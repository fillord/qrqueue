import logging
import uuid
from datetime import datetime, timedelta

from fastapi.encoders import jsonable_encoder
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import local_date, utcnow
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
from app.services.queue_order import waiting_order
from app.services.queue_availability import within_schedule
from app.services.realtime import publish_event
from app.services.wait_estimate import estimate_wait_seconds

logger = logging.getLogger(__name__)

_APPROACHING_POSITION = 3

_CALLED_LIKE_STATUSES = (TicketStatus.called, TicketStatus.confirmed, TicketStatus.serving)
_ACTIVE_STATUSES = (
    TicketStatus.waiting,
    TicketStatus.called,
    TicketStatus.confirmed,
    TicketStatus.serving,
)


def _require_status(ticket: Ticket, *allowed: TicketStatus) -> None:
    if ticket.status not in allowed:
        raise ServiceError("invalid_transition", 409, status=ticket.status.value)


async def _lock_queues(db: AsyncSession, *queue_ids: uuid.UUID) -> None:
    # Ticket mutations of one queue share its row lock. Transfers lock both
    # queues in UUID order, avoiding opposite-direction transfer deadlocks.
    await db.execute(
        select(Queue).where(Queue.id.in_(queue_ids)).order_by(Queue.id)
        .with_for_update().execution_options(populate_existing=True)
    )


async def _lock_client(db: AsyncSession, client_id: uuid.UUID | None) -> None:
    if client_id is not None:
        await db.execute(select(Client).where(Client.id == client_id).with_for_update())


async def _lock_ticket(db: AsyncSession, ticket: Ticket) -> None:
    await _lock_queues(db, ticket.queue_id)
    await db.refresh(ticket, with_for_update=True)


