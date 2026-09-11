import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_role
from app.db import get_db
from app.models.enums import UserRole
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.user import User
from app.schemas.admin_user import AdminCreate, AdminOut, AdminUpdate
from app.schemas.analytics import AnalyticsOut
from app.schemas.audit import AuditLogPageOut
from app.schemas.organization import OrganizationCreate, OrganizationOut, OrganizationUpdate
from app.services.analytics import get_analytics
from app.services.audit_query import list_audit_logs
from app.services.organizations import create_organization, list_organizations, update_organization
from app.services.staff import create_org_user, update_org_user

router = APIRouter(prefix="/sa", tags=["superadmin"])

require_superadmin = require_role(UserRole.superadmin.value)


async def _get_org_or_404(db: AsyncSession, org_id: uuid.UUID) -> Organization:
    org = await db.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return org


@router.post("/organizations", response_model=OrganizationOut, status_code=status.HTTP_201_CREATED)
async def create_organization_route(
    payload: OrganizationCreate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_superadmin),
) -> Organization:
    if payload.slug is not None:
        existing = await db.execute(select(Organization).where(Organization.slug == payload.slug))
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already in use")

    org = await create_organization(db, payload, actor)
    await db.commit()
    return org


@router.get("/organizations", response_model=list[OrganizationOut])
async def list_organizations_route(
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_superadmin),
) -> list[Organization]:
    return await list_organizations(db)


@router.get("/organizations/{org_id}", response_model=OrganizationOut)
async def get_organization_route(
    org_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_superadmin),
) -> Organization:
    return await _get_org_or_404(db, org_id)


@router.patch("/organizations/{org_id}", response_model=OrganizationOut)
async def update_organization_route(
    org_id: uuid.UUID,
    payload: OrganizationUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_superadmin),
) -> Organization:
    org = await _get_org_or_404(db, org_id)

    if payload.slug is not None and payload.slug != org.slug:
        existing = await db.execute(select(Organization).where(Organization.slug == payload.slug))
        if existing.scalar_one_or_none() is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already in use")

    org = await update_organization(db, org, payload, actor)
    await db.commit()
    return org


@router.post(
    "/organizations/{org_id}/admins", response_model=AdminOut, status_code=status.HTTP_201_CREATED
)
async def create_admin_route(
    org_id: uuid.UUID,
    payload: AdminCreate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_superadmin),
) -> User:
    await _get_org_or_404(db, org_id)

    user = await create_org_user(
        db,
        organization_id=org_id,
        email=payload.email,
        password=payload.password,
        full_name=payload.full_name,
        role=UserRole.org_admin,
        actor=actor,
    )
    await db.commit()
    return user


@router.get("/organizations/{org_id}/admins", response_model=list[AdminOut])
async def list_admins_route(
    org_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_superadmin),
) -> list[User]:
    await _get_org_or_404(db, org_id)

    result = await db.execute(
        select(User).where(User.organization_id == org_id, User.role == UserRole.org_admin)
    )
    return list(result.scalars().all())


@router.patch("/organizations/{org_id}/admins/{admin_id}", response_model=AdminOut)
async def update_admin_route(
    org_id: uuid.UUID,
    admin_id: uuid.UUID,
    payload: AdminUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_superadmin),
) -> User:
    await _get_org_or_404(db, org_id)

    admin = await db.get(User, admin_id)
    if admin is None or admin.organization_id != org_id or admin.role != UserRole.org_admin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    admin = await update_org_user(db, admin, changes=payload.model_dump(exclude_unset=True), actor=actor)
    await db.commit()
    return admin


# --- analytics / audit log (no organization_id = every organization) -------


@router.get("/analytics", response_model=AnalyticsOut)
async def get_sa_analytics_route(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    organization_id: uuid.UUID | None = Query(default=None),
    queue_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_superadmin),
) -> dict:
    timezone_name = "UTC"
    if organization_id is not None:
        organization = await _get_org_or_404(db, organization_id)
        timezone_name = organization.timezone
    if queue_id is not None:
        queue = await db.get(Queue, queue_id)
        if queue is None or (organization_id is not None and queue.organization_id != organization_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    return await get_analytics(
        db,
        organization_id=organization_id,
        timezone_name=timezone_name,
        date_from=date_from,
        date_to=date_to,
        queue_id=queue_id,
    )


@router.get("/audit-logs", response_model=AuditLogPageOut)
async def list_sa_audit_logs_route(
    date_from: date | None = Query(default=None, alias="from"),
    date_to: date | None = Query(default=None, alias="to"),
    action: str | None = Query(default=None),
    organization_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_superadmin),
) -> dict:
    if organization_id is not None:
        await _get_org_or_404(db, organization_id)

    items, total = await list_audit_logs(
        db,
        organization_id=organization_id,
        date_from=date_from,
        date_to=date_to,
        action=action,
        limit=limit,
        offset=offset,
    )
    return {"items": items, "total": total, "limit": limit, "offset": offset}
