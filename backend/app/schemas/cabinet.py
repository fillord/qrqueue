import uuid

from pydantic import BaseModel

from app.models.enums import CabinetStatus


class CabinetCreate(BaseModel):
    label: str
    queue_id: uuid.UUID | None = None


class CabinetUpdate(BaseModel):
    label: str | None = None
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

    model_config = {"from_attributes": True}
