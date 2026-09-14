from app.models.enums import UserRole
from app.models.user import User
from app.security import hash_password


async def _create_user(db_session, *, email, password, role, organization_id=None):
    user = User(
        email=email,
        password_hash=hash_password(password),
        full_name="Test User",
        role=role,
        organization_id=organization_id,
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def test_login_success_and_me(client, db_session):
    user = await _create_user(
        db_session, email="operator@example.com", password="s3cret-pass", role=UserRole.operator
    )

    resp = await client.post(
        "/api/auth/login", json={"email": "operator@example.com", "password": "s3cret-pass"}
    )
    assert resp.status_code == 200
    assert resp.json() == {"totp_required": False, "totp_setup": None}
    assert "access_token" in resp.cookies

    me_resp = await client.get("/api/auth/me")
    assert me_resp.status_code == 200
    body = me_resp.json()
    assert body["email"] == "operator@example.com"
    assert body["id"] == str(user.id)


async def test_login_wrong_password(client, db_session):
    await _create_user(
        db_session, email="operator2@example.com", password="s3cret-pass", role=UserRole.operator
    )
    resp = await client.post(
        "/api/auth/login", json={"email": "operator2@example.com", "password": "wrong"}
    )
    assert resp.status_code == 401


async def test_me_requires_auth(client):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401
