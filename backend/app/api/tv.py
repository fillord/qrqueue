from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models.organization import Organization
from app.models.tv_screen import TVScreen
from app.redis import get_redis
from app.schemas.qr import QRBatchOut
from app.schemas.tv import TVPairRequest, TVPairResponse, TVStateOut
from app.services.errors import ServiceError
from app.services.qr_tokens import issue_batch
from app.services.rate_limit import client_ip, enforce_rate_limit
from app.services.tv_screens import get_screen_by_device_token, pair_tv_screen
from app.services.tv_state import build_tv_state

router = APIRouter(prefix="/tv", tags=["tv"])


async def current_tv_screen(
    db: AsyncSession = Depends(get_db),
    x_device_token: str | None = Header(default=None, alias="X-Device-Token"),
) -> TVScreen:
    if not x_device_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    screen = await get_screen_by_device_token(db, x_device_token)
    if screen is None or not await screen_organization_is_active(db, screen):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return screen


async def screen_organization_is_active(db: AsyncSession, screen: TVScreen) -> bool:
    organization = await db.get(Organization, screen.organization_id)
    return organization is not None and organization.is_active


@router.post("/pair", response_model=TVPairResponse)
async def pair_route(
    payload: TVPairRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> dict:
    await enforce_rate_limit(
        redis, scope="tv_pair", key=client_ip(request), limit=settings.rate_limit_tv_pair_per_minute
    )
    screen = await pair_tv_screen(db, code=payload.code)
    await db.commit()
    return {"device_token": screen.device_token}


@router.get("/state", response_model=TVStateOut)
async def state_route(
    db: AsyncSession = Depends(get_db), screen: TVScreen = Depends(current_tv_screen)
) -> dict:
    state = await build_tv_state(db, screen)
    await db.commit()
    return state


@router.get("/qr-batch", response_model=QRBatchOut)
async def qr_batch_route(
    db: AsyncSession = Depends(get_db), screen: TVScreen = Depends(current_tv_screen)
) -> dict:
    if screen.queue_id is None:
        raise ServiceError("tv_screen_has_no_queue", 409)
    return issue_batch(screen.queue_id)
