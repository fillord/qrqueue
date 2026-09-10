from datetime import datetime

from pydantic import BaseModel


class QRBatchToken(BaseModel):
    token: str
    nbf: datetime
    exp: datetime


class QRBatchOut(BaseModel):
    server_time: datetime
    tokens: list[QRBatchToken]
