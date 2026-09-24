import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.models.enums import AuditActorType, UserRole
from app.services.audit import log_action
from tests.utils import login

pytestmark = pytest.mark.asyncio


async def _log(db_session, organization_id, *, action, actor_id=None, entity_id=None):
    await log_action(
        db_session,
        actor_type=AuditActorType.user,
        actor_id=actor_id,
        action=action,
        entity_type="ticket",
        entity_id=entity_id or uuid.uuid4(),
        organization_id=organization_id,
    )
    await db_session.commit()


async def test_audit_logs_filter_by_action(client, db_session, make_user, make_organization):
    org = await make_organization(name="Журнал Организация 1")
    admin, password = await make_user(
        email="audit-admin1@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    await _log(db_session, org.id, action="ticket.called", actor_id=admin.id)
    await _log(db_session, org.id, action="ticket.finished", actor_id=admin.id)
    await _log(db_session, org.id, action="ticket.called", actor_id=admin.id)

    await login(client, "audit-admin1@example.com", password)
    resp = await client.get("/api/admin/audit-logs?action=ticket.called")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 2
    assert all(item["action"] == "ticket.called" for item in body["items"])


async def test_audit_logs_filter_by_date_range(client, db_session, make_user, make_organization):
    org = await make_organization(name="Журнал Организация 2")
    admin, password = await make_user(
        email="audit-admin2@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    await _log(db_session, org.id, action="ticket.created", actor_id=admin.id)

    await login(client, "audit-admin2@example.com", password)
    today = datetime.now(ZoneInfo(org.timezone)).date()

    resp = await client.get(f"/api/admin/audit-logs?from={today}&to={today}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["total"] >= 1

    yesterday = today - timedelta(days=2)
    two_days_ago = today - timedelta(days=3)
    resp = await client.get(f"/api/admin/audit-logs?from={two_days_ago}&to={yesterday}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["total"] == 0


async def test_org_admin_sees_only_own_organization_logs_even_without_filter(
    client, db_session, make_user, make_organization
):
    org_a = await make_organization(name="Журнал Org A")
    org_b = await make_organization(name="Журнал Org B")
    admin_a, password_a = await make_user(
        email="audit-admin-a@example.com", role=UserRole.org_admin, organization_id=org_a.id
    )
    await _log(db_session, org_a.id, action="ticket.called", actor_id=admin_a.id)
    await _log(db_session, org_b.id, action="ticket.called", actor_id=None)
    await _log(db_session, org_b.id, action="ticket.finished", actor_id=None)

    await login(client, "audit-admin-a@example.com", password_a)
    # No action filter here — login() itself just logged a "user.login" entry
    # for org_a, so this also proves scoping doesn't only work for the one
    # action explicitly logged above.
    resp = await client.get("/api/admin/audit-logs?limit=200")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert all(item["organization_id"] == str(org_a.id) for item in body["items"])
    actions = {item["action"] for item in body["items"]}
    assert actions == {"ticket.called", "user.login", "user.totp_enabled"}  # org_a only, never org_b


async def test_audit_log_actor_name_joined_for_user_actor(client, db_session, make_user, make_organization):
    org = await make_organization(name="Журнал Организация Имя")
    admin, password = await make_user(
        email="audit-admin3@example.com",
        role=UserRole.org_admin,
        organization_id=org.id,
        full_name="Иван Иванов",
    )
    await _log(db_session, org.id, action="ticket.called", actor_id=admin.id)

    await login(client, "audit-admin3@example.com", password)
    resp = await client.get("/api/admin/audit-logs")
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert items[0]["actor_name"] == "Иван Иванов"


async def test_sa_audit_logs_scoping(client, db_session, make_user, make_organization):
    org_a = await make_organization(name="Журнал SA Org A")
    org_b = await make_organization(name="Журнал SA Org B")
    # A one-off action name, not a real one any other test/session activity
    # could have logged — the dev DB behind this test suite isn't wiped
    # between manual smoke-testing sessions, so counting a real action name
    # ("ticket.called" etc.) with no organization filter isn't reliable.
    marker_action = f"test.marker.{uuid.uuid4().hex}"
    await _log(db_session, org_a.id, action=marker_action, actor_id=None)
    await _log(db_session, org_b.id, action=marker_action, actor_id=None)

    superadmin, sa_password = await make_user(
        email="audit-sa@example.com", role=UserRole.superadmin, organization_id=None
    )
    await login(client, "audit-sa@example.com", sa_password)

    resp = await client.get(f"/api/sa/audit-logs?organization_id={org_a.id}&action={marker_action}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["organization_id"] == str(org_a.id)

    resp = await client.get(f"/api/sa/audit-logs?action={marker_action}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["total"] == 2


async def test_audit_day_uses_organization_timezone(db_session, make_organization):
    import uuid
    from datetime import date, datetime, timezone
    from app.models.audit_log import AuditLog
    from app.models.enums import AuditActorType
    from app.services.audit_query import list_audit_logs
    org = await make_organization(name='Audit local day', timezone='Asia/Almaty')
    for hour in (18, 20):
        db_session.add(AuditLog(organization_id=org.id, actor_type=AuditActorType.system,
            action='test.boundary', entity_type='queue', entity_id=uuid.uuid4(), payload={},
            created_at=datetime(2026, 9, 22, hour, tzinfo=timezone.utc)))
    await db_session.flush()
    items, count = await list_audit_logs(db_session, organization_id=org.id,
        date_from=date(2026, 9, 23), date_to=date(2026, 9, 23), action=None, limit=25, offset=0)
    assert count == 1
    assert items[0]['created_at'].hour == 20
