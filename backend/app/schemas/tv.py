import uuid
from datetime import datetime
from typing import ClassVar, Literal

from pydantic import BaseModel, Field
from app.schemas.validation import Name, PatchModel

from app.models.enums import Language, QueueStatus
from app.schemas.tv_signage import TVDepartmentState, TVMediaState


class TVScreenCreate(BaseModel):
    name: Name
    queue_id: uuid.UUID | None = None
    language: Language = Language.ru
    display_mode: Literal["queue", "schedule", "media"] = "queue"
    slide_seconds: int = Field(default=15, ge=5, le=120)
    ads_enabled: bool = False
    media_playlist_mode: Literal["all", "selected"] = "all"
    selected_media_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)
    queue_selection_mode: Literal["all", "selected"] = "all"
    selected_queue_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)
    cabinet_selection_mode: Literal["all", "selected"] = "all"
    selected_cabinet_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)
    department_selection_mode: Literal["all", "selected"] = "all"
    selected_department_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)


class TVScreenUpdate(PatchModel):
    nullable_fields: ClassVar[frozenset[str]] = frozenset({"queue_id"})
    queue_id: uuid.UUID | None = None
    language: Language | None = None
    name: Name | None = None
    display_mode: Literal["queue", "schedule", "media"] | None = None
    slide_seconds: int | None = Field(default=None, ge=5, le=120)
    ads_enabled: bool | None = None
    media_playlist_mode: Literal["all", "selected"] | None = None
    selected_media_ids: list[uuid.UUID] | None = Field(default=None, max_length=500)
    queue_selection_mode: Literal["all", "selected"] | None = None
    selected_queue_ids: list[uuid.UUID] | None = Field(default=None, max_length=500)
    cabinet_selection_mode: Literal["all", "selected"] | None = None
    selected_cabinet_ids: list[uuid.UUID] | None = Field(default=None, max_length=500)
    department_selection_mode: Literal["all", "selected"] | None = None
    selected_department_ids: list[uuid.UUID] | None = Field(default=None, max_length=500)


class TVScreenOut(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    queue_id: uuid.UUID | None
    name: str
    pairing_code: str | None
    language: Language
    last_seen_at: datetime | None
    display_mode: Literal["queue", "schedule", "media"]
    slide_seconds: int
    ads_enabled: bool
    media_playlist_mode: Literal["all", "selected"]
    selected_media_ids: list[uuid.UUID]
    queue_selection_mode: Literal["all", "selected"]
    selected_queue_ids: list[uuid.UUID]
    cabinet_selection_mode: Literal["all", "selected"]
    selected_cabinet_ids: list[uuid.UUID]
    department_selection_mode: Literal["all", "selected"]
    selected_department_ids: list[uuid.UUID]

    model_config = {"from_attributes": True}


class TVPairRequest(BaseModel):
    code: str


class TVPairResponse(BaseModel):
    device_token: str


class TVActiveCall(BaseModel):
    ticket_id: uuid.UUID
    display_number: str
    cabinet_label: str | None
    call_count: int


class TVQueueState(BaseModel):
    active_calls: list[TVActiveCall]
    queue_id: uuid.UUID
    queue_name: str
    queue_status: QueueStatus
    now_serving: str | None
    now_serving_cabinet: str | None
    waiting_count: int


class TVRecentCall(BaseModel):
    ticket_id: uuid.UUID
    display_number: str
    cabinet_label: str | None
    queue_name: str


class TVStateOut(BaseModel):
    organization_name: str
    logo_url: str | None
    brand_color: str | None
    language: Language
    is_hall_screen: bool
    queues: list[TVQueueState]
    recent_calls: list[TVRecentCall]
    timezone: str
    display_mode: Literal["queue", "schedule", "media"]
    slide_seconds: int
    ads_enabled: bool
    departments: list[TVDepartmentState]
    media: list[TVMediaState]
