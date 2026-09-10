import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin, current_organization_id, get_in_org_or_404
from app.db import get_db
from app.models.cabinet import Cabinet
from app.models.enums import UserRole
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.user import User
from app.schemas.cabinet import CabinetCreate, CabinetOut, CabinetUpdate
from app.schemas.organization import OrganizationOut, OrganizationSelfUpdate
from app.schemas.qr import QRBatchOut
from app.schemas.queue import QueueCreate, QueueOut, QueueUpdate, ScheduleReplace
from app.schemas.staff import StaffCreate, StaffOut, StaffUpdate
from app.services.cabinets import assign_operator, create_cabinet, unassign_operator, update_cabinet
from app.services.organizations import update_organization
from app.services.qr_tokens import issue_batch
from app.services.queues import create_queue, replace_schedule, update_queue
from app.services.staff import create_org_user, update_org_user

router = APIRouter(prefix="/admin", tags=["admin"])


async def _get_organization(db: AsyncSession, organization_id: uuid.UUID) -> Organization:
    org = await db.get(Organization, organization_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return org


# --- organization ---------------------------------------------------------


@router.patch("/organization", response_model=OrganizationOut)
async def update_own_organization_route(
    payload: OrganizationSelfUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> Organization:
    org = await _get_organization(db, organization_id)
    org = await update_organization(db, org, payload, actor)
    await db.commit()
    return org


# --- queues -----------------------------------------------------------------


@router.post("/queues", response_model=QueueOut, status_code=status.HTTP_201_CREATED)
async def create_queue_route(
    payload: QueueCreate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> Queue:
    org = await _get_organization(db, organization_id)
    queue = await create_queue(db, org, payload, actor)
    await db.commit()
    return queue


@router.get("/queues", response_model=list[QueueOut])
async def list_queues_route(
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> list[Queue]:
    result = await db.execute(
        select(Queue).where(Queue.organization_id == organization_id).order_by(Queue.name)
    )
    return list(result.scalars().all())


@router.get("/queues/{queue_id}", response_model=QueueOut)
async def get_queue_route(
    queue_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> Queue:
    return await get_in_org_or_404(db, Queue, queue_id, organization_id)


@router.patch("/queues/{queue_id}", response_model=QueueOut)
async def update_queue_route(
    queue_id: uuid.UUID,
    payload: QueueUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> Queue:
    queue = await get_in_org_or_404(db, Queue, queue_id, organization_id)
    queue = await update_queue(db, queue, payload, actor)
    await db.commit()
    return queue


@router.get("/queues/{queue_id}/qr-batch", response_model=QRBatchOut)
async def get_queue_qr_batch_route(
    queue_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> dict:
    """Preview/debug endpoint — the TV-facing /api/tv/qr-batch (step 5) reuses issue_batch()."""
    queue = await get_in_org_or_404(db, Queue, queue_id, organization_id)
    return issue_batch(queue.id)


@router.put("/queues/{queue_id}/schedule", status_code=status.HTTP_204_NO_CONTENT)
async def replace_queue_schedule_route(
    queue_id: uuid.UUID,
    payload: ScheduleReplace,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> None:
    queue = await get_in_org_or_404(db, Queue, queue_id, organization_id)
    await replace_schedule(db, queue, payload.schedule, actor)
    await db.commit()


# --- cabinets -----------------------------------------------------------------


@router.post("/cabinets", response_model=CabinetOut, status_code=status.HTTP_201_CREATED)
async def create_cabinet_route(
    payload: CabinetCreate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> Cabinet:
    org = await _get_organization(db, organization_id)
    cabinet = await create_cabinet(db, org, payload, actor)
    await db.commit()
    return cabinet


@router.get("/cabinets", response_model=list[CabinetOut])
async def list_cabinets_route(
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> list[Cabinet]:
    result = await db.execute(
        select(Cabinet).where(Cabinet.organization_id == organization_id).order_by(Cabinet.label)
    )
    return list(result.scalars().all())


@router.get("/cabinets/{cabinet_id}", response_model=CabinetOut)
async def get_cabinet_route(
    cabinet_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> Cabinet:
    return await get_in_org_or_404(db, Cabinet, cabinet_id, organization_id)


@router.patch("/cabinets/{cabinet_id}", response_model=CabinetOut)
async def update_cabinet_route(
    cabinet_id: uuid.UUID,
    payload: CabinetUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> Cabinet:
    cabinet = await get_in_org_or_404(db, Cabinet, cabinet_id, organization_id)
    cabinet = await update_cabinet(db, cabinet, payload, actor)
    await db.commit()
    return cabinet


@router.post("/cabinets/{cabinet_id}/operators/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def assign_operator_route(
    cabinet_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> None:
    cabinet = await get_in_org_or_404(db, Cabinet, cabinet_id, organization_id)
    await assign_operator(db, cabinet, user_id, actor)
    await db.commit()


@router.delete("/cabinets/{cabinet_id}/operators/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_operator_route(
    cabinet_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> None:
    cabinet = await get_in_org_or_404(db, Cabinet, cabinet_id, organization_id)
    await unassign_operator(db, cabinet, user_id, actor)
    await db.commit()


# --- users (operator, registrar) --------------------------------------------


@router.post("/users", response_model=StaffOut, status_code=status.HTTP_201_CREATED)
async def create_staff_route(
    payload: StaffCreate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> User:
    user = await create_org_user(
        db,
        organization_id=organization_id,
        email=payload.email,
        password=payload.password,
        full_name=payload.full_name,
        role=UserRole(payload.role.value),
        actor=actor,
    )
    await db.commit()
    return user


@router.get("/users", response_model=list[StaffOut])
async def list_staff_route(
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> list[User]:
    result = await db.execute(
        select(User).where(
            User.organization_id == organization_id,
            User.role.in_([UserRole.operator, UserRole.registrar]),
        )
    )
    return list(result.scalars().all())


@router.get("/users/{user_id}", response_model=StaffOut)
async def get_staff_route(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> User:
    user = await get_in_org_or_404(db, User, user_id, organization_id)
    if user.role not in (UserRole.operator, UserRole.registrar):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return user


@router.patch("/users/{user_id}", response_model=StaffOut)
async def update_staff_route(
    user_id: uuid.UUID,
    payload: StaffUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> User:
    user = await get_in_org_or_404(db, User, user_id, organization_id)
    if user.role not in (UserRole.operator, UserRole.registrar):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    changes = payload.model_dump(exclude_unset=True)
    if changes.get("role") is not None:
        changes["role"] = UserRole(changes["role"])

    user = await update_org_user(db, user, changes=changes, actor=actor)
    await db.commit()
    return user
