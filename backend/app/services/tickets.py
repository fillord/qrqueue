import uuid
from datetime import datetime

from fastapi.encoders import jsonable_encoder
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models.cabinet import Cabinet
from app.models.client import Client
from app.models.enums import AuditActorType, CabinetStatus, QueueStatus, TicketSource, TicketStatus
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.models.user import User
from app.services.audit import log_action
from app.services.errors import ServiceError
from app.services.numbering import next_number
from app.services.realtime import publish_event

_CALLED_LIKE_STATUSES = (TicketStatus.called, TicketStatus.serving)
_ACTIVE_STATUSES = (
    TicketStatus.waiting,
    TicketStatus.called,
    TicketStatus.confirmed,
    TicketStatus.serving,
)


def _require_status(ticket: Ticket, *allowed: TicketStatus) -> None:
    if ticket.status not in allowed:
        raise ServiceError("invalid_transition", 409, status=ticket.status.value)


async def create_ticket(
    db: AsyncSession,
    redis: Redis,
    *,
    organization: Organization,
    queue: Queue,
    source: TicketSource,
    client: Client | None = None,
    transferred_from: uuid.UUID | None = None,
    actor_type: AuditActorType | None = None,
    actor_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> Ticket:
    number, display_number = await next_number(db, queue, organization, now)

    ticket = Ticket(
        organization_id=organization.id,
        queue_id=queue.id,
        client_id=client.id if client else None,
        number=number,
        display_number=display_number,
        status=TicketStatus.waiting,
        source=source,
        transferred_from=transferred_from,
    )
    db.add(ticket)
    await db.flush()

    resolved_actor_type = actor_type or (AuditActorType.client if client else AuditActorType.system)
    resolved_actor_id = actor_id if actor_id is not None else (client.id if client else None)

    await log_action(
        db,
        actor_type=resolved_actor_type,
        actor_id=resolved_actor_id,
        action="ticket.created",
        entity_type="ticket",
        entity_id=ticket.id,
        organization_id=organization.id,
        payload=jsonable_encoder(
            {"queue_id": queue.id, "display_number": display_number, "source": source}
        ),
    )
    await publish_event(redis, queue.id, "ticket.created", ticket_id=str(ticket.id), status=ticket.status.value)
    return ticket


async def call_next(
    db: AsyncSession,
    redis: Redis,
    *,
    queue: Queue,
    cabinet: Cabinet,
    operator: User,
    now: datetime | None = None,
) -> Ticket:
    now = now or utcnow()

    if cabinet.status != CabinetStatus.free:
        raise ServiceError("cabinet_busy", 409)

    # Tickets with called_at already set (returned from no_show) are ordered
    # first, oldest called_at first; pure waiting tickets follow by created_at.
    result = await db.execute(
        select(Ticket)
        .where(Ticket.queue_id == queue.id, Ticket.status == TicketStatus.waiting)
        .order_by(Ticket.called_at.is_(None), Ticket.called_at, Ticket.created_at)
        .limit(1)
        .with_for_update()
    )
    ticket = result.scalar_one_or_none()
    if ticket is None:
        raise ServiceError("queue_empty", 404)

    ticket.status = TicketStatus.called
    ticket.cabinet_id = cabinet.id
    ticket.called_by = operator.id
    ticket.called_at = now
    ticket.call_count = 1

    cabinet.status = CabinetStatus.busy
    cabinet.current_ticket_id = ticket.id

    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=operator.id,
        action="ticket.called",
        entity_type="ticket",
        entity_id=ticket.id,
        organization_id=queue.organization_id,
        payload={"cabinet_id": str(cabinet.id), "queue_id": str(queue.id)},
    )
    await publish_event(redis, queue.id, "ticket.called", ticket_id=str(ticket.id), status=ticket.status.value)
    return ticket


