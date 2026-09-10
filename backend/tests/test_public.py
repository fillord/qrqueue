from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from httpx import ASGITransport, AsyncClient

from app.main import app
from app.models.enums import QueueStatus
from app.models.queue import Queue
from app.services.qr_tokens import issue_batch


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
