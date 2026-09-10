import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_registrar
from app.db import get_db
from app.models.enums import QueueStatus
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.models.user import User
from app.redis import get_redis
from app.schemas.operator import QueueSummaryOut
from app.schemas.public import TicketSummaryOut
from app.schemas.registrar import RegistrarTicketCreate
from app.services.registrar import register_ticket

router = APIRouter(prefix="/registrar", tags=["registrar"])


@router.get("/queues", response_model=list[QueueSummaryOut])
async def list_registrar_queues_route(
    db: AsyncSession = Depends(get_db),
    registrar: User = Depends(current_registrar),
) -> list[Queue]:
    result = await db.execute(
        select(Queue)
        .where(
            Queue.organization_id == registrar.organization_id,
            Queue.status.in_([QueueStatus.open, QueueStatus.paused]),
            Queue.is_active.is_(True),
        )
        .order_by(Queue.name)
    )
    return list(result.scalars().all())


@router.post("/tickets", response_model=TicketSummaryOut, status_code=status.HTTP_201_CREATED)
async def create_registrar_ticket_route(
    payload: RegistrarTicketCreate,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    registrar: User = Depends(current_registrar),
) -> Ticket:
    queue = await db.get(Queue, payload.queue_id)
    if queue is None or queue.organization_id != registrar.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    organization = await db.get(Organization, registrar.organization_id)
    ticket = await register_ticket(
        db,
        redis,
        organization=organization,
        queue=queue,
        registrar=registrar,
        note=payload.note,
    )
    await db.commit()
    return ticket


@router.get("/tickets/{ticket_id}", response_model=TicketSummaryOut)
async def get_registrar_ticket_route(
    ticket_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    registrar: User = Depends(current_registrar),
) -> Ticket:
    ticket = await db.get(Ticket, ticket_id)
    if ticket is None or ticket.organization_id != registrar.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return ticket
