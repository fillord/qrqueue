from fastapi import Request
from redis.asyncio import Redis

from app.config import settings
from app.services.errors import ServiceError


def client_ip(request: Request) -> str:
    """CF-Connecting-IP behind Cloudflare, else the (proxy-header-resolved) peer."""
    forwarded = request.headers.get("cf-connecting-ip")
    if forwarded:
        return forwarded.strip()
    return request.client.host if request.client else "unknown"


async def enforce_rate_limit(
    redis: Redis, *, scope: str, key: str, limit: int, window_seconds: int = 60
) -> None:
    """Fixed-window counter: at most `limit` hits per `window_seconds` for
    (scope, key). Raises rate_limited (429) with retry_after in seconds."""
    if not settings.rate_limit_enabled:
        return
    redis_key = f"ratelimit:{scope}:{key}"
    async with redis.pipeline(transaction=True) as pipe:
        pipe.incr(redis_key)
        pipe.ttl(redis_key)
        count, ttl = await pipe.execute()
    if ttl < 0:
        await redis.expire(redis_key, window_seconds)
        ttl = window_seconds
    if count > limit:
        raise ServiceError("rate_limited", 429, retry_after=ttl)
