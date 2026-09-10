from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from httpx import ASGITransport, AsyncClient

from app.main import app
from app.models.cabinet import Cabinet, CabinetOperator
from app.models.enums import QueueStatus, UserRole
from app.models.queue import Queue
from app.services.qr_tokens import issue_batch
from tests.utils import login


def _scan_token(queue_id) -> str:
    batch = issue_batch(queue_id)
    return batch["tokens"][0]["token"]


async def _make_queue(db_session, organization, **kwargs) -> Queue:
    today = datetime.now(ZoneInfo(organization.timezone)).date()
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


def _second_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_scan_success_duplicate_and_second_client(client, db_session, make_organization):
    org = await make_organization(name="Скан Организация")
    queue = await _make_queue(db_session, org)

    resp = await client.post("/api/public/scan", json={"token": _scan_token(queue.id)})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["display_number"] == "A-001"
    assert "qc" in resp.cookies

    resp2 = await client.post("/api/public/scan", json={"token": _scan_token(queue.id)})
    assert resp2.status_code == 409, resp2.text
    detail = resp2.json()["detail"]
    assert detail["code"] == "already_in_queue"
    assert detail["ticket_id"] == body["id"]

    async with _second_client() as client2:
        resp3 = await client2.post("/api/public/scan", json={"token": _scan_token(queue.id)})
        assert resp3.status_code == 201, resp3.text
        assert resp3.json()["display_number"] == "A-002"


async def test_scan_paused_queue_returns_queue_paused(client, db_session, make_organization):
    org = await make_organization(name="Пауза Организация")
    queue = await _make_queue(db_session, org, status=QueueStatus.paused)

    resp = await client.post("/api/public/scan", json={"token": _scan_token(queue.id)})
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "queue_paused"