async def _active_ticket(
    db: AsyncSession,
    client_id: uuid.UUID,
    queue: Queue,
    organization: Organization,
    exclude_id: uuid.UUID | None = None,
) -> Ticket | None:
    stmt = select(Ticket).where(Ticket.client_id == client_id, Ticket.status.in_(_ACTIVE_STATUSES))
    if organization.one_ticket_per_org:
        stmt = stmt.where(Ticket.organization_id == organization.id)
    else:
        stmt = stmt.where(Ticket.queue_id == queue.id)
    if exclude_id is not None:
        stmt = stmt.where(Ticket.id != exclude_id)
    return (await db.execute(stmt)).scalars().first()


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
    commit: bool = True,
) -> Ticket:
    # Client first serializes the organization-wide active-ticket limit
    # even when two requests target different queues.
    await _lock_client(db, client.id if client else None)
    await _lock_queues(db, queue.id)
    now = now or utcnow()

    if not organization.is_active or not queue.is_active or queue.status == QueueStatus.closed:
        raise ServiceError("queue_closed", 422)
    if queue.status == QueueStatus.paused:
        raise ServiceError("queue_paused", 422)
    today = local_date(organization.timezone, now)
    if not await within_schedule(db, queue, today, now, organization.timezone):
        raise ServiceError("outside_schedule", 422)
    issued_today = queue.last_ticket_number if queue.counter_date == today else 0
    if queue.daily_ticket_limit is not None and issued_today >= queue.daily_ticket_limit:
        raise ServiceError("daily_limit_reached", 422)
    if client:
        existing = await _active_ticket(db, client.id, queue, organization)
        if existing:
            raise ServiceError("already_in_queue", 409, ticket_id=str(existing.id))
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
    if commit:
        await db.commit()
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

    await _lock_queues(db, queue.id)
    await db.refresh(cabinet, with_for_update=True)
    if cabinet.status != CabinetStatus.free or cabinet.current_ticket_id is not None:
        raise ServiceError("cabinet_busy", 409)

    # Tickets with called_at already set (returned from no_show) are ordered
    # first, oldest called_at first; pure waiting tickets follow by created_at.
    result = await db.execute(
        select(Ticket)
        .where(Ticket.queue_id == queue.id, Ticket.status == TicketStatus.waiting)
        .order_by(*waiting_order())
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

    await notifications.notify_client(db, client.id, notifications.ticket_message(client.language, "called", ticket, cabinet_label))


async def _notify_approaching_position(db: AsyncSession, queue: Queue) -> None:
    result = await db.execute(
        select(Ticket).where(Ticket.queue_id == queue.id, Ticket.status == TicketStatus.waiting)
        .order_by(*waiting_order()).limit(_APPROACHING_POSITION)
    )
    candidates = [ticket for ticket in result.scalars().all() if ticket.client_id and not ticket.position_notified]
    for ticket in candidates:
        # An atomic claim prevents concurrent queue transitions from notifying twice.
        from sqlalchemy import update
        claimed = await db.execute(update(Ticket).where(
            Ticket.id == ticket.id, Ticket.position_notified.is_(False), Ticket.status == TicketStatus.waiting
        ).values(position_notified=True).returning(Ticket.id))
        if claimed.scalar_one_or_none() is None:
            continue
        await db.commit()
        client = await db.get(Client, ticket.client_id)
        if client:
            await notifications.notify_client(db, client.id, notifications.ticket_message(client.language, "approaching", ticket))


async def _notify_after_change(db: AsyncSession, ticket: Ticket, kind: str | None = None) -> None:
    try:
        if kind and ticket.client_id:
            client = await db.get(Client, ticket.client_id)
            if client:
                await notifications.notify_client(db, client.id, notifications.ticket_message(client.language, kind, ticket))
        queue = await db.get(Queue, ticket.queue_id)
        await _notify_approaching_position(db, queue)
    except Exception:
        logger.exception("push notification after ticket transition failed")


async def recall(
    db: AsyncSession, redis: Redis, *, ticket: Ticket, operator: User, now: datetime | None = None
) -> Ticket:
    await _lock_ticket(db, ticket)
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
    await _lock_ticket(db, ticket)
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
    await _lock_ticket(db, ticket)
    if actor_type == AuditActorType.system:
        queue = await db.get(Queue, ticket.queue_id)
        deadline = ticket.called_at + timedelta(minutes=queue.presence_timeout_min) if ticket.called_at else None
        if ticket.status != TicketStatus.called or deadline is None or deadline > (now or utcnow()):
            return ticket
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
    await _notify_after_change(db, ticket, "missed")
    return ticket


async def return_to_queue(
    db: AsyncSession, redis: Redis, *, ticket: Ticket, operator: User, now: datetime | None = None
) -> Ticket:
    await _lock_client(db, ticket.client_id)
    await _lock_ticket(db, ticket)
    _require_status(ticket, TicketStatus.no_show)

    if ticket.client_id:
        queue = await db.get(Queue, ticket.queue_id)
        organization = await db.get(Organization, ticket.organization_id)
        existing = await _active_ticket(db, ticket.client_id, queue, organization, exclude_id=ticket.id)
        if existing:
            raise ServiceError("already_in_queue", 409, ticket_id=str(existing.id))

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
    await _notify_after_change(db, ticket, None)
    return ticket


async def start_serving(
    db: AsyncSession, redis: Redis, *, ticket: Ticket, operator: User, now: datetime | None = None
) -> Ticket:
    now = now or utcnow()
    await _lock_ticket(db, ticket)
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
    await _lock_ticket(db, ticket)
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
    await _lock_client(db, ticket.client_id)
    await _lock_queues(db, ticket.queue_id, target_queue.id)
    await db.refresh(ticket, with_for_update=True)
    _require_status(ticket, TicketStatus.waiting, TicketStatus.called, TicketStatus.confirmed)

    if target_queue.status != QueueStatus.open or not target_queue.is_active:
        raise ServiceError("target_queue_unavailable", 409)

    async with db.begin_nested():
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
        client = await db.get(Client, ticket.client_id) if ticket.client_id else None
        new_ticket = await create_ticket(
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
            commit=False,
        )
    await db.commit()
    await publish_event(redis, ticket.queue_id, "ticket.updated", ticket_id=str(ticket.id), status=ticket.status.value)
    await publish_event(redis, new_ticket.queue_id, "ticket.created", ticket_id=str(new_ticket.id), status=new_ticket.status.value)
    await _notify_after_change(db, ticket)
    await _notify_after_change(db, new_ticket)
    return new_ticket


async def leave(
    db: AsyncSession, redis: Redis, *, ticket: Ticket, client: Client, now: datetime | None = None
) -> Ticket:
    """Client leaves the queue voluntarily."""
    await _lock_ticket(db, ticket)
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
    await _notify_after_change(db, ticket, None)
    return ticket


async def rate(
    db: AsyncSession, *, ticket: Ticket, client: Client, rating: int, comment: str | None = None
) -> Ticket:
    """Client rates a served ticket — one rating per ticket, no realtime
    event (not part of the ARCHITECTURE.md section 5 event set)."""
    await _lock_ticket(db, ticket)
    _require_status(ticket, TicketStatus.served)
    if ticket.rating is not None:
        raise ServiceError("already_rated", 409)

    ticket.rating = rating
    ticket.rating_comment = comment
    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.client,
        actor_id=client.id,
        action="ticket.rated",
        entity_type="ticket",
        entity_id=ticket.id,
        organization_id=ticket.organization_id,
        payload={"rating": rating},
    )
    await db.commit()
    return ticket


