import uuid

from sqlalchemy import Boolean, Enum, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPkMixin
from app.models.enums import CabinetStatus


class Cabinet(UUIDPkMixin, Base):
    __tablename__ = "cabinets"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    queue_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("queues.id"), nullable=True
    )
    label: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[CabinetStatus] = mapped_column(
        Enum(CabinetStatus, name="cabinet_status", values_callable=lambda e: [i.value for i in e]),
        nullable=False,
        default=CabinetStatus.offline,
    )
    current_ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id", use_alter=True, name="fk_cabinets_current_ticket_id"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class CabinetOperator(Base):
    __tablename__ = "cabinet_operators"

    cabinet_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cabinets.id"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
