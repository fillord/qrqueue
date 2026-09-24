import uuid

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import AuditActorType, UserRole
from app.models.ticket import Ticket
from app.models.enums import TicketStatus
from app.clock import utcnow
from app.models.user import User
from app.security import hash_password
from app.services.audit import log_action
from app.services.realtime import defer_event, organization_channel


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
    if "email" in changes and changes["email"].lower() != user.email.lower():
        existing = await db.execute(select(User.id).where(User.email == changes["email"], User.id != user.id))
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")

    if "password" in changes:
        password = changes.pop("password")
        if password is not None:
            user.password_hash = hash_password(password)
            user.auth_version += 1
            changes["password"] = "***"

    if changes.pop("reset_totp", None):
        # Lost authenticator: next login re-enrolls (mandatory roles) or skips 2FA.
        user.totp_secret = None
        user.auth_version += 1  # Revoke existing sessions and pending enrollment tokens.
        changes["reset_totp"] = True

    for field, value in changes.items():
        if field in ("password", "reset_totp"):
            continue
        if field in ("role", "is_active", "email") and value != getattr(user, field):
            user.auth_version += 1
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
    if user.organization_id:
        defer_event(db, organization_channel(user.organization_id), "user.updated", user_id=str(user.id))
    return user


async def archive_org_user(db: AsyncSession, user: User, actor: User) -> None:
    active = await db.scalar(select(Ticket.id).where(
        Ticket.called_by == user.id,
        Ticket.status.in_([TicketStatus.called, TicketStatus.confirmed, TicketStatus.serving]),
    ).limit(1))
    if active is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "active_tickets"})
    user.deleted_at = utcnow()
    user.is_active = False
    user.auth_version += 1
    await db.flush()
    await log_action(db, actor_type=AuditActorType.user, actor_id=actor.id,
                     action="user.archived", entity_type="user", entity_id=user.id,
                     organization_id=user.organization_id,
                     payload={"email": user.email, "full_name": user.full_name, "role": user.role.value})
    defer_event(db, organization_channel(user.organization_id), "user.updated", user_id=str(user.id))


async def restore_org_user(db: AsyncSession, user: User, actor: User) -> User:
    user.deleted_at = None
    user.is_active = False  # An explicit activation is required before sign-in.
    user.auth_version += 1
    await db.flush()
    await log_action(db, actor_type=AuditActorType.user, actor_id=actor.id,
                     action="user.restored", entity_type="user", entity_id=user.id,
                     organization_id=user.organization_id)
    defer_event(db, organization_channel(user.organization_id), "user.updated", user_id=str(user.id))
    return user
