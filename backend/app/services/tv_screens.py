import secrets
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models.enums import AuditActorType
from app.models.organization import Organization
from app.models.tv_screen import TVScreen
from app.models.user import User
from app.schemas.tv import TVScreenCreate
from app.services.audit import log_action
from app.services.errors import ServiceError

_PAIRING_CODE_LENGTH = 6
_PAIRING_CODE_ALPHABET = "0123456789"


async def _generate_pairing_code(db: AsyncSession) -> str:
    for _ in range(20):
        code = "".join(secrets.choice(_PAIRING_CODE_ALPHABET) for _ in range(_PAIRING_CODE_LENGTH))
        result = await db.execute(select(TVScreen.id).where(TVScreen.pairing_code == code))
        if result.scalar_one_or_none() is None:
            return code
    raise RuntimeError("could not generate a unique TV pairing code")


async def create_tv_screen(
    db: AsyncSession, organization: Organization, payload: TVScreenCreate, actor: User
) -> TVScreen:
    code = await _generate_pairing_code(db)
    screen = TVScreen(
        organization_id=organization.id,
        queue_id=payload.queue_id,
        name=payload.name,
        pairing_code=code,
        language=payload.language,
    )
    db.add(screen)
    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=actor.id,
        action="tv_screen.created",
        entity_type="tv_screen",
        entity_id=screen.id,
        organization_id=organization.id,
        payload={"name": payload.name, "queue_id": str(payload.queue_id) if payload.queue_id else None},
    )
    return screen


async def delete_tv_screen(db: AsyncSession, screen: TVScreen, actor: User) -> None:
    screen_id = screen.id
    organization_id = screen.organization_id
    await db.delete(screen)
    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=actor.id,
        action="tv_screen.deleted",
        entity_type="tv_screen",
        entity_id=screen_id,
        organization_id=organization_id,
    )


async def pair_tv_screen(db: AsyncSession, *, code: str, now: datetime | None = None) -> TVScreen:
    """Pairing codes are single-use: a successful pair clears it so it can't
    be replayed, matching the QR tokens' one-purpose-per-secret pattern.
    """
    now = now or utcnow()
    result = await db.execute(select(TVScreen).where(TVScreen.pairing_code == code))
    screen = result.scalar_one_or_none()
    if screen is None:
        raise ServiceError("invalid_pairing_code", 404)

    screen.device_token = secrets.token_urlsafe(32)
    screen.pairing_code = None
    screen.last_seen_at = now
    await db.flush()
    return screen


async def get_screen_by_device_token(db: AsyncSession, device_token: str) -> TVScreen | None:
    result = await db.execute(select(TVScreen).where(TVScreen.device_token == device_token))
    return result.scalar_one_or_none()
