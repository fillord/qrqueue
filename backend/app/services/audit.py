import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.enums import AuditActorType


async def log_action(
    db: AsyncSession,
    *,
    actor_type: AuditActorType,
    actor_id: uuid.UUID | None,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID,
    organization_id: uuid.UUID | None = None,
    payload: dict | None = None,
    ip: str | None = None,
) -> AuditLog:
    entry = AuditLog(
        organization_id=organization_id,
        actor_type=actor_type,
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=payload or {},
        ip=ip,
    )
    db.add(entry)
    await db.flush()
    return entry
