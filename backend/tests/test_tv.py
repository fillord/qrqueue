from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

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

    preview = await client.get(f"/api/admin/tv-screens/{screen_id}/preview?organization_id={org.id}")
    assert preview.status_code == 200, preview.text
    assert preview.json()["organization_name"] == org.name
    assert "device_token" not in preview.json()

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
    resp = await client.post(f"/api/admin/tv-screens/{screen_id}/unpair?organization_id={org_a.id}")
    assert resp.status_code == 404, resp.text
    resp = await client.get(f"/api/admin/tv-screens/{screen_id}/preview?organization_id={org_a.id}")
    assert resp.status_code == 404, resp.text


async def test_admin_unpairs_tv_and_can_pair_it_again(client, db_session, make_user, make_organization):
    org = await make_organization(name="TV Unpair Организация")
    queue = await _make_queue(db_session, org)
    admin, password = await make_user(
        email="tv-unpair@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    await login(client, "tv-unpair@example.com", password)
    created = await client.post("/api/admin/tv-screens", json={
        "name": "Табло", "queue_id": str(queue.id), "language": "ru",
    })
    assert created.status_code == 201, created.text
    screen_id = created.json()["id"]
    old_code = created.json()["pairing_code"]
    paired = await client.post("/api/tv/pair", json={"code": old_code})
    assert paired.status_code == 200, paired.text
    old_token = paired.json()["device_token"]

    unpaired = await client.post(f"/api/admin/tv-screens/{screen_id}/unpair")
    assert unpaired.status_code == 200, unpaired.text
    assert unpaired.json()["queue_id"] == str(queue.id)
    assert unpaired.json()["name"] == "Табло"
    assert unpaired.json()["last_seen_at"] is None
    new_code = unpaired.json()["pairing_code"]
    assert new_code and new_code != old_code
    assert (await client.get("/api/tv/state", headers={"X-Device-Token": old_token})).status_code == 401
    assert (await client.post(f"/api/admin/tv-screens/{screen_id}/unpair")).status_code == 409

    paired_again = await client.post("/api/tv/pair", json={"code": new_code})
    assert paired_again.status_code == 200, paired_again.text
    assert paired_again.json()["device_token"] != old_token
    assert (await client.get("/api/tv/state", headers={"X-Device-Token": paired_again.json()["device_token"]})).status_code == 200


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


async def test_tv_heartbeat_refreshes_last_seen_and_requires_device_token(
    client, db_session, make_organization
):
    org = await make_organization(name="TV heartbeat")
    screen = TVScreen(organization_id=org.id, name="Lobby", pairing_code=None,
                      device_token="heartbeat-device-token", language=Language.ru)
    db_session.add(screen)
    await db_session.commit()
    stale = datetime.now(timezone.utc) - timedelta(minutes=5)
    screen.last_seen_at = stale
    await db_session.commit()

    assert (await client.post("/api/tv/heartbeat")).status_code == 401
    response = await client.post("/api/tv/heartbeat", headers={"X-Device-Token": "heartbeat-device-token"})
    assert response.status_code == 204, response.text
    await db_session.refresh(screen)
    assert screen.last_seen_at > stale


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


async def test_hall_screen_with_exactly_one_active_queue_is_still_marked_as_hall(
    client, db_session, make_user, make_organization
):
    """A hall screen with one visible queue still issues a hall selection QR."""
    org = await make_organization(name="TV Зал Одна Очередь Организация")
    queue = await _make_queue(db_session, org, name="Единственная очередь", ticket_prefix="A")
    admin, password = await make_user(
        email="tv-hall-one-admin@example.com", role=UserRole.org_admin, organization_id=org.id
    )

    await login(client, "tv-hall-one-admin@example.com", password)
    resp = await client.post(f"/api/admin/tv-screens?organization_id={org.id}", json={"name": "Табло зала"})
    assert resp.status_code == 201, resp.text
    pairing_code = resp.json()["pairing_code"]

    resp = await client.post("/api/tv/pair", json={"code": pairing_code})
    device_token = resp.json()["device_token"]

    resp = await client.get("/api/tv/state", headers={"X-Device-Token": device_token})
    assert resp.status_code == 200, resp.text
    state = resp.json()
    assert len(state["queues"]) == 1
    assert state["is_hall_screen"] is True

    resp = await client.get("/api/tv/qr-batch", headers={"X-Device-Token": device_token})
    assert resp.status_code == 200, resp.text
    options = await client.post("/api/public/scan-options", json={"token": resp.json()["tokens"][0]["token"]})
    assert options.status_code == 200, options.text
    assert len(options.json()["queues"]) == 1
    assert options.json()["queues"][0]["unavailable_reason"] is None
    queue.status = QueueStatus.paused
    await db_session.commit()
    refreshed = await client.post("/api/public/scan-options", json={"token": resp.json()["tokens"][0]["token"]})
    assert refreshed.json()["queues"][0]["unavailable_reason"] == "queue_paused"
    denied = await client.post("/api/public/scan", json={
        "token": options.json()["selection_token"], "queue_id": str(queue.id)})
    assert denied.status_code == 422
    assert denied.json()["detail"]["code"] == "queue_paused"


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
    assert state["is_hall_screen"] is True
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
    assert state["is_hall_screen"] is False
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


async def test_tv_state_keeps_simultaneous_calls_and_recall_count(db_session, make_organization):
    from app.models.ticket import Ticket
    from app.models.enums import TicketStatus, TicketSource
    from app.services.tv_state import build_tv_state
    org = await make_organization(name='Shared queue')
    queue = await _make_queue(db_session, org)
    for index, status in enumerate((TicketStatus.called, TicketStatus.confirmed, TicketStatus.serving), 1):
        cabinet = await _make_cabinet(db_session, org, queue, label=str(index))
        db_session.add(Ticket(organization_id=org.id, queue_id=queue.id, cabinet_id=cabinet.id,
            number=index, display_number=f'A{index:03}', source=TicketSource.registrar,
            status=status, call_count=index, called_at=datetime.now(timezone.utc)))
    await db_session.flush()
    screen = TVScreen(organization_id=org.id, queue_id=queue.id, name='Test', language=Language.ru)
    state = await build_tv_state(db_session, screen)
    calls = state['queues'][0]['active_calls']
    assert len(calls) == 3
    assert {(c['display_number'], c['cabinet_label'], c['call_count']) for c in calls} == {('A001', '1', 1), ('A002', '2', 2), ('A003', '3', 3)}


async def test_tv_recent_calls_keep_last_two_after_completion_and_respect_screen_selection(
    db_session, make_organization
):
    from app.models.enums import TicketSource, TicketStatus
    from app.models.ticket import Ticket
    from app.services.tv_state import build_tv_state

    org = await make_organization(name='Recent calls')
    first_queue = await _make_queue(db_session, org, name='Therapy')
    second_queue = await _make_queue(db_session, org, name='Surgery')
    first_cabinet = await _make_cabinet(db_session, org, first_queue, label='101')
    second_cabinet = await _make_cabinet(db_session, org, second_queue, label='202')
    local_start = datetime.now(ZoneInfo(org.timezone)).replace(hour=0, minute=0, second=0, microsecond=0)
    calls = [
        (first_queue, first_cabinet, 'A001', local_start - timedelta(minutes=1), TicketStatus.served),
        (first_queue, first_cabinet, 'A002', local_start + timedelta(minutes=1), TicketStatus.served),
        (second_queue, second_cabinet, 'B001', local_start + timedelta(minutes=2), TicketStatus.serving),
        (first_queue, first_cabinet, 'A003', local_start + timedelta(minutes=3), TicketStatus.called),
    ]
    for number, (queue, cabinet, display_number, called_at, status) in enumerate(calls, 1):
        db_session.add(Ticket(organization_id=org.id, queue_id=queue.id, cabinet_id=cabinet.id,
                              number=number, display_number=display_number, source=TicketSource.registrar,
                              status=status, call_count=1, called_at=called_at.astimezone(timezone.utc)))
    await db_session.flush()

    screen = TVScreen(organization_id=org.id, queue_id=None, name='Hall', language=Language.ru)
    state = await build_tv_state(db_session, screen)
    assert [(call['display_number'], call['queue_name']) for call in state['recent_calls']] == [
        ('A003', 'Therapy'), ('B001', 'Surgery')]

    screen.cabinet_selection_mode = 'selected'
    screen.selected_cabinet_ids = [first_cabinet.id]
    state = await build_tv_state(db_session, screen)
    assert [call['display_number'] for call in state['recent_calls']] == ['A003', 'A002']


async def test_admin_can_change_screen_language_and_other_org_cannot(client, db_session, make_user, make_organization):
    org = await make_organization(name='TV language edit')
    _, password = await make_user(email='tv-edit@example.com', role=UserRole.org_admin, organization_id=org.id)
    await login(client, 'tv-edit@example.com', password)
    response = await client.post('/api/admin/tv-screens', json={'name':'Hall'})
    screen_id = response.json()['id']
    response = await client.patch(f'/api/admin/tv-screens/{screen_id}', json={'language':'en'})
    assert response.status_code == 200
    assert response.json()['language'] == 'en'
    other_org = await make_organization(name='Other screen org')
    _, password = await make_user(email='tv-other@example.com', role=UserRole.org_admin, organization_id=other_org.id)
    await login(client, 'tv-other@example.com', password)
    assert (await client.patch(f'/api/admin/tv-screens/{screen_id}', json={'language':'kk'})).status_code == 404


async def test_hall_tv_selects_queues_and_cabinets_and_rejects_foreign_ids(
    client, db_session, make_user, make_organization
):
    from app.models.enums import TicketSource, TicketStatus
    from app.models.ticket import Ticket

    org = await make_organization(name="Selected TV")
    foreign_org = await make_organization(name="Foreign selected TV")
    queues = [await _make_queue(db_session, org, name=name, ticket_prefix=prefix)
              for name, prefix in (("Therapy", "A"), ("Surgery", "B"), ("Lab", "C"))]
    cabinets = [await _make_cabinet(db_session, org, queues[0], label="1"),
                await _make_cabinet(db_session, org, queues[0], label="2"),
                await _make_cabinet(db_session, org, queues[1], label="3")]
    foreign_queue = await _make_queue(db_session, foreign_org, name="Foreign")
    foreign_cabinet = await _make_cabinet(db_session, foreign_org, foreign_queue)
    for index, (queue, cabinet) in enumerate(((queues[0], cabinets[0]),
                                               (queues[0], cabinets[1]),
                                               (queues[1], cabinets[2])), 1):
        db_session.add(Ticket(organization_id=org.id, queue_id=queue.id, cabinet_id=cabinet.id,
                              number=index, display_number=f"N{index}", source=TicketSource.registrar,
                              status=TicketStatus.called, call_count=1, called_at=datetime.now(timezone.utc)))
    await db_session.commit()
    _, password = await make_user(email="selected-tv@example.com", role=UserRole.org_admin,
                                  organization_id=org.id)
    await login(client, "selected-tv@example.com", password)

    url = "/api/admin/tv-screens"
    response = await client.post(url, json={
        "name": "Selected hall", "queue_selection_mode": "selected",
        "selected_queue_ids": [str(queues[0].id), str(queues[1].id)],
        "cabinet_selection_mode": "selected",
        "selected_cabinet_ids": [str(cabinets[0].id), str(cabinets[2].id)],
    })
    assert response.status_code == 201, response.text
    screen = response.json()
    assert screen["selected_queue_ids"] == [str(queues[0].id), str(queues[1].id)]
    pairing = await client.post("/api/tv/pair", json={"code": screen["pairing_code"]})
    token = pairing.json()["device_token"]
    state = (await client.get("/api/tv/state", headers={"X-Device-Token": token})).json()
    assert state["is_hall_screen"] is True
    assert {item["queue_id"] for item in state["queues"]} == {str(queues[0].id), str(queues[1].id)}
    assert {call["display_number"] for item in state["queues"] for call in item["active_calls"]} == {"N1", "N3"}
    batch = await client.get("/api/tv/qr-batch", headers={"X-Device-Token": token})
    assert batch.status_code == 200, batch.text
    qr_token = batch.json()["tokens"][0]["token"]
    options = await client.post("/api/public/scan-options", json={"token": qr_token})
    assert options.status_code == 200, options.text
    assert {item["id"] for item in options.json()["queues"]} == {str(queues[0].id), str(queues[1].id)}
    from app.services.qr_tokens import issue_batch
    direct_options = await client.post("/api/public/scan-options", json={
        "token": issue_batch(queues[0].id)["tokens"][0]["token"]})
    assert direct_options.status_code == 422
    assert direct_options.json()["detail"]["code"] == "token_invalid"
    selection_token = options.json()["selection_token"]
    assert (await client.post("/api/public/scan", json={"token": qr_token,
                                                       "queue_id": str(queues[0].id)})).status_code == 422
    assert (await client.post("/api/public/scan", json={"token": selection_token,
                                                       "queue_id": str(queues[2].id)})).json()["detail"]["code"] == "queue_unavailable"
    ticket = await client.post("/api/public/scan", json={"token": selection_token,
                                                      "queue_id": str(queues[0].id)})
    assert ticket.status_code == 201, ticket.text
    assert ticket.json()["queue_id"] == str(queues[0].id)
    duplicate = await client.post("/api/public/scan", json={"token": selection_token,
                                                         "queue_id": str(queues[0].id)})
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"]["ticket_id"] == ticket.json()["id"]

    screen_url = f"{url}/{screen['id']}"
    assert (await client.post(url, json={"name": "Bad", "selected_queue_ids": [str(foreign_queue.id)]})).status_code == 404
    assert (await client.patch(screen_url, json={"selected_cabinet_ids": [str(foreign_cabinet.id)]})).status_code == 404
    assert (await client.patch(screen_url, json={"queue_id": str(foreign_queue.id)})).status_code == 404
    assert (await client.patch(screen_url, json={"selected_queue_ids": [str(queues[1].id)]})).status_code == 200
    stale = await client.post("/api/public/scan", json={"token": selection_token,
                                                     "queue_id": str(queues[0].id)})
    assert stale.status_code == 422
    assert stale.json()["detail"]["code"] == "queue_unavailable"
    org.one_ticket_per_org = True
    await db_session.commit()
    cross_queue_duplicate = await client.post("/api/public/scan", json={
        "token": selection_token, "queue_id": str(queues[1].id)})
    assert cross_queue_duplicate.status_code == 409
    assert cross_queue_duplicate.json()["detail"]["ticket_id"] == ticket.json()["id"]
    response = await client.patch(screen_url, json={"queue_id": str(queues[0].id),
                                                    "cabinet_selection_mode": "all"})
    assert response.status_code == 200, response.text
    state = (await client.get("/api/tv/state", headers={"X-Device-Token": token})).json()
    assert state["is_hall_screen"] is False
    assert {call["display_number"] for call in state["queues"][0]["active_calls"]} == {"N1", "N2"}
    response = await client.patch(screen_url, json={"queue_id": None})
    assert response.status_code == 200, response.text
    assert response.json()["queue_id"] is None
