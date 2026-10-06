"""Attendance's own directory; no schedule/TV department dependency."""
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.attendance import _active_org
from app.api.deps import current_admin, current_organization_id
from app.db import get_db
from app.models.attendance import AttendanceDepartment, Employee
from app.models.enums import AuditActorType
from app.models.organization import Organization
from app.models.user import User
from app.services.audit import log_action
from app.services.errors import ServiceError

router = APIRouter(prefix="/attendance/admin/departments", tags=["attendance-departments"])


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def clean_name(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Department name cannot be blank")
        return self


def view(department: AttendanceDepartment) -> dict:
    return {"id": department.id, "name": department.name, "is_active": department.is_active}


async def get_department(db: AsyncSession, org_id: uuid.UUID, department_id: uuid.UUID):
    item = await db.get(AttendanceDepartment, department_id)
    if item is None or item.organization_id != org_id:
        raise ServiceError("attendance_department_not_found", 404)
    return item


async def lock_organization(db: AsyncSession, org_id: uuid.UUID):
    await _active_org(db, org_id)
    # Also taken by employee assignment/import: archive cannot race an assignment.
    await db.execute(select(Organization.id).where(Organization.id == org_id).with_for_update())


async def check_name(db: AsyncSession, org_id: uuid.UUID, name: str, own_id=None):
    entries = (await db.execute(select(AttendanceDepartment.id, AttendanceDepartment.name)
        .where(AttendanceDepartment.organization_id == org_id))).all()
    if any(entry.id != own_id and entry.name.strip().casefold() == name.casefold() for entry in entries):
        raise ServiceError("attendance_department_exists", 409)


async def audit(db, actor, org_id, item, action, payload):
    await log_action(db, actor_type=AuditActorType.user, actor_id=actor.id,
        organization_id=org_id, action=f"attendance.department_{action}",
        entity_type="attendance_department", entity_id=item.id, payload=payload)


@router.get("")
async def list_departments(db: AsyncSession = Depends(get_db), actor: User = Depends(current_admin),
                           org_id: uuid.UUID = Depends(current_organization_id)):
    await _active_org(db, org_id)
    items = (await db.scalars(select(AttendanceDepartment)
        .where(AttendanceDepartment.organization_id == org_id).order_by(AttendanceDepartment.name))).all()
    return [view(item) for item in items]


@router.post("", status_code=201)
async def create_department(payload: DepartmentCreate, db: AsyncSession = Depends(get_db),
                            actor: User = Depends(current_admin), org_id: uuid.UUID = Depends(current_organization_id)):
    await lock_organization(db, org_id)
    await check_name(db, org_id, payload.name)
    item = AttendanceDepartment(organization_id=org_id, name=payload.name, is_active=True)
    db.add(item)
    await db.flush()
    await audit(db, actor, org_id, item, "created", {"name": item.name})
    await db.commit()
    return view(item)


@router.patch("/{department_id}")
async def rename_department(department_id: uuid.UUID, payload: DepartmentCreate, db: AsyncSession = Depends(get_db),
                            actor: User = Depends(current_admin), org_id: uuid.UUID = Depends(current_organization_id)):
    await lock_organization(db, org_id)
    item = await get_department(db, org_id, department_id)
    await check_name(db, org_id, payload.name, item.id)
    before = item.name
    item.name = payload.name
    # Preserve the readable fallback used by archived employee records too.
    await db.execute(update(Employee).where(Employee.organization_id == org_id,
        Employee.department_id == item.id).values(department=item.name))
    await audit(db, actor, org_id, item, "updated", {"before": before, "name": item.name})
    await db.commit()
    return view(item)


@router.delete("/{department_id}", status_code=204)
async def archive_department(department_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                             actor: User = Depends(current_admin), org_id: uuid.UUID = Depends(current_organization_id)):
    await lock_organization(db, org_id)
    item = await get_department(db, org_id, department_id)
    if await db.scalar(select(Employee.id).where(Employee.organization_id == org_id,
        Employee.department_id == item.id, Employee.deleted_at.is_(None)).limit(1)):
        raise ServiceError("attendance_department_has_employees", 409)
    item.is_active = False
    await audit(db, actor, org_id, item, "archived", {"name": item.name})
    await db.commit()


@router.post("/{department_id}/restore")
async def restore_department(department_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                             actor: User = Depends(current_admin), org_id: uuid.UUID = Depends(current_organization_id)):
    await lock_organization(db, org_id)
    item = await get_department(db, org_id, department_id)
    item.is_active = True
    await audit(db, actor, org_id, item, "restored", {"name": item.name})
    await db.commit()
    return view(item)
