from httpx import AsyncClient


async def login(client: AsyncClient, email: str, password: str) -> None:
    resp = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