async def recall(
    db: AsyncSession, redis: Redis, *, ticket: Ticket, operator: User, now: datetime | None = None
) -> Ticket:
    _require_status(ticket, TicketStatus.called)

    ticket.call_count += 1
    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=operator.id,
        action="ticket.recalled",
        entity_type="ticket",
        entity_id=ticket.id,
        organization_id=ticket.organization_id,
        payload={"call_count": ticket.call_count},
    )
    await publish_event(redis, ticket.queue_id, "ticket.updated", ticket_id=str(ticket.id), status=ticket.status.value)
    return ticket


async def mark_no_show(
    db: AsyncSession,
    redis: Redis,
    *,
    ticket: Ticket,
    actor_type: AuditActorType,
    actor_id: uuid.UUID | None,
    now: datetime | None = None,
) -> Ticket:
    _require_status(ticket, TicketStatus.called, TicketStatus.confirmed)

    ticket.status = TicketStatus.no_show

    if ticket.cabinet_id is not None:
        cabinet = await db.get(Cabinet, ticket.cabinet_id)
        if cabinet is not None:
            cabinet.status = CabinetStatus.free
            cabinet.current_ticket_id = None

    await db.flush()

    await log_action(
        db,
        actor_type=actor_type,
        actor_id=actor_id,
        action="ticket.no_show",
        entity_type="ticket",
        entity_id=ticket.id,
        organization_id=ticket.organization_id,
    )
    await publish_event(redis, ticket.queue_id, "ticket.updated", ticket_id=str(ticket.id), status=ticket.status.value)
    return ticket


async def return_to_queue(
    db: AsyncSession, redis: Redis, *, ticket: Ticket, operator: User, now: datetime | None = None
) -> Ticket:
    _require_status(ticket, TicketStatus.no_show)

    ticket.status = TicketStatus.waiting
    ticket.cabinet_id = None
    # called_at is intentionally left as-is: call_next orders returned
    # tickets ahead of fresh waiting ones by that preserved timestamp.

    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=operator.id,
        action="ticket.returned",
        entity_type="ticket",
        entity_id=ticket.id,
        organization_id=ticket.organization_id,
    )
    await publish_event(redis, ticket.queue_id, "ticket.updated", ticket_id=str(ticket.id), status=ticket.status.value)
    return ticket


async def start_serving(
    db: AsyncSession, redis: Redis, *, ticket: Ticket, operator: User, now: datetime | None = None
) -> Ticket:
    now = now or utcnow()
    _require_status(ticket, TicketStatus.called, TicketStatus.confirmed)

    ticket.status = TicketStatus.serving
    ticket.serving_started_at = now
    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=operator.id,
        action="ticket.serving_started",
        entity_type="ticket",
        entity_id=ticket.id,
        organization_id=ticket.organization_id,
    )
    await publish_event(redis, ticket.queue_id, "ticket.updated", ticket_id=str(ticket.id), status=ticket.status.value)
    return ticket


async def finish(
    db: AsyncSession, redis: Redis, *, ticket: Ticket, operator: User, now: datetime | None = None
) -> Ticket:
    now = now or utcnow()
    _require_status(ticket, TicketStatus.serving)

    ticket.status = TicketStatus.served
    ticket.finished_at = now

    if ticket.cabinet_id is not None:
        cabinet = await db.get(Cabinet, ticket.cabinet_id)
        if cabinet is not None:
            cabinet.status = CabinetStatus.free
            cabinet.current_ticket_id = None

    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=operator.id,
        action="ticket.finished",
        entity_type="ticket",
        entity_id=ticket.id,
        organization_id=ticket.organization_id,
    )
    await publish_event(redis, ticket.queue_id, "ticket.updated", ticket_id=str(ticket.id), status=ticket.status.value)
    return ticket


