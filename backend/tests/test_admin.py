from app.models.cabinet import Cabinet
from app.models.enums import UserRole
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
