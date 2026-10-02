from datetime import date

from app.models.cabinet import Cabinet, CabinetOperator
from app.models.enums import CabinetStatus, QueueStatus, TicketSource, TicketStatus, UserRole
from app.models.queue import Queue
from app.models.ticket import Ticket
from tests.utils import login


async def test_superadmin_creates_org_and_admin_can_login(client, db_session, make_user):
    _superadmin, sa_password = await make_user(
        email="sa@example.com", role=UserRole.superadmin, organization_id=None
    )
    await login(client, "sa@example.com", sa_password)

    resp = await client.post(
        "/api/sa/organizations",
        json={"name": "Поликлиника №1", "default_language": "ru"},
    )
    assert resp.status_code == 201, resp.text
    org = resp.json()
    assert org["slug"]

    resp = await client.post(
        f"/api/sa/organizations/{org['id']}/admins",
        json={"email": "admin1@example.com", "password": "admin-pass-1234", "full_name": "Admin One"},
    )
    assert resp.status_code == 201, resp.text
    admin = resp.json()
    assert admin["role"] == "org_admin"
    assert admin["organization_id"] == org["id"]

    await client.post("/api/auth/logout")
    resp = await client.post(
        "/api/auth/login", json={"email": "admin1@example.com", "password": "admin-pass-1234"}
    )
    assert resp.status_code == 200


