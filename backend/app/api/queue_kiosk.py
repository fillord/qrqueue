"""Revocable visitor devices; never share attendance credentials or client cookies."""
import hashlib
import logging
import secrets
import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Header, Request
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field, model_validator
from redis.asyncio import Redis
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin, current_organization_id
from app.clock import local_date, utcnow
from app.db import get_db
from app.models.enums import AuditActorType, QueueStatus, TicketSource, TicketStatus
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.queue_kiosk import QueueKiosk, QueueKioskIssue
from app.models.ticket import Ticket
from app.models.user import User
from app.redis import get_redis
from app.services.audit import log_action
from app.services.errors import ServiceError
from app.services.queue_availability import within_schedule
from app.services.rate_limit import client_ip, enforce_rate_limit
from app.services.realtime import publish_event
from app.services.tickets import create_ticket

router = APIRouter(tags=["queue-kiosks"])
logger = logging.getLogger(__name__)


class KioskSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    queue_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)
    printing_enabled: bool = False
    paper_width: Literal[58, 80] = 80
    language: Literal["ru", "kk", "en"] = "ru"

    @model_validator(mode="after")
    def clean(self):
        self.name = self.name.strip()
        if not self.name or len(self.queue_ids) != len(set(self.queue_ids)):
            raise ValueError("Name must not be blank; queue IDs must be distinct")
        return self


