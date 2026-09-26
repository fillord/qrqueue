import uuid
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin, current_organization_id, get_in_org_or_404
from app.db import get_db
from app.redis import get_redis
from app.clock import utcnow
from app.models.cabinet import Cabinet, CabinetOperator
from app.models.enums import UserRole
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.tv_screen import TVScreen
from app.models.user import User
from app.schemas.analytics import AnalyticsOut
from app.schemas.admin_home import AdminHomeOut
from app.schemas.admin_operations import AdminProblemsOut, DailyReportOut
from app.schemas.audit import AuditLogPageOut
from app.schemas.cabinet import CabinetCreate, CabinetOut, CabinetUpdate
from app.schemas.organization import OrganizationOut, OrganizationSelfUpdate
from app.schemas.qr import QRBatchOut
from app.schemas.queue import QueueCreate, QueueOut, QueueUpdate, ScheduleEntryOut, ScheduleReplace
from app.schemas.staff import StaffCreate, StaffOut, StaffUpdate
from app.schemas.tv import TVScreenCreate, TVScreenUpdate, TVScreenOut, TVStateOut
from app.services.analytics import get_analytics
from app.services.admin_operations import daily_report_xlsx, get_admin_problems, get_daily_report
from app.services.audit_query import list_audit_logs
from app.services.cabinets import (
    archive_cabinet,
    assign_operator,
    create_cabinet,
    list_cabinet_operators,
    restore_cabinet,
    unassign_operator,
    update_cabinet,
)
from app.services.organizations import update_organization
from app.services.qr_tokens import issue_batch
from app.services.queues import (
    archive_queue,
    create_queue,
    get_schedule,
    list_queues_with_waiting_counts,
    replace_schedule,
    restore_queue,
    update_queue,
)
from app.services.staff import archive_org_user, create_org_user, restore_org_user, update_org_user
from app.services.tv_screens import create_tv_screen, delete_tv_screen, unpair_tv_screen
from app.services.tv_state import build_tv_state

router = APIRouter(prefix="/admin", tags=["admin"])


async def _get_organization(db: AsyncSession, organization_id: uuid.UUID) -> Organization:
    org = await db.get(Organization, organization_id)
    if org is None or org.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return org


