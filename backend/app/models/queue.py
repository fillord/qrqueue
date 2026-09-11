import uuid
from datetime import date, time

from sqlalchemy import Boolean, Date, Enum, ForeignKey, Integer, Numeric, SmallInteger, Text, Time
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.models.base import Base, UUIDPkMixin
from app.models.enums import QueueStatus


class Queue(UUIDPkMixin, Base):
    __tablename__ = "queues"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    ticket_prefix: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[QueueStatus] = mapped_column(
        Enum(QueueStatus, name="queue_status", values_callable=lambda e: [i.value for i in e]),
        nullable=False,
        default=QueueStatus.open,
    )
    latitude: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    geo_radius_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    presence_timeout_min: Mapped[int] = mapped_column(
        Integer, nullable=False, default=lambda: settings.presence_timeout_minutes
    )
    daily_ticket_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_ticket_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    counter_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # True only when an admin paused the queue directly (not via cabinet-pause cascade) —
    # blocks the cascade from auto-reopening it when a cabinet resumes.
    manually_paused: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class QueueSchedule(UUIDPkMixin, Base):
    __tablename__ = "queue_schedules"

    queue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("queues.id"), nullable=False
    )
    weekday: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    opens_at: Mapped[time] = mapped_column(Time, nullable=False)
    closes_at: Mapped[time] = mapped_column(Time, nullable=False)
