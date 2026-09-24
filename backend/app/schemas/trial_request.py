import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, StringConstraints


class TrialRequestCreate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    organization: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    contact: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=200)]


class TrialRequestOut(TrialRequestCreate):
    id: uuid.UUID
    processed: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TrialRequestUpdate(BaseModel):
    processed: bool
