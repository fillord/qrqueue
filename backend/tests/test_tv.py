from datetime import datetime, timezone

from app.models.cabinet import Cabinet
from app.models.enums import Language, QueueStatus, UserRole
from app.models.queue import Queue
from app.models.tv_screen import TVScreen
from tests.utils import login


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


async def _make_cabinet(db_session, organization, queue, label="Кабинет") -> Cabinet:
    cabinet = Cabinet(organization_id=organization.id, queue_id=queue.id, label=label)
    db_session.add(cabinet)
    await db_session.commit()
    await db_session.refresh(cabinet)
    return cabinet


async def test_admin_creates_lists_and_deletes_tv_screen(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="TV Admin Организация")
    queue = await _make_queue(db_session, org)
    admin, password = await make_user(
        email="tv-admin@example.com", role=UserRole.org_admin, organization_id=org.id
    )

    await login(client, "tv-admin@example.com", password)

    resp = await client.post(
        f"/api/admin/tv-screens?organization_id={org.id}",
        json={"name": "Табло у входа", "queue_id": str(queue.id), "language": "ru"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "Табло у входа"
    assert body["queue_id"] == str(queue.id)
    assert body["pairing_code"] is not None
    assert len(body["pairing_code"]) == 6
    screen_id = body["id"]

    resp = await client.get(f"/api/admin/tv-screens?organization_id={org.id}")
    assert resp.status_code == 200, resp.text
    assert [s["id"] for s in resp.json()] == [screen_id]

    resp = await client.delete(f"/api/admin/tv-screens/{screen_id}?organization_id={org.id}")
    assert resp.status_code == 204, resp.text

    resp = await client.get(f"/api/admin/tv-screens?organization_id={org.id}")
    assert resp.json() == []


async def test_admin_cannot_see_other_org_tv_screen(client, db_session, make_user, make_organization):
    org_a = await make_organization(name="TV Org A")
    org_b = await make_organization(name="TV Org B")
    admin_a, password_a = await make_user(
        email="tv-admin-a@example.com", role=UserRole.org_admin, organization_id=org_a.id
    )
    admin_b, password_b = await make_user(
        email="tv-admin-b@example.com", role=UserRole.org_admin, organization_id=org_b.id
    )

    await login(client, "tv-admin-b@example.com", password_b)
    resp = await client.post(
        f"/api/admin/tv-screens?organization_id={org_b.id}",
        json={"name": "Табло B"},
    )
    assert resp.status_code == 201, resp.text
    screen_id = resp.json()["id"]

    await login(client, "tv-admin-a@example.com", password_a)
    resp = await client.delete(f"/api/admin/tv-screens/{screen_id}?organization_id={org_a.id}")
    assert resp.status_code == 404, resp.text


async def test_pair_flow_state_and_qr_batch(client, db_session, make_user, make_organization):
    org = await make_organization(name="TV Pair Организация")
    queue = await _make_queue(db_session, org)
    admin, password = await make_user(
        email="tv-pair-admin@example.com", role=UserRole.org_admin, organization_id=org.id
    )

    await login(client, "tv-pair-admin@example.com", password)
    resp = await client.post(
        f"/api/admin/tv-screens?organization_id={org.id}",
        json={"name": "Табло 1", "queue_id": str(queue.id)},
    )
    assert resp.status_code == 201, resp.text
    pairing_code = resp.json()["pairing_code"]

    resp = await client.post("/api/tv/pair", json={"code": "000000"})
    assert resp.status_code == 404, resp.text

    resp = await client.post("/api/tv/pair", json={"code": pairing_code})
    assert resp.status_code == 200, resp.text
    device_token = resp.json()["device_token"]
    assert device_token

    # single-use: the same code can't be paired again
    resp = await client.post("/api/tv/pair", json={"code": pairing_code})
    assert resp.status_code == 404, resp.text

    resp = await client.get("/api/tv/state")
    assert resp.status_code == 401, resp.text

    resp = await client.get("/api/tv/state", headers={"X-Device-Token": "not-a-real-token"})
    assert resp.status_code == 401, resp.text

    resp = await client.get("/api/tv/state", headers={"X-Device-Token": device_token})
    assert resp.status_code == 200, resp.text
    state = resp.json()
    assert state["organization_name"] == org.name
    assert len(state["queues"]) == 1
    assert state["queues"][0]["queue_id"] == str(queue.id)
    assert state["queues"][0]["waiting_count"] == 0

    resp = await client.get("/api/tv/qr-batch", headers={"X-Device-Token": device_token})
    assert resp.status_code == 200, resp.text
    batch = resp.json()
    assert "server_time" in batch
    assert len(batch["tokens"]) >= 1


async def test_qr_batch_rejected_for_hall_screen_without_queue(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="TV Hall Организация")
    admin, password = await make_user(
        email="tv-hall-admin@example.com", role=UserRole.org_admin, organization_id=org.id
    )

    await login(client, "tv-hall-admin@example.com", password)
    resp = await client.post(f"/api/admin/tv-screens?organization_id={org.id}", json={"name": "Табло зала"})
    assert resp.status_code == 201, resp.text
    pairing_code = resp.json()["pairing_code"]

    resp = await client.post("/api/tv/pair", json={"code": pairing_code})
    assert resp.status_code == 200, resp.text
    device_token = resp.json()["device_token"]

    resp = await client.get("/api/tv/qr-batch", headers={"X-Device-Token": device_token})
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["code"] == "tv_screen_has_no_queue"


async def test_hall_screen_state_aggregates_all_organization_queues(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="TV Зал Организация")
    org.logo_url = "https://example.com/logo.png"
    org.brand_color = "#123456"
    await db_session.commit()

    queue_a = await _make_queue(db_session, org, name="Терапевт", ticket_prefix="A")
    queue_b = await _make_queue(db_session, org, name="Хирург", ticket_prefix="B")
    admin, password = await make_user(
        email="tv-hall2-admin@example.com", role=UserRole.org_admin, organization_id=org.id
    )

    await login(client, "tv-hall2-admin@example.com", password)
    resp = await client.post(f"/api/admin/tv-screens?organization_id={org.id}", json={"name": "Табло зала"})
    assert resp.status_code == 201, resp.text
    pairing_code = resp.json()["pairing_code"]

    resp = await client.post("/api/tv/pair", json={"code": pairing_code})
    assert resp.status_code == 200, resp.text
    device_token = resp.json()["device_token"]

    resp = await client.get("/api/tv/state", headers={"X-Device-Token": device_token})
    assert resp.status_code == 200, resp.text
    state = resp.json()
    assert state["logo_url"] == "https://example.com/logo.png"
    assert state["brand_color"] == "#123456"
    queue_ids = {q["queue_id"] for q in state["queues"]}
    assert queue_ids == {str(queue_a.id), str(queue_b.id)}


async def test_queue_bound_screen_state_has_only_its_queue(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="TV Одна Очередь Организация")
    queue_a = await _make_queue(db_session, org, name="Терапевт", ticket_prefix="A")
    await _make_queue(db_session, org, name="Хирург", ticket_prefix="B")
    admin, password = await make_user(
        email="tv-single-admin@example.com", role=UserRole.org_admin, organization_id=org.id
    )

    await login(client, "tv-single-admin@example.com", password)
    resp = await client.post(
        f"/api/admin/tv-screens?organization_id={org.id}",
        json={"name": "Табло 1", "queue_id": str(queue_a.id)},
    )
    assert resp.status_code == 201, resp.text
    pairing_code = resp.json()["pairing_code"]

    resp = await client.post("/api/tv/pair", json={"code": pairing_code})
    device_token = resp.json()["device_token"]

    resp = await client.get("/api/tv/state", headers={"X-Device-Token": device_token})
    assert resp.status_code == 200, resp.text
    state = resp.json()
    assert [q["queue_id"] for q in state["queues"]] == [str(queue_a.id)]


async def test_tv_state_brand_fields_are_null_when_unset(client, db_session, make_user, make_organization):
    org = await make_organization(name="TV Без Брендинга Организация")
    queue = await _make_queue(db_session, org)
    admin, password = await make_user(
        email="tv-nobrand-admin@example.com", role=UserRole.org_admin, organization_id=org.id
    )

    await login(client, "tv-nobrand-admin@example.com", password)
    resp = await client.post(
        f"/api/admin/tv-screens?organization_id={org.id}",
        json={"name": "Табло", "queue_id": str(queue.id)},
    )
    pairing_code = resp.json()["pairing_code"]
    resp = await client.post("/api/tv/pair", json={"code": pairing_code})
    device_token = resp.json()["device_token"]

    resp = await client.get("/api/tv/state", headers={"X-Device-Token": device_token})
    state = resp.json()
    assert state["logo_url"] is None
    assert state["brand_color"] is None


async def test_tv_state_reflects_screen_language(client, db_session, make_user, make_organization):
    org = await make_organization(name="TV Язык Организация")
    queue = await _make_queue(db_session, org)
    admin, password = await make_user(
        email="tv-lang-admin@example.com", role=UserRole.org_admin, organization_id=org.id
    )

    await login(client, "tv-lang-admin@example.com", password)
    resp = await client.post(
        f"/api/admin/tv-screens?organization_id={org.id}",
        json={"name": "Табло", "queue_id": str(queue.id), "language": "kk"},
    )
    pairing_code = resp.json()["pairing_code"]
    resp = await client.post("/api/tv/pair", json={"code": pairing_code})
    device_token = resp.json()["device_token"]

    resp = await client.get("/api/tv/state", headers={"X-Device-Token": device_token})
    assert resp.json()["language"] == "kk"