async def test_admin_creates_cabinet_without_queue_auto_creates_queue(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Клиника Береке")
    _admin, password = await make_user(
        email="admin2@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    await login(client, "admin2@example.com", password)

    resp = await client.post("/api/admin/cabinets", json={"label": "Кабинет 5"})
    assert resp.status_code == 201, resp.text
    cabinet = resp.json()
    assert cabinet["queue_id"] is not None

    resp = await client.get(f"/api/admin/queues/{cabinet['queue_id']}")
    assert resp.status_code == 200
    queue = resp.json()
    assert queue["name"] == "Кабинет 5"
    assert queue["organization_id"] == str(org.id)


async def test_admin_cannot_access_other_org_cabinet(
    client, db_session, make_user, make_organization
):
    org_a = await make_organization(name="Организация А")
    org_b = await make_organization(name="Организация Б")
    _admin_a, password_a = await make_user(
        email="admina@example.com", role=UserRole.org_admin, organization_id=org_a.id
    )

    cabinet_b = Cabinet(organization_id=org_b.id, label="Чужой кабинет")
    db_session.add(cabinet_b)
    await db_session.commit()
    await db_session.refresh(cabinet_b)

    await login(client, "admina@example.com", password_a)
    resp = await client.get(f"/api/admin/cabinets/{cabinet_b.id}")
    assert resp.status_code == 404


async def test_operator_forbidden_from_admin_routes(client, db_session, make_user, make_organization):
    org = await make_organization(name="Организация В")
    _operator, password = await make_user(
        email="operator1@example.com", role=UserRole.operator, organization_id=org.id
    )
    await login(client, "operator1@example.com", password)

    resp = await client.get("/api/admin/queues")
    assert resp.status_code == 403


async def test_queue_create_partial_geo_fields_returns_422(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Организация Г")
    _admin, password = await make_user(
        email="admin4@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    await login(client, "admin4@example.com", password)

    resp = await client.post(
        "/api/admin/queues",
        json={"name": "Очередь 1", "ticket_prefix": "A", "latitude": 43.2, "longitude": 76.9},
    )
    assert resp.status_code == 422


async def test_list_queues_includes_waiting_count(client, db_session, make_user, make_organization):
    org = await make_organization(name="Организация Д")
    _admin, password = await make_user(
        email="admin5@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    queue = Queue(organization_id=org.id, name="Очередь", ticket_prefix="A", counter_date=date.today())
    db_session.add(queue)
    await db_session.commit()
    await db_session.refresh(queue)

    for n, status_ in enumerate([TicketStatus.waiting, TicketStatus.waiting, TicketStatus.served], start=1):
        db_session.add(
            Ticket(
                organization_id=org.id,
                queue_id=queue.id,
                number=n,
                display_number=f"A-{n:03d}",
                source=TicketSource.qr,
                status=status_,
            )
        )
    await db_session.commit()

    await login(client, "admin5@example.com", password)
    resp = await client.get("/api/admin/queues")
    assert resp.status_code == 200, resp.text
    body = {q["id"]: q for q in resp.json()}
    assert body[str(queue.id)]["waiting_count"] == 2


async def test_admin_manual_pause_is_sticky_against_cabinet_resume(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Организация Е")
    admin, admin_password = await make_user(
        email="admin6@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    operator, operator_password = await make_user(
        email="operator6@example.com", role=UserRole.operator, organization_id=org.id
    )

    queue = Queue(organization_id=org.id, name="Очередь", ticket_prefix="A", counter_date=date.today())
    db_session.add(queue)
    await db_session.flush()
    cabinet = Cabinet(organization_id=org.id, queue_id=queue.id, label="Окно 1")
    db_session.add(cabinet)
    await db_session.flush()
    db_session.add(CabinetOperator(cabinet_id=cabinet.id, user_id=operator.id))
    await db_session.commit()
    await db_session.refresh(queue)

    await login(client, "admin6@example.com", admin_password)
    resp = await client.patch(f"/api/admin/queues/{queue.id}", json={"status": "paused"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "paused"

    await client.post("/api/auth/logout")
    await login(client, "operator6@example.com", operator_password)
    await client.post(f"/api/operator/cabinets/{cabinet.id}/select")

    resp = await client.post("/api/operator/cabinet/pause")
    assert resp.status_code == 200, resp.text
    resp = await client.post("/api/operator/cabinet/resume")
    assert resp.status_code == 200, resp.text

    await db_session.refresh(queue)
    assert queue.status == QueueStatus.paused  # admin's manual pause must survive cabinet resume

    await client.post("/api/auth/logout")
    await login(client, "admin6@example.com", admin_password)
    resp = await client.patch(f"/api/admin/queues/{queue.id}", json={"status": "open"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "open"


async def test_opening_inactive_queue_reactivates_it(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Queue state invariant")
    _admin, password = await make_user(
        email="queue-state@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    queue = Queue(
        organization_id=org.id, name="Inactive", ticket_prefix="I",
        counter_date=date.today(), status=QueueStatus.closed, is_active=False,
    )
    db_session.add(queue)
    await db_session.commit()

    await login(client, "queue-state@example.com", password)
    response = await client.patch(f"/api/admin/queues/{queue.id}", json={"status": "open"})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "open"
    assert response.json()["is_active"] is True

    response = await client.patch(
        f"/api/admin/queues/{queue.id}", json={"status": "open", "is_active": False}
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "closed"
    assert response.json()["is_active"] is False


async def test_queue_schedule_round_trip(client, db_session, make_user, make_organization):
    org = await make_organization(name="Организация З")
    _admin, password = await make_user(
        email="admin8@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    await login(client, "admin8@example.com", password)

    resp = await client.post("/api/admin/queues", json={"name": "Очередь", "ticket_prefix": "A"})
    queue_id = resp.json()["id"]

    resp = await client.get(f"/api/admin/queues/{queue_id}/schedule")
    assert resp.status_code == 200, resp.text
    assert resp.json() == []

    resp = await client.put(
        f"/api/admin/queues/{queue_id}/schedule",
        json={"schedule": [
            {"weekday": 0, "opens_at": "09:00:00", "closes_at": "18:00:00"},
            {"weekday": 1, "opens_at": "09:00:00", "closes_at": "18:00:00"},
        ]},
    )
    assert resp.status_code == 204, resp.text

    resp = await client.get(f"/api/admin/queues/{queue_id}/schedule")
    assert resp.status_code == 200, resp.text
    entries = resp.json()
    assert len(entries) == 2
    assert {e["weekday"] for e in entries} == {0, 1}


async def test_list_cabinet_operators(client, db_session, make_user, make_organization):
    org = await make_organization(name="Организация Ж")
    _admin, password = await make_user(
        email="admin7@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    operator, _ = await make_user(
        email="operator7@example.com", role=UserRole.operator, organization_id=org.id
    )
    cabinet = Cabinet(organization_id=org.id, label="Окно 1")
    db_session.add(cabinet)
    await db_session.flush()
    db_session.add(CabinetOperator(cabinet_id=cabinet.id, user_id=operator.id))
    await db_session.commit()

    await login(client, "admin7@example.com", password)
    resp = await client.get(f"/api/admin/cabinets/{cabinet.id}/operators")
    assert resp.status_code == 200, resp.text
    emails = [u["email"] for u in resp.json()]
    assert emails == ["operator7@example.com"]


async def test_busy_cabinet_cannot_be_deactivated_or_moved(client, db_session, make_user, make_organization):
    from app.models.ticket import Ticket
    from app.models.enums import TicketStatus, TicketSource
    org = await make_organization(name='Cabinet integrity')
    _, password = await make_user(email='cabinet-integrity@example.com', role=UserRole.org_admin, organization_id=org.id)
    await login(client, 'cabinet-integrity@example.com', password)
    queue = (await client.post('/api/admin/queues', json={'name':'Queue','ticket_prefix':'A'})).json()
    other = (await client.post('/api/admin/queues', json={'name':'Other','ticket_prefix':'B'})).json()
    cabinet_id = (await client.post('/api/admin/cabinets', json={'label':'Desk','queue_id':queue['id']})).json()['id']
    import uuid
    cabinet = await db_session.get(Cabinet, uuid.UUID(cabinet_id))
    ticket = Ticket(organization_id=org.id, queue_id=cabinet.queue_id, cabinet_id=cabinet.id,
                    number=1, display_number='A001', status=TicketStatus.called, source=TicketSource.registrar)
    db_session.add(ticket)
    await db_session.flush()
    cabinet.current_ticket_id = ticket.id
    cabinet.status = CabinetStatus.busy
    await db_session.commit()
    for data in ({'is_active':False}, {'queue_id':other['id']}, {'status':'free'}):
        assert (await client.patch(f'/api/admin/cabinets/{cabinet_id}', json=data)).status_code == 409
    assert (await client.patch(f'/api/admin/cabinets/{cabinet_id}', json={'label':'Renamed'})).status_code == 200
