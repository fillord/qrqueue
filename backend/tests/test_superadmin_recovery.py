import pytest
from sqlalchemy import select

from app.config import settings
from app.models.audit_log import AuditLog
from app.models.enums import UserRole
from app.security import totp_code, totp_counter
from app.services.superadmin_recovery import RecoveryDenied, recover_superadmin_totp
from tests.utils import login


async def test_console_recovery_requires_password_and_revokes_sessions(client, db_session, make_user):
    user, password = await make_user(email=settings.superadmin_email, role=UserRole.superadmin)
    await login(client, user.email, password)
    session_token = client.cookies.get(settings.jwt_cookie_name)
    await db_session.refresh(user)
    old_secret = user.totp_secret

    await client.post('/api/auth/logout')
    pending = await client.post('/api/auth/login', json={'email': user.email, 'password': password})
    assert pending.json()['totp_setup'] is None

    with pytest.raises(RecoveryDenied):
        await recover_superadmin_totp(db_session, user.email, 'wrong password')
    await db_session.refresh(user)
    assert user.totp_secret == old_secret
    with pytest.raises(RecoveryDenied):
        await recover_superadmin_totp(db_session, 'another@example.com', password)

    await recover_superadmin_totp(db_session, user.email, password)
    await db_session.refresh(user)
    assert user.totp_secret is None and user.auth_version == 1

    client.cookies.set(settings.jwt_cookie_name, session_token)
    assert (await client.get('/api/auth/me')).status_code == 401
    stale_code = totp_code(old_secret, totp_counter())
    expired = await client.post('/api/auth/totp', json={'code': stale_code})
    assert expired.status_code == 401 and expired.json()['detail']['code'] == 'totp_expired'

    client.cookies.delete(settings.jwt_cookie_name)
    fresh = await client.post('/api/auth/login', json={'email': user.email, 'password': password})
    assert fresh.status_code == 200 and fresh.json()['totp_setup'] is not None
    logs = (await db_session.execute(select(AuditLog).where(AuditLog.action == 'user.totp_recovered'))).scalars().all()
    assert len(logs) == 1 and logs[0].entity_id == user.id


async def test_console_recovery_refuses_non_superadmin(db_session, make_user):
    user, password = await make_user(email='recovery-admin@example.com', role=UserRole.org_admin)
    with pytest.raises(RecoveryDenied):
        await recover_superadmin_totp(db_session, user.email, password)
