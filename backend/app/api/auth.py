import uuid
from datetime import datetime, timezone
from io import BytesIO

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from PIL import Image, ImageOps, UnidentifiedImageError
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, organization_is_active
from app.config import settings
from app.db import get_db
from app.models.enums import AuditActorType, UserRole
from app.models.user import User
from app.models.user_profile_photo import UserProfilePhoto
from app.redis import get_redis
from app.schemas.auth import (
    LoginRequest, LoginResponse, ProfileEmailUpdate, ProfileNameUpdate,
    ProfilePasswordUpdate, TotpRequest, TotpSetupOut, UserOut,
)
from app.security import (
    TOTP_PENDING_MINUTES,
    TOTP_PERIOD_SECONDS,
    create_access_token,
    create_totp_pending_token,
    decode_access_token,
    generate_totp_secret,
    hash_password,
    totp_provisioning_uri,
    verify_password,
    verify_totp,
)
from app.services.audit import log_action
from app.services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/auth", tags=["auth"])

TOTP_PENDING_COOKIE = "totp_pending"
MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024


def _cookie_kwargs() -> dict:
    return {"httponly": True, "samesite": "lax", "secure": settings.cookie_secure}


def _set_session_cookie(response: Response, user: User) -> None:
    response.set_cookie(
        key=settings.jwt_cookie_name,
        value=create_access_token(user.id, user.role.value, user.auth_version),
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

    if (user is None or not user.is_active or user.deleted_at is not None
            or not verify_password(payload.password, user.password_hash)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not await organization_is_active(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail={"code": "organization_inactive"}
        )

    setup: TotpSetupOut | None = None
    if user.totp_secret is not None:
        pending = create_totp_pending_token(user.id, auth_version=user.auth_version)
    elif user.role.value in settings.totp_required_role_set:
        secret = generate_totp_secret()
        setup = TotpSetupOut(secret=secret, otpauth_uri=totp_provisioning_uri(secret, user.email))
        pending = create_totp_pending_token(user.id, setup_secret=secret, auth_version=user.auth_version)
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
    if (user is None or not user.is_active or user.deleted_at is not None
            or claims.get("auth_version", 0) != user.auth_version
            or not await organization_is_active(db, user)):
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


@router.patch("/me/name", response_model=UserOut)
async def update_my_name(
    payload: ProfileNameUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> User:
    name = payload.full_name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail={"code": "invalid_profile_name"})
    if name != user.full_name:
        user.full_name = name
        await log_action(db, actor_type=AuditActorType.user, actor_id=user.id,
                         action="user.profile_updated", entity_type="user", entity_id=user.id,
                         organization_id=user.organization_id, payload={"full_name": name})
        await db.commit()
    return user


@router.post("/me/password", response_model=UserOut)
async def update_my_password(
    payload: ProfilePasswordUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    user: User = Depends(current_user),
) -> User:
    await enforce_rate_limit(redis, scope="profile-password", key=str(user.id), limit=5)
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail={"code": "invalid_current_password"})
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail={"code": "password_unchanged"})
    user.password_hash = hash_password(payload.new_password)
    user.auth_version += 1  # Revoke other sessions; renew this one below.
    await log_action(db, actor_type=AuditActorType.user, actor_id=user.id,
                     action="user.password_changed", entity_type="user", entity_id=user.id,
                     organization_id=user.organization_id)
    await db.commit()
    _set_session_cookie(response, user)
    return user


@router.patch("/me/email", response_model=UserOut)
async def update_my_email(
    payload: ProfileEmailUpdate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    user: User = Depends(current_user),
) -> User:
    if user.role != UserRole.superadmin:
        raise HTTPException(status_code=403, detail={"code": "email_managed_by_admin"})
    await enforce_rate_limit(redis, scope="profile-email", key=str(user.id), limit=5)
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail={"code": "invalid_current_password"})
    email = str(payload.email).strip().lower()
    if email == user.email.lower():
        return user
    existing = await db.scalar(select(User.id).where(User.email == email, User.id != user.id))
    if existing is not None:
        raise HTTPException(status_code=409, detail={"code": "email_in_use"})
    user.email = email
    user.auth_version += 1
    await log_action(db, actor_type=AuditActorType.user, actor_id=user.id,
                     action="user.email_changed", entity_type="user", entity_id=user.id,
                     organization_id=None, payload={"email": email})
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail={"code": "email_in_use"}) from None
    _set_session_cookie(response, user)
    return user


@router.get("/me/photo")
async def get_my_photo(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> Response:
    photo = await db.get(UserProfilePhoto, user.id)
    if photo is None:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(content=photo.image_data, media_type="image/jpeg",
                    headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.put("/me/photo", response_model=UserOut)
async def update_my_photo(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> User:
    content_type = request.headers.get("content-type", "").split(";")[0].lower()
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail={"code": "invalid_photo_type"})
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_PROFILE_PHOTO_BYTES:
            raise HTTPException(status_code=413, detail={"code": "photo_too_large"})
    try:
        with Image.open(BytesIO(data)) as source:
            if source.width * source.height > 16_000_000:
                raise ValueError("Image dimensions exceed the limit")
            image = ImageOps.exif_transpose(source)
            image.thumbnail((512, 512))
            if image.mode in {"RGBA", "LA", "P"}:
                image = image.convert("RGBA")
                background = Image.new("RGB", image.size, "white")
                background.paste(image, mask=image.getchannel("A"))
                image = background
            else:
                image = image.convert("RGB")
            output = BytesIO()
            image.save(output, format="JPEG", quality=85, optimize=True)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(status_code=422, detail={"code": "invalid_photo"}) from None
    photo = await db.get(UserProfilePhoto, user.id)
    if photo is None:
        db.add(UserProfilePhoto(user_id=user.id, image_data=output.getvalue()))
    else:
        photo.image_data = output.getvalue()
    user.has_photo = True
    user.photo_revision += 1
    await log_action(db, actor_type=AuditActorType.user, actor_id=user.id,
                     action="user.photo_updated", entity_type="user", entity_id=user.id,
                     organization_id=user.organization_id)
    await db.commit()
    return user


@router.delete("/me/photo", response_model=UserOut)
async def delete_my_photo(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
) -> User:
    photo = await db.get(UserProfilePhoto, user.id)
    if photo is not None:
        await db.delete(photo)
        user.has_photo = False
        user.photo_revision += 1
        await log_action(db, actor_type=AuditActorType.user, actor_id=user.id,
                         action="user.photo_removed", entity_type="user", entity_id=user.id,
                         organization_id=user.organization_id)
        await db.commit()
    return user
