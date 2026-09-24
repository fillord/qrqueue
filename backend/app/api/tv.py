import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.media import TV_MEDIA_CHUNK_BYTES
from app.models.organization import Organization
from app.models.tv_screen import TVScreen
from app.models.tv_media import TVMedia, TVMediaChunk
from app.redis import get_redis
from app.schemas.qr import QRBatchOut
from app.schemas.tv import TVPairRequest, TVPairResponse, TVStateOut
from app.services.errors import ServiceError
from app.services.qr_tokens import issue_batch, issue_screen_batch
from app.services.hall_scan import hall_queues
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
    return organization is not None and organization.is_active and organization.deleted_at is None


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
    if screen.display_mode != "queue":
        raise ServiceError("tv_screen_has_no_queue", 409)
    if screen.queue_id is not None:
        return issue_batch(screen.queue_id)
    if not await hall_queues(db, screen):
        raise ServiceError("tv_screen_has_no_queue", 409)
    return issue_screen_batch(screen.id)


@router.get("/media/{media_id}")
async def stream_media_route(
    media_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
):
    # Only ready, enabled content of a live organization is public. TV screens
    # are visible to visitors, so media URLs deliberately need no device token.
    media = await db.get(TVMedia, media_id)
    if media is None or not media.is_ready or not media.is_active:
        raise HTTPException(status_code=404, detail="Not found")
    org = await db.get(Organization, media.organization_id)
    if org is None or not org.is_active or org.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Not found")

    total = media.size_bytes
    first, last = 0, total - 1
    range_header = request.headers.get("range")
    if range_header:
        try:
            if not range_header.startswith("bytes=") or "," in range_header:
                raise ValueError
            start_text, end_text = range_header[6:].split("-", 1)
            if start_text:
                first = int(start_text)
                last = min(int(end_text), total - 1) if end_text else total - 1
            else:
                suffix = int(end_text)
                if suffix <= 0:
                    raise ValueError
                first = max(0, total - suffix)
            if first < 0 or first >= total or last < first:
                raise ValueError
        except (ValueError, TypeError):
            raise HTTPException(status_code=416, detail="Invalid byte range",
                                headers={"Content-Range": f"bytes */{total}"})

    async def chunks():
        for index in range(first // TV_MEDIA_CHUNK_BYTES, last // TV_MEDIA_CHUNK_BYTES + 1):
            chunk = await db.get(TVMediaChunk, (media_id, index))
            if chunk is None:
                break
            offset = index * TV_MEDIA_CHUNK_BYTES
            yield chunk.data[max(0, first - offset):min(len(chunk.data), last - offset + 1)]

    headers = {"Accept-Ranges": "bytes", "Content-Length": str(last - first + 1),
               "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff"}
    if range_header:
        headers["Content-Range"] = f"bytes {first}-{last}/{total}"
    return StreamingResponse(chunks(), status_code=206 if range_header else 200,
                             media_type=media.mime_type, headers=headers)
