import uuid

import jwt
from fastapi import Cookie, Depends, HTTPException, Query, Response, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.config import settings
from app.db import get_db
from app.models.cabinet import Cabinet
from app.models.client import Client
from app.models.enums import UserRole
from app.models.organization import Organization
from app.models.user import User
from app.redis import get_redis
from app.security import decode_access_token

CLIENT_COOKIE_NAME = "qc"
CLIENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365


async def current_user(
    access_token: str | None = Cookie(default=None, alias=settings.jwt_cookie_name),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
    )
    if access_token is None:
        raise credentials_error
    try:
        payload = decode_access_token(access_token)
    except jwt.PyJWTError:
        raise credentials_error

    user_id = payload.get("sub")
    if user_id is None:
        raise credentials_error

    user = await db.get(User, uuid.UUID(user_id))
    if user is None or not user.is_active:
        raise credentials_error
    return user


def require_role(*roles: str):
    async def dependency(user: User = Depends(current_user)) -> User:
        if user.role.value not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions"
            )
        return user

    return dependency


current_admin = require_role(UserRole.org_admin.value, UserRole.superadmin.value)


async def current_organization_id(
    user: User = Depends(current_admin),
    db: AsyncSession = Depends(get_db),
    organization_id: uuid.UUID | None = Query(default=None),
) -> uuid.UUID:
    """Resolves which organization an /api/admin/* request is scoped to.

    org_admin is always scoped to their own organization. superadmin must pass
    ?organization_id= explicitly, per ARCHITECTURE.md section 6.
    """
    if user.role == UserRole.superadmin:
        if organization_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="organization_id query parameter is required",
            )
        org = await db.get(Organization, organization_id)
        if org is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        return organization_id
    return user.organization_id


async def current_client(
    response: Response,
    db: AsyncSession = Depends(get_db),
    qc: str | None = Cookie(default=None),
) -> Client:
    """Resolves the visitor's device identity from the `qc` cookie.

    Creates a new clients row and sets the cookie on first visit, per
    ARCHITECTURE.md section 2 (clients). Always bumps last_seen_at.
    """
    client = None
    if qc is not None:
        try:
            client = await db.get(Client, uuid.UUID(qc))
        except ValueError:
            client = None

    now = utcnow()
    if client is None:
        client = Client(last_seen_at=now)
        db.add(client)
        await db.flush()
        response.set_cookie(
            key=CLIENT_COOKIE_NAME,
            value=str(client.id),
            httponly=True,
            samesite="lax",
            max_age=CLIENT_COOKIE_MAX_AGE,
            secure=settings.cookie_secure,
        )
    else:
        client.last_seen_at = now

    return client


current_operator = require_role(UserRole.operator.value)


async def current_cabinet(
    user: User = Depends(current_operator),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> Cabinet:
    """Resolves the operator's selected cabinet from Redis (see services/cabinets.select_cabinet).

    409 cabinet_not_selected if nothing is selected, or the selection no
    longer resolves to a live cabinet in this operator's organization.
    """
    cabinet_id_raw = await redis.get(f"operator:{user.id}:cabinet")
    cabinet = None
    if cabinet_id_raw is not None:
        try:
            cabinet = await db.get(Cabinet, uuid.UUID(cabinet_id_raw))
        except ValueError:
            cabinet = None

    if cabinet is None or not cabinet.is_active or cabinet.organization_id != user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail={"code": "cabinet_not_selected"}
        )
    return cabinet


async def get_in_org_or_404(
    db: AsyncSession, model: type, entity_id: uuid.UUID, organization_id: uuid.UUID
):
    """Fetches a row by pk and 404s unless it belongs to organization_id.

    Reused everywhere an /api/admin/* or /api/sa/* route touches an
    organization-scoped entity — access to another organization's entity
    must look identical to it not existing.
    """
    entity = await db.get(model, entity_id)
    if entity is None or getattr(entity, "organization_id", None) != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return entity
