from datetime import datetime, timedelta, timezone

import pytest

from app.models.enums import QueueStatus, TicketSource, TicketStatus
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.services.wait_estimate import estimate_wait_seconds

pytestmark = pytest.mark.asyncio


async def _make_queue(db_session, organization, **kwargs) -> Queue:
    today = datetime.now(timezone.utc).date()
    queue = Queue(
        organization_id=organization.id,
        name=kwargs.pop("name", "Очередь"),
        ticket_prefix=kwargs.pop("ticket_prefix", "A"),
        status=kwargs.pop("status", QueueStatus.open),
        counter_date=kwargs.pop("counter_date", today),
        **kwargs,
    )
    db_session.add(queue)
    await db_session.commit()
    await db_session.refresh(queue)
    return queue


async def _make_served_ticket(db_session, organization, queue, *, number, duration_seconds, finished_at):
    ticket = Ticket(
        organization_id=organization.id,
        queue_id=queue.id,
        number=number,
        display_number=f"{queue.ticket_prefix}-{number:03d}",
        status=TicketStatus.served,
        source=TicketSource.qr,
        serving_started_at=finished_at - timedelta(seconds=duration_seconds),
        finished_at=finished_at,
    )
    db_session.add(ticket)
    await db_session.commit()


async def test_fewer_than_five_served_tickets_returns_none(db_session, make_organization):
    org = await make_organization(name="Оценка Ожидания Мало")
    queue = await _make_queue(db_session, org)
    now = datetime.now(timezone.utc)

    for i in range(4):
        await _make_served_ticket(db_session, org, queue, number=i + 1, duration_seconds=300, finished_at=now)

    result = await estimate_wait_seconds(db_session, queue, org, now=now)
    assert result is None


async def test_average_of_last_20_served_tickets(db_session, make_organization):
    org = await make_organization(name="Оценка Ожидания Норм")
    queue = await _make_queue(db_session, org)
    now = datetime.now(timezone.utc)

    # 5 old tickets with a very different duration — must be excluded once
    # there are more than MAX_SAMPLES=20 more-recent ones.
    for i in range(5):
        await _make_served_ticket(
            db_session, org, queue, number=i + 1, duration_seconds=6000,
            finished_at=now - timedelta(hours=5, minutes=i),
        )

    # 20 recent tickets, all exactly 120s — these are the ones that should
    # be averaged (most recent MAX_SAMPLES=20 by finished_at).
    for i in range(20):
        await _make_served_ticket(
            db_session, org, queue, number=100 + i, duration_seconds=120,
            finished_at=now - timedelta(minutes=i),
        )

    result = await estimate_wait_seconds(db_session, queue, org, now=now)
    assert result == 120


async def test_exactly_five_served_tickets_returns_average(db_session, make_organization):
    org = await make_organization(name="Оценка Ожидания Пять")
    queue = await _make_queue(db_session, org)
    now = datetime.now(timezone.utc)

    durations = [100, 200, 300, 400, 500]
    for i, duration in enumerate(durations):
        await _make_served_ticket(
            db_session, org, queue, number=i + 1, duration_seconds=duration,
            finished_at=now - timedelta(minutes=i),
        )

    result = await estimate_wait_seconds(db_session, queue, org, now=now)
    assert result == round(sum(durations) / len(durations))


async def test_only_counts_todays_tickets(db_session, make_organization):
    org = await make_organization(name="Оценка Ожидания Вчера")
    queue = await _make_queue(db_session, org)
    now = datetime.now(timezone.utc)

    for i in range(5):
        await _make_served_ticket(
            db_session, org, queue, number=i + 1, duration_seconds=999,
            finished_at=now - timedelta(days=1),
        )

    result = await estimate_wait_seconds(db_session, queue, org, now=now)
    assert result is None


async def test_ticket_estimate_accounts_for_active_cabinets(db_session, make_organization):
    from app.models.cabinet import Cabinet
    from app.models.enums import CabinetStatus
    from app.services.tickets import build_ticket_detail
    org = await make_organization(name='Capacity estimate')
    queue = await _make_queue(db_session, org)
    now = datetime.now(timezone.utc)
    for number in range(5):
        await _make_served_ticket(db_session, org, queue, number=number, duration_seconds=120, finished_at=now)
    ticket = Ticket(organization_id=org.id, queue_id=queue.id, number=6, display_number='A006', status=TicketStatus.waiting, source=TicketSource.registrar)
    db_session.add(ticket)
    cabinets = [Cabinet(organization_id=org.id, queue_id=queue.id, label=str(i), status=CabinetStatus.free) for i in range(2)]
    db_session.add_all(cabinets)
    await db_session.commit()
    assert (await build_ticket_detail(db_session, ticket))['estimated_wait_seconds'] == 60
    cabinets[1].status = CabinetStatus.paused
    await db_session.flush()
    assert (await build_ticket_detail(db_session, ticket))['estimated_wait_seconds'] == 120
    cabinets[0].status = CabinetStatus.offline
    await db_session.flush()
    assert (await build_ticket_detail(db_session, ticket))['estimated_wait_seconds'] is None
