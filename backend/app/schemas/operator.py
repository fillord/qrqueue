import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import CabinetStatus, QueueStatus
from app.schemas.public import TicketSummaryOut


class OperatorTicketOut(TicketSummaryOut):
    called_at: datetime | None = None
    call_count: int = 0


class OperatorQueueOut(BaseModel):
    queue_id: uuid.UUID
    queue_status: QueueStatus
    cabinet_status: CabinetStatus
    current_ticket: OperatorTicketOut | None
    waiting: list[OperatorTicketOut]
    waiting_count: int
    no_show: list[OperatorTicketOut]


class QueueSummaryOut(BaseModel):
    id: uuid.UUID
    name: str
    status: QueueStatus

    model_config = {"from_attributes": True}


class TransferRequest(BaseModel):
    queue_id: uuid.UUID


class PauseRequest(BaseModel):
    reason: str | None = None
