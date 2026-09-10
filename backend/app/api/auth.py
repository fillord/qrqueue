from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.config import settings
from app.db import get_db
from app.models.enums import AuditActorType
from app.models.user import User
from app.schemas.auth import LoginRequest, LoginResponse, UserOut
from app.security import create_access_token, verify_password
from app.services.audit import log_action

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

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

    token = create_access_token(user.id, user.role.value)
    response.set_cookie(
        key=settings.jwt_cookie_name,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=settings.jwt_expire_minutes * 60,
    )
    return LoginResponse(totp_required=False)


@router.post("/logout")
async def logout(response: Response) -> dict:
    response.delete_cookie(key=settings.jwt_cookie_name)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)) -> User:
    return user
