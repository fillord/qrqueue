"""Events announcing committed state must not be visible before the commit
(PROJECT_STATUS.md blocker 6), and live screens must learn about admin edits."""
import asyncio
import uuid
from unittest.mock import AsyncMock

from httpx_ws import aconnect_ws
from app.db import async_session_factory
from app.models.cabinet import Cabinet
from app.models.enums import CabinetStatus, Language, QueueStatus, UserRole
from app.models.queue import Queue
from app.models.tv_screen import TVScreen
from app.models.user import User
from app.redis import redis_client
from app.services import realtime
from app.services.cabinets import pause_cabinet
from app.services.realtime import defer_event, publish_event
from tests.test_ws_routes import (
    RECEIVE_TIMEOUT,
    _assign_operator,
    _make_cabinet,
    _make_client_row,
    _make_organization_real,
    _make_queue,
    _make_ticket,
    _make_user_real,
)
from tests.utils import login, ws_client


async def _settle() -> None:
    if realtime._background_tasks:
        await asyncio.gather(*realtime._background_tasks, return_exceptions=True)


async def test_deferred_event_publishes_after_commit_and_not_after_rollback(db_session, monkeypatch):
    publish = AsyncMock()
    monkeypatch.setattr(redis_client, "publish", publish)

    defer_event(db_session, "queue:test", "queue.status", status="paused")
    publish.assert_not_called()
    await db_session.commit()
    await _settle()
    publish.assert_awaited_once()
    assert publish.await_args.args[0] == "queue:test"
    assert '"event": "queue.status"' in publish.await_args.args[1]

    publish.reset_mock()
    defer_event(db_session, "queue:test", "queue.status", status="open")
    await db_session.rollback()
    await _settle()
    publish.assert_not_called()


async def test_cabinet_pause_event_is_observable_only_after_commit(monkeypatch):
    run_id = uuid.uuid4().hex[:8]
    async with async_session_factory() as db:
        org = await _make_organization_real(db, f"Пауза после commit {run_id}")
        queue = await _make_queue(db, org)
        cabinet = await _make_cabinet(db, org, queue)
        operator = await _make_user_real(db, email=f"pause-{run_id}@example.com", role=UserRole.operator, organization_id=org.id)
        queue_id, cabinet_id, operator_id = queue.id, cabinet.id, operator.id

    seen: list[QueueStatus] = []

    async def observe(channel, message):
        async with async_session_factory() as observer:
            seen.append((await observer.get(Queue, queue_id)).status)

    monkeypatch.setattr(redis_client, "publish", AsyncMock(side_effect=observe))

    async with async_session_factory() as db:
        cabinet = await db.get(Cabinet, cabinet_id)
        await pause_cabinet(db, redis_client, cabinet=cabinet, operator=await db.get(User, operator_id))
        assert seen == []  # nothing published inside the transaction
        await db.commit()
    await _settle()
    assert seen == [QueueStatus.paused]  # the only publish saw the committed pause
    async with async_session_factory() as db:
        assert (await db.get(Cabinet, cabinet_id)).status == CabinetStatus.paused


async def test_hall_screen_picks_up_queue_created_after_connect(ws_manager_running):
    run_id = uuid.uuid4().hex[:8]
    device_token = f"hall-new-queue-{run_id}"
    async with async_session_factory() as db:
        org = await _make_organization_real(db, f"Зал новые очереди {run_id}")
        first = await _make_queue(db, org, name=f"Первая {run_id}")
        admin = await _make_user_real(db, email=f"hall-admin-{run_id}@example.com", role=UserRole.org_admin, organization_id=org.id)
        db.add(TVScreen(organization_id=org.id, queue_id=None, name="Зал", device_token=device_token, language=Language.ru))
        await db.commit()
        org_id, first_id, admin_email = org.id, first.id, admin.email

    async with ws_client() as client:
        async with aconnect_ws(f"/ws/tv?device_token={device_token}", client) as ws:
            snapshot = await asyncio.wait_for(ws.receive_json(), timeout=RECEIVE_TIMEOUT)
            assert {q["queue_id"] for q in snapshot["queues"]} == {str(first_id)}

            await login(client, admin_email, "test-pass-1234")
            resp = await client.post(
                f"/api/admin/queues?organization_id={org_id}",
                json={"name": f"Вторая {run_id}", "ticket_prefix": "B"},
            )
            assert resp.status_code == 201, resp.text
            second_id = resp.json()["id"]

            # queue.created on the organization channel -> fresh snapshot with both queues.
            update = await asyncio.wait_for(ws.receive_json(), timeout=RECEIVE_TIMEOUT)
            assert {q["queue_id"] for q in update["queues"]} == {str(first_id), second_id}

            # ...and the socket is now subscribed to the new queue's own channel.
            await publish_event(redis_client, uuid.UUID(second_id), "ticket.created")
            update = await asyncio.wait_for(ws.receive_json(), timeout=RECEIVE_TIMEOUT)
            assert second_id in {q["queue_id"] for q in update["queues"]}

            # Branding edits reach the screen too.
            resp = await client.patch(f"/api/admin/organization?organization_id={org_id}", json={"brand_color": "#123456"})
            assert resp.status_code == 200, resp.text
            update = await asyncio.wait_for(ws.receive_json(), timeout=RECEIVE_TIMEOUT)
            assert update["brand_color"] == "#123456"


async def test_ticket_ws_releases_db_connection_between_pushes(override_get_db, db_session, make_organization):
    org = await make_organization(name="WS без удержания соединения")
    queue = await _make_queue(db_session, org)
    owner = await _make_client_row(db_session)
    ticket = await _make_ticket(db_session, org, queue, client=owner)

    async with ws_client() as client:
        client.cookies.set("qc", str(owner.id))
        async with aconnect_ws(f"/ws/ticket/{ticket.id}", client) as ws:
            snapshot = await asyncio.wait_for(ws.receive_json(), timeout=RECEIVE_TIMEOUT)
            assert snapshot["id"] == str(ticket.id)
            # The session served the snapshot and then ended its transaction,
            # so the pooled connection is free while the socket idles.
            assert not db_session.in_transaction()
