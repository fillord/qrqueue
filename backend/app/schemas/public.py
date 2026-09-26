import uuid
from datetime import datetime

from pydantic import BaseModel, Field
from typing import Literal

from app.models.enums import QueueStatus, TicketStatus


class ScanRequest(BaseModel):
    token: str
    queue_id: uuid.UUID | None = None
    lat: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    lng: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    fingerprint: str | None = None


class ScanOptionsRequest(BaseModel):
    token: str


class ScanOption(BaseModel):
    id: uuid.UUID
    name: str
    status: QueueStatus
    unavailable_reason: Literal["queue_closed", "queue_paused", "outside_schedule", "daily_limit_reached"] | None


class ScanOptionsOut(BaseModel):
    organization_name: str
    selection_token: str
    queues: list[ScanOption]


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
    organization_name: str
    queue_name: str
    position: int | None
    queue_status: QueueStatus
    now_serving: str | None
    estimated_wait_seconds: int | None = None
    cabinet: CabinetInfo | None = None
    rating: int | None = None
    next_ticket_id: uuid.UUID | None = None


class RateRequest(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)


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
