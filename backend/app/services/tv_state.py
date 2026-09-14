import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cabinet import Cabinet
from app.models.enums import TicketStatus
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.models.tv_screen import TVScreen

_CALLED_LIKE_STATUSES = (TicketStatus.called, TicketStatus.confirmed, TicketStatus.serving)


async def _now_serving(db: AsyncSession, queue_id: uuid.UUID) -> tuple[str | None, str | None]:
    result = await db.execute(
        select(Ticket, Cabinet.label)
        .outerjoin(Cabinet, Cabinet.id == Ticket.cabinet_id)
        .where(Ticket.queue_id == queue_id, Ticket.status.in_(_CALLED_LIKE_STATUSES))
        .order_by(Ticket.called_at.desc())
        .limit(1)
    )
    row = result.first()
    if row is None:
        return None, None
    ticket, cabinet_label = row
    return ticket.display_number, cabinet_label


async def _waiting_count(db: AsyncSession, queue_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(Ticket)
        .where(Ticket.queue_id == queue_id, Ticket.status == TicketStatus.waiting)
    )
    return result.scalar_one()


async def build_tv_state(db: AsyncSession, screen: TVScreen) -> dict:
    """One queue for a queue-bound screen, or every active queue of the
    organization for a null-queue hall screen (ARCHITECTURE.md section 6).
    """
    organization = await db.get(Organization, screen.organization_id)

    if screen.queue_id is not None:
        queue_ids = [screen.queue_id]
    else:
        result = await db.execute(
            select(Queue.id)
            .where(Queue.organization_id == screen.organization_id, Queue.is_active.is_(True))
            .order_by(Queue.name)
        )
        queue_ids = [row[0] for row in result.all()]

    queues_out = []
    for queue_id in queue_ids:
        queue = await db.get(Queue, queue_id)
        if queue is None:
            continue
        now_serving, now_serving_cabinet = await _now_serving(db, queue_id)
        queues_out.append(
            {
                "queue_id": queue.id,
                "queue_name": queue.name,
                "queue_status": queue.status,
                "now_serving": now_serving,
                "now_serving_cabinet": now_serving_cabinet,
                "waiting_count": await _waiting_count(db, queue_id),
            }
        )

    return {
        "organization_name": organization.name if organization else "",
        "logo_url": organization.logo_url if organization else None,
        "brand_color": organization.brand_color if organization else None,
        "language": screen.language,
        # True signal for "can this screen show a QR at all" — deliberately
        # not derived from len(queues_out), which can be 1 for a hall screen
        # that currently has only one active queue and would otherwise look
        # just like a real queue-bound screen (that mixup is what caused the
        # /tv/qr-batch 409 loop this field exists to fix).
        "is_hall_screen": screen.queue_id is None,
        "queues": queues_out,
    }
