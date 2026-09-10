from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.superadmin import router as superadmin_router
from app.config import settings
from app.db import async_session_factory
from app.models.enums import UserRole
from app.models.user import User
from app.security import hash_password
from app.services.errors import ServiceError


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


@app.exception_handler(ServiceError)
async def service_error_handler(request: Request, exc: ServiceError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": {"code": exc.code, **exc.extra}})


app.include_router(auth_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(superadmin_router, prefix="/api")


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}
