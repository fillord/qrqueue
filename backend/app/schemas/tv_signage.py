import uuid
from datetime import time, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.validation import Name, PatchModel


class DepartmentCreate(BaseModel):
    name: Name
    sort_order: int = Field(default=0, ge=0, le=10000)
    is_active: bool = True


class DepartmentUpdate(PatchModel):
    name: Name | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)
    is_active: bool | None = None


class DepartmentOut(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    sort_order: int
    is_active: bool

    model_config = {"from_attributes": True}


class ScheduleItemCreate(BaseModel):
    doctor_name: Name
    service_name: str | None = Field(default=None, max_length=160)
    room: str | None = Field(default=None, max_length=120)
    weekday: int = Field(ge=0, le=6)
    starts_at: time
    ends_at: time
    sort_order: int = Field(default=0, ge=0, le=10000)

    @model_validator(mode="after")
    def validate_interval(self):
        if self.starts_at.tzinfo or self.ends_at.tzinfo or self.starts_at >= self.ends_at:
            raise ValueError("Schedule times must be local and end after start")
        return self


class ScheduleItemUpdate(PatchModel):
    nullable_fields = frozenset({"service_name", "room"})
    doctor_name: Name | None = None
    service_name: str | None = Field(default=None, max_length=160)
    room: str | None = Field(default=None, max_length=120)
    weekday: int | None = Field(default=None, ge=0, le=6)
    starts_at: time | None = None
    ends_at: time | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)


class ScheduleItemOut(ScheduleItemCreate):
    id: uuid.UUID
    department_id: uuid.UUID
    model_config = {"from_attributes": True}


class TVMediaCreate(BaseModel):
    title: Name
    kind: Literal["video", "advertisement"]
    mime_type: Literal["video/mp4", "video/webm", "image/jpeg", "image/png", "image/webp"]
    size_bytes: int = Field(gt=0, le=104857600)
    sort_order: int = Field(default=0, ge=0, le=10000)

    @model_validator(mode="after")
    def validate_kind(self):
        if self.kind == "video" and not self.mime_type.startswith("video/"):
            raise ValueError("Ordinary videos must have a video format")
        return self


class TVMediaUpdate(PatchModel):
    title: Name | None = None
    kind: Literal["video", "advertisement"] | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)
    is_active: bool | None = None


class TVMediaOut(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    title: str
    kind: str
    mime_type: str
    size_bytes: int
    uploaded_bytes: int
    is_ready: bool
    is_active: bool
    sort_order: int
    created_at: datetime
    model_config = {"from_attributes": True}


class TVDepartmentState(BaseModel):
    id: uuid.UUID
    name: str
    entries: list[ScheduleItemOut]


class TVMediaState(BaseModel):
    id: uuid.UUID
    title: str
    kind: str
    mime_type: str
    url: str
