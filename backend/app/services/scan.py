import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import local_date, utcnow
from app.models.client import Client
from app.models.enums import QueueStatus, TicketSource, TicketStatus
from app.models.organization import Organization
from app.models.queue import Queue, QueueSchedule
from app.models.ticket import Ticket
from app.services.geo import haversine_m
from app.services.qr_tokens import QRTokenError, verify
from app.services.tickets import create_ticket

_ACTIVE_STATUSES = (
    TicketStatus.waiting,
    TicketStatus.called,
    TicketStatus.confirmed,
    TicketStatus.serving,
)


class ScanError(Exception):
    def __init__(self, code: str, ticket_id: uuid.UUID | None = None):
        self.code = code
        self.ticket_id = ticket_id
        super().__init__(code)


async def scan(
    db: AsyncSession,
    redis: Redis,
    *,
    token: str,
    client: Client,
    lat: float | None = None,
    lng: float | None = None,
    now: datetime | None = None,
) -> Ticket:
    now = now or utcnow()

    # 1. signature, nbf, exp
    try:
        queue_id = verify(token, now)
    except QRTokenError as exc:
        raise ScanError(exc.reason)

    queue = await db.get(Queue, queue_id)
    if queue is None:
        raise ScanError("token_invalid")

    organization = await db.get(Organization, queue.organization_id)

    # 2. queue open, schedule, daily_ticket_limit
    if not queue.is_active or queue.status == QueueStatus.closed:
        raise ScanError("queue_closed")
    if queue.status == QueueStatus.paused:
        raise ScanError("queue_paused")

    today = local_date(organization.timezone, now)
    if not await _within_schedule(db, queue, today, now, organization.timezone):
        raise ScanError("outside_schedule")

    if queue.daily_ticket_limit is not None:
        issued_today = 0 if queue.counter_date != today else queue.last_ticket_number
        if issued_today >= queue.daily_ticket_limit:
            raise ScanError("daily_limit_reached")

    # 3. geozone
    if queue.geo_radius_m is not None:
        if lat is None or lng is None:
            raise ScanError("geo_required")
        distance = haversine_m(float(queue.latitude), float(queue.longitude), lat, lng)
        if distance > queue.geo_radius_m:
            raise ScanError("geo_out_of_range")

    # 4. no active ticket already
    existing = await _find_active_ticket(db, client, queue, organization)
    if existing is not None:
        raise ScanError("already_in_queue", ticket_id=existing.id)

    return await create_ticket(
        db,
        redis,
        organization=organization,
        queue=queue,
        source=TicketSource.qr,
        client=client,
        now=now,
    )


async def _within_schedule(
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


async def _find_active_ticket(
    db: AsyncSession, client: Client, queue: Queue, organization: Organization
) -> Ticket | None:
    stmt = select(Ticket).where(
        Ticket.client_id == client.id,
        Ticket.status.in_(_ACTIVE_STATUSES),
    )
    if organization.one_ticket_per_org:
        stmt = stmt.where(Ticket.organization_id == organization.id)
    else:
        stmt = stmt.where(Ticket.queue_id == queue.id)

    result = await db.execute(stmt)
    return result.scalars().first()
