"""Resolve the current queues of a hall TV for QR selection and redemption."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization import Organization
from app.models.queue import Queue
from app.models.tv_screen import TVScreen


async def hall_queues(db: AsyncSession, screen: TVScreen) -> list[Queue]:
    if screen.queue_id is not None or screen.display_mode != "queue":
        return []
    organization = await db.get(Organization, screen.organization_id)
    if organization is None or not organization.is_active or organization.deleted_at is not None:
        return []
    query = select(Queue).where(
        Queue.organization_id == screen.organization_id,
        Queue.is_active.is_(True),
        Queue.deleted_at.is_(None),
    ).order_by(Queue.name)
    if screen.queue_selection_mode == "selected":
        query = query.where(Queue.id.in_(screen.selected_queue_ids or []))
    return list((await db.scalars(query)).all())
