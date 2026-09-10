from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import local_date
from app.models.enums import AuditActorType
from app.models.organization import Organization
from app.models.queue import Queue, QueueSchedule
from app.models.user import User
from app.schemas.queue import QueueCreate, QueueUpdate, ScheduleEntry, validate_geo_fields
from app.services.audit import log_action


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
    await db.flush()

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


async def replace_schedule(
    db: AsyncSession, queue: Queue, entries: list[ScheduleEntry], actor: User
) -> list[QueueSchedule]:
    await db.execute(delete(QueueSchedule).where(QueueSchedule.queue_id == queue.id))

    rows = [
        QueueSchedule(queue_id=queue.id, weekday=entry.weekday, opens_at=entry.opens_at, closes_at=entry.closes_at)
        for entry in entries
    ]
    db.add_all(rows)
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
