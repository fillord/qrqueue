import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db import engine, get_db
from app.main import app
from app.models.enums import Language, Plan, UserRole
from app.models.organization import Organization
from app.models.user import User
from app.redis import redis_client
from app.security import hash_password
from app.services.slug import generate_unique_slug
from app.ws.manager import manager


@pytest_asyncio.fixture
async def db_session():
    async with engine.connect() as conn:
        await conn.begin()
        session_factory = async_sessionmaker(
            bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
        )
        async with session_factory() as session:
            yield session
        await conn.rollback()


@pytest_asyncio.fixture
async def client(db_session):
    async def _get_db_override():
        yield db_session

    app.dependency_overrides[get_db] = _get_db_override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
def make_user(db_session):
    async def _make(
        *,
        email: str,
        role: UserRole,
        organization_id=None,
        password: str = "test-pass-1234",
        full_name: str = "Test User",
        is_active: bool = True,
    ) -> tuple[User, str]:
        user = User(
            email=email,
            password_hash=hash_password(password),
            full_name=full_name,
            role=role,
            organization_id=organization_id,
            is_active=is_active,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)
        return user, password

    return _make


@pytest.fixture
def override_get_db(db_session):
    """Points the app's get_db dependency at this test's transactional
    db_session, without opening any client itself — for tests that build
    their own WebSocket-capable client (tests.utils.ws_client) instead of
    using the plain `client` fixture. Kept separate from `ws_client` in
    conftest on purpose: httpx_ws's ASGIWebSocketTransport opens an anyio
    TaskGroup, and TaskGroups require entering and exiting in the same
    asyncio Task — a fixture that `yield`s across that boundary can resume
    in a different task under pytest-asyncio's scheduling and blow up with
    "cancel scope in a different task". Opening it fully inside the test
    function's own body (see tests.utils.ws_client) sidesteps that.
    """

    async def _get_db_override():
        yield db_session

    app.dependency_overrides[get_db] = _get_db_override
    yield
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def ws_manager_running():
    """Starts the real ConnectionManager's Redis listener for the duration of
    a test — needed because the app's lifespan (which normally starts it)
    never runs under ASGITransport-based tests. Talks to the real `redis`
    service, same as `services/tickets.py`'s publish_event does.
    """
    manager.start(redis_client)
    yield
    await manager.stop()


@pytest_asyncio.fixture
def make_organization(db_session):
    async def _make(*, name: str = "Тестовая организация", **kwargs) -> Organization:
        org = Organization(
            name=name,
            slug=await generate_unique_slug(db_session, name),
            default_language=kwargs.pop("default_language", Language.ru),
            plan=kwargs.pop("plan", Plan.trial),
            **kwargs,
        )
        db_session.add(org)
        await db_session.commit()
        await db_session.refresh(org)
        return org

    return _make
