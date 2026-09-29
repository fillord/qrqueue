import uuid
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cabinet import Cabinet
from app.models.department import Department, DepartmentScheduleItem
from app.models.enums import TicketStatus
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.models.tv_screen import TVScreen
from app.models.tv_media import TVMedia
from app.services.youtube import youtube_embed_url

_CALLED_LIKE_STATUSES = (TicketStatus.called, TicketStatus.confirmed, TicketStatus.serving)


async def _active_calls(db: AsyncSession, queue_id: uuid.UUID, cabinet_ids: set[uuid.UUID] | None = None) -> list[dict]:
    query = (select(Ticket, Cabinet.label)
        .outerjoin(Cabinet, Cabinet.id == Ticket.cabinet_id)
        .where(Ticket.queue_id == queue_id, Ticket.status.in_(_CALLED_LIKE_STATUSES))
        .order_by(Ticket.called_at.desc(), Ticket.id))
    if cabinet_ids is not None:
        query = query.where(Ticket.cabinet_id.in_(cabinet_ids))
    result = await db.execute(query)
    return [
        {"ticket_id": ticket.id, "display_number": ticket.display_number,
         "cabinet_label": label, "call_count": ticket.call_count}
        for ticket, label in result.all()
    ]


async def _waiting_count(db: AsyncSession, queue_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(Ticket)
        .where(Ticket.queue_id == queue_id, Ticket.status == TicketStatus.waiting)
    )
    return result.scalar_one()


async def _recent_calls(db: AsyncSession, queue_ids: list[uuid.UUID], organization: Organization,
                        cabinet_ids: set[uuid.UUID] | None = None) -> list[dict]:
    if not queue_ids:
        return []
    local_now = datetime.now(ZoneInfo(organization.timezone))
    today_start = datetime.combine(local_now.date(), time.min, tzinfo=local_now.tzinfo).astimezone(timezone.utc)
    query = (select(Ticket, Cabinet.label, Queue.name)
             .join(Queue, Queue.id == Ticket.queue_id)
             .outerjoin(Cabinet, Cabinet.id == Ticket.cabinet_id)
             .where(Ticket.queue_id.in_(queue_ids), Ticket.called_at >= today_start)
             .order_by(Ticket.called_at.desc(), Ticket.id.desc())
             .limit(2))
    if cabinet_ids is not None:
        query = query.where(Ticket.cabinet_id.in_(cabinet_ids))
    result = await db.execute(query)
    return [
        {"ticket_id": ticket.id, "display_number": ticket.display_number,
         "cabinet_label": label, "queue_name": queue_name}
        for ticket, label, queue_name in result.all()
    ]


async def build_tv_state(db: AsyncSession, screen: TVScreen) -> dict:
    """Build the queue view for one queue or a hall screen's selected queues."""
    organization = await db.get(Organization, screen.organization_id)

    if screen.display_mode not in (None, "queue"):
        queue_ids = []
    elif screen.queue_id is not None:
        queue_ids = [screen.queue_id]
    else:
        selected_queue_ids = set(screen.selected_queue_ids or []) if screen.queue_selection_mode == "selected" else None
        result = await db.execute(
            select(Queue.id)
            .where(Queue.organization_id == screen.organization_id, Queue.is_active.is_(True),
                   Queue.deleted_at.is_(None))
            .order_by(Queue.name)
        )
        queue_ids = [row[0] for row in result.all() if selected_queue_ids is None or row[0] in selected_queue_ids]

    selected_cabinet_ids = set(screen.selected_cabinet_ids or []) if screen.cabinet_selection_mode == "selected" else None
    queues_out = []
    for queue_id in queue_ids:
        queue = await db.get(Queue, queue_id)
        if queue is None:
            continue
        calls = await _active_calls(db, queue_id, selected_cabinet_ids)
        queues_out.append(
            {
                "queue_id": queue.id,
                "queue_name": queue.name,
                "queue_status": queue.status,
                "now_serving": calls[0]["display_number"] if calls else None,
                "now_serving_cabinet": calls[0]["cabinet_label"] if calls else None,
                "active_calls": calls,
                "waiting_count": await _waiting_count(db, queue_id),
            }
        )

    departments_out = []
    media_out = []
    if screen.display_mode == "schedule":
        selected_department_ids = (set(screen.selected_department_ids or [])
                                   if screen.department_selection_mode == "selected" else None)
        departments = (await db.scalars(select(Department)
                                        .where(Department.organization_id == screen.organization_id,
                                               Department.is_active.is_(True))
                                        .order_by(Department.sort_order, Department.name))).all()
        if selected_department_ids is not None:
            departments = [department for department in departments if department.id in selected_department_ids]
        entries_by_department = {department.id: [] for department in departments}
        if departments:
            entries = (await db.scalars(select(DepartmentScheduleItem)
                                        .where(DepartmentScheduleItem.department_id.in_(entries_by_department))
                                        .order_by(DepartmentScheduleItem.weekday,
                                                  DepartmentScheduleItem.starts_at,
                                                  DepartmentScheduleItem.sort_order))).all()
            for entry in entries:
                entries_by_department[entry.department_id].append(entry)
        for department in departments:
            departments_out.append({"id": department.id, "name": department.name,
                                    "entries": entries_by_department[department.id]})
    if screen.display_mode == "media":
        selected_ids = set(screen.selected_media_ids or []) if screen.media_playlist_mode == "selected" else None
        media = (await db.scalars(select(TVMedia)
                                  .where(TVMedia.organization_id == screen.organization_id,
                                         TVMedia.is_ready.is_(True), TVMedia.is_active.is_(True))
                                  .order_by(TVMedia.sort_order, TVMedia.created_at))).all()
        media_out = [
            {"id": item.id, "title": item.title, "kind": item.kind,
             "mime_type": item.mime_type,
             "url": youtube_embed_url(item.kind, item.youtube_id) if item.youtube_id
                    else f"/api/tv/media/{item.id}?v={item.size_bytes}"}
            for item in media if (selected_ids is None or item.id in selected_ids)
            and (item.kind != "advertisement" or screen.ads_enabled)
            and (item.kind in {"youtube_video", "youtube_playlist"} and item.youtube_id
                 or item.kind == "advertisement" and item.mime_type.startswith("image/"))
        ]

    return {
        "organization_name": organization.name if organization else "",
        "logo_url": organization.logo_url if organization else None,
        "brand_color": organization.brand_color if organization else None,
        "language": screen.language,
        # True signal for "can this screen show a QR at all" — deliberately
        # not derived from len(queues_out), which can be 1 for a hall screen
        # that currently has only one active queue and would otherwise look
        # just like a real queue-bound screen (that mixup is what caused the
        # /tv/qr-batch 409 loop this field exists to fix).
        "is_hall_screen": screen.queue_id is None,
        "queues": queues_out,
        "recent_calls": await _recent_calls(db, queue_ids, organization, selected_cabinet_ids) if organization else [],
        "timezone": organization.timezone if organization else "Asia/Almaty",
        "display_mode": screen.display_mode,
        "slide_seconds": screen.slide_seconds,
        "ads_enabled": screen.ads_enabled,
        "departments": departments_out,
        "media": media_out,
    }


async def _now_serving(db: AsyncSession, queue_id: uuid.UUID) -> tuple[str | None, str | None]:
    calls = await _active_calls(db, queue_id)
    return (calls[0]["display_number"], calls[0]["cabinet_label"]) if calls else (None, None)
