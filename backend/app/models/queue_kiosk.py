import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, SmallInteger, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPkMixin


class QueueKiosk(UUIDPkMixin, Base):
    __tablename__ = "queue_kiosks"
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(Text)
    queue_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False)
    printing_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    paper_width: Mapped[int] = mapped_column(SmallInteger, default=80, server_default="80")
    language: Mapped[str] = mapped_column(String(2), default="ru", server_default="ru")
    pairing_code: Mapped[str | None] = mapped_column(String(6), unique=True)
    pairing_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    token_digest: Mapped[str | None] = mapped_column(String(64), unique=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (CheckConstraint("paper_width IN (58, 80)", name="ck_queue_kiosk_paper"),)


class QueueKioskIssue(UUIDPkMixin, Base):
    __tablename__ = "queue_kiosk_issues"
    kiosk_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("queue_kiosks.id"))
    request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    ticket_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tickets.id"), unique=True)
    receipt: Mapped[dict] = mapped_column(JSONB)
    __table_args__ = (UniqueConstraint("kiosk_id", "request_id", name="uq_queue_kiosk_request"),)
