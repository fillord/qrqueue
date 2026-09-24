import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_cabinet, current_operator
from app.db import get_db
from app.models.cabinet import Cabinet, CabinetOperator
from app.models.enums import AuditActorType, QueueStatus
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.models.user import User
from app.redis import get_redis
from app.schemas.cabinet import CabinetOut
from app.schemas.operator import OperatorQueueOut, PauseRequest, QueueSummaryOut, TransferRequest
from app.schemas.public import TicketSummaryOut
from app.services.cabinets import pause_cabinet, resume_cabinet, select_cabinet
from app.services.operator_queue import build_operator_queue_snapshot, require_queue
from app.services.tickets import (
    call_next,
    finish,
    mark_no_show,
    recall,
    return_to_queue,
    start_serving,
    transfer,
)

router = APIRouter(prefix="/operator", tags=["operator"])


async def _get_ticket_by_queue(db: AsyncSession, ticket_id: uuid.UUID, cabinet: Cabinet) -> Ticket:
    """Scope is the operator's queue, not their specific cabinet: a pooled queue can have
    several cabinets serving it, and a ticket may not have a cabinet yet (still waiting) or
    any longer (returned from no_show) — the state machine, not cabinet ownership, is what
    decides whether an action is valid.
    """
    ticket = await db.get(Ticket, ticket_id)
    if ticket is None or ticket.queue_id != cabinet.queue_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return ticket


@router.post("/cabinets/{cabinet_id}/select", response_model=CabinetOut)
async def select_cabinet_route(
    cabinet_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    operator: User = Depends(current_operator),
) -> Cabinet:
    cabinet = await select_cabinet(db, redis, operator=operator, cabinet_id=cabinet_id)
    await db.commit()
    return cabinet


@router.get("/cabinets", response_model=list[CabinetOut])
async def list_my_cabinets_route(
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(current_operator),
) -> list[Cabinet]:
    result = await db.execute(
        select(Cabinet)
        .join(CabinetOperator, CabinetOperator.cabinet_id == Cabinet.id)
        .where(CabinetOperator.user_id == operator.id)
        .where(Cabinet.deleted_at.is_(None))
        .order_by(Cabinet.label)
    )
    return list(result.scalars().all())


@router.get("/queue", response_model=OperatorQueueOut)
async def get_operator_queue_route(
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(current_operator),
    cabinet: Cabinet = Depends(current_cabinet),
) -> dict:
    snapshot = await build_operator_queue_snapshot(db, cabinet)
    await db.commit()
    return snapshot


@router.get("/queues", response_model=list[QueueSummaryOut])
async def list_operator_queues_route(
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(current_operator),
) -> list[Queue]:
    """Open/paused queues of the operator's organization — transfer targets."""
    result = await db.execute(
        select(Queue)
        .where(
            Queue.organization_id == operator.organization_id,
            Queue.status.in_([QueueStatus.open, QueueStatus.paused]),
            Queue.is_active.is_(True),
        )
        .order_by(Queue.name)
    )
    return list(result.scalars().all())


@router.post("/call-next", response_model=TicketSummaryOut)
async def call_next_route(
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    operator: User = Depends(current_operator),
    cabinet: Cabinet = Depends(current_cabinet),
) -> Ticket:
    queue = await require_queue(db, cabinet)
    ticket = await call_next(db, redis, queue=queue, cabinet=cabinet, operator=operator)
    await db.commit()
    return ticket


@router.post("/tickets/{ticket_id}/recall", response_model=TicketSummaryOut)
async def recall_route(
    ticket_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    operator: User = Depends(current_operator),
    cabinet: Cabinet = Depends(current_cabinet),
) -> Ticket:
    ticket = await _get_ticket_by_queue(db, ticket_id, cabinet)
    ticket = await recall(db, redis, ticket=ticket, operator=operator)
    await db.commit()
    return ticket


@router.post("/tickets/{ticket_id}/no-show", response_model=TicketSummaryOut)
async def no_show_route(
    ticket_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    operator: User = Depends(current_operator),
    cabinet: Cabinet = Depends(current_cabinet),
) -> Ticket:
    ticket = await _get_ticket_by_queue(db, ticket_id, cabinet)
    ticket = await mark_no_show(
        db, redis, ticket=ticket, actor_type=AuditActorType.user, actor_id=operator.id
    )
    await db.commit()
    return ticket


@router.post("/tickets/{ticket_id}/return", response_model=TicketSummaryOut)
async def return_route(
    ticket_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    operator: User = Depends(current_operator),
    cabinet: Cabinet = Depends(current_cabinet),
) -> Ticket:
    ticket = await _get_ticket_by_queue(db, ticket_id, cabinet)
    ticket = await return_to_queue(db, redis, ticket=ticket, operator=operator)
    await db.commit()
    return ticket


@router.post("/tickets/{ticket_id}/start", response_model=TicketSummaryOut)
async def start_route(
    ticket_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    operator: User = Depends(current_operator),
    cabinet: Cabinet = Depends(current_cabinet),
) -> Ticket:
    ticket = await _get_ticket_by_queue(db, ticket_id, cabinet)
    ticket = await start_serving(db, redis, ticket=ticket, operator=operator)
    await db.commit()
    return ticket


@router.post("/tickets/{ticket_id}/finish", response_model=TicketSummaryOut)
async def finish_route(
    ticket_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    operator: User = Depends(current_operator),
    cabinet: Cabinet = Depends(current_cabinet),
) -> Ticket:
    ticket = await _get_ticket_by_queue(db, ticket_id, cabinet)
    ticket = await finish(db, redis, ticket=ticket, operator=operator)
    await db.commit()
    return ticket


@router.post(
    "/tickets/{ticket_id}/transfer", response_model=TicketSummaryOut, status_code=status.HTTP_201_CREATED
)
async def transfer_route(
    ticket_id: uuid.UUID,
    payload: TransferRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    operator: User = Depends(current_operator),
    cabinet: Cabinet = Depends(current_cabinet),
) -> Ticket:
    ticket = await _get_ticket_by_queue(db, ticket_id, cabinet)

    target_queue = await db.get(Queue, payload.queue_id)
    if target_queue is None or target_queue.organization_id != operator.organization_id or target_queue.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    organization = await db.get(Organization, operator.organization_id)
    new_ticket = await transfer(
        db,
        redis,
        ticket=ticket,
        target_queue=target_queue,
        organization=organization,
        operator=operator,
    )
    await db.commit()
    return new_ticket


@router.post("/cabinet/pause", response_model=CabinetOut)
async def pause_cabinet_route(
    payload: PauseRequest | None = None,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    operator: User = Depends(current_operator),
    cabinet: Cabinet = Depends(current_cabinet),
) -> Cabinet:
    reason = payload.reason if payload else None
    cabinet = await pause_cabinet(db, redis, cabinet=cabinet, operator=operator, reason=reason)
    await db.commit()
    return cabinet


@router.post("/cabinet/resume", response_model=CabinetOut)
async def resume_cabinet_route(
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    operator: User = Depends(current_operator),
    cabinet: Cabinet = Depends(current_cabinet),
) -> Cabinet:
    cabinet = await resume_cabinet(db, redis, cabinet=cabinet, operator=operator)
    await db.commit()
    return cabinet
