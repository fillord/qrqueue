import uuid

from fastapi import APIRouter, Depends
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.attendance import _active_org, _employee
from app.api.deps import current_admin, current_client, current_organization_id
from app.db import get_db
from app.models.client import Client
from app.models.enums import AuditActorType
from app.models.ticket import Ticket
from app.models.user import User
from app.redis import get_redis
from app.services.audit import log_action
from app.services.errors import ServiceError
from app.services import telegram

router = APIRouter(tags=["telegram"])


@router.get("/public/tickets/{ticket_id}/telegram")
async def status(ticket_id: uuid.UUID, db: AsyncSession = Depends(get_db), client: Client = Depends(current_client)):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket or ticket.client_id != client.id:
        raise ServiceError("ticket_not_found", 404)
    await db.commit()
    return {"available": telegram.enabled(), "connected": client.telegram_chat_id is not None}


@router.post("/public/tickets/{ticket_id}/telegram")
async def connect_client(ticket_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                         redis: Redis = Depends(get_redis), client: Client = Depends(current_client)):
    ticket = await db.get(Ticket, ticket_id)
    if not ticket or ticket.client_id != client.id:
        raise ServiceError("ticket_not_found", 404)
    await _active_org(db, ticket.organization_id)
    if ticket.status.value not in ("waiting", "called", "confirmed"):
        raise ServiceError("ticket_not_active", 409)
    await db.commit()
    return await telegram.issue_link(redis, kind="client", subject_id=client.id, ticket_id=ticket.id)


@router.post("/attendance/admin/employees/{employee_id}/telegram")
async def connect_employee(employee_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                           redis: Redis = Depends(get_redis), actor: User = Depends(current_admin),
                           organization_id: uuid.UUID = Depends(current_organization_id)):
    await _active_org(db, organization_id)
    employee = await _employee(db, organization_id, employee_id)
    if not employee.is_active:
        raise ServiceError("employee_inactive", 409)
    result = await telegram.issue_link(redis, kind="employee", subject_id=employee.id)
    await log_action(db, actor_type=AuditActorType.user, actor_id=actor.id,
        action="attendance.telegram.link_issued", entity_type="employee", entity_id=employee.id,
        organization_id=organization_id)
    await db.commit()
    return result
