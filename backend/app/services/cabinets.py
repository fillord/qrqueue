import uuid
from datetime import datetime

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cabinet import Cabinet, CabinetOperator
from app.models.enums import AuditActorType, CabinetStatus, QueueStatus, UserRole
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.user import User
from app.schemas.cabinet import CabinetCreate, CabinetUpdate
from app.services.audit import log_action
from app.services.errors import ServiceError
from app.services.queues import create_queue_record
from app.services.realtime import publish_event

OPERATOR_CABINET_TTL_SECONDS = 12 * 60 * 60


async def create_cabinet(
    db: AsyncSession, organization: Organization, payload: CabinetCreate, actor: User
) -> Cabinet:
    if payload.queue_id is not None:
        queue = await db.get(Queue, payload.queue_id)
        if queue is None or queue.organization_id != organization.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Queue not found")
        queue_id = queue.id
    else:
        prefix = payload.label.strip()[:1].upper() or "A"
        auto_queue = await create_queue_record(
            db,
            organization,
            name=payload.label,
            ticket_prefix=prefix,
            status_=QueueStatus.open,
        )
        await log_action(
            db,
            actor_type=AuditActorType.user,
            actor_id=actor.id,
            action="queue.created",
            entity_type="queue",
            entity_id=auto_queue.id,
            organization_id=organization.id,
            payload=jsonable_encoder({"name": auto_queue.name, "auto_created_for_cabinet": True}),
        )
        queue_id = auto_queue.id

    cabinet = Cabinet(organization_id=organization.id, queue_id=queue_id, label=payload.label)
    db.add(cabinet)
    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=actor.id,
        action="cabinet.created",
        entity_type="cabinet",
        entity_id=cabinet.id,
        organization_id=organization.id,
        payload=jsonable_encoder({"label": payload.label, "queue_id": queue_id}),
    )
    return cabinet


async def update_cabinet(
    db: AsyncSession, cabinet: Cabinet, payload: CabinetUpdate, actor: User
) -> Cabinet:
    changes = payload.model_dump(exclude_unset=True)

    if "queue_id" in changes and changes["queue_id"] is not None:
        queue = await db.get(Queue, changes["queue_id"])
        if queue is None or queue.organization_id != cabinet.organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Queue not found")

    for field, value in changes.items():
        setattr(cabinet, field, value)
    await db.flush()

    action = "cabinet.deactivated" if changes.get("is_active") is False else "cabinet.updated"
    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=actor.id,
        action=action,
        entity_type="cabinet",
        entity_id=cabinet.id,
        organization_id=cabinet.organization_id,
        payload=jsonable_encoder(changes),
    )
    return cabinet


async def assign_operator(
    db: AsyncSession, cabinet: Cabinet, user_id: uuid.UUID, actor: User
) -> None:
    operator = await db.get(User, user_id)
    if (
        operator is None
        or operator.organization_id != cabinet.organization_id
        or operator.role != UserRole.operator
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operator not found")

    existing = await db.get(CabinetOperator, (cabinet.id, user_id))
    if existing is not None:
        return

    db.add(CabinetOperator(cabinet_id=cabinet.id, user_id=user_id))
    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=actor.id,
        action="cabinet.operator_assigned",
        entity_type="cabinet",
        entity_id=cabinet.id,
        organization_id=cabinet.organization_id,
        payload={"user_id": str(user_id)},
    )


async def unassign_operator(
    db: AsyncSession, cabinet: Cabinet, user_id: uuid.UUID, actor: User
) -> None:
    existing = await db.get(CabinetOperator, (cabinet.id, user_id))
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not assigned")

    await db.delete(existing)
    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=actor.id,
        action="cabinet.operator_unassigned",
        entity_type="cabinet",
        entity_id=cabinet.id,
        organization_id=cabinet.organization_id,
        payload={"user_id": str(user_id)},
    )


def _operator_cabinet_key(operator_id: uuid.UUID) -> str:
    return f"operator:{operator_id}:cabinet"


async def select_cabinet(
    db: AsyncSession, redis: Redis, *, operator: User, cabinet_id: uuid.UUID
) -> Cabinet:
    """Only a cabinet the operator is assigned to (via cabinet_operators) may be selected."""
    cabinet = await db.get(Cabinet, cabinet_id)
    if cabinet is None or not cabinet.is_active or cabinet.organization_id != operator.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    assignment = await db.get(CabinetOperator, (cabinet_id, operator.id))
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    if cabinet.status == CabinetStatus.offline:
        cabinet.status = CabinetStatus.free
        await db.flush()

    await redis.set(_operator_cabinet_key(operator.id), str(cabinet.id), ex=OPERATOR_CABINET_TTL_SECONDS)
    return cabinet


async def _sync_queue_status_after_cabinet_change(
    db: AsyncSession, redis: Redis, cabinet: Cabinet
) -> None:
    if cabinet.queue_id is None:
        return
    queue = await db.get(Queue, cabinet.queue_id)
    if queue is None or queue.status == QueueStatus.closed:
        return

    result = await db.execute(
        select(Cabinet).where(Cabinet.queue_id == queue.id, Cabinet.is_active.is_(True))
    )
    active_cabinets = list(result.scalars().all())

    all_paused = bool(active_cabinets) and all(c.status == CabinetStatus.paused for c in active_cabinets)
    if all_paused and queue.status != QueueStatus.paused:
        queue.status = QueueStatus.paused
        await db.flush()
        await publish_event(redis, queue.id, "queue.status", status=queue.status.value)
    elif not all_paused and queue.status == QueueStatus.paused:
        queue.status = QueueStatus.open
        await db.flush()
        await publish_event(redis, queue.id, "queue.status", status=queue.status.value)


async def pause_cabinet(
    db: AsyncSession,
    redis: Redis,
    *,
    cabinet: Cabinet,
    operator: User,
    reason: str | None = None,
    now: datetime | None = None,
) -> Cabinet:
    if cabinet.status == CabinetStatus.busy:
        raise ServiceError("active_ticket", 409)

    cabinet.status = CabinetStatus.paused
    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=operator.id,
        action="cabinet.paused",
        entity_type="cabinet",
        entity_id=cabinet.id,
        organization_id=cabinet.organization_id,
        payload={"reason": reason},
    )

    await _sync_queue_status_after_cabinet_change(db, redis, cabinet)
    return cabinet


async def resume_cabinet(
    db: AsyncSession, redis: Redis, *, cabinet: Cabinet, operator: User, now: datetime | None = None
) -> Cabinet:
    if cabinet.status != CabinetStatus.paused:
        raise ServiceError("cabinet_not_paused", 409, status=cabinet.status.value)

    cabinet.status = CabinetStatus.free
    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=operator.id,
        action="cabinet.resumed",
        entity_type="cabinet",
        entity_id=cabinet.id,
        organization_id=cabinet.organization_id,
    )

    await _sync_queue_status_after_cabinet_change(db, redis, cabinet)
    return cabinet
