"""2FA, rate limits and access revocation (PROJECT_STATUS.md, blocker 4)."""
import uuid

import pytest
from httpx_ws import aconnect_ws

from app.config import settings
from app.models.cabinet import Cabinet, CabinetOperator
from app.models.enums import UserRole
from app.models.organization import Organization
from app.models.user import User
from app.redis import redis_client
from app.security import totp_code, totp_counter
from app.services.realtime import publish_event
from tests.test_operator import _assign_operator, _make_cabinet, _make_queue
from tests.utils import login, ws_client


@pytest.fixture
def rate_limits_on(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)


async def _password_step(client, email, password):
    resp = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


# --- 2FA -----------------------------------------------------------------------


async def test_admin_must_enroll_totp_then_login_needs_a_fresh_code(client, db_session, make_user, make_organization):
    org = await make_organization(name="2FA Организация")
    admin, password = await make_user(email="2fa-admin@example.com", role=UserRole.org_admin, organization_id=org.id)

    body = await _password_step(client, admin.email, password)
    assert body["totp_required"] is True
    secret = body["totp_setup"]["secret"]
    assert body["totp_setup"]["otpauth_uri"].startswith("otpauth://totp/")

    # The password step alone is not a session, and the pending cookie is not accepted as one.
    assert (await client.get("/api/auth/me")).status_code == 401
    client.cookies.set(settings.jwt_cookie_name, client.cookies.get("totp_pending"))
    assert (await client.get("/api/auth/me")).status_code == 401
    client.cookies.delete(settings.jwt_cookie_name)

    resp = await client.post("/api/auth/totp", json={"code": "000000"})
    assert resp.status_code == 401 and resp.json()["detail"]["code"] == "invalid_totp"
    await db_session.refresh(admin)
    assert admin.totp_secret is None  # a failed enrollment persists nothing

    counter = totp_counter()
    resp = await client.post("/api/auth/totp", json={"code": totp_code(secret, counter)})
    assert resp.status_code == 200, resp.text
    me = await client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["totp_enabled"] is True
    await db_session.refresh(admin)
    assert admin.totp_secret == secret

    # Second login: enrolled, so no setup material is sent and the used code is rejected.
    await client.post("/api/auth/logout")
    body = await _password_step(client, admin.email, password)
    assert body == {"totp_required": True, "totp_setup": None}
    resp = await client.post("/api/auth/totp", json={"code": totp_code(secret, counter)})
    assert resp.status_code == 401 and resp.json()["detail"]["code"] == "invalid_totp"
    resp = await client.post("/api/auth/totp", json={"code": totp_code(secret, counter + 1)})
    assert resp.status_code == 200, resp.text
    assert (await client.get("/api/auth/me")).status_code == 200


async def test_totp_step_without_password_step_is_rejected(client):
    resp = await client.post("/api/auth/totp", json={"code": "123456"})
    assert resp.status_code == 401 and resp.json()["detail"]["code"] == "totp_expired"


async def test_operator_without_authenticator_logs_in_directly(client, make_user, make_organization):
    org = await make_organization(name="Без 2FA")
    operator, password = await make_user(email="no2fa@example.com", role=UserRole.operator, organization_id=org.id)
    body = await _password_step(client, operator.email, password)
    assert body["totp_required"] is False
    assert (await client.get("/api/auth/me")).status_code == 200


async def test_superadmin_can_reset_admin_totp(client, db_session, make_user, make_organization):
    org = await make_organization(name="Сброс 2FA")
    admin, password = await make_user(email="reset-admin@example.com", role=UserRole.org_admin, organization_id=org.id)
    sa, sa_password = await make_user(email="reset-sa@example.com", role=UserRole.superadmin)
    await login(client, admin.email, password)
    old_session = client.cookies.get(settings.jwt_cookie_name)
    await db_session.refresh(admin)
    assert admin.totp_secret is not None

    await client.post("/api/auth/logout")
    await login(client, sa.email, sa_password)
    resp = await client.patch(f"/api/sa/organizations/{org.id}/admins/{admin.id}", json={"reset_totp": True})
    assert resp.status_code == 200, resp.text
    await db_session.refresh(admin)
    assert admin.totp_secret is None and admin.auth_version == 1
    client.cookies.set(settings.jwt_cookie_name, old_session)
    assert (await client.get("/api/auth/me")).status_code == 401
    await client.post("/api/auth/logout")
    body = await _password_step(client, admin.email, password)
    assert body["totp_setup"] is not None


# --- rate limits -------------------------------------------------------------------


