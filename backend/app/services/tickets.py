import logging
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
from app.services import notifications
from app.services.audit import log_action
from app.services.errors import ServiceError
from app.services.numbering import next_number
from app.services.realtime import publish_event
from app.services.wait_estimate import estimate_wait_seconds

logger = logging.getLogger(__name__)

_APPROACHING_POSITION = 3

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
    note: str | None = None,
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

    # note (e.g. a registrar's visitor name) has nowhere on the ticket row
    # itself — it's called out or printed on the spot, not looked up later —
    # so it only lives in the audit trail.
    payload = {"queue_id": queue.id, "display_number": display_number, "source": source}
    if note:
        payload["note"] = note

    await log_action(
        db,
        actor_type=resolved_actor_type,
        actor_id=resolved_actor_id,
        action="ticket.created",
        entity_type="ticket",
        entity_id=ticket.id,
        organization_id=organization.id,
        payload=jsonable_encoder(payload),
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
    # Commit before publishing, in every transition function below: a WS
    # push that beats the commit to a subscriber's re-read gets pre-commit
    # (i.e. stale) data — reproduced via a live socket during step 6's
    # confirm(). The caller's own commit afterward becomes a no-op.
    await db.commit()
    await publish_event(redis, queue.id, "ticket.called", ticket_id=str(ticket.id), status=ticket.status.value)

    # Push is best-effort and strictly after the transition is durable and
    # published — a delivery failure (or the whole push service being down)
    # must never turn a successful call into a failed HTTP response.
    try:
        await _notify_called(db, ticket)
    except Exception:
        logger.exception("push notification for ticket.called failed")
    try:
        await _notify_approaching_position(db, queue)
    except Exception:
        logger.exception("push notification for approaching position failed")

    return ticket


async def _notify_called(db: AsyncSession, ticket: Ticket) -> None:
    if ticket.client_id is None:
        return
    client = await db.get(Client, ticket.client_id)
    if client is None:
        return

    cabinet_label = None
    if ticket.cabinet_id is not None:
        cabinet = await db.get(Cabinet, ticket.cabinet_id)
        cabinet_label = cabinet.label if cabinet is not None else None

    body = f"Подойдите к {cabinet_label}." if cabinet_label else "Подойдите к окну приёма."
    await notifications.notify_client(
        db,
        client.id,
        {
            "title": f"Вас вызывают — {ticket.display_number}",
            "body": body,
            "ticket_id": str(ticket.id),
        },
    )


async def _notify_approaching_position(db: AsyncSession, queue: Queue) -> None:
    """Pings whoever is now exactly _APPROACHING_POSITION-th in line — not
    everyone at or under that position on every recompute, which would spam
    a ticket once for every call ahead of it. `position_notified` makes this
    a one-time signal per ticket even if it re-enters that position later
    (e.g. after a no_show `return`).
    """
    result = await db.execute(
        select(Ticket)
        .where(Ticket.queue_id == queue.id, Ticket.status == TicketStatus.waiting)
        .order_by(Ticket.called_at.is_(None), Ticket.called_at, Ticket.created_at)
        .limit(_APPROACHING_POSITION)
    )
    waiting = list(result.scalars().all())
    if len(waiting) < _APPROACHING_POSITION:
        return

    ticket = waiting[_APPROACHING_POSITION - 1]
    if ticket.position_notified or ticket.client_id is None:
        return

    ticket.position_notified = True
    await db.flush()
    await db.commit()

    client = await db.get(Client, ticket.client_id)
    if client is None:
        return
    await notifications.notify_client(
        db,
        client.id,
        {
            "title": f"Скоро ваша очередь — {ticket.display_number}",
            "body": "Вы примерно третий в очереди — будьте рядом.",
            "ticket_id": str(ticket.id),
        },
    )


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
    await db.commit()
    await publish_event(redis, ticket.queue_id, "ticket.updated", ticket_id=str(ticket.id), status=ticket.status.value)
    return ticket


async def confirm(
    db: AsyncSession, redis: Redis, *, ticket: Ticket, client: Client, now: datetime | None = None
) -> Ticket:
    """Client presses "я здесь" after being called — called -> confirmed
    (ARCHITECTURE.md section 3). The operator can still start serving
    straight from `called`, confirm is just the visitor's own signal.
    """
    now = now or utcnow()
    _require_status(ticket, TicketStatus.called)

    ticket.status = TicketStatus.confirmed
    ticket.confirmed_at = now
    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.client,
        actor_id=client.id,
        action="ticket.confirmed",
        entity_type="ticket",
        entity_id=ticket.id,
        organization_id=ticket.organization_id,
    )
    await db.commit()
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
    await db.commit()
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
    await db.commit()
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
    await db.commit()
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
    await db.commit()
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
    # Commit the old ticket's transferred state on its own before publishing
    # — it's a complete, valid state by itself, and create_ticket() below
    # (for the new ticket) still commits later via the caller, unchanged,
    # since it's also reachable directly from scan()/register_ticket() and
    # committing it early here would break create_ticket() being able to
    # be part of one atomic transaction in those direct-call cases.
    await db.commit()
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
    """Client leaves the queue voluntarily."""
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
    await db.commit()
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

    estimated_wait_seconds = None
    if position is not None:
        organization = await db.get(Organization, ticket.organization_id)
        avg_seconds = await estimate_wait_seconds(db, queue, organization)
        if avg_seconds is not None:
            estimated_wait_seconds = avg_seconds * position

    return {
        "id": ticket.id,
        "queue_id": ticket.queue_id,
        "display_number": ticket.display_number,
        "status": ticket.status,
        "created_at": ticket.created_at,
        "position": position,
        "queue_status": queue.status,
        "now_serving": now_serving,
        "estimated_wait_seconds": estimated_wait_seconds,
        "cabinet": cabinet,
    }
