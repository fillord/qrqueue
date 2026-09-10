import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db import engine, get_db
from app.main import app
from app.models.enums import Language, Plan, UserRole
from app.models.organization import Organization
from app.models.user import User
from app.security import hash_password
from app.services.slug import generate_unique_slug


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
