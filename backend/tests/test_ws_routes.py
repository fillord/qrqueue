import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from httpx_ws import WebSocketDisconnect, aconnect_ws

from app.db import async_session_factory
from app.models.cabinet import Cabinet, CabinetOperator
from app.models.client import Client
from app.models.enums import Language, Plan, QueueStatus, TicketSource, TicketStatus, UserRole
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.models.tv_screen import TVScreen
from app.models.user import User
from app.security import hash_password
from app.services.slug import generate_unique_slug
from tests.utils import login, ws_client

pytestmark = pytest.mark.asyncio

RECEIVE_TIMEOUT = 5

# --- helpers shared by every test in this file ------------------------------
#
# The "sends a push in response to a concurrent HTTP action" tests below
# open a real WebSocket connection whose background pump loop (app/ws/routes.py
# _pump) runs concurrently with the test's own later HTTP calls, on its own
# session (via the app's normal, un-overridden get_db). A SQLAlchemy
# AsyncSession cannot safely be used from two places at once, so unlike the
# rest of this test suite these tests do NOT use the db_session/client
# fixtures (which force every dependency to share one session for
# transactional rollback) — they commit real rows via a fresh session here,
# exactly like two independent real requests would, with random suffixes so
# repeat runs against the same dev database never collide.
#
# The plain rejection tests further down (no concurrent HTTP call while the
# socket is open) have no such conflict and use the regular db_session-based
# fixtures like the rest of the suite.


async def _make_queue(db, organization, **kwargs) -> Queue:
    today = datetime.now(timezone.utc).date()
    queue = Queue(
        organization_id=organization.id,
        name=kwargs.pop("name", "Очередь"),
        ticket_prefix=kwargs.pop("ticket_prefix", "A"),
        status=kwargs.pop("status", QueueStatus.open),
        counter_date=kwargs.pop("counter_date", today),
        **kwargs,
    )
    db.add(queue)
    await db.commit()
    await db.refresh(queue)
    return queue


async def _make_cabinet(db, organization, queue, label="Кабинет") -> Cabinet:
    cabinet = Cabinet(organization_id=organization.id, queue_id=queue.id, label=label)
    db.add(cabinet)
    await db.commit()
    await db.refresh(cabinet)
    return cabinet


async def _assign_operator(db, cabinet, operator) -> None:
    db.add(CabinetOperator(cabinet_id=cabinet.id, user_id=operator.id))
    await db.commit()


async def _make_client_row(db) -> Client:
    client_row = Client(last_seen_at=datetime.now(timezone.utc))
    db.add(client_row)
    await db.commit()
    await db.refresh(client_row)
    return client_row


async def _make_ticket(db, organization, queue, *, client=None, number=1) -> Ticket:
    ticket = Ticket(
        organization_id=organization.id,
        queue_id=queue.id,
        client_id=client.id if client else None,
        number=number,
        display_number=f"{queue.ticket_prefix}-{number:03d}",
        status=TicketStatus.waiting,
        source=TicketSource.qr,
    )
    db.add(ticket)
    await db.commit()
    await db.refresh(ticket)
    return ticket


