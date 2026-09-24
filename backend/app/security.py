import base64
import hashlib
import hmac
import secrets
import struct
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import bcrypt
import jwt

from app.config import settings

TOTP_PENDING_MINUTES = 5
TOTP_PERIOD_SECONDS = 30
TOTP_DIGITS = 6


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def create_access_token(user_id: uuid.UUID, role: str, auth_version: int = 0) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "auth_version": auth_version,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def create_totp_pending_token(user_id: uuid.UUID, setup_secret: str | None = None, auth_version: int = 0) -> str:
    """Short-lived token proving the password step passed; carries the
    not-yet-confirmed secret during enrollment. Never accepted as a session."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "purpose": "totp",
        "auth_version": auth_version,
        "iat": now,
        "exp": now + timedelta(minutes=TOTP_PENDING_MINUTES),
    }
    if setup_secret is not None:
        payload["setup_secret"] = setup_secret
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


# --- TOTP (RFC 6238, SHA-1, 30 s, 6 digits — what authenticator apps expect) --


def generate_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_code(secret: str, counter: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**TOTP_DIGITS).zfill(TOTP_DIGITS)


def totp_counter(at: float | None = None) -> int:
    return int((time.time() if at is None else at) // TOTP_PERIOD_SECONDS)


def verify_totp(secret: str, code: str, at: float | None = None, window: int = 1) -> int | None:
    """Returns the matched counter (for replay protection) or None."""
    code = code.strip().replace(" ", "")
    if len(code) != TOTP_DIGITS or not code.isdigit():
        return None
    current = totp_counter(at)
    for counter in range(current - window, current + window + 1):
        if hmac.compare_digest(totp_code(secret, counter), code):
            return counter
    return None


def totp_provisioning_uri(secret: str, email: str) -> str:
    issuer = quote(settings.totp_issuer, safe="")
    return f"otpauth://totp/{issuer}:{quote(email, safe='')}?secret={secret}&issuer={issuer}&digits={TOTP_DIGITS}&period={TOTP_PERIOD_SECONDS}"
