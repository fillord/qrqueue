from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPkMixin


class TrialRequest(UUIDPkMixin, Base):
    __tablename__ = "trial_requests"

    name: Mapped[str] = mapped_column(String(120))
    organization: Mapped[str] = mapped_column(String(200))
    contact: Mapped[str] = mapped_column(String(200))
    processed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