@router.get("/home", response_model=AdminHomeOut)
async def get_admin_home_route(
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> dict:
    org = await _get_organization(db, organization_id)
    pairs = await list_queues_with_waiting_counts(db, organization_id)
    active_queues = [(queue, waiting) for queue, waiting in pairs if queue.is_active]
    queue_ids = [queue.id for queue, _ in active_queues]

    cabinet_ids = list((await db.scalars(select(Cabinet.id).where(
        Cabinet.organization_id == organization_id, Cabinet.deleted_at.is_(None),
        Cabinet.is_active.is_(True), Cabinet.queue_id.in_(queue_ids),
    ))).all()) if queue_ids else []
    operator_ids = list((await db.scalars(select(User.id).where(
        User.organization_id == organization_id, User.role == UserRole.operator,
        User.deleted_at.is_(None), User.is_active.is_(True),
    ))).all())
    has_assignment = False
    if cabinet_ids and operator_ids:
        has_assignment = await db.scalar(select(CabinetOperator.cabinet_id).where(
            CabinetOperator.cabinet_id.in_(cabinet_ids),
            CabinetOperator.user_id.in_(operator_ids),
        ).limit(1)) is not None

    screens = list((await db.scalars(select(TVScreen).where(
        TVScreen.organization_id == organization_id, TVScreen.device_token.is_not(None),
    ))).all())
    online_after = utcnow() - timedelta(seconds=90)
    online_count = sum(screen.last_seen_at is not None and screen.last_seen_at >= online_after for screen in screens)
    return {
        "organization_name": org.name,
        "queues": [{"id": queue.id, "name": queue.name, "status": queue.status,
                    "waiting_count": waiting} for queue, waiting in active_queues],
        "cabinet_count": len(cabinet_ids),
        "operator_count": len(operator_ids),
        "has_operator_assignment": has_assignment,
        "paired_queue_screen_count": sum(screen.display_mode == "queue" for screen in screens),
        "paired_screen_count": len(screens),
        "online_screen_count": online_count,
        "offline_screen_count": len(screens) - online_count,
    }


@router.get("/problems", response_model=AdminProblemsOut)
async def get_admin_problems_route(
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> dict:
    await _get_organization(db, organization_id)
    return await get_admin_problems(db, organization_id)


@router.get("/daily-report", response_model=DailyReportOut)
async def get_daily_report_route(
    day: date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> dict:
    org = await _get_organization(db, organization_id)
    return await get_daily_report(db, org, day)


@router.get("/daily-report.xlsx")
async def download_daily_report_route(
    day: date | None = Query(default=None),
    lang: Literal["ru", "en", "kk"] = Query(default="ru"),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> Response:
    org = await _get_organization(db, organization_id)
    report = await get_daily_report(db, org, day)
    return Response(
        content=daily_report_xlsx(report, lang),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="queue-report-{report["day"]}.xlsx"',
            "Cache-Control": "no-store",
        },
    )


# --- organization ---------------------------------------------------------


@router.get("/organization", response_model=OrganizationOut)
async def get_own_organization_route(
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> Organization:
    """Not explicitly requested, but the settings form built on top of the
    existing PATCH needs something to read current values from first."""
    return await _get_organization(db, organization_id)


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
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> list[Queue]:
    pairs = await list_queues_with_waiting_counts(db, organization_id, include_archived=include_archived)
    queues = []
    for queue, waiting_count in pairs:
        queue.waiting_count = waiting_count
        queues.append(queue)
    return queues


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


@router.delete("/queues/{queue_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_queue_route(
    queue_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> None:
    queue = await get_in_org_or_404(db, Queue, queue_id, organization_id)
    await archive_queue(db, queue, actor)
    await db.commit()


@router.post("/queues/{queue_id}/restore", response_model=QueueOut)
async def restore_queue_route(
    queue_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> Queue:
    queue = await db.get(Queue, queue_id)
    if queue is None or queue.organization_id != organization_id or queue.deleted_at is None:
        raise HTTPException(status_code=404, detail="Not found")
    queue = await restore_queue(db, queue, actor)
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


@router.get("/queues/{queue_id}/schedule", response_model=list[ScheduleEntryOut])
async def get_queue_schedule_route(
    queue_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> list:
    queue = await get_in_org_or_404(db, Queue, queue_id, organization_id)
    return await get_schedule(db, queue)


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
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> list[Cabinet]:
    query = select(Cabinet).where(Cabinet.organization_id == organization_id).order_by(Cabinet.label)
    if not include_archived:
        query = query.where(Cabinet.deleted_at.is_(None))
    result = await db.execute(query)
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


@router.delete("/cabinets/{cabinet_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_cabinet_route(
    cabinet_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> None:
    cabinet = await get_in_org_or_404(db, Cabinet, cabinet_id, organization_id)
    await archive_cabinet(db, cabinet, actor)
    await db.commit()


@router.post("/cabinets/{cabinet_id}/restore", response_model=CabinetOut)
async def restore_cabinet_route(
    cabinet_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> Cabinet:
    cabinet = await db.get(Cabinet, cabinet_id)
    if cabinet is None or cabinet.organization_id != organization_id or cabinet.deleted_at is None:
        raise HTTPException(status_code=404, detail="Not found")
    cabinet = await restore_cabinet(db, cabinet, actor)
    await db.commit()
    return cabinet


@router.get("/cabinets/{cabinet_id}/operators", response_model=list[StaffOut])
async def list_cabinet_operators_route(
    cabinet_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> list[User]:
    cabinet = await get_in_org_or_404(db, Cabinet, cabinet_id, organization_id)
    return await list_cabinet_operators(db, cabinet)


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
    redis: Redis = Depends(get_redis),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> None:
    cabinet = await get_in_org_or_404(db, Cabinet, cabinet_id, organization_id)
    await unassign_operator(db, cabinet, user_id, actor, redis)
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
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> list[User]:
    statement = select(User).where(
        User.organization_id == organization_id,
        User.role.in_([UserRole.operator, UserRole.registrar]),
    )
    if not include_archived:
        statement = statement.where(User.deleted_at.is_(None))
    result = await db.execute(statement.order_by(User.full_name, User.id))
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


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_staff_route(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> None:
    user = await get_in_org_or_404(db, User, user_id, organization_id)
    if user.role not in (UserRole.operator, UserRole.registrar):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await archive_org_user(db, user, actor)
    await db.commit()


@router.post("/users/{user_id}/restore", response_model=StaffOut)
async def restore_staff_route(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> User:
    user = await db.get(User, user_id)
    if (user is None or user.organization_id != organization_id or user.deleted_at is None
            or user.role not in (UserRole.operator, UserRole.registrar)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    user = await restore_org_user(db, user, actor)
    await db.commit()
    return user


# --- tv-screens ---------------------------------------------------------


@router.post("/tv-screens", response_model=TVScreenOut, status_code=status.HTTP_201_CREATED)
async def create_tv_screen_route(
    payload: TVScreenCreate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> TVScreen:
    org = await _get_organization(db, organization_id)
    if payload.queue_id is not None:
        queue = await db.get(Queue, payload.queue_id)
        if queue is None or queue.organization_id != organization_id or queue.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Queue not found")
    screen = await create_tv_screen(db, org, payload, actor)
    await db.commit()
    return screen


@router.get("/tv-screens", response_model=list[TVScreenOut])
async def list_tv_screens_route(
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> list[TVScreen]:
    result = await db.execute(
        select(TVScreen).where(TVScreen.organization_id == organization_id).order_by(TVScreen.name)
    )
    return list(result.scalars().all())


@router.get("/tv-screens/{screen_id}/preview", response_model=TVStateOut)
async def preview_tv_screen_route(
    screen_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> dict:
    screen = await get_in_org_or_404(db, TVScreen, screen_id, organization_id)
    return await build_tv_state(db, screen)


@router.delete("/tv-screens/{screen_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tv_screen_route(
    screen_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> None:
    screen = await get_in_org_or_404(db, TVScreen, screen_id, organization_id)
    await delete_tv_screen(db, screen, actor)
    await db.commit()


@router.post("/tv-screens/{screen_id}/unpair", response_model=TVScreenOut)
async def unpair_tv_screen_route(
    screen_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> TVScreen:
    screen = await get_in_org_or_404(db, TVScreen, screen_id, organization_id)
    await unpair_tv_screen(db, screen, actor)
    await db.commit()
    return screen


# --- analytics / audit log ---------------------------------------------------


@router.get("/analytics", response_model=AnalyticsOut)
async def get_analytics_route(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    queue_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> dict:
    organization = await _get_organization(db, organization_id)
    if queue_id is not None:
        await get_in_org_or_404(db, Queue, queue_id, organization_id)

    return await get_analytics(
        db,
        organization_id=organization_id,
        timezone_name=organization.timezone,
        date_from=date_from,
        date_to=date_to,
        queue_id=queue_id,
    )


@router.get("/audit-logs", response_model=AuditLogPageOut)
async def list_audit_logs_route(
    date_from: date | None = Query(default=None, alias="from"),
    date_to: date | None = Query(default=None, alias="to"),
    action: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
) -> dict:
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


@router.patch("/tv-screens/{screen_id}", response_model=TVScreenOut)
async def update_tv_screen_route(
    screen_id: uuid.UUID,
    payload: TVScreenUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin),
    organization_id: uuid.UUID = Depends(current_organization_id),
):
    from app.services.tv_screens import update_tv_screen
    screen = await get_in_org_or_404(db, TVScreen, screen_id, organization_id)
    await update_tv_screen(db, screen, payload, actor)
    await db.commit()
    return screen
