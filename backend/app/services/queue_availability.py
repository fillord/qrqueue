from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.queue import Queue, QueueSchedule


async def within_schedule(
    db: AsyncSession, queue: Queue, today, now: datetime, timezone_name: str
) -> bool:
    result = await db.execute(select(QueueSchedule).where(QueueSchedule.queue_id == queue.id))
    entries = result.scalars().all()
    if not entries:
        # No schedule configured for this queue at all -> unrestricted, like geo_radius_m=None.
        return True

    weekday = today.weekday()
    local_time = now.astimezone(ZoneInfo(timezone_name)).time()
    return any(
        entry.weekday == weekday and entry.opens_at <= local_time < entry.closes_at
        for entry in entries
    )

