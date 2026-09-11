import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import Language, QueueStatus


class TVScreenCreate(BaseModel):
    name: str
    queue_id: uuid.UUID | None = None
    language: Language = Language.ru


class TVScreenOut(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    queue_id: uuid.UUID | None
    name: str
    pairing_code: str | None
    language: Language
    last_seen_at: datetime | None

    model_config = {"from_attributes": True}


class TVPairRequest(BaseModel):
    code: str


class TVPairResponse(BaseModel):
    device_token: str


class TVQueueState(BaseModel):
    queue_id: uuid.UUID
    queue_name: str
    queue_status: QueueStatus
    now_serving: str | None
    now_serving_cabinet: str | None
    waiting_count: int


class TVStateOut(BaseModel):
    organization_name: str
    logo_url: str | None
    brand_color: str | None
    language: Language
    queues: list[TVQueueState]
