import uuid

import jwt
from fastapi import Cookie, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models.enums import UserRole
from app.models.organization import Organization
from app.models.user import User
from app.security import decode_access_token


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
