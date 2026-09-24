import math
import uuid
from datetime import datetime, timedelta

import jwt

from app.clock import utcnow
from app.config import settings

_ALGORITHM = "HS256"
_OVERLAP = timedelta(seconds=15)


class QRTokenError(Exception):
    """Raised by verify() with .reason set to one of:
    token_invalid, token_not_yet_valid, token_expired.
    """

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def _issue_batch(claim: str, subject_id: uuid.UUID, now: datetime | None = None) -> dict:
    now = now or utcnow()
    ttl = timedelta(seconds=settings.qr_token_ttl_seconds)
    batch_span = timedelta(minutes=settings.qr_token_batch_minutes)
    count = max(1, math.ceil(batch_span / ttl))

    tokens = []
    for i in range(count):
        nbf = now + i * ttl
        exp = now + (i + 1) * ttl + _OVERLAP
        jti = str(uuid.uuid4())
        payload = {claim: str(subject_id), "nbf": nbf, "exp": exp, "jti": jti}
        token = jwt.encode(payload, settings.qr_token_secret, algorithm=_ALGORITHM)
        tokens.append({"token": token, "nbf": nbf, "exp": exp, "jti": jti})

    return {"server_time": now, "tokens": tokens}


def issue_batch(queue_id: uuid.UUID, now: datetime | None = None) -> dict:
    return _issue_batch("q", queue_id, now)


def issue_screen_batch(screen_id: uuid.UUID, now: datetime | None = None) -> dict:
    return _issue_batch("s", screen_id, now)


def issue_selection(screen_id: uuid.UUID, now: datetime | None = None) -> str:
    now = now or utcnow()
    return jwt.encode({"ss": str(screen_id), "nbf": now,
                       "exp": now + timedelta(seconds=settings.qr_selection_ttl_seconds),
                       "jti": str(uuid.uuid4())}, settings.qr_token_secret, algorithm=_ALGORITHM)


def _verify_subject(token: str, claim: str, now: datetime | None = None) -> uuid.UUID:
    now = now or utcnow()
    try:
        payload = jwt.decode(
            token,
            settings.qr_token_secret,
            algorithms=[_ALGORITHM],
            options={"verify_exp": False, "verify_nbf": False},
        )
    except jwt.InvalidTokenError:
        raise QRTokenError("token_invalid")

    subject_id = payload.get(claim)
    nbf = payload.get("nbf")
    exp = payload.get("exp")
    if not isinstance(subject_id, str) or not isinstance(nbf, (int, float)) or not isinstance(exp, (int, float)):
        raise QRTokenError("token_invalid")

    now_ts = now.timestamp()
    if now_ts < nbf:
        raise QRTokenError("token_not_yet_valid")
    if now_ts >= exp:
        raise QRTokenError("token_expired")

    try:
        return uuid.UUID(subject_id)
    except (ValueError, TypeError, AttributeError):
        raise QRTokenError("token_invalid")


def verify(token: str, now: datetime | None = None) -> uuid.UUID:
    return _verify_subject(token, "q", now)


def verify_screen(token: str, now: datetime | None = None) -> uuid.UUID:
    return _verify_subject(token, "s", now)


def verify_selection(token: str, now: datetime | None = None) -> uuid.UUID:
    return _verify_subject(token, "ss", now)
