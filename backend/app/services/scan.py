import uuid
from datetime import datetime

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import local_date, utcnow
from app.models.client import Client
from app.models.enums import QueueStatus, TicketSource, TicketStatus
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.models.tv_screen import TVScreen
from app.services.hall_scan import hall_queues
from app.services.geo import haversine_m
from app.services.queue_availability import within_schedule
from app.services.qr_tokens import QRTokenError, verify, verify_selection
from app.services.tickets import create_ticket

_ACTIVE_STATUSES = (
    TicketStatus.waiting,
    TicketStatus.called,
    TicketStatus.confirmed,
    TicketStatus.serving,
)


async def queue_unavailability(db: AsyncSession, queue: Queue, organization: Organization, now: datetime) -> str | None:
    if not queue.is_active or queue.deleted_at is not None or queue.status == QueueStatus.closed:
        return "queue_closed"
    if queue.status == QueueStatus.paused:
        return "queue_paused"
    today = local_date(organization.timezone, now)
    if not await within_schedule(db, queue, today, now, organization.timezone):
        return "outside_schedule"
    if queue.daily_ticket_limit is not None:
        issued_today = 0 if queue.counter_date != today else queue.last_ticket_number
        if issued_today >= queue.daily_ticket_limit:
            return "daily_limit_reached"
    return None


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
    selected_queue_id: uuid.UUID | None = None,
    lat: float | None = None,
    lng: float | None = None,
    now: datetime | None = None,
) -> Ticket:
    now = now or utcnow()

    # 1. signature, nbf, exp
    try:
        if selected_queue_id is None:
            queue_id = verify(token, now)
        else:
            screen_id = verify_selection(token, now)
    except QRTokenError as exc:
        raise ScanError(exc.reason)

    if selected_queue_id is not None:
        screen = await db.get(TVScreen, screen_id)
        if screen is None or selected_queue_id not in {queue.id for queue in await hall_queues(db, screen)}:
            raise ScanError("queue_unavailable")
        queue_id = selected_queue_id

    queue = await db.get(Queue, queue_id)
    if queue is None or queue.deleted_at is not None:
        raise ScanError("token_invalid")

    organization = await db.get(Organization, queue.organization_id)
    if organization is None or not organization.is_active or organization.deleted_at is not None:
        raise ScanError("queue_unavailable")

    # 2. queue open, schedule, daily_ticket_limit
    unavailability = await queue_unavailability(db, queue, organization, now)
    if unavailability:
        raise ScanError(unavailability)

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
