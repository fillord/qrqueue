from datetime import datetime, time as dt_time, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models.enums import TicketStatus
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.ticket import Ticket

MIN_SAMPLES = 5
MAX_SAMPLES = 20


async def estimate_wait_seconds(
    db: AsyncSession, queue: Queue, organization: Organization, now: datetime | None = None
) -> int | None:
    """Average handling time (finished_at - serving_started_at) over the
    last MAX_SAMPLES tickets served today in this queue. None if there
    isn't enough history yet (MIN_SAMPLES) — no guessing a number.
    """
    now = now or utcnow()
    tz = ZoneInfo(organization.timezone)
    start_local = datetime.combine(now.astimezone(tz).date(), dt_time.min, tzinfo=tz)
    start_utc = start_local.astimezone(timezone.utc)

    result = await db.execute(
        select(Ticket.serving_started_at, Ticket.finished_at)
        .where(
            Ticket.queue_id == queue.id,
            Ticket.status == TicketStatus.served,
            Ticket.serving_started_at.is_not(None),
            Ticket.finished_at.is_not(None),
            Ticket.finished_at >= start_utc,
        )
        .order_by(Ticket.finished_at.desc())
        .limit(MAX_SAMPLES)
    )
    rows = result.all()
    if len(rows) < MIN_SAMPLES:
        return None

    durations = [(finished_at - started_at).total_seconds() for started_at, finished_at in rows]
    return round(sum(durations) / len(durations))
