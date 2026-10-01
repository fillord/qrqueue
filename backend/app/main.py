import asyncio
import contextlib
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, text

from app.api.admin import router as admin_router
from app.api.attendance import router as attendance_router
from app.api.assistant import router as assistant_router
from app.api.auth import router as auth_router
from app.api.operator import router as operator_router
from app.api.public import router as public_router
from app.api.registrar import router as registrar_router
from app.api.superadmin import router as superadmin_router
from app.api.tv import router as tv_router
from app.api.tv_signage import router as tv_signage_router
from app.config import settings
from app.db import async_session_factory
from app.models.enums import UserRole
from app.models.user import User
from app.redis import redis_client
from app.security import hash_password
from app.services.errors import ServiceError
from app.workers.schedules import run_once as run_schedules_once
from app.workers.timeouts import run_once as run_timeouts_once
from app.ws.manager import manager
from app.ws.routes import router as ws_router

logger = logging.getLogger(__name__)

TIMEOUT_WORKER_INTERVAL_SECONDS = 10
SCHEDULE_WORKER_INTERVAL_SECONDS = 30


async def bootstrap_superadmin() -> None:
    async with async_session_factory() as db:
        # A superadmin may change their email in their profile. Do not create a
        # second superadmin with the bootstrap address on the next restart.
        result = await db.execute(select(User).where(User.role == UserRole.superadmin))
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


async def _timeout_worker_loop() -> None:
    while True:
        await asyncio.sleep(TIMEOUT_WORKER_INTERVAL_SECONDS)
        try:
            async with async_session_factory() as db:
                await run_timeouts_once(db, redis_client)
        except Exception:
            logger.exception("timeout worker tick failed")


async def _schedule_worker_loop() -> None:
    while True:
        try:
            async with async_session_factory() as db:
                await run_schedules_once(db, redis_client)
        except Exception:
            logger.exception("schedule worker tick failed")
        await asyncio.sleep(SCHEDULE_WORKER_INTERVAL_SECONDS)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    await bootstrap_superadmin()
    manager.start(redis_client)
    worker_tasks = [
        asyncio.create_task(_timeout_worker_loop()),
        asyncio.create_task(_schedule_worker_loop()),
    ]
    try:
        yield
    finally:
        for task in worker_tasks:
            task.cancel()
        for task in worker_tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await manager.stop()


app = FastAPI(title="Онлайн-очереди", lifespan=lifespan)


@app.exception_handler(ServiceError)
async def service_error_handler(request: Request, exc: ServiceError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": {"code": exc.code, **exc.extra}})


app.include_router(auth_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(attendance_router, prefix="/api")
app.include_router(assistant_router, prefix="/api")
app.include_router(superadmin_router, prefix="/api")
app.include_router(public_router, prefix="/api")
app.include_router(operator_router, prefix="/api")
app.include_router(registrar_router, prefix="/api")
app.include_router(tv_router, prefix="/api")
app.include_router(tv_signage_router, prefix="/api")
app.include_router(ws_router)


@app.get("/api/health", response_model=None)
async def health() -> dict | JSONResponse:
    try:
        async with async_session_factory() as db:
            await asyncio.wait_for(db.execute(text("SELECT 1")), timeout=3)
        await asyncio.wait_for(redis_client.ping(), timeout=3)
    except Exception:
        logger.exception("Readiness check failed")
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    return {"status": "ok"}
