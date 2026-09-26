import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import AuditActorType


class AuditLogOut(BaseModel):
    id: int
    organization_id: uuid.UUID | None
    actor_type: AuditActorType
    actor_id: uuid.UUID | None
    actor_name: str | None
    action: str
    entity_type: str
    entity_id: uuid.UUID
    entity_label: str | None = None
    queue_name: str | None = None
    cabinet_label: str | None = None
    payload: dict
    ip: str | None
    created_at: datetime


class AuditLogPageOut(BaseModel):
    items: list[AuditLogOut]
    total: int
    limit: int
    offset: int
