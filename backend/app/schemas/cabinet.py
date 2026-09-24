from app.schemas.validation import Name, Password, PatchModel
import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import CabinetStatus


class CabinetCreate(BaseModel):
    label: Name
    queue_id: uuid.UUID | None = None


class CabinetUpdate(PatchModel):
    label: Name | None = None
    queue_id: uuid.UUID | None = None
    status: CabinetStatus | None = None
    is_active: bool | None = None


class CabinetOut(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    queue_id: uuid.UUID | None
    label: str
    status: CabinetStatus
    current_ticket_id: uuid.UUID | None
    is_active: bool
    deleted_at: datetime | None

    model_config = {"from_attributes": True}
