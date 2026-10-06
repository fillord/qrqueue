"""Dated work calendar and monthly accounting timesheets."""
import uuid
from datetime import date, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.api.attendance import _active_org, _employee
from app.api.deps import current_admin, current_organization_id
from app.clock import utcnow
from app.db import get_db
from app.models.attendance import Employee, EmployeeCalendarDay
from app.models.enums import AuditActorType
from app.models.user import User
from app.services.audit import log_action
from app.services.errors import ServiceError
from app.services.workforce import build_report, month_range, timesheet_workbook

router = APIRouter(prefix="/attendance/admin", tags=["workforce"])


class CalendarPeriod(BaseModel):
    employee_id: uuid.UUID
    date_from: date
    date_to: date
    kind: Literal["shift", "off", "vacation", "sick", "absence"]
    starts_at: time | None = None
    ends_at: time | None = None
    reason: str = Field(min_length=5, max_length=500)

    @model_validator(mode="after")
    def validate_period(self):
        if len(self.reason.strip()) < 5 or self.date_to < self.date_from or (self.date_to - self.date_from).days > 365:
            raise ValueError("Invalid calendar period")
        if self.kind == "shift":
            if not self.starts_at or not self.ends_at or self.starts_at >= self.ends_at:
                raise ValueError("Shift end must be after its start")
        elif self.starts_at is not None or self.ends_at is not None:
            raise ValueError("Only shifts have working hours")
        return self


class ResetDay(BaseModel):
    reason: str = Field(min_length=5, max_length=500)

    @model_validator(mode="after")
    def valid_reason(self):
        if len(self.reason.strip()) < 5:
            raise ValueError("A meaningful reason is required")
        return self


@router.get("/calendar")
async def calendar(month: str, department_id: uuid.UUID | None = None,
                   db: AsyncSession = Depends(get_db), actor: User = Depends(current_admin),
                   organization_id: uuid.UUID = Depends(current_organization_id)):
    org = await _active_org(db, organization_id)
    return await build_report(db, org, *month_range(month), department_id, all_days=True)


@router.post("/calendar")
async def save_period(payload: CalendarPeriod, db: AsyncSession = Depends(get_db),
                      actor: User = Depends(current_admin),
                      organization_id: uuid.UUID = Depends(current_organization_id)):
    await _active_org(db, organization_id)
    employee = await _employee(db, organization_id, payload.employee_id)
    if not employee.is_active:
        raise ServiceError("employee_inactive", 409)
    await db.execute(select(Employee.id).where(Employee.id == employee.id).with_for_update())
    await db.refresh(employee)
    if employee.deleted_at is not None or not employee.is_active:
        raise ServiceError("employee_inactive", 409)
    existing = (await db.scalars(select(EmployeeCalendarDay).where(
        EmployeeCalendarDay.employee_id == employee.id,
        EmployeeCalendarDay.day.between(payload.date_from, payload.date_to)))).all()
    by_day = {row.day: row for row in existing}
    before = [{"day": row.day.isoformat(), "kind": row.kind,
               "starts_at": str(row.starts_at), "ends_at": str(row.ends_at), "reason": row.reason} for row in existing]
    day = payload.date_from
    while day <= payload.date_to:
        item = by_day.get(day)
        if item is None:
            item = EmployeeCalendarDay(organization_id=organization_id, employee_id=employee.id, day=day)
            db.add(item)
        item.kind, item.starts_at, item.ends_at = payload.kind, payload.starts_at, payload.ends_at
        item.reason, item.updated_by, item.updated_at = payload.reason.strip(), actor.id, utcnow()
        day += timedelta(days=1)
    await log_action(db, actor_type=AuditActorType.user, actor_id=actor.id,
        action="attendance.calendar.updated", entity_type="employee", entity_id=employee.id,
        organization_id=organization_id, payload={"before": before, "after": payload.model_dump(mode="json")})
    await db.commit()
    return {"days": (payload.date_to - payload.date_from).days + 1}


@router.post("/calendar/{day_id}/reset")
async def reset_day(day_id: uuid.UUID, payload: ResetDay, db: AsyncSession = Depends(get_db),
                    actor: User = Depends(current_admin),
                    organization_id: uuid.UUID = Depends(current_organization_id)):
    await _active_org(db, organization_id)
    row = await db.get(EmployeeCalendarDay, day_id)
    if row is None or row.organization_id != organization_id:
        raise ServiceError("calendar_day_not_found", 404)
    await _employee(db, organization_id, row.employee_id)
    await db.execute(select(Employee.id).where(Employee.id == row.employee_id).with_for_update())
    row = await db.scalar(select(EmployeeCalendarDay).where(EmployeeCalendarDay.id == day_id,
        EmployeeCalendarDay.organization_id == organization_id).execution_options(populate_existing=True))
    if row is None:
        raise ServiceError("calendar_day_not_found", 404)
    await log_action(db, actor_type=AuditActorType.user, actor_id=actor.id,
        action="attendance.calendar.reset", entity_type="employee", entity_id=row.employee_id,
        organization_id=organization_id, payload={"day": row.day.isoformat(), "kind": row.kind, "reason": payload.reason})
    await db.delete(row)
    await db.commit()
    return {"status": "reset"}


@router.get("/timesheet.xlsx")
async def export_timesheet(month: str, language: Literal["ru", "kk", "en"] = "ru",
                           department_id: uuid.UUID | None = None, db: AsyncSession = Depends(get_db),
                           actor: User = Depends(current_admin),
                           organization_id: uuid.UUID = Depends(current_organization_id)):
    org = await _active_org(db, organization_id)
    report = await build_report(db, org, *month_range(month), department_id, all_days=True)
    data = await run_in_threadpool(timesheet_workbook, report, month, language)
    await log_action(db, actor_type=AuditActorType.user, actor_id=actor.id,
        action="attendance.timesheet.exported", entity_type="organization", entity_id=org.id,
        organization_id=org.id, payload={"month": month, "department_id": str(department_id) if department_id else None})
    await db.commit()
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="timesheet-{month}.xlsx"', "Cache-Control": "no-store"})
