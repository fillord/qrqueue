import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPkMixin
from app.models.enums import Language


class Client(UUIDPkMixin, Base):
    __tablename__ = "clients"

    fingerprint_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    language: Mapped[Language | None] = mapped_column(
        Enum(Language, name="language", values_callable=lambda e: [i.value for i in e]),
        nullable=True,
    )
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PushSubscription(UUIDPkMixin, Base):
    __tablename__ = "push_subscriptions"

    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clients.id"), nullable=False
    )
    endpoint: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    keys: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
