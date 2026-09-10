import uuid
from datetime import datetime, time as dt_time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_cabinet, current_operator
from app.db import get_db
from app.models.cabinet import Cabinet, CabinetOperator
from app.models.enums import AuditActorType, QueueStatus, TicketStatus
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.models.user import User
from app.redis import get_redis
from app.schemas.cabinet import CabinetOut
from app.schemas.operator import OperatorQueueOut, PauseRequest, QueueSummaryOut, TransferRequest
from app.schemas.public import TicketSummaryOut
from app.services.cabinets import pause_cabinet, resume_cabinet, select_cabinet
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


def _today_range_utc(organization: Organization) -> tuple[datetime, datetime]:
    """Local-midnight-to-midnight range for `organization`'s timezone, in UTC —
    matches the day boundary used for the daily ticket counter (services/numbering.py).
    """
    tz = ZoneInfo(organization.timezone)
    start_local = datetime.combine(datetime.now(tz).date(), dt_time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


async def _require_queue(db: AsyncSession, cabinet: Cabinet) -> Queue:
    if cabinet.queue_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail={"code": "cabinet_has_no_queue"}
        )
    queue = await db.get(Queue, cabinet.queue_id)
    if queue is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail={"code": "cabinet_has_no_queue"}
        )
    return queue


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
        .order_by(Cabinet.label)
    )
    return list(result.scalars().all())


@router.get("/queue", response_model=OperatorQueueOut)
async def get_operator_queue_route(
    db: AsyncSession = Depends(get_db),
    operator: User = Depends(current_operator),
    cabinet: Cabinet = Depends(current_cabinet),
) -> dict:
    queue = await _require_queue(db, cabinet)

    current_ticket = None
    if cabinet.current_ticket_id is not None:
        current_ticket = await db.get(Ticket, cabinet.current_ticket_id)

    result = await db.execute(
        select(Ticket)
        .where(Ticket.queue_id == queue.id, Ticket.status == TicketStatus.waiting)
        .order_by(Ticket.called_at.is_(None), Ticket.called_at, Ticket.created_at)
    )
    waiting = list(result.scalars().all())

    organization = await db.get(Organization, operator.organization_id)
    start_utc, end_utc = _today_range_utc(organization)
    result = await db.execute(
        select(Ticket)
        .where(
            Ticket.queue_id == queue.id,
            Ticket.status == TicketStatus.no_show,
            Ticket.created_at >= start_utc,
            Ticket.created_at < end_utc,
        )
        .order_by(Ticket.called_at)
    )
    no_show = list(result.scalars().all())

    await db.commit()
    return {
        "queue_id": queue.id,
        "queue_status": queue.status,
        "cabinet_status": cabinet.status,
        "current_ticket": current_ticket,
        "waiting": waiting,
        "waiting_count": len(waiting),
        "no_show": no_show,
    }


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
    queue = await _require_queue(db, cabinet)
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
    if target_queue is None or target_queue.organization_id != operator.organization_id:
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
