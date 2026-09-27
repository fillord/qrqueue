import uuid
from datetime import date, datetime, time as dt_time, timedelta, timezone

from zoneinfo import ZoneInfo
from app.models.organization import Organization

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.attendance import Employee
from app.models.cabinet import Cabinet
from app.models.department import Department, DepartmentScheduleItem
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.models.trial_request import TrialRequest
from app.models.tv_media import TVMedia
from app.models.tv_screen import TVScreen
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

    entries = [entry for entry, _ in rows]
    ids_by_type: dict[str, set[uuid.UUID]] = {}
    for entry in entries:
        ids_by_type.setdefault(entry.entity_type, set()).add(entry.entity_id)

    # Resolve the visible page in batches, including archived rows. Audit payloads
    # take precedence below because they preserve a name recorded at event time.
    named_models = {
        "organization": (Organization, Organization.name),
        "user": (User, User.full_name),
        "department": (Department, Department.name),
        "department_schedule_item": (DepartmentScheduleItem, DepartmentScheduleItem.doctor_name),
        "tv_screen": (TVScreen, TVScreen.name),
        "tv_media": (TVMedia, TVMedia.title),
        "trial_request": (TrialRequest, TrialRequest.organization),
        "attendance_employee": (Employee, Employee.full_name),
    }
    names: dict[str, dict[uuid.UUID, str]] = {}
    for entity_type, (model, label_column) in named_models.items():
        ids = ids_by_type.get(entity_type)
        if ids:
            names[entity_type] = dict((await db.execute(
                select(model.id, label_column).where(model.id.in_(ids))
            )).all())

    ticket_ids = ids_by_type.get("ticket", set())
    tickets = {}
    if ticket_ids:
        tickets = {row.id: row for row in (await db.execute(
            select(Ticket.id, Ticket.display_number, Ticket.queue_id, Ticket.cabinet_id)
            .where(Ticket.id.in_(ticket_ids))
        )).all()}

    queue_ids = ids_by_type.get("queue", set()).copy()
    cabinet_ids = ids_by_type.get("cabinet", set()).copy()
    for ticket in tickets.values():
        queue_ids.add(ticket.queue_id)
        if ticket.cabinet_id:
            cabinet_ids.add(ticket.cabinet_id)
    for entry in entries:
        if entry.entity_type == "ticket" and entry.payload.get("cabinet_id"):
            try:
                cabinet_ids.add(uuid.UUID(str(entry.payload["cabinet_id"])))
            except (TypeError, ValueError):
                pass
    queues = dict((await db.execute(select(Queue.id, Queue.name).where(Queue.id.in_(queue_ids)))).all()) if queue_ids else {}
    cabinets = dict((await db.execute(select(Cabinet.id, Cabinet.label).where(Cabinet.id.in_(cabinet_ids)))).all()) if cabinet_ids else {}

    def label_for(entry: AuditLog) -> str | None:
        payload = entry.payload or {}
        if entry.entity_type == "ticket":
            ticket = tickets.get(entry.entity_id)
            return ticket.display_number if ticket else payload.get("display_number")
        snapshot_key = {"organization": "name", "user": "full_name", "queue": "name",
                        "cabinet": "label", "department": "name", "department_schedule_item": "doctor_name",
                        "tv_screen": "name", "tv_media": "title",
                        "attendance_employee": "full_name", "attendance_event": "full_name"}.get(entry.entity_type)
        if snapshot_key and isinstance(payload.get(snapshot_key), str):
            return payload[snapshot_key]
        if entry.entity_type == "queue":
            return queues.get(entry.entity_id)
        if entry.entity_type == "cabinet":
            return cabinets.get(entry.entity_id)
        return names.get(entry.entity_type, {}).get(entry.entity_id)

    def ticket_context(entry: AuditLog) -> tuple[str | None, str | None]:
        ticket = tickets.get(entry.entity_id) if entry.entity_type == "ticket" else None
        if ticket is None:
            return None, None
        queue_name = queues.get(ticket.queue_id)
        if entry.action == "ticket.created":
            return queue_name, None
        cabinet_id = ticket.cabinet_id
        if entry.payload.get("cabinet_id"):
            try:
                cabinet_id = uuid.UUID(str(entry.payload["cabinet_id"]))
            except (TypeError, ValueError):
                pass
        return queue_name, cabinets.get(cabinet_id)

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
            "entity_label": label_for(entry),
            "queue_name": ticket_context(entry)[0],
            "cabinet_label": ticket_context(entry)[1],
            "payload": entry.payload,
            # asyncpg hands INET back as ipaddress.IPv4Address/IPv6Address,
            # not str — the schema wants a plain string.
            "ip": str(entry.ip) if entry.ip is not None else None,
            "created_at": entry.created_at,
        }
        for entry, actor_name in rows
    ]
    return items, total
