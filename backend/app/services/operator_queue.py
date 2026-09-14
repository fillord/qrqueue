from datetime import datetime, time as dt_time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cabinet import Cabinet
from app.models.enums import TicketStatus
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.services.errors import ServiceError
from app.services.queue_order import waiting_order

"""Builds the operator/queue snapshot — shared by the GET /operator/queue
route and the /ws/operator push (see ARCHITECTURE.md section 5): both must
serialize identically, so the WS payload needs no extra round trip on top of
what the REST response already carries.
"""


def _today_range_utc(organization: Organization) -> tuple[datetime, datetime]:
    """Local-midnight-to-midnight range for `organization`'s timezone, in UTC —
    matches the day boundary used for the daily ticket counter (services/numbering.py).
    """
    tz = ZoneInfo(organization.timezone)
    start_local = datetime.combine(datetime.now(tz).date(), dt_time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


async def require_queue(db: AsyncSession, cabinet: Cabinet) -> Queue:
    if cabinet.queue_id is None:
        raise ServiceError("cabinet_has_no_queue", 409)
    queue = await db.get(Queue, cabinet.queue_id)
    if queue is None:
        raise ServiceError("cabinet_has_no_queue", 409)
    return queue


async def build_operator_queue_snapshot(db: AsyncSession, cabinet: Cabinet) -> dict:
    queue = await require_queue(db, cabinet)

    current_ticket = None
    if cabinet.current_ticket_id is not None:
        current_ticket = await db.get(Ticket, cabinet.current_ticket_id)

    result = await db.execute(
        select(Ticket)
        .where(Ticket.queue_id == queue.id, Ticket.status == TicketStatus.waiting)
        .order_by(*waiting_order())
    )
    waiting = list(result.scalars().all())

    organization = await db.get(Organization, cabinet.organization_id)
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

    return {
        "queue_id": queue.id,
        "queue_status": queue.status,
        "cabinet_status": cabinet.status,
        "current_ticket": current_ticket,
        "waiting": waiting,
        "waiting_count": len(waiting),
        "no_show": no_show,
    }