async def transfer(
    db: AsyncSession,
    redis: Redis,
    *,
    ticket: Ticket,
    target_queue: Queue,
    organization: Organization,
    operator: User,
    now: datetime | None = None,
) -> Ticket:
    now = now or utcnow()
    _require_status(ticket, TicketStatus.waiting, TicketStatus.called, TicketStatus.confirmed)

    if target_queue.status != QueueStatus.open or not target_queue.is_active:
        raise ServiceError("target_queue_unavailable", 409)

    ticket.status = TicketStatus.transferred

    if ticket.cabinet_id is not None:
        cabinet = await db.get(Cabinet, ticket.cabinet_id)
        if cabinet is not None:
            cabinet.status = CabinetStatus.free
            cabinet.current_ticket_id = None

    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=operator.id,
        action="ticket.transferred",
        entity_type="ticket",
        entity_id=ticket.id,
        organization_id=ticket.organization_id,
        payload={"target_queue_id": str(target_queue.id)},
    )
    await publish_event(redis, ticket.queue_id, "ticket.updated", ticket_id=str(ticket.id), status=ticket.status.value)

    client = await db.get(Client, ticket.client_id) if ticket.client_id else None
    return await create_ticket(
        db,
        redis,
        organization=organization,
        queue=target_queue,
        source=TicketSource.transfer,
        client=client,
        transferred_from=ticket.id,
        actor_type=AuditActorType.user,
        actor_id=operator.id,
        now=now,
    )


async def leave(
    db: AsyncSession, redis: Redis, *, ticket: Ticket, client: Client, now: datetime | None = None
) -> Ticket:
    """Client leaves the queue voluntarily. No route yet — that's step 6."""
    _require_status(ticket, TicketStatus.waiting, TicketStatus.called, TicketStatus.confirmed)

    ticket.status = TicketStatus.left

    if ticket.cabinet_id is not None:
        cabinet = await db.get(Cabinet, ticket.cabinet_id)
        if cabinet is not None:
            cabinet.status = CabinetStatus.free
            cabinet.current_ticket_id = None

    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.client,
        actor_id=client.id,
        action="ticket.left",
        entity_type="ticket",
        entity_id=ticket.id,
        organization_id=ticket.organization_id,
    )
    await publish_event(redis, ticket.queue_id, "ticket.updated", ticket_id=str(ticket.id), status=ticket.status.value)
    return ticket


async def get_position(db: AsyncSession, ticket: Ticket) -> int | None:
    if ticket.status != TicketStatus.waiting:
        return None

    result = await db.execute(
        select(func.count())
        .select_from(Ticket)
        .where(
            Ticket.queue_id == ticket.queue_id,
            Ticket.status == TicketStatus.waiting,
            Ticket.created_at < ticket.created_at,
        )
    )
    earlier = result.scalar_one()
    return earlier + 1


async def get_now_serving(db: AsyncSession, queue_id: uuid.UUID) -> str | None:
    result = await db.execute(
        select(Ticket)
        .where(Ticket.queue_id == queue_id, Ticket.status.in_(_CALLED_LIKE_STATUSES))
        .order_by(Ticket.called_at.desc())
        .limit(1)
    )
    current = result.scalar_one_or_none()
    return current.display_number if current else None


async def build_ticket_detail(db: AsyncSession, ticket: Ticket) -> dict:
    queue = await db.get(Queue, ticket.queue_id)
    position = await get_position(db, ticket)
    now_serving = await get_now_serving(db, ticket.queue_id)

    cabinet = None
    if ticket.status in (TicketStatus.called, TicketStatus.confirmed, TicketStatus.serving) and ticket.cabinet_id:
        cabinet_row = await db.get(Cabinet, ticket.cabinet_id)
        if cabinet_row is not None:
            cabinet = {"id": cabinet_row.id, "label": cabinet_row.label}

    return {
        "id": ticket.id,
        "queue_id": ticket.queue_id,
        "display_number": ticket.display_number,
        "status": ticket.status,
        "created_at": ticket.created_at,
        "position": position,
        "queue_status": queue.status,
        "now_serving": now_serving,
        "estimated_wait_minutes": None,
        "cabinet": cabinet,
    }
