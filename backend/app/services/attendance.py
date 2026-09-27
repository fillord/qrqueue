import hashlib
import hmac
import secrets
import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.config import settings
from app.models.attendance import AttendanceEvent, Employee
from app.services.errors import ServiceError

QR_LIFETIME_SECONDS = 45
DUPLICATE_COOLDOWN = timedelta(minutes=2)
MAX_OPEN_INTERVAL = timedelta(hours=20)


def code_digest(organization_id: uuid.UUID, code: str) -> str:
    normalized = code.strip().replace(" ", "")
    return hmac.new(settings.attendance_signing_secret.encode(), f"attendance-code:{organization_id}:{normalized}".encode(), hashlib.sha256).hexdigest()


def new_code() -> str:
    return str(secrets.randbelow(10_000)).zfill(4)


def enrollment_token(organization_id: uuid.UUID, version: int) -> str:
    data = f"{organization_id}:{version}"
    signature = hmac.new(settings.attendance_signing_secret.encode(), f"attendance-enroll:{data}".encode(), hashlib.sha256).hexdigest()[:32]
    return f"{data}:{signature}"


def verify_enrollment_token(token: str) -> tuple[uuid.UUID, int]:
    try:
        organization_raw, version_raw, signature = token.split(":")
        organization_id, version = uuid.UUID(organization_raw), int(version_raw)
    except (ValueError, AttributeError) as exc:
        raise ServiceError("enrollment_link_invalid", 404) from exc
    if len(token) > 100 or version < 1 or not hmac.compare_digest(token, enrollment_token(organization_id, version)):
        raise ServiceError("enrollment_link_invalid", 404)
    return organization_id, version


def qr_token(organization_id: uuid.UUID, at=None) -> str:
    now = at or utcnow()
    bucket = int(now.timestamp() // QR_LIFETIME_SECONDS)
    data = f"{organization_id}:{bucket}"
    signature = hmac.new(settings.attendance_signing_secret.encode(), f"attendance-qr:{data}".encode(), hashlib.sha256).hexdigest()[:32]
    return f"{data}:{signature}"


def verify_qr(token: str) -> uuid.UUID:
    try:
        org_raw, bucket_raw, signature = token.split(":")
        organization_id = uuid.UUID(org_raw)
        bucket = int(bucket_raw)
    except (ValueError, AttributeError) as exc:
        raise ServiceError("attendance_qr_expired", 400) from exc
    if len(token) > 100 or abs(int(utcnow().timestamp() // QR_LIFETIME_SECONDS) - bucket) > 1:
        raise ServiceError("attendance_qr_expired", 400)
    data = f"{organization_id}:{bucket}"
    expected = hmac.new(settings.attendance_signing_secret.encode(), f"attendance-qr:{data}".encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(signature, expected):
        raise ServiceError("attendance_qr_expired", 400)
    return organization_id


def phone_session_token(organization_id: uuid.UUID) -> str:
    expires = int(utcnow().timestamp()) + 300
    data = f"{organization_id}:{expires}"
    signature = hmac.new(settings.attendance_signing_secret.encode(), f"attendance-phone:{data}".encode(), hashlib.sha256).hexdigest()[:32]
    return f"{data}:{signature}"


def verify_phone_session(token: str) -> uuid.UUID:
    try:
        org_raw, expires_raw, signature = token.split(":")
        organization_id = uuid.UUID(org_raw)
        expires = int(expires_raw)
    except (ValueError, AttributeError) as exc:
        raise ServiceError("attendance_qr_expired", 400) from exc
    if len(token) > 100 or expires < int(utcnow().timestamp()) or expires > int(utcnow().timestamp()) + 300:
        raise ServiceError("attendance_qr_expired", 400)
    data = f"{organization_id}:{expires}"
    expected = hmac.new(settings.attendance_signing_secret.encode(), f"attendance-phone:{data}".encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(signature, expected):
        raise ServiceError("attendance_qr_expired", 400)
    return organization_id


async def record_attendance(db: AsyncSession, employee: Employee, source: str) -> AttendanceEvent:
    # Serialize concurrent kiosk/phone requests for this employee.
    employee = (await db.execute(select(Employee).where(Employee.id == employee.id).with_for_update())).scalar_one()
    if employee.deleted_at is not None or not employee.is_active or employee.face_template is None or employee.face_consent_at is None:
        raise ServiceError("employee_unavailable", 409)
    now = utcnow()
    previous = (await db.execute(select(AttendanceEvent).where(AttendanceEvent.employee_id == employee.id).order_by(AttendanceEvent.occurred_at.desc(), AttendanceEvent.recorded_at.desc()).limit(1))).scalar_one_or_none()
    if previous is not None and now - previous.occurred_at < DUPLICATE_COOLDOWN:
        raise ServiceError("attendance_too_soon", 409, last_kind=previous.kind,
                           retry_at=(previous.occurred_at + DUPLICATE_COOLDOWN).isoformat(),
                           employee_name=employee.full_name)
    kind = "out" if previous is not None and previous.kind == "in" and now - previous.occurred_at < MAX_OPEN_INTERVAL else "in"
    if previous is not None and previous.kind == "in" and kind == "in":
        previous.needs_review = True
    event = AttendanceEvent(organization_id=employee.organization_id, employee_id=employee.id, kind=kind, source=source, occurred_at=now)
    db.add(event)
    await db.flush()
    return event
