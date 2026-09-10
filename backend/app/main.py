from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import select

from app.api.auth import router as auth_router
from app.config import settings
from app.db import async_session_factory
from app.models.enums import UserRole
from app.models.user import User
from app.security import hash_password


async def bootstrap_superadmin() -> None:
    async with async_session_factory() as db:
        result = await db.execute(select(User).where(User.email == settings.superadmin_email))
        if result.scalar_one_or_none() is not None:
            return

        db.add(
            User(
                email=settings.superadmin_email,
                password_hash=hash_password(settings.superadmin_password),
                full_name="Superadmin",
                role=UserRole.superadmin,
                organization_id=None,
                is_active=True,
            )
        )
        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await bootstrap_superadmin()
    yield


app = FastAPI(title="Онлайн-очереди", lifespan=lifespan)

app.include_router(auth_router, prefix="/api")


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}
