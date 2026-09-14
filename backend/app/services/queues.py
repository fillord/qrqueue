import uuid

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import local_date
from app.models.enums import AuditActorType, QueueStatus, TicketStatus
from app.models.organization import Organization
from app.models.queue import Queue, QueueSchedule
from app.models.ticket import Ticket
from app.models.user import User
from app.schemas.queue import QueueCreate, QueueUpdate, ScheduleEntry, validate_geo_fields
from app.services.audit import log_action
from app.services.realtime import defer_event, organization_channel, queue_channel


async def create_queue_record(
    db: AsyncSession,
    organization: Organization,
    *,
    name: str,
    ticket_prefix: str,
    status_: str,
    latitude: float | None = None,
    longitude: float | None = None,
    geo_radius_m: int | None = None,
    presence_timeout_min: int | None = None,
    daily_ticket_limit: int | None = None,
) -> Queue:
    kwargs = dict(
        organization_id=organization.id,
        name=name,
        ticket_prefix=ticket_prefix,
        status=status_,
        latitude=latitude,
        longitude=longitude,
        geo_radius_m=geo_radius_m,
        daily_ticket_limit=daily_ticket_limit,
        counter_date=local_date(organization.timezone),
        manually_paused=status_ == "paused",
    )
    if presence_timeout_min is not None:
        kwargs["presence_timeout_min"] = presence_timeout_min

    queue = Queue(**kwargs)
    db.add(queue)
    await db.flush()
    return queue


async def create_queue(
    db: AsyncSession, organization: Organization, payload: QueueCreate, actor: User
) -> Queue:
    queue = await create_queue_record(
        db,
        organization,
        name=payload.name,
        ticket_prefix=payload.ticket_prefix,
        status_=payload.status,
        latitude=payload.latitude,
        longitude=payload.longitude,
        geo_radius_m=payload.geo_radius_m,
        presence_timeout_min=payload.presence_timeout_min,
        daily_ticket_limit=payload.daily_ticket_limit,
    )

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=actor.id,
        action="queue.created",
        entity_type="queue",
        entity_id=queue.id,
        organization_id=organization.id,
        payload=jsonable_encoder(payload.model_dump()),
    )
    defer_event(db, organization_channel(organization.id), "queue.created", queue_id=str(queue.id))
    return queue


async def update_queue(db: AsyncSession, queue: Queue, payload: QueueUpdate, actor: User) -> Queue:
    changes = payload.model_dump(exclude_unset=True)

    latitude = changes.get("latitude", queue.latitude)
    longitude = changes.get("longitude", queue.longitude)
    geo_radius_m = changes.get("geo_radius_m", queue.geo_radius_m)
    try:
        validate_geo_fields(latitude, longitude, geo_radius_m)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))

    for field, value in changes.items():
        setattr(queue, field, value)
    if "status" in changes:
        queue.manually_paused = changes["status"] == QueueStatus.paused
    await db.flush()

    # Live screens re-read their snapshot on any event: status changes go to
    # the queue's own channel, everything else (rename, deactivation) to the
    # organization channel so hall screens re-resolve which queues to show.
    if "status" in changes:
        defer_event(db, queue_channel(queue.id), "queue.status", status=queue.status.value)
    if changes:
        defer_event(db, queue_channel(queue.id), "queue.updated", queue_id=str(queue.id))
        defer_event(db, organization_channel(queue.organization_id), "queue.updated", queue_id=str(queue.id))

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=actor.id,
        action="queue.updated",
        entity_type="queue",
        entity_id=queue.id,
        organization_id=queue.organization_id,
        payload=jsonable_encoder(changes),
    )
    return queue


async def list_queues_with_waiting_counts(
    db: AsyncSession, organization_id: uuid.UUID
) -> list[tuple[Queue, int]]:
    """One GROUP BY pass, not N+1 — waiting_count per queue for the admin queues list."""
    waiting_counts = (
        select(Ticket.queue_id, func.count().label("cnt"))
        .where(Ticket.status == TicketStatus.waiting)
        .group_by(Ticket.queue_id)
        .subquery()
    )
    result = await db.execute(
        select(Queue, func.coalesce(waiting_counts.c.cnt, 0))
        .outerjoin(waiting_counts, waiting_counts.c.queue_id == Queue.id)
        .where(Queue.organization_id == organization_id)
        .order_by(Queue.name)
    )
    return [(queue, int(count)) for queue, count in result.all()]


async def get_schedule(db: AsyncSession, queue: Queue) -> list[QueueSchedule]:
    result = await db.execute(
        select(QueueSchedule).where(QueueSchedule.queue_id == queue.id).order_by(QueueSchedule.weekday)
    )
    return list(result.scalars().all())


async def replace_schedule(
    db: AsyncSession, queue: Queue, entries: list[ScheduleEntry], actor: User
) -> list[QueueSchedule]:
    await db.execute(delete(QueueSchedule).where(QueueSchedule.queue_id == queue.id))

    rows = [
        QueueSchedule(queue_id=queue.id, weekday=entry.weekday, opens_at=entry.opens_at, closes_at=entry.closes_at)
        for entry in entries
    ]
    db.add_all(rows)
    queue.schedule_open = None  # the schedule worker re-baselines on its next tick
    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=actor.id,
        action="queue.schedule_updated",
        entity_type="queue",
        entity_id=queue.id,
        organization_id=queue.organization_id,
        payload=jsonable_encoder({"schedule": [e.model_dump() for e in entries]}),
    )
    return rows