async def test_login_is_limited_per_email(client, rate_limits_on):
    email = f"limited-{uuid.uuid4()}@example.com"
    for _ in range(settings.rate_limit_login_per_minute):
        assert (await client.post("/api/auth/login", json={"email": email, "password": "x"})).status_code == 401
    resp = await client.post("/api/auth/login", json={"email": email, "password": "x"})
    assert resp.status_code == 429
    assert resp.json()["detail"]["code"] == "rate_limited"
    assert resp.json()["detail"]["retry_after"] > 0
    other = await client.post("/api/auth/login", json={"email": f"other-{uuid.uuid4()}@example.com", "password": "x"})
    assert other.status_code == 401


async def test_scan_is_limited_per_ip_from_cf_header(client, rate_limits_on):
    ip = f"10.0.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}"
    headers = {"CF-Connecting-IP": ip}
    for _ in range(settings.rate_limit_scan_per_minute):
        assert (await client.post("/api/public/scan", json={"token": "bad"}, headers=headers)).status_code == 422
    assert (await client.post("/api/public/scan", json={"token": "bad"}, headers=headers)).status_code == 429


async def test_tv_pair_is_limited_per_ip(client, rate_limits_on):
    headers = {"CF-Connecting-IP": f"10.1.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}"}
    for _ in range(settings.rate_limit_tv_pair_per_minute):
        assert (await client.post("/api/tv/pair", json={"code": "000000"}, headers=headers)).status_code == 404
    assert (await client.post("/api/tv/pair", json={"code": "000000"}, headers=headers)).status_code == 429


# --- revocation ----------------------------------------------------------------------


async def test_deactivated_organization_revokes_staff_sessions_and_tv(client, db_session, make_user, make_organization):
    org = await make_organization(name="Деактивация")
    queue = await _make_queue(db_session, org)
    admin, password = await make_user(email="deact-admin@example.com", role=UserRole.org_admin, organization_id=org.id)
    await login(client, admin.email, password)
    resp = await client.post(f"/api/admin/tv-screens?organization_id={org.id}", json={"name": "Табло", "queue_id": str(queue.id)})
    device_token = (await client.post("/api/tv/pair", json={"code": resp.json()["pairing_code"]})).json()["device_token"]
    assert (await client.get("/api/tv/state", headers={"X-Device-Token": device_token})).status_code == 200

    org.is_active = False
    await db_session.commit()

    assert (await client.get("/api/auth/me")).status_code == 401
    assert (await client.get("/api/tv/state", headers={"X-Device-Token": device_token})).status_code == 401
    resp = await client.post("/api/auth/login", json={"email": admin.email, "password": password})
    assert resp.status_code == 403 and resp.json()["detail"]["code"] == "organization_inactive"


async def test_unassigned_operator_loses_cabinet_selection(client, db_session, make_user, make_organization):
    org = await make_organization(name="Снятие назначения")
    queue = await _make_queue(db_session, org)
    cabinet = await _make_cabinet(db_session, org, queue)
    operator, password = await make_user(email="unassigned-op@example.com", role=UserRole.operator, organization_id=org.id)
    await _assign_operator(db_session, cabinet, operator)
    await login(client, operator.email, password)
    assert (await client.post(f"/api/operator/cabinets/{cabinet.id}/select")).status_code == 200
    assert (await client.get("/api/operator/queue")).status_code == 200

    await db_session.delete(await db_session.get(CabinetOperator, (cabinet.id, operator.id)))
    await db_session.commit()

    resp = await client.get("/api/operator/queue")
    assert resp.status_code == 409 and resp.json()["detail"]["code"] == "cabinet_not_selected"
    assert await redis_client.get(f"operator:{operator.id}:cabinet") is None


async def test_operator_ws_closes_when_user_is_deactivated(ws_manager_running, override_get_db, db_session, make_user, make_organization):
    org = await make_organization(name="WS отзыв")
    queue = await _make_queue(db_session, org)
    cabinet = await _make_cabinet(db_session, org, queue)
    operator, password = await make_user(email="ws-revoked@example.com", role=UserRole.operator, organization_id=org.id)
    await _assign_operator(db_session, cabinet, operator)

    async with ws_client() as ac:
        await login(ac, operator.email, password)
        assert (await ac.post(f"/api/operator/cabinets/{cabinet.id}/select")).status_code == 200
        async with aconnect_ws("/ws/operator", ac) as ws:
            assert "waiting" in await ws.receive_json()
            operator.is_active = False
            await db_session.commit()
            await publish_event(redis_client, queue.id, "queue.status", status="open")
            with pytest.raises(Exception):
                await ws.receive_json(timeout=5)
