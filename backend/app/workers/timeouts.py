from datetime import datetime, timedelta

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models.enums import AuditActorType, TicketStatus
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.services.tickets import mark_no_show


async def run_once(db: AsyncSession, redis: Redis, now: datetime | None = None) -> int:
    """called tickets older than their queue's presence_timeout_min -> no_show.

    now is injectable so tests don't depend on real wall-clock time.
    """
    now = now or utcnow()

    result = await db.execute(
        select(Ticket, Queue.presence_timeout_min)
        .join(Queue, Queue.id == Ticket.queue_id)
        .where(Ticket.status == TicketStatus.called, Ticket.called_at.is_not(None))
    )
    rows = result.all()

    expired = [
        ticket
        for ticket, timeout_min in rows
        if ticket.called_at + timedelta(minutes=timeout_min) <= now
    ]

    for ticket in expired:
        await mark_no_show(
            db,
            redis,
            ticket=ticket,
            actor_type=AuditActorType.system,
            actor_id=None,
            now=now,
        )

    if expired:
        await db.commit()

    return len(expired)
