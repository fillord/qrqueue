import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import QueueStatus, TicketStatus


class ScanRequest(BaseModel):
    token: str
    lat: float | None = None
    lng: float | None = None
    fingerprint: str | None = None


class TicketSummaryOut(BaseModel):
    id: uuid.UUID
    queue_id: uuid.UUID
    display_number: str
    status: TicketStatus
    created_at: datetime

    model_config = {"from_attributes": True}


class CabinetInfo(BaseModel):
    id: uuid.UUID
    label: str


class TicketDetailOut(TicketSummaryOut):
    position: int | None
    queue_status: QueueStatus
    now_serving: str | None
    estimated_wait_seconds: int | None = None
    cabinet: CabinetInfo | None = None


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscribeRequest(BaseModel):
    endpoint: str
    keys: PushKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str


class VapidKeyOut(BaseModel):
    public_key: str | None
