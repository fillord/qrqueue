import uuid
from datetime import date, datetime, time

from pydantic import BaseModel, Field, model_validator
from app.schemas.validation import Name, Prefix, PatchModel

from app.models.enums import QueueStatus


def validate_geo_fields(latitude, longitude, geo_radius_m) -> None:
    provided = [latitude is not None, longitude is not None, geo_radius_m is not None]
    if any(provided) and not all(provided):
        raise ValueError(
            "latitude, longitude and geo_radius_m must be provided together or not at all"
        )


class QueueCreate(BaseModel):
    name: Name
    ticket_prefix: Prefix
    status: QueueStatus = QueueStatus.open
    latitude: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    geo_radius_m: int | None = Field(default=None, gt=0, le=100000)
    presence_timeout_min: int | None = Field(default=None, gt=0, le=1440)
    daily_ticket_limit: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _validate_geo(self):
        validate_geo_fields(self.latitude, self.longitude, self.geo_radius_m)
        return self


class QueueUpdate(PatchModel):
    nullable_fields = frozenset({"latitude", "longitude", "geo_radius_m", "daily_ticket_limit"})
    name: Name | None = None
    ticket_prefix: Prefix | None = None
    status: QueueStatus | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    geo_radius_m: int | None = Field(default=None, gt=0, le=100000)
    presence_timeout_min: int | None = Field(default=None, gt=0, le=1440)
    daily_ticket_limit: int | None = Field(default=None, gt=0)
    is_active: bool | None = None


class QueueOut(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    ticket_prefix: str
    status: QueueStatus
    latitude: float | None
    longitude: float | None
    geo_radius_m: int | None
    presence_timeout_min: int
    daily_ticket_limit: int | None
    last_ticket_number: int
    counter_date: date
    is_active: bool
    deleted_at: datetime | None
    waiting_count: int = 0

    model_config = {"from_attributes": True}


class ScheduleEntry(BaseModel):
    weekday: int
    opens_at: time
    closes_at: time

    @model_validator(mode="after")
    def _validate_weekday(self):
        if not 0 <= self.weekday <= 6:
            raise ValueError("weekday must be between 0 and 6")
        if self.opens_at.tzinfo is not None or self.closes_at.tzinfo is not None:
            raise ValueError("Schedule times must be local")
        if self.opens_at >= self.closes_at:
            raise ValueError("Closing time must be after opening time")
        return self


class ScheduleReplace(BaseModel):
    schedule: list[ScheduleEntry] = Field(max_length=7)

    @model_validator(mode="after")
    def unique_days(self):
        if len({entry.weekday for entry in self.schedule}) != len(self.schedule):
            raise ValueError("Duplicate weekday")
        return self


class ScheduleEntryOut(BaseModel):
    id: uuid.UUID
    weekday: int
    opens_at: time
    closes_at: time

    model_config = {"from_attributes": True}
