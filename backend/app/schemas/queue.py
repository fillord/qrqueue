import uuid
from datetime import date, time

from pydantic import BaseModel, model_validator

from app.models.enums import QueueStatus


def validate_geo_fields(latitude, longitude, geo_radius_m) -> None:
    provided = [latitude is not None, longitude is not None, geo_radius_m is not None]
    if any(provided) and not all(provided):
        raise ValueError(
            "latitude, longitude and geo_radius_m must be provided together or not at all"
        )


class QueueCreate(BaseModel):
    name: str
    ticket_prefix: str
    status: QueueStatus = QueueStatus.open
    latitude: float | None = None
    longitude: float | None = None
    geo_radius_m: int | None = None
    presence_timeout_min: int | None = None
    daily_ticket_limit: int | None = None

    @model_validator(mode="after")
    def _validate_geo(self):
        validate_geo_fields(self.latitude, self.longitude, self.geo_radius_m)
        return self


class QueueUpdate(BaseModel):
    name: str | None = None
    ticket_prefix: str | None = None
    status: QueueStatus | None = None
    latitude: float | None = None
    longitude: float | None = None
    geo_radius_m: int | None = None
    presence_timeout_min: int | None = None
    daily_ticket_limit: int | None = None
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

    model_config = {"from_attributes": True}


class ScheduleEntry(BaseModel):
    weekday: int
    opens_at: time
    closes_at: time

    @model_validator(mode="after")
    def _validate_weekday(self):
        if not 0 <= self.weekday <= 6:
            raise ValueError("weekday must be between 0 and 6")
        return self


class ScheduleReplace(BaseModel):
    schedule: list[ScheduleEntry]


class ScheduleEntryOut(BaseModel):
    id: uuid.UUID
    weekday: int
    opens_at: time
    closes_at: time

    model_config = {"from_attributes": True}
