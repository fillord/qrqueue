import uuid
from datetime import time

from sqlalchemy import Boolean, ForeignKey, Integer, Text, Time, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPkMixin


class Department(UUIDPkMixin, Base):
    __tablename__ = "departments"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (UniqueConstraint("organization_id", "name", name="uq_departments_org_name"),)


class DepartmentScheduleItem(UUIDPkMixin, Base):
    __tablename__ = "department_schedule_items"

    department_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    doctor_name: Mapped[str] = mapped_column(Text, nullable=False)
    service_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    room: Mapped[str | None] = mapped_column(Text, nullable=True)
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)
    starts_at: Mapped[time] = mapped_column(Time, nullable=False)
    ends_at: Mapped[time] = mapped_column(Time, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
