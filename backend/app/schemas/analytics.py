import uuid
from datetime import date

from pydantic import BaseModel


class OperatorStatOut(BaseModel):
    operator_id: uuid.UUID
    full_name: str
    served_count: int
    avg_serving_seconds: int | None


class HourlyPeakOut(BaseModel):
    hour: int
    count: int


class WeekdayPeakOut(BaseModel):
    weekday: int
    count: int


class AnalyticsOut(BaseModel):
    date_from: date
    date_to: date
    avg_wait_seconds: int | None
    avg_serving_seconds: int | None
    no_show_rate: float | None
    avg_rating: float | None
    ratings_count: int
    served_count: int
    no_show_count: int
    left_count: int
    by_operator: list[OperatorStatOut]
    peaks_by_hour: list[HourlyPeakOut]
    peaks_by_weekday: list[WeekdayPeakOut]
