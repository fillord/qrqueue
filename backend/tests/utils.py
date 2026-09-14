import contextlib
from collections.abc import AsyncIterator

from httpx import AsyncClient
from httpx_ws.transport import ASGIWebSocketTransport

from app.main import app
from app.redis import redis_client
from app.security import decode_access_token, totp_code, totp_counter

# Secrets enrolled by earlier login() calls, so a test that logs the same
# admin in twice can answer the second challenge.
_enrolled_secrets: dict[str, str] = {}


async def login(client: AsyncClient, email: str, password: str, totp_secret: str | None = None) -> None:
    """Completes both steps: enrolls the authenticator when the role requires
    one (superadmin, org_admin) or answers with the enrolled secret's code."""
    resp = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    if not body["totp_required"]:
        return
    if body["totp_setup"] is not None:
        _enrolled_secrets[email] = body["totp_setup"]["secret"]
    secret = totp_secret or _enrolled_secrets[email]
    counter = totp_counter()
    # Tests log in repeatedly inside one 30-second window; forget the replay mark.
    user_id = decode_access_token(client.cookies.get("totp_pending"))["sub"]
    await redis_client.delete(f"totp:used:{user_id}:{counter}")
    resp = await client.post("/api/auth/totp", json={"code": totp_code(secret, counter)})
    assert resp.status_code == 200, resp.text


@contextlib.asynccontextmanager
async def ws_client() -> AsyncIterator[AsyncClient]:
    """A client whose transport understands WebSocket upgrades (plain
    ASGITransport only speaks the http scope), for tests that mix regular
    API calls and `httpx_ws.aconnect_ws(...)` against the same client so
    cookies set by one are seen by the other.

    Must be opened directly inside the test function (not via a fixture
    that yields across a setup/teardown boundary) — see
    conftest.override_get_db for why.
    """
    async with ASGIWebSocketTransport(app=app) as transport:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