class PairInput(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


class IssueInput(BaseModel):
    queue_id: uuid.UUID
    request_id: uuid.UUID


async def active_org(db, org_id):
    org = await db.get(Organization, org_id)
    if org is None or org.deleted_at is not None or not org.is_active:
        raise ServiceError("kiosk_unavailable", 401)
    return org


def view(item):
    return {key: getattr(item, key) for key in (
        "id", "name", "queue_ids", "printing_enabled", "paper_width", "language",
        "pairing_code", "pairing_expires_at", "last_seen_at")} | {"paired": item.token_digest is not None}


async def new_code(db):
    # Serialize allocation globally, including code renewal on another kiosk.
    await db.execute(text("SELECT pg_advisory_xact_lock(71624101)"))
    for _ in range(30):
        code = f"{secrets.randbelow(1000000):06d}"
        if not await db.scalar(select(QueueKiosk.id).where(QueueKiosk.pairing_code == code)):
            return code
    raise ServiceError("kiosk_code_unavailable", 503)


async def validate_queues(db, org_id, ids):
    found = set((await db.scalars(select(Queue.id).where(Queue.id.in_(ids),
        Queue.organization_id == org_id, Queue.deleted_at.is_(None), Queue.is_active.is_(True)))).all())
    if found != set(ids):
        raise ServiceError("kiosk_queue_not_found", 404)


async def admin_kiosk(db, kiosk_id, org_id):
    await active_org(db, org_id)
    item = await db.scalar(select(QueueKiosk).where(QueueKiosk.id == kiosk_id,
        QueueKiosk.organization_id == org_id, QueueKiosk.deleted_at.is_(None)).with_for_update())
    if item is None:
        raise ServiceError("kiosk_not_found", 404)
    return item


async def audit(db, item, action, actor=None):
    await log_action(db, actor_type=AuditActorType.user if actor else AuditActorType.system,
        actor_id=actor.id if actor else None, organization_id=item.organization_id,
        action=f"queue_kiosk.{action}", entity_type="queue_kiosk", entity_id=item.id,
        payload={"name": item.name, "queue_ids": [str(id) for id in item.queue_ids],
                 "printing_enabled": item.printing_enabled, "paper_width": item.paper_width})


@router.get("/admin/queue-kiosks")
async def list_kiosks(db: AsyncSession = Depends(get_db), actor: User = Depends(current_admin),
                      org_id: uuid.UUID = Depends(current_organization_id)):
    await active_org(db, org_id)
    return [view(item) for item in await db.scalars(select(QueueKiosk).where(
        QueueKiosk.organization_id == org_id, QueueKiosk.deleted_at.is_(None)).order_by(QueueKiosk.created_at))]


@router.post("/admin/queue-kiosks", status_code=201)
async def add_kiosk(payload: KioskSettings, db: AsyncSession = Depends(get_db), actor: User = Depends(current_admin),
                     org_id: uuid.UUID = Depends(current_organization_id)):
    await active_org(db, org_id)
    await validate_queues(db, org_id, payload.queue_ids)
    item = QueueKiosk(organization_id=org_id, **payload.model_dump(), pairing_code=await new_code(db),
                      pairing_expires_at=utcnow() + timedelta(hours=24))
    db.add(item)
    await db.flush()
    await audit(db, item, "created", actor)
    await db.commit()
    return view(item)


@router.patch("/admin/queue-kiosks/{kiosk_id}")
async def update_kiosk(kiosk_id: uuid.UUID, payload: KioskSettings, db: AsyncSession = Depends(get_db),
                        actor: User = Depends(current_admin), org_id: uuid.UUID = Depends(current_organization_id)):
    item = await admin_kiosk(db, kiosk_id, org_id)
    await validate_queues(db, org_id, payload.queue_ids)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    await audit(db, item, "updated", actor)
    await db.commit()
    return view(item)


@router.post("/admin/queue-kiosks/{kiosk_id}/unpair")
async def unpair(kiosk_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: User = Depends(current_admin),
                  org_id: uuid.UUID = Depends(current_organization_id)):
    item = await admin_kiosk(db, kiosk_id, org_id)
    item.token_digest = None
    item.last_seen_at = None
    item.pairing_code = await new_code(db)
    item.pairing_expires_at = utcnow() + timedelta(hours=24)
    await audit(db, item, "unpaired", actor)
    await db.commit()
    return view(item)


@router.delete("/admin/queue-kiosks/{kiosk_id}", status_code=204)
async def archive(kiosk_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: User = Depends(current_admin),
                    org_id: uuid.UUID = Depends(current_organization_id)):
    item = await admin_kiosk(db, kiosk_id, org_id)
    item.deleted_at = utcnow()
    item.token_digest = item.pairing_code = None
    item.pairing_expires_at = None
    await audit(db, item, "archived", actor)
    await db.commit()


async def device(db: AsyncSession = Depends(get_db),
                 token: str | None = Header(default=None, alias="X-Queue-Kiosk-Token")):
    if not token or len(token) != 64:
        raise ServiceError("kiosk_not_paired", 401)
    item = await db.scalar(select(QueueKiosk).where(
        QueueKiosk.token_digest == hashlib.sha256(token.encode()).hexdigest(),
        QueueKiosk.deleted_at.is_(None)).with_for_update())
    if item is None:
        raise ServiceError("kiosk_not_paired", 401)
    await active_org(db, item.organization_id)
    return item


@router.post("/queue-kiosk/pair")
async def pair(payload: PairInput, request: Request, db: AsyncSession = Depends(get_db), redis: Redis = Depends(get_redis)):
    await enforce_rate_limit(redis, scope="queue-kiosk-pair", key=client_ip(request), limit=5)
    item = await db.scalar(select(QueueKiosk).where(QueueKiosk.pairing_code == payload.code,
        QueueKiosk.deleted_at.is_(None)).with_for_update())
    if item is None or item.pairing_expires_at is None or item.pairing_expires_at <= utcnow():
        raise ServiceError("kiosk_pairing_invalid", 404)
    await active_org(db, item.organization_id)
    token = secrets.token_hex(32)
    item.token_digest = hashlib.sha256(token.encode()).hexdigest()
    item.pairing_code = item.pairing_expires_at = None
    item.last_seen_at = utcnow()
    await audit(db, item, "paired")
    await db.commit()
    return {"device_token": token}


@router.get("/queue-kiosk/state")
async def state(item: QueueKiosk = Depends(device), db: AsyncSession = Depends(get_db)):
    org = await active_org(db, item.organization_id)
    now = utcnow()
    today = local_date(org.timezone, now)
    entries = []
    for queue in await db.scalars(select(Queue).where(Queue.id.in_(item.queue_ids),
            Queue.organization_id == org.id, Queue.deleted_at.is_(None), Queue.is_active.is_(True)).order_by(Queue.name)):
        issued = queue.last_ticket_number if queue.counter_date == today else 0
        reason = ("queue_closed" if queue.status == QueueStatus.closed else
                  "queue_paused" if queue.status == QueueStatus.paused else
                  "outside_schedule" if not await within_schedule(db, queue, today, now, org.timezone) else
                  "daily_limit_reached" if queue.daily_ticket_limit is not None and issued >= queue.daily_ticket_limit else None)
        entries.append({"id": queue.id, "name": queue.name, "unavailable_reason": reason})
    item.last_seen_at = now
    await db.commit()
    return {"id": item.id, "name": item.name, "organization_name": org.name,
            "language": item.language, "printing_enabled": item.printing_enabled,
            "paper_width": item.paper_width, "queues": entries}


def receipt_view(item, issue):
    return {**issue.receipt, "request_id": issue.request_id,
            "printing_enabled": item.printing_enabled, "paper_width": item.paper_width}


@router.post("/queue-kiosk/tickets", status_code=201)
async def issue_ticket(payload: IssueInput, item: QueueKiosk = Depends(device), db: AsyncSession = Depends(get_db),
                        redis: Redis = Depends(get_redis)):
    # The device row lock serializes retries, unpair and settings changes.
    old = await db.scalar(select(QueueKioskIssue).where(QueueKioskIssue.kiosk_id == item.id,
                                                      QueueKioskIssue.request_id == payload.request_id))
    if old:
        if old.receipt["queue_id"] != str(payload.queue_id):
            raise ServiceError("kiosk_request_conflict", 409)
        return receipt_view(item, old)
    if payload.queue_id not in item.queue_ids:
        raise ServiceError("kiosk_queue_not_found", 404)
    queue = await db.get(Queue, payload.queue_id)
    if queue is None or queue.organization_id != item.organization_id or queue.deleted_at is not None:
        raise ServiceError("kiosk_queue_not_found", 404)
    await enforce_rate_limit(redis, scope="queue-kiosk-issue", key=str(item.id), limit=20)
    org = await active_org(db, item.organization_id)
    ticket = await create_ticket(db, redis, organization=org, queue=queue, source=TicketSource.kiosk,
                                 actor_type=AuditActorType.system, actor_id=item.id, commit=False)
    ahead = await db.scalar(select(func.count()).select_from(Ticket).where(
        Ticket.queue_id == queue.id, Ticket.status == TicketStatus.waiting, Ticket.id != ticket.id))
    issue = QueueKioskIssue(kiosk_id=item.id, request_id=payload.request_id, ticket_id=ticket.id,
        receipt=jsonable_encoder({"ticket_id": ticket.id, "queue_id": queue.id, "queue_name": queue.name,
            "organization_name": org.name, "display_number": ticket.display_number, "created_at": ticket.created_at,
            "timezone": org.timezone, "ahead": ahead, "language": item.language}))
    db.add(issue)
    item.last_seen_at = utcnow()
    await db.commit()
    try:
        await publish_event(redis, queue.id, "ticket.created", ticket_id=str(ticket.id), status=ticket.status.value)
    except Exception:
        logger.warning("Kiosk ticket committed; realtime publication unavailable")
    return receipt_view(item, issue)


@router.get("/queue-kiosk/receipts/{request_id}")
async def get_receipt(request_id: uuid.UUID, item: QueueKiosk = Depends(device), db: AsyncSession = Depends(get_db)):
    issue = await db.scalar(select(QueueKioskIssue).where(QueueKioskIssue.kiosk_id == item.id,
                                                        QueueKioskIssue.request_id == request_id))
    if issue is None:
        raise ServiceError("kiosk_receipt_not_found", 404)
    return receipt_view(item, issue)


@router.post("/queue-kiosk/receipts/{request_id}/print")
async def print_receipt(request_id: uuid.UUID, item: QueueKiosk = Depends(device), db: AsyncSession = Depends(get_db)):
    issue = await db.scalar(select(QueueKioskIssue).where(QueueKioskIssue.kiosk_id == item.id,
                                                        QueueKioskIssue.request_id == request_id))
    if issue is None:
        raise ServiceError("kiosk_receipt_not_found", 404)
    if not item.printing_enabled:
        raise ServiceError("kiosk_printing_disabled", 409)
    await log_action(db, actor_type=AuditActorType.system, actor_id=item.id,
        organization_id=item.organization_id, action="queue_kiosk.print_requested",
        entity_type="ticket", entity_id=issue.ticket_id, payload={"kiosk_id": str(item.id)})
    await db.commit()
    return receipt_view(item, issue)
