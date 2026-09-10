import contextlib
from collections.abc import AsyncIterator

from httpx import AsyncClient
from httpx_ws.transport import ASGIWebSocketTransport

from app.main import app


async def login(client: AsyncClient, email: str, password: str) -> None:
    resp = await client.post("/api/auth/login", json={"email": email, "password": password})
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
