from app.config import settings
from app.models.enums import UserRole
from app.security import create_access_token


def sign_in(client, user):
    token = create_access_token(user.id, user.role.value, user.auth_version)
    client.cookies.set(settings.jwt_cookie_name, token)


async def test_assistant_status_and_privacy_preferences(client, make_user, monkeypatch):
    user, _ = await make_user(email="assistant@example.com", role=UserRole.org_admin)
    sign_in(client, user)

    monkeypatch.setattr(settings, "gemini_api_key", None)
    status = await client.get("/api/assistant/status")
    assert status.status_code == 200
    assert status.json() == {"available": False}

    disabled = await client.patch("/api/auth/me/assistant", json={
        "assistant_enabled": True,
        "assistant_ai_enabled": False,
    })
    assert disabled.status_code == 200
    chat = await client.post("/api/assistant/chat", json={
        "message": "Что здесь делать?",
        "path": "/admin/queues?secret=must-not-be-forwarded",
        "locale": "ru",
    })
    assert chat.status_code == 403
    assert chat.json()["detail"]["code"] == "assistant_ai_disabled"


async def test_assistant_requires_session(client):
    assert (await client.get("/api/assistant/status")).status_code == 401
    assert (await client.post("/api/assistant/chat", json={
        "message": "Help me",
        "path": "/admin",
        "locale": "en",
    })).status_code == 401
