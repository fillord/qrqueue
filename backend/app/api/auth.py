import uuid
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, organization_is_active
from app.config import settings
from app.db import get_db
from app.models.enums import AuditActorType
from app.models.user import User
from app.redis import get_redis
from app.schemas.auth import LoginRequest, LoginResponse, TotpRequest, TotpSetupOut, UserOut
from app.security import (
    TOTP_PENDING_MINUTES,
    TOTP_PERIOD_SECONDS,
    create_access_token,
    create_totp_pending_token,
    decode_access_token,
    generate_totp_secret,
    totp_provisioning_uri,
    verify_password,
    verify_totp,
)
from app.services.audit import log_action
from app.services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/auth", tags=["auth"])

TOTP_PENDING_COOKIE = "totp_pending"


def _cookie_kwargs() -> dict:
    return {"httponly": True, "samesite": "lax", "secure": settings.cookie_secure}


def _set_session_cookie(response: Response, user: User) -> None:
    response.set_cookie(
        key=settings.jwt_cookie_name,
        value=create_access_token(user.id, user.role.value),
        max_age=settings.jwt_expire_minutes * 60,
        **_cookie_kwargs(),
    )
    response.delete_cookie(key=TOTP_PENDING_COOKIE)


async def _record_login(db: AsyncSession, request: Request, user: User) -> None:
    user.last_login_at = datetime.now(timezone.utc)
    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=user.id,
        action="user.login",
        entity_type="user",
        entity_id=user.id,
        organization_id=user.organization_id,
        ip=request.client.host if request.client else None,
    )
    await db.commit()


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> LoginResponse:
    email = payload.email.lower()
    await enforce_rate_limit(
        redis, scope="login", key=email, limit=settings.rate_limit_login_per_minute
    )

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not await organization_is_active(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail={"code": "organization_inactive"}
        )

    setup: TotpSetupOut | None = None
    if user.totp_secret is not None:
        pending = create_totp_pending_token(user.id)
    elif user.role.value in settings.totp_required_role_set:
        secret = generate_totp_secret()
        setup = TotpSetupOut(secret=secret, otpauth_uri=totp_provisioning_uri(secret, user.email))
        pending = create_totp_pending_token(user.id, setup_secret=secret)
    else:
        await _record_login(db, request, user)
        _set_session_cookie(response, user)
        return LoginResponse(totp_required=False)

    response.set_cookie(
        key=TOTP_PENDING_COOKIE,
        value=pending,
        max_age=TOTP_PENDING_MINUTES * 60,
        **_cookie_kwargs(),
    )
    return LoginResponse(totp_required=True, totp_setup=setup)


@router.post("/totp", response_model=LoginResponse)
async def totp_step(
    payload: TotpRequest,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    totp_pending: str | None = Cookie(default=None, alias=TOTP_PENDING_COOKIE),
) -> LoginResponse:
    """Second login step: verifies the authenticator code against the enrolled
    secret, or — during enrollment — against the secret carried by the pending
    token, persisting it on success. Each code is accepted once."""
    expired = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "totp_expired"})
    if totp_pending is None:
        raise expired
    try:
        claims = decode_access_token(totp_pending)
    except jwt.PyJWTError:
        raise expired
    if claims.get("purpose") != "totp" or not claims.get("sub"):
        raise expired

    user = await db.get(User, uuid.UUID(claims["sub"]))
    if user is None or not user.is_active or not await organization_is_active(db, user):
        raise expired

    await enforce_rate_limit(
        redis, scope="totp", key=str(user.id), limit=settings.rate_limit_login_per_minute
    )

    setup_secret = claims.get("setup_secret")
    secret = user.totp_secret or setup_secret
    if secret is None:
        raise expired

    counter = verify_totp(secret, payload.code)
    if counter is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "invalid_totp"})
    # A code is single-use: the same 30-second window cannot be replayed.
    fresh = await redis.set(f"totp:used:{user.id}:{counter}", "1", ex=TOTP_PERIOD_SECONDS * 4, nx=True)
    if not fresh:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "invalid_totp"})

    if user.totp_secret is None:
        user.totp_secret = secret
        await log_action(
            db,
            actor_type=AuditActorType.user,
            actor_id=user.id,
            action="user.totp_enabled",
            entity_type="user",
            entity_id=user.id,
            organization_id=user.organization_id,
        )

    await _record_login(db, request, user)
    _set_session_cookie(response, user)
    return LoginResponse(totp_required=False)


@router.post("/logout")
async def logout(response: Response) -> dict:
    response.delete_cookie(key=settings.jwt_cookie_name)
    response.delete_cookie(key=TOTP_PENDING_COOKIE)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)) -> User:
    return user
