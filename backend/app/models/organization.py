from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPkMixin
from app.models.enums import Language, Plan


class Organization(UUIDPkMixin, Base):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    timezone: Mapped[str] = mapped_column(Text, nullable=False, default="Asia/Almaty")
    default_language: Mapped[Language] = mapped_column(
        Enum(Language, name="language", values_callable=lambda e: [i.value for i in e]),
        nullable=False,
    )
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    brand_color: Mapped[str | None] = mapped_column(Text, nullable=True)
    plan: Mapped[Plan] = mapped_column(
        Enum(Plan, name="plan", values_callable=lambda e: [i.value for i in e]),
        nullable=False,
    )
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    one_ticket_per_org: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    video_large_upload_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    attendance_enrollment_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    attendance_enrollment_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    attendance_enrollment_on_kiosk: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    attendance_geo_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    attendance_geo_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    attendance_geo_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    attendance_geo_radius_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
