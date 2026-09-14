from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import local_date, utcnow
from app.models.organization import Organization
from app.models.queue import Queue


async def next_number(
    db: AsyncSession, queue: Queue, organization: Organization, now: datetime | None = None
) -> tuple[int, str]:
    now = now or utcnow()
    today = local_date(organization.timezone, now)

    result = await db.execute(select(Queue).where(Queue.id == queue.id).with_for_update().execution_options(populate_existing=True))
    locked = result.scalar_one()

    if locked.counter_date != today:
        locked.counter_date = today
        locked.last_ticket_number = 0

    locked.last_ticket_number += 1
    number = locked.last_ticket_number
    display_number = f"{locked.ticket_prefix}-{number:03d}"

    await db.flush()
    return number, display_number
