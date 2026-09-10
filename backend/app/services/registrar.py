from datetime import datetime

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import local_date, utcnow
from app.models.enums import AuditActorType, QueueStatus, TicketSource
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.models.user import User
from app.services.errors import ServiceError
from app.services.scan import within_schedule
from app.services.tickets import create_ticket


async def register_ticket(
    db: AsyncSession,
    redis: Redis,
    *,
    organization: Organization,
    queue: Queue,
    registrar: User,
    note: str | None = None,
    now: datetime | None = None,
) -> Ticket:
    """A registrar-issued ticket goes through the same queue-availability
    checks as a QR scan (open, schedule, daily limit) — just not the geozone
    or one-active-ticket-per-device checks, since there's no device here
    (ARCHITECTURE.md section 6, Registrar).
    """
    now = now or utcnow()

    if not queue.is_active or queue.status == QueueStatus.closed:
        raise ServiceError("queue_closed", 422)
    if queue.status == QueueStatus.paused:
        raise ServiceError("queue_paused", 422)

    today = local_date(organization.timezone, now)
    if not await within_schedule(db, queue, today, now, organization.timezone):
        raise ServiceError("outside_schedule", 422)

    if queue.daily_ticket_limit is not None:
        issued_today = 0 if queue.counter_date != today else queue.last_ticket_number
        if issued_today >= queue.daily_ticket_limit:
            raise ServiceError("daily_limit_reached", 422)

    return await create_ticket(
        db,
        redis,
        organization=organization,
        queue=queue,
        source=TicketSource.registrar,
        client=None,
        actor_type=AuditActorType.user,
        actor_id=registrar.id,
        note=note,
        now=now,
    )
