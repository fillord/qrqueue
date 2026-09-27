import secrets
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models.enums import AuditActorType
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.cabinet import Cabinet
from app.models.department import Department
from app.models.tv_screen import TVScreen
from app.models.tv_media import TVMedia
from app.models.user import User
from app.schemas.tv import TVScreenCreate
from app.services.audit import log_action
from app.services.errors import ServiceError

_PAIRING_CODE_LENGTH = 6
_PAIRING_CODE_ALPHABET = "0123456789"


async def _checked_media_ids(db: AsyncSession, organization_id, media_ids):
    selected = list(dict.fromkeys(media_ids))
    if selected:
        found = (await db.scalars(select(TVMedia.id).where(
            TVMedia.organization_id == organization_id, TVMedia.id.in_(selected)
        ))).all()
        if len(found) != len(selected):
            raise ServiceError("media_not_found", 404)
    return selected


async def _checked_queue_ids(db: AsyncSession, organization_id, queue_ids):
    selected = list(dict.fromkeys(queue_ids))
    if selected:
        found = (await db.scalars(select(Queue.id).where(
            Queue.organization_id == organization_id, Queue.id.in_(selected), Queue.deleted_at.is_(None)
        ))).all()
        if len(found) != len(selected):
            raise ServiceError("queue_not_found", 404)
    return selected


async def _checked_cabinet_ids(db: AsyncSession, organization_id, cabinet_ids):
    selected = list(dict.fromkeys(cabinet_ids))
    if selected:
        found = (await db.scalars(select(Cabinet.id).where(
            Cabinet.organization_id == organization_id, Cabinet.id.in_(selected), Cabinet.deleted_at.is_(None)
        ))).all()
        if len(found) != len(selected):
            raise ServiceError("cabinet_not_found", 404)
    return selected


async def _checked_department_ids(db: AsyncSession, organization_id, department_ids):
    selected = list(dict.fromkeys(department_ids))
    if selected:
        found = (await db.scalars(select(Department.id).where(
            Department.organization_id == organization_id, Department.id.in_(selected)
        ))).all()
        if len(found) != len(selected):
            raise ServiceError("department_not_found", 404)
    return selected


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
    selected_media_ids = await _checked_media_ids(db, organization.id, payload.selected_media_ids)
    selected_queue_ids = await _checked_queue_ids(db, organization.id, payload.selected_queue_ids)
    selected_cabinet_ids = await _checked_cabinet_ids(db, organization.id, payload.selected_cabinet_ids)
    selected_department_ids = await _checked_department_ids(db, organization.id, payload.selected_department_ids)
    screen = TVScreen(
        organization_id=organization.id,
        queue_id=payload.queue_id if payload.display_mode == "queue" else None,
        name=payload.name,
        pairing_code=code,
        language=payload.language,
        display_mode=payload.display_mode,
        slide_seconds=payload.slide_seconds,
        ads_enabled=payload.ads_enabled,
        media_playlist_mode=payload.media_playlist_mode,
        selected_media_ids=selected_media_ids,
        queue_selection_mode=payload.queue_selection_mode,
        selected_queue_ids=selected_queue_ids,
        cabinet_selection_mode=payload.cabinet_selection_mode,
        selected_cabinet_ids=selected_cabinet_ids,
        department_selection_mode=payload.department_selection_mode,
        selected_department_ids=selected_department_ids,
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
        payload={"name": payload.name, "queue_id": str(payload.queue_id) if payload.queue_id else None,
                 "media_playlist_mode": payload.media_playlist_mode,
                 "selected_media_ids": [str(item) for item in selected_media_ids],
                 "queue_selection_mode": payload.queue_selection_mode,
                 "selected_queue_ids": [str(item) for item in selected_queue_ids],
                 "cabinet_selection_mode": payload.cabinet_selection_mode,
                 "selected_cabinet_ids": [str(item) for item in selected_cabinet_ids],
                 "department_selection_mode": payload.department_selection_mode,
                 "selected_department_ids": [str(item) for item in selected_department_ids]},
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
        payload={"name": screen.name},
    )


async def unpair_tv_screen(db: AsyncSession, screen: TVScreen, actor: User) -> TVScreen:
    """Revoke the current device without discarding the screen's configuration."""
    from app.services.realtime import defer_event, organization_channel

    if screen.device_token is None:
        raise ServiceError("tv_screen_not_paired", 409)
    screen.device_token = None
    screen.pairing_code = await _generate_pairing_code(db)
    screen.last_seen_at = None
    await db.flush()
    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=actor.id,
        action="tv_screen.unpaired",
        entity_type="tv_screen",
        entity_id=screen.id,
        organization_id=screen.organization_id,
        payload={"name": screen.name},
    )
    defer_event(db, organization_channel(screen.organization_id), "tv_screen.unpaired", screen_id=str(screen.id))
    return screen


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


async def update_tv_screen(db, screen, payload, actor):
    from app.services.realtime import defer_event, organization_channel
    changes = payload.model_dump(exclude_unset=True)
    if "selected_media_ids" in changes:
        changes["selected_media_ids"] = await _checked_media_ids(
            db, screen.organization_id, changes["selected_media_ids"]
        )
    if "queue_id" in changes and changes["queue_id"] is not None:
        await _checked_queue_ids(db, screen.organization_id, [changes["queue_id"]])
    if "selected_queue_ids" in changes:
        changes["selected_queue_ids"] = await _checked_queue_ids(
            db, screen.organization_id, changes["selected_queue_ids"]
        )
    if "selected_cabinet_ids" in changes:
        changes["selected_cabinet_ids"] = await _checked_cabinet_ids(
            db, screen.organization_id, changes["selected_cabinet_ids"]
        )
    if "selected_department_ids" in changes:
        changes["selected_department_ids"] = await _checked_department_ids(
            db, screen.organization_id, changes["selected_department_ids"]
        )
    for field, value in changes.items():
        setattr(screen, field, value)
    await log_action(db, actor_type=AuditActorType.user, actor_id=actor.id,
                     action="tv_screen.updated", entity_type="tv_screen",
                     entity_id=screen.id, organization_id=screen.organization_id,
                     payload={key: [str(item) for item in value] if key in ("selected_media_ids", "selected_queue_ids", "selected_cabinet_ids", "selected_department_ids")
                              else str(value) if key == "queue_id" and value is not None else value
                              for key, value in changes.items()})
    defer_event(db, organization_channel(screen.organization_id), "tv_screen.updated", screen_id=str(screen.id))
