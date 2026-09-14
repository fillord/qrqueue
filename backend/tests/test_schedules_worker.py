from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.models.enums import QueueStatus
from app.models.queue import Queue, QueueSchedule
from app.redis import redis_client
from app.workers.schedules import run_once

TZ = ZoneInfo("Asia/Almaty")


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    # Monday 2026-09-14 is weekday 0.
    return datetime(2026, 9, 14 + day, hour, minute, tzinfo=TZ)


async def _make_queue(db_session, organization, *, schedule=True, status=QueueStatus.open) -> Queue:
    queue = Queue(
        organization_id=organization.id,
        name="Очередь",
        ticket_prefix="A",
        status=status,
        counter_date=_at(0, 0).date(),
    )
    db_session.add(queue)
    await db_session.flush()
    if schedule:
        db_session.add_all(
            QueueSchedule(queue_id=queue.id, weekday=weekday, opens_at=time(9, 0), closes_at=time(18, 0))
            for weekday in range(5)  # Mon-Fri; weekend has no rows = closed
        )
    await db_session.commit()
    await db_session.refresh(queue)
    return queue


async def test_worker_follows_edges_and_manual_pause_wins_until_close(db_session, make_organization):
    org = await make_organization(name="Расписание Организация", timezone="Asia/Almaty")
    queue = await _make_queue(db_session, org)

    # Baseline before opening: outside hours -> closed.
    assert await run_once(db_session, redis_client, now=_at(0, 8, 30)) == 1
    await db_session.refresh(queue)
    assert queue.status == QueueStatus.closed

    assert await run_once(db_session, redis_client, now=_at(0, 9, 0)) == 1
    await db_session.refresh(queue)
    assert queue.status == QueueStatus.open

    # Admin pauses at noon: the worker must not lift it while still inside hours.
    queue.status = QueueStatus.paused
    queue.manually_paused = True
    await db_session.commit()
    assert await run_once(db_session, redis_client, now=_at(0, 12, 0)) == 0
    await db_session.refresh(queue)
    assert queue.status == QueueStatus.paused

    # Closing time clears the pause; next morning it opens again.
    assert await run_once(db_session, redis_client, now=_at(0, 18, 0)) == 1
    await db_session.refresh(queue)
    assert queue.status == QueueStatus.closed
    assert queue.manually_paused is False
    assert await run_once(db_session, redis_client, now=_at(1, 9, 0)) == 1
    await db_session.refresh(queue)
    assert queue.status == QueueStatus.open


async def test_manual_close_inside_hours_holds_until_next_opening(db_session, make_organization):
    org = await make_organization(name="Ручное закрытие", timezone="Asia/Almaty")
    queue = await _make_queue(db_session, org)
    await run_once(db_session, redis_client, now=_at(0, 10, 0))  # baseline: open, nothing to do
    await db_session.refresh(queue)
    assert queue.status == QueueStatus.open

    queue.status = QueueStatus.closed
    await db_session.commit()
    assert await run_once(db_session, redis_client, now=_at(0, 11, 0)) == 0
    await db_session.refresh(queue)
    assert queue.status == QueueStatus.closed

    # Weekend has no rows: stays closed. Monday 09:00 reopens.
    await run_once(db_session, redis_client, now=_at(0, 18, 0))
    assert await run_once(db_session, redis_client, now=_at(5, 12, 0)) == 0
    await db_session.refresh(queue)
    assert queue.status == QueueStatus.closed
    assert await run_once(db_session, redis_client, now=_at(7, 9, 0)) == 1
    await db_session.refresh(queue)
    assert queue.status == QueueStatus.open


async def test_queue_without_schedule_is_never_touched(db_session, make_organization):
    org = await make_organization(name="Без расписания", timezone="Asia/Almaty")
    queue = await _make_queue(db_session, org, schedule=False)
    assert await run_once(db_session, redis_client, now=_at(6, 3, 0)) == 0
    await db_session.refresh(queue)
    assert queue.status == QueueStatus.open
    assert queue.schedule_open is None


async def test_replacing_schedule_rebaselines(db_session, make_organization, client, make_user):
    from app.models.enums import UserRole
    from tests.utils import login

    org = await make_organization(name="Смена расписания", timezone="Asia/Almaty")
    queue = await _make_queue(db_session, org)
    await run_once(db_session, redis_client, now=_at(0, 10, 0))
    await db_session.refresh(queue)
    assert queue.schedule_open is True

    admin, password = await make_user(email="sched-admin@example.com", role=UserRole.org_admin, organization_id=org.id)
    await login(client, admin.email, password)
    resp = await client.put(
        f"/api/admin/queues/{queue.id}/schedule",
        json={"schedule": [{"weekday": 0, "opens_at": "14:00:00", "closes_at": "18:00:00"}]},
    )
    assert resp.status_code == 204, resp.text
    await db_session.refresh(queue)
    assert queue.schedule_open is None
    # Now 10:00 is outside the new hours: the baseline closes the queue.
    assert await run_once(db_session, redis_client, now=_at(0, 10, 0) + timedelta(seconds=30)) == 1
    await db_session.refresh(queue)
    assert queue.status == QueueStatus.closed