async def get_position(db: AsyncSession, ticket: Ticket) -> int | None:
    if ticket.status != TicketStatus.waiting:
        return None

    ranked = select(
        Ticket.id, func.row_number().over(order_by=waiting_order()).label("position")
    ).where(Ticket.queue_id == ticket.queue_id, Ticket.status == TicketStatus.waiting).subquery()
    return (await db.execute(select(ranked.c.position).where(ranked.c.id == ticket.id))).scalar_one_or_none()


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
    organization = await db.get(Organization, ticket.organization_id)
    position = await get_position(db, ticket)
    now_serving = await get_now_serving(db, ticket.queue_id)

    cabinet = None
    if ticket.status in (TicketStatus.called, TicketStatus.confirmed, TicketStatus.serving) and ticket.cabinet_id:
        cabinet_row = await db.get(Cabinet, ticket.cabinet_id)
        if cabinet_row is not None:
            cabinet = {"id": cabinet_row.id, "label": cabinet_row.label}

    estimated_wait_seconds = None
    if position is not None:
        avg_seconds = await estimate_wait_seconds(db, queue, organization)
        if avg_seconds is not None:
            capacity = (await db.execute(select(func.count()).select_from(Cabinet).where(
                Cabinet.queue_id == queue.id, Cabinet.is_active.is_(True),
                Cabinet.status.in_((CabinetStatus.free, CabinetStatus.busy)),
            ))).scalar_one()
            if capacity and queue.status == QueueStatus.open:
                estimated_wait_seconds = round(avg_seconds * position / capacity)

    next_ticket_id = None
    if ticket.status == TicketStatus.transferred:
        next_ticket_id = (await db.execute(
            select(Ticket.id).where(Ticket.transferred_from == ticket.id, Ticket.client_id == ticket.client_id)
        )).scalar_one_or_none()

    return {
        "id": ticket.id,
        "queue_id": ticket.queue_id,
        "organization_name": organization.name,
        "queue_name": queue.name,
        "display_number": ticket.display_number,
        "status": ticket.status,
        "created_at": ticket.created_at,
        "position": position,
        "queue_status": queue.status,
        "now_serving": now_serving,
        "estimated_wait_seconds": estimated_wait_seconds,
        "cabinet": cabinet,
        "rating": ticket.rating,
        "next_ticket_id": next_ticket_id,
    }