async def _make_organization_real(db, name: str) -> Organization:
    org = Organization(
        name=name,
        slug=await generate_unique_slug(db, name),
        default_language=Language.ru,
        plan=Plan.trial,
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return org


async def _make_user_real(db, *, email: str, role: UserRole, organization_id, password="test-pass-1234") -> User:
    user = User(
        email=email,
        password_hash=hash_password(password),
        full_name="Test User",
        role=role,
        organization_id=organization_id,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def test_operator_ws_snapshot_then_ticket_called_on_call_next(ws_manager_running):
    run_id = uuid.uuid4().hex[:8]
    email = f"ws-op-{run_id}@example.com"
    password = "test-pass-1234"

    async with async_session_factory() as db:
        org = await _make_organization_real(db, f"WS Оператор {run_id}")
        queue = await _make_queue(db, org)
        cabinet = await _make_cabinet(db, org, queue)
        operator = await _make_user_real(
            db, email=email, role=UserRole.operator, organization_id=org.id, password=password
        )
        await _assign_operator(db, cabinet, operator)
        ticket = await _make_ticket(db, org, queue)
        cabinet_id, queue_id, ticket_id = cabinet.id, queue.id, ticket.id

    async with ws_client() as client:
        await login(client, email, password)
        resp = await client.post(f"/api/operator/cabinets/{cabinet_id}/select")
        assert resp.status_code == 200, resp.text

        async with aconnect_ws("/ws/operator", client) as ws:
            snapshot = await asyncio.wait_for(ws.receive_json(), timeout=RECEIVE_TIMEOUT)
            assert snapshot["queue_id"] == str(queue_id)
            assert snapshot["current_ticket"] is None
            assert snapshot["waiting_count"] == 1

            resp = await client.post("/api/operator/call-next")
            assert resp.status_code == 200, resp.text

            update = await asyncio.wait_for(ws.receive_json(), timeout=RECEIVE_TIMEOUT)
            assert update["current_ticket"]["id"] == str(ticket_id)
            assert update["current_ticket"]["status"] == "called"
            assert update["waiting_count"] == 0


async def test_ticket_ws_sends_snapshot_and_updates_on_call(ws_manager_running):
    run_id = uuid.uuid4().hex[:8]
    email = f"ws-op2-{run_id}@example.com"
    password = "test-pass-1234"

    async with async_session_factory() as db:
        org = await _make_organization_real(db, f"WS Талон {run_id}")
        queue = await _make_queue(db, org)
        cabinet = await _make_cabinet(db, org, queue, label=f"Кабинет {run_id}")
        operator = await _make_user_real(
            db, email=email, role=UserRole.operator, organization_id=org.id, password=password
        )
        await _assign_operator(db, cabinet, operator)
        client_row = await _make_client_row(db)
        ticket = await _make_ticket(db, org, queue, client=client_row)
        cabinet_id, ticket_id, client_id = cabinet.id, ticket.id, client_row.id
        cabinet_label = cabinet.label

    async with ws_client() as client:
        client.cookies.set("qc", str(client_id))
        async with aconnect_ws(f"/ws/ticket/{ticket_id}", client) as ws:
            snapshot = await asyncio.wait_for(ws.receive_json(), timeout=RECEIVE_TIMEOUT)
            assert snapshot["id"] == str(ticket_id)
            assert snapshot["status"] == "waiting"
            assert snapshot["cabinet"] is None

            # A different actor (the operator) calls this ticket — the
            # visitor's own socket, subscribed on the same queue channel,
            # must see the update without polling.
            client.cookies.delete("qc")
            await login(client, email, password)
            await client.post(f"/api/operator/cabinets/{cabinet_id}/select")
            resp = await client.post("/api/operator/call-next")
            assert resp.status_code == 200, resp.text

            update = await asyncio.wait_for(ws.receive_json(), timeout=RECEIVE_TIMEOUT)
            assert update["status"] == "called"
            assert update["cabinet"]["label"] == cabinet_label


async def test_ticket_ws_rejects_wrong_owner_cookie(override_get_db, db_session, make_organization):
    org = await make_organization(name="WS Талон Чужой")
    queue = await _make_queue(db_session, org)
    owner = await _make_client_row(db_session)
    stranger = await _make_client_row(db_session)
    ticket = await _make_ticket(db_session, org, queue, client=owner)

    async with ws_client() as client:
        client.cookies.set("qc", str(stranger.id))
        with pytest.raises(WebSocketDisconnect) as exc_info:
            async with aconnect_ws(f"/ws/ticket/{ticket.id}", client):
                pass
        assert exc_info.value.code == 1008


async def test_ticket_ws_rejects_missing_cookie(override_get_db, db_session, make_organization):
    org = await make_organization(name="WS Талон Без Куки")
    queue = await _make_queue(db_session, org)
    owner = await _make_client_row(db_session)
    ticket = await _make_ticket(db_session, org, queue, client=owner)

    async with ws_client() as client:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            async with aconnect_ws(f"/ws/ticket/{ticket.id}", client):
                pass
        assert exc_info.value.code == 1008


async def test_tv_ws_rejects_missing_device_token(override_get_db):
    async with ws_client() as client:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            async with aconnect_ws("/ws/tv", client):
                pass
        assert exc_info.value.code == 1008


async def test_tv_ws_rejects_unknown_device_token(override_get_db):
    async with ws_client() as client:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            async with aconnect_ws("/ws/tv?device_token=not-a-real-token", client):
                pass
        assert exc_info.value.code == 1008


async def test_tv_ws_sends_snapshot_and_updates_on_call(ws_manager_running):
    run_id = uuid.uuid4().hex[:8]
    email = f"ws-op3-{run_id}@example.com"
    password = "test-pass-1234"
    device_token = f"test-device-token-{run_id}"

    async with async_session_factory() as db:
        org = await _make_organization_real(db, f"WS ТВ {run_id}")
        org.logo_url = "https://example.com/logo.png"
        await db.commit()
        queue = await _make_queue(db, org)
        cabinet = await _make_cabinet(db, org, queue, label=f"Кабинет {run_id}")
        operator = await _make_user_real(
            db, email=email, role=UserRole.operator, organization_id=org.id, password=password
        )
        await _assign_operator(db, cabinet, operator)
        await _make_ticket(db, org, queue)

        screen = TVScreen(
            organization_id=org.id,
            queue_id=queue.id,
            name="Табло 1",
            device_token=device_token,
            language=Language.ru,
        )
        db.add(screen)
        await db.commit()

        cabinet_id, org_name, cabinet_label = cabinet.id, org.name, cabinet.label

    async with ws_client() as client:
        async with aconnect_ws(f"/ws/tv?device_token={device_token}", client) as ws:
            snapshot = await asyncio.wait_for(ws.receive_json(), timeout=RECEIVE_TIMEOUT)
            assert snapshot["organization_name"] == org_name
            assert snapshot["logo_url"] == "https://example.com/logo.png"
            assert len(snapshot["queues"]) == 1
            assert snapshot["queues"][0]["waiting_count"] == 1
            assert snapshot["queues"][0]["now_serving"] is None

            await login(client, email, password)
            await client.post(f"/api/operator/cabinets/{cabinet_id}/select")
            resp = await client.post("/api/operator/call-next")
            assert resp.status_code == 200, resp.text

            update = await asyncio.wait_for(ws.receive_json(), timeout=RECEIVE_TIMEOUT)
            assert update["queues"][0]["waiting_count"] == 0
            assert update["queues"][0]["now_serving"] is not None
            assert update["queues"][0]["now_serving_cabinet"] == cabinet_label


async def test_tv_ws_hall_screen_aggregates_all_queues_and_updates(ws_manager_running):
    run_id = uuid.uuid4().hex[:8]
    email = f"ws-hall-{run_id}@example.com"
    password = "test-pass-1234"
    device_token = f"test-hall-device-token-{run_id}"

    async with async_session_factory() as db:
        org = await _make_organization_real(db, f"WS Зал {run_id}")
        queue_a = await _make_queue(db, org, name=f"Терапевт {run_id}", ticket_prefix="A")
        queue_b = await _make_queue(db, org, name=f"Хирург {run_id}", ticket_prefix="B")
        cabinet_a = await _make_cabinet(db, org, queue_a, label=f"Каб А {run_id}")
        operator = await _make_user_real(
            db, email=email, role=UserRole.operator, organization_id=org.id, password=password
        )
        await _assign_operator(db, cabinet_a, operator)
        await _make_ticket(db, org, queue_a)
        await _make_ticket(db, org, queue_b)

        screen = TVScreen(
            organization_id=org.id,
            queue_id=None,
            name="Табло зала",
            device_token=device_token,
            language=Language.ru,
        )
        db.add(screen)
        await db.commit()

        cabinet_a_id, queue_a_id, queue_b_id = cabinet_a.id, queue_a.id, queue_b.id

    async with ws_client() as client:
        async with aconnect_ws(f"/ws/tv?device_token={device_token}", client) as ws:
            snapshot = await asyncio.wait_for(ws.receive_json(), timeout=RECEIVE_TIMEOUT)
            queue_ids = {q["queue_id"] for q in snapshot["queues"]}
            assert queue_ids == {str(queue_a_id), str(queue_b_id)}
            by_queue = {q["queue_id"]: q for q in snapshot["queues"]}
            assert by_queue[str(queue_a_id)]["waiting_count"] == 1
            assert by_queue[str(queue_b_id)]["waiting_count"] == 1

            # Calling a ticket in just one of the aggregated queues must still
            # reach the hall screen's socket (subscribed to every queue's channel).
            await login(client, email, password)
            await client.post(f"/api/operator/cabinets/{cabinet_a_id}/select")
            resp = await client.post("/api/operator/call-next")
            assert resp.status_code == 200, resp.text

            update = await asyncio.wait_for(ws.receive_json(), timeout=RECEIVE_TIMEOUT)
            by_queue = {q["queue_id"]: q for q in update["queues"]}
            assert by_queue[str(queue_a_id)]["waiting_count"] == 0
            assert by_queue[str(queue_a_id)]["now_serving"] is not None
            assert by_queue[str(queue_b_id)]["waiting_count"] == 1
