import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPkMixin
from app.models.enums import Language


class TVScreen(UUIDPkMixin, Base):
    __tablename__ = "tv_screens"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    queue_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("queues.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    pairing_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    device_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    language: Mapped[Language] = mapped_column(
        Enum(Language, name="language", values_callable=lambda e: [i.value for i in e]),
        nullable=False,
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    display_mode: Mapped[str] = mapped_column(String(12), nullable=False, default="queue")
    slide_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=15)
    ads_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    media_playlist_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="all")
    selected_media_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)
    queue_selection_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="all")
    selected_queue_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)
    cabinet_selection_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="all")
    selected_cabinet_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)