async def test_scan_geo_required_out_of_range_then_success(client, db_session, make_organization):
    org = await make_organization(name="Гео Организация")
    queue = await _make_queue(
        db_session, org, latitude=43.238949, longitude=76.889709, geo_radius_m=100
    )

    resp = await client.post("/api/public/scan", json={"token": _scan_token(queue.id)})
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "geo_required"

    resp = await client.post(
        "/api/public/scan",
        json={"token": _scan_token(queue.id), "lat": 43.9, "lng": 77.5},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "geo_out_of_range"

    resp = await client.post(
        "/api/public/scan",
        json={"token": _scan_token(queue.id), "lat": 43.238950, "lng": 76.889710},
    )
    assert resp.status_code == 201, resp.text


async def test_scan_daily_limit_reached_for_second_client(client, db_session, make_organization):
    org = await make_organization(name="Лимит Организация")
    queue = await _make_queue(db_session, org, daily_ticket_limit=1)

    resp = await client.post("/api/public/scan", json={"token": _scan_token(queue.id)})
    assert resp.status_code == 201, resp.text

    async with _second_client() as client2:
        resp2 = await client2.post("/api/public/scan", json={"token": _scan_token(queue.id)})
        assert resp2.status_code == 422, resp2.text
        assert resp2.json()["detail"]["code"] == "daily_limit_reached"


async def test_scan_counter_resets_on_new_day(client, db_session, make_organization):
    org = await make_organization(name="Сброс Организация")
    yesterday = datetime.now(ZoneInfo(org.timezone)).date() - timedelta(days=1)
    queue = await _make_queue(db_session, org, counter_date=yesterday)
    queue.last_ticket_number = 7
    await db_session.commit()

    resp = await client.post("/api/public/scan", json={"token": _scan_token(queue.id)})
    assert resp.status_code == 201, resp.text
    assert resp.json()["display_number"] == "A-001"


async def test_get_ticket_by_other_client_is_404(client, db_session, make_organization):
    org = await make_organization(name="Чужой Талон Организация")
    queue = await _make_queue(db_session, org)

    resp = await client.post("/api/public/scan", json={"token": _scan_token(queue.id)})
    ticket_id = resp.json()["id"]

    async with _second_client() as client2:
        resp2 = await client2.get(f"/api/public/tickets/{ticket_id}")
        assert resp2.status_code == 404


async def _make_cabinet(db_session, organization, queue, label="Кабинет") -> Cabinet:
    cabinet = Cabinet(organization_id=organization.id, queue_id=queue.id, label=label)
    db_session.add(cabinet)
    await db_session.commit()
    await db_session.refresh(cabinet)
    return cabinet


async def test_confirm_called_ticket_becomes_confirmed(client, db_session, make_user, make_organization):
    org = await make_organization(name="Confirm Организация")
    queue = await _make_queue(db_session, org)
    cabinet = await _make_cabinet(db_session, org, queue)
    operator, op_password = await make_user(
        email="confirm-op@example.com", role=UserRole.operator, organization_id=org.id
    )
    db_session.add(CabinetOperator(cabinet_id=cabinet.id, user_id=operator.id))
    await db_session.commit()

    resp = await client.post("/api/public/scan", json={"token": _scan_token(queue.id)})
    ticket_id = resp.json()["id"]

    async with _second_client() as op_client:
        await login(op_client, "confirm-op@example.com", op_password)
        await op_client.post(f"/api/operator/cabinets/{cabinet.id}/select")
        resp = await op_client.post("/api/operator/call-next")
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == ticket_id

    resp = await client.post(f"/api/public/tickets/{ticket_id}/confirm")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "confirmed"


async def test_confirm_by_other_client_is_404(client, db_session, make_organization):
    org = await make_organization(name="Confirm Чужой Организация")
    queue = await _make_queue(db_session, org)

    resp = await client.post("/api/public/scan", json={"token": _scan_token(queue.id)})
    ticket_id = resp.json()["id"]

    async with _second_client() as client2:
        resp2 = await client2.post(f"/api/public/tickets/{ticket_id}/confirm")
        assert resp2.status_code == 404


async def test_leave_from_waiting_becomes_left(client, db_session, make_organization):
    org = await make_organization(name="Leave Waiting Организация")
    queue = await _make_queue(db_session, org)

    resp = await client.post("/api/public/scan", json={"token": _scan_token(queue.id)})
    ticket_id = resp.json()["id"]

    resp = await client.post(f"/api/public/tickets/{ticket_id}/leave")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "left"


async def test_leave_from_called_frees_cabinet(client, db_session, make_user, make_organization):
    org = await make_organization(name="Leave Called Организация")
    queue = await _make_queue(db_session, org)
    cabinet = await _make_cabinet(db_session, org, queue)
    operator, op_password = await make_user(
        email="leave-op@example.com", role=UserRole.operator, organization_id=org.id
    )
    db_session.add(CabinetOperator(cabinet_id=cabinet.id, user_id=operator.id))
    await db_session.commit()

    resp = await client.post("/api/public/scan", json={"token": _scan_token(queue.id)})
    ticket_id = resp.json()["id"]

    async with _second_client() as op_client:
        await login(op_client, "leave-op@example.com", op_password)
        await op_client.post(f"/api/operator/cabinets/{cabinet.id}/select")
        resp = await op_client.post("/api/operator/call-next")
        assert resp.status_code == 200, resp.text

    resp = await client.post(f"/api/public/tickets/{ticket_id}/leave")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "left"

    await db_session.refresh(cabinet)
    assert cabinet.status.value == "free"
    assert cabinet.current_ticket_id is None


async def test_confirm_and_leave_on_served_ticket_returns_409(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Served Организация")
    queue = await _make_queue(db_session, org)
    cabinet = await _make_cabinet(db_session, org, queue)
    operator, op_password = await make_user(
        email="served-op@example.com", role=UserRole.operator, organization_id=org.id
    )
    db_session.add(CabinetOperator(cabinet_id=cabinet.id, user_id=operator.id))
    await db_session.commit()

    resp = await client.post("/api/public/scan", json={"token": _scan_token(queue.id)})
    ticket_id = resp.json()["id"]

    async with _second_client() as op_client:
        await login(op_client, "served-op@example.com", op_password)
        await op_client.post(f"/api/operator/cabinets/{cabinet.id}/select")
        await op_client.post("/api/operator/call-next")
        await op_client.post(f"/api/operator/tickets/{ticket_id}/start")
        resp = await op_client.post(f"/api/operator/tickets/{ticket_id}/finish")
        assert resp.status_code == 200, resp.text

    resp = await client.post(f"/api/public/tickets/{ticket_id}/confirm")
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["code"] == "invalid_transition"

    resp = await client.post(f"/api/public/tickets/{ticket_id}/leave")
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["code"] == "invalid_transition"
