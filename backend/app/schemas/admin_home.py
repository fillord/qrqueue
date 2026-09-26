import uuid

from pydantic import BaseModel

from app.models.enums import QueueStatus


class AdminHomeQueue(BaseModel):
    id: uuid.UUID
    name: str
    status: QueueStatus
    waiting_count: int


class AdminHomeOut(BaseModel):
    organization_name: str
    queues: list[AdminHomeQueue]
    cabinet_count: int
    operator_count: int
    has_operator_assignment: bool
    paired_queue_screen_count: int
    paired_screen_count: int
    online_screen_count: int
    offline_screen_count: int
