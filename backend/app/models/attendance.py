import uuid
from datetime import date, datetime, time

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, LargeBinary, String, Text, Time, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPkMixin


class AttendanceDepartment(UUIDPkMixin, Base):
    __tablename__ = "attendance_departments"
    __table_args__ = (UniqueConstraint("organization_id", "name", name="uq_attendance_departments_org_name"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Employee(UUIDPkMixin, Base):
    __tablename__ = "attendance_employees"

    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    department: Mapped[str | None] = mapped_column(Text, nullable=True)
    department_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("attendance_departments.id"), nullable=True, index=True)
    position: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, unique=True)
    code_digest: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    code_length: Mapped[int] = mapped_column(default=4, nullable=False)
    face_template: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    face_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pending_face_template: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    pending_face_photo: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    pending_face_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pending_face_submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    telegram_chat_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)


class EmployeeCalendarDay(UUIDPkMixin, Base):
    __tablename__ = "attendance_calendar_days"
    __table_args__ = (
        UniqueConstraint("employee_id", "day", name="uq_attendance_calendar_day"),
        CheckConstraint("kind IN ('shift','off','vacation','sick','absence')", name="ck_attendance_calendar_kind"),
        CheckConstraint("(kind = 'shift' AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND starts_at < ends_at) OR (kind <> 'shift' AND starts_at IS NULL AND ends_at IS NULL)", name="ck_attendance_calendar_time"),
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("attendance_employees.id"), nullable=False, index=True)
    day: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(12), nullable=False)
    starts_at: Mapped[time | None] = mapped_column(Time, nullable=True)
    ends_at: Mapped[time | None] = mapped_column(Time, nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class EmployeeWorkSchedule(UUIDPkMixin, Base):
    __tablename__ = "attendance_employee_schedules"
    __table_args__ = (
        UniqueConstraint("employee_id", "weekday", name="uq_attendance_employee_schedule_day"),
        CheckConstraint("weekday >= 0 AND weekday <= 6", name="ck_attendance_employee_schedule_weekday"),
        CheckConstraint("starts_at < ends_at", name="ck_attendance_employee_schedule_time"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("attendance_employees.id", ondelete="CASCADE"), nullable=False, index=True)
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)
    starts_at: Mapped[time] = mapped_column(Time, nullable=False)
    ends_at: Mapped[time] = mapped_column(Time, nullable=False)

class AttendanceEvent(UUIDPkMixin, Base):
    __tablename__ = "attendance_events"

    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("attendance_employees.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(3), nullable=False)  # in/out
    source: Mapped[str] = mapped_column(String(10), nullable=False)  # phone/kiosk/manual
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    corrected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    correction_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    corrected_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class AttendanceKiosk(UUIDPkMixin, Base):
    __tablename__ = "attendance_kiosks"

    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    pairing_code: Mapped[str | None] = mapped_column(String(6), nullable=True, unique=True)
    token_digest: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
