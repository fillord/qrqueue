from datetime import datetime, timedelta, timezone

from app.models.cabinet import Cabinet
from app.models.enums import CabinetStatus, QueueStatus, TicketSource, TicketStatus
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.redis import redis_client
from app.workers.timeouts import run_once

PRESENCE_TIMEOUT_MIN = 3


async def _make_queue(db_session, organization) -> Queue:
    queue = Queue(
        organization_id=organization.id,
        name="Очередь",
        ticket_prefix="A",
        status=QueueStatus.open,
        presence_timeout_min=PRESENCE_TIMEOUT_MIN,
        counter_date=datetime.now(timezone.utc).date(),
    )
    db_session.add(queue)
    await db_session.commit()
    await db_session.refresh(queue)
    return queue


async def _make_called_ticket(db_session, organization, queue, cabinet, called_at) -> Ticket:
    ticket = Ticket(
        organization_id=organization.id,
        queue_id=queue.id,
        number=1,
        display_number="A-001",
        status=TicketStatus.called,
        source=TicketSource.qr,
        cabinet_id=cabinet.id,
        called_at=called_at,
        call_count=1,
    )
    db_session.add(ticket)
    cabinet.status = CabinetStatus.busy
    await db_session.commit()
    await db_session.refresh(ticket)

    cabinet.current_ticket_id = ticket.id
    await db_session.commit()
    return ticket


async def test_run_once_no_show_after_timeout_and_noop_before(db_session, make_organization):
    org = await make_organization(name="Таймаут Организация")
    queue = await _make_queue(db_session, org)
    cabinet = Cabinet(organization_id=org.id, queue_id=queue.id, label="Окно 1")
    db_session.add(cabinet)
    await db_session.commit()
    await db_session.refresh(cabinet)

    t0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    ticket = await _make_called_ticket(db_session, org, queue, cabinet, called_at=t0)

    # Before the timeout: nothing happens.
    changed = await run_once(db_session, redis_client, now=t0 + timedelta(minutes=1))
    assert changed == 0
    await db_session.refresh(ticket)
    await db_session.refresh(cabinet)
    assert ticket.status == TicketStatus.called
    assert cabinet.status == CabinetStatus.busy

    # After the timeout: flips to no_show, cabinet freed.
    changed = await run_once(
        db_session, redis_client, now=t0 + timedelta(minutes=PRESENCE_TIMEOUT_MIN + 1)
    )
    assert changed == 1
    await db_session.refresh(ticket)
    await db_session.refresh(cabinet)
    assert ticket.status == TicketStatus.no_show
    assert cabinet.status == CabinetStatus.free
    assert cabinet.current_ticket_id is None
