import uuid
from datetime import date, datetime, time as dt_time, timedelta, timezone

from zoneinfo import ZoneInfo
from app.models.organization import Organization

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.user import User


async def list_audit_logs(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID | None,
    date_from: date | None,
    date_to: date | None,
    action: str | None,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    """organization_id=None is superadmin's "every organization" view — org_admin
    routes always pass their own organization_id, never None.
    """
    org = await db.get(Organization, organization_id) if organization_id else None
    tz = ZoneInfo(org.timezone) if org else timezone.utc
    conditions = []
    if organization_id is not None:
        conditions.append(AuditLog.organization_id == organization_id)
    if date_from is not None:
        conditions.append(AuditLog.created_at >= datetime.combine(date_from, dt_time.min, tzinfo=tz))
    if date_to is not None:
        conditions.append(
            AuditLog.created_at
            < datetime.combine(date_to, dt_time.min, tzinfo=tz) + timedelta(days=1)
        )
    if action is not None:
        conditions.append(AuditLog.action == action)

    count_stmt = select(func.count()).select_from(AuditLog).where(*conditions)
    total = (await db.execute(count_stmt)).scalar_one()

    page_stmt = (
        select(AuditLog, User.full_name)
        .select_from(AuditLog)
        .outerjoin(User, AuditLog.actor_id == User.id)
        .where(*conditions)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(page_stmt)).all()

    items = [
        {
            "id": entry.id,
            "organization_id": entry.organization_id,
            "actor_type": entry.actor_type,
            "actor_id": entry.actor_id,
            "actor_name": actor_name if entry.actor_type.value == "user" else None,
            "action": entry.action,
            "entity_type": entry.entity_type,
            "entity_id": entry.entity_id,
            "payload": entry.payload,
            # asyncpg hands INET back as ipaddress.IPv4Address/IPv6Address,
            # not str — the schema wants a plain string.
            "ip": str(entry.ip) if entry.ip is not None else None,
            "created_at": entry.created_at,
        }
        for entry, actor_name in rows
    ]
    return items, total
