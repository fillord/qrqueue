import uuid

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import AuditActorType, UserRole
from app.models.user import User
from app.security import hash_password
from app.services.audit import log_action


async def create_org_user(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID,
    email: str,
    password: str,
    full_name: str,
    role: UserRole,
    actor: User,
) -> User:
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")

    user = User(
        email=email,
        password_hash=hash_password(password),
        full_name=full_name,
        role=role,
        organization_id=organization_id,
        is_active=True,
    )
    db.add(user)
    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=actor.id,
        action="user.created",
        entity_type="user",
        entity_id=user.id,
        organization_id=organization_id,
        payload=jsonable_encoder({"email": email, "full_name": full_name, "role": role}),
    )
    return user


async def update_org_user(
    db: AsyncSession,
    user: User,
    *,
    changes: dict,
    actor: User,
) -> User:
    if "password" in changes:
        password = changes.pop("password")
        if password is not None:
            user.password_hash = hash_password(password)
            changes["password"] = "***"

    if changes.pop("reset_totp", None):
        # Lost authenticator: next login re-enrolls (mandatory roles) or skips 2FA.
        user.totp_secret = None
        changes["reset_totp"] = True

    for field, value in changes.items():
        if field in ("password", "reset_totp"):
            continue
        setattr(user, field, value)
    await db.flush()

    action = "user.deactivated" if changes.get("is_active") is False else "user.updated"
    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=actor.id,
        action=action,
        entity_type="user",
        entity_id=user.id,
        organization_id=user.organization_id,
        payload=jsonable_encoder(changes),
    )
    return user
