import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class AdminProblem(BaseModel):
    code: Literal["queue_not_open", "no_cabinet", "long_wait", "screen_offline"]
    severity: Literal["critical", "warning"]
    name: str
    queue_id: uuid.UUID | None = None
    screen_id: uuid.UUID | None = None
    waiting_count: int | None = None
    wait_minutes: int | None = None


class AdminProblemsOut(BaseModel):
    generated_at: datetime
    items: list[AdminProblem]


class DailyQueueStat(BaseModel):
    queue_id: uuid.UUID
    name: str
    issued_count: int
    served_count: int
    no_show_count: int
    left_count: int
    active_count: int
    avg_wait_seconds: int | None


class DailyOperatorStat(BaseModel):
    operator_id: uuid.UUID
    full_name: str
    served_count: int


class DailyReportOut(BaseModel):
    day: date
    organization_name: str
    timezone: str
    issued_count: int
    served_count: int
    no_show_count: int
    left_count: int
    active_count: int
    avg_wait_seconds: int | None
    avg_serving_seconds: int | None
    by_queue: list[DailyQueueStat]
    by_operator: list[DailyOperatorStat]
