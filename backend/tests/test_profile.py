from io import BytesIO

from PIL import Image

from app.api.deps import resolve_session_user
from app.config import settings
from app.models.enums import UserRole
from app.security import create_access_token, verify_password


def sign_in(client, user):
    token = create_access_token(user.id, user.role.value, user.auth_version)
    client.cookies.set(settings.jwt_cookie_name, token)
    return token


async def test_users_edit_name_and_password_but_not_email(client, db_session, make_organization, make_user):
    organization = await make_organization()
    user, old_password = await make_user(
        email="operator-profile@example.com", role=UserRole.operator,
        organization_id=organization.id,
    )
    old_token = sign_in(client, user)

    name = await client.patch("/api/auth/me/name", json={"full_name": "  Айгуль Садыкова  "})
    assert name.status_code == 200
    assert name.json()["full_name"] == "Айгуль Садыкова"

    email = await client.patch("/api/auth/me/email", json={
        "email": "new@example.com", "current_password": old_password,
    })
    assert email.status_code == 403
    assert user.email == "operator-profile@example.com"

    wrong = await client.post("/api/auth/me/password", json={
        "current_password": "wrong", "new_password": "new-password-123",
    })
    assert wrong.status_code == 400
    assert wrong.json()["detail"]["code"] == "invalid_current_password"

    changed = await client.post("/api/auth/me/password", json={
        "current_password": old_password, "new_password": "new-password-123",
    })
    assert changed.status_code == 200
    assert verify_password("new-password-123", user.password_hash)
    assert await resolve_session_user(db_session, old_token) is None
    assert (await client.get("/api/auth/me")).status_code == 200


async def test_admin_email_requires_superadmin(client, make_organization, make_user):
    organization = await make_organization()
    admin, password = await make_user(
        email="admin-profile@example.com", role=UserRole.org_admin,
        organization_id=organization.id,
    )
    sign_in(client, admin)
    response = await client.patch("/api/auth/me/email", json={
        "email": "admin-new@example.com", "current_password": password,
    })
    assert response.status_code == 403
    assert admin.email == "admin-profile@example.com"


async def test_superadmin_can_change_own_email_with_password(client, db_session, make_user):
    admin, password = await make_user(
        email="super-profile@example.com", role=UserRole.superadmin,
    )
    old_token = sign_in(client, admin)
    bad = await client.patch("/api/auth/me/email", json={
        "email": "super-new@example.com", "current_password": "wrong",
    })
    assert bad.status_code == 400
    changed = await client.patch("/api/auth/me/email", json={
        "email": "SUPER-NEW@example.com", "current_password": password,
    })
    assert changed.status_code == 200
    assert changed.json()["email"] == "super-new@example.com"
    assert await resolve_session_user(db_session, old_token) is None
    assert (await client.get("/api/auth/me")).status_code == 200


async def test_photo_is_private_and_can_be_replaced_and_removed(client, make_user):
    user, _ = await make_user(email="photo@example.com", role=UserRole.superadmin)
    assert (await client.get("/api/auth/me/photo")).status_code == 401
    sign_in(client, user)
    assert (await client.get("/api/auth/me/photo")).status_code == 404

    invalid = await client.put("/api/auth/me/photo", content=b"not an image",
                               headers={"content-type": "image/png"})
    assert invalid.status_code == 422
    image = Image.new("RGB", (800, 600), "#347964")
    output = BytesIO()
    image.save(output, format="PNG")
    uploaded = await client.put("/api/auth/me/photo", content=output.getvalue(),
                                headers={"content-type": "image/png"})
    assert uploaded.status_code == 200
    assert uploaded.json()["has_photo"] is True
    photo = await client.get("/api/auth/me/photo")
    assert photo.status_code == 200
    assert photo.headers["content-type"] == "image/jpeg"
    assert photo.headers["cache-control"] == "private, no-store"
    with Image.open(BytesIO(photo.content)) as saved:
        assert max(saved.size) <= 512

    removed = await client.delete("/api/auth/me/photo")
    assert removed.status_code == 200
    assert removed.json()["has_photo"] is False
    assert (await client.get("/api/auth/me/photo")).status_code == 404
