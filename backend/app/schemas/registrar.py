import uuid

from pydantic import BaseModel


class RegistrarTicketCreate(BaseModel):
    queue_id: uuid.UUID
    note: str | None = None
