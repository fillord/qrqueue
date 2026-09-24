import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_client
from app.config import settings
from app.clock import utcnow
from app.db import get_db
from app.models.trial_request import TrialRequest
from app.models.organization import Organization
from app.models.tv_screen import TVScreen
from app.schemas.trial_request import TrialRequestCreate
from app.models.client import Client
from app.models.enums import TicketStatus
from app.models.ticket import Ticket
from app.redis import get_redis
from app.schemas.public import (
    PushSubscribeRequest,
    PushUnsubscribeRequest,
    RateRequest,
    ScanRequest,
    ScanOptionsRequest,
    ScanOptionsOut,
    TicketDetailOut,
    TicketSummaryOut,
    VapidKeyOut,
)
from app.services import notifications
from app.services.scan import ScanError
from app.services.scan import scan as scan_service
from app.services.scan import queue_unavailability
from app.services.hall_scan import hall_queues
from app.services.qr_tokens import QRTokenError, issue_selection, verify_screen
from app.services.rate_limit import client_ip, enforce_rate_limit
from app.services.tickets import build_ticket_detail
from app.services.tickets import confirm as confirm_ticket
from app.services.tickets import leave as leave_ticket
from app.services.tickets import rate as rate_ticket

router = APIRouter(prefix="/public", tags=["public"])

_ACTIVE_STATUSES = (
    TicketStatus.waiting,
    TicketStatus.called,
    TicketStatus.confirmed,
    TicketStatus.serving,
)


@router.post("/scan-options", response_model=ScanOptionsOut)
async def scan_options_route(
    payload: ScanOptionsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> dict:
    await enforce_rate_limit(
        redis, scope="scan_options", key=client_ip(request), limit=settings.rate_limit_scan_per_minute
    )
    try:
        screen_id = verify_screen(payload.token)
    except QRTokenError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.reason})
    screen = await db.get(TVScreen, screen_id)
    if screen is None:
        raise HTTPException(status_code=422, detail={"code": "token_invalid"})
    queues = await hall_queues(db, screen)
    if not queues:
        raise HTTPException(status_code=422, detail={"code": "queue_unavailable"})
    organization = await db.get(Organization, screen.organization_id)
    now = utcnow()
    return {"organization_name": organization.name, "selection_token": issue_selection(screen.id),
            "queues": [{"id": queue.id, "name": queue.name, "status": queue.status,
                        "unavailable_reason": await queue_unavailability(db, queue, organization, now)}
                       for queue in queues]}


@router.post("/scan", response_model=TicketSummaryOut, status_code=status.HTTP_201_CREATED)
async def scan_route(
    payload: ScanRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    client: Client = Depends(current_client),
) -> Ticket:
    await enforce_rate_limit(
        redis, scope="scan", key=client_ip(request), limit=settings.rate_limit_scan_per_minute
    )
    try:
        ticket = await scan_service(
            db, redis, token=payload.token, client=client, selected_queue_id=payload.queue_id,
            lat=payload.lat, lng=payload.lng
        )
    except ScanError as exc:
        # No ticket-related rows were touched before this point, so it's safe
        # to still commit here — that persists the client cookie bookkeeping
        # from current_client even though the scan itself was rejected.
        await db.commit()
        status_code = (
            status.HTTP_409_CONFLICT
            if exc.code == "already_in_queue"
            else status.HTTP_422_UNPROCESSABLE_CONTENT
        )
        detail = {"code": exc.code}
        if exc.ticket_id is not None:
            detail["ticket_id"] = str(exc.ticket_id)
        raise HTTPException(status_code=status_code, detail=detail)

    await db.commit()
    return ticket


@router.get("/me/tickets", response_model=list[TicketSummaryOut])
async def my_tickets_route(
    db: AsyncSession = Depends(get_db),
    client: Client = Depends(current_client),
) -> list[Ticket]:
    result = await db.execute(
        select(Ticket)
        .where(Ticket.client_id == client.id, Ticket.status.in_(_ACTIVE_STATUSES))
        .order_by(Ticket.created_at)
    )
    tickets = list(result.scalars().all())
    await db.commit()
    return tickets


@router.get("/tickets/{ticket_id}", response_model=TicketDetailOut)
async def get_ticket_route(
    ticket_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    client: Client = Depends(current_client),
) -> dict:
    ticket = await db.get(Ticket, ticket_id)
    if ticket is None or ticket.client_id != client.id:
        await db.commit()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    detail = await build_ticket_detail(db, ticket)
    await db.commit()
    return detail


@router.post("/tickets/{ticket_id}/confirm", response_model=TicketDetailOut)
async def confirm_ticket_route(
    ticket_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    client: Client = Depends(current_client),
) -> dict:
    ticket = await db.get(Ticket, ticket_id)
    if ticket is None or ticket.client_id != client.id:
        await db.commit()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    ticket = await confirm_ticket(db, redis, ticket=ticket, client=client)
    detail = await build_ticket_detail(db, ticket)
    await db.commit()
    return detail


@router.post("/tickets/{ticket_id}/leave", response_model=TicketDetailOut)
async def leave_ticket_route(
    ticket_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    client: Client = Depends(current_client),
) -> dict:
    ticket = await db.get(Ticket, ticket_id)
    if ticket is None or ticket.client_id != client.id:
        await db.commit()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    ticket = await leave_ticket(db, redis, ticket=ticket, client=client)
    detail = await build_ticket_detail(db, ticket)
    await db.commit()
    return detail


@router.post("/tickets/{ticket_id}/rate", response_model=TicketDetailOut)
async def rate_ticket_route(
    ticket_id: uuid.UUID,
    payload: RateRequest,
    db: AsyncSession = Depends(get_db),
    client: Client = Depends(current_client),
) -> dict:
    ticket = await db.get(Ticket, ticket_id)
    if ticket is None or ticket.client_id != client.id:
        await db.commit()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    ticket = await rate_ticket(db, ticket=ticket, client=client, rating=payload.rating, comment=payload.comment)
    detail = await build_ticket_detail(db, ticket)
    await db.commit()
    return detail


@router.get("/push/vapid-key", response_model=VapidKeyOut)
async def get_vapid_key_route() -> dict:
    return {"public_key": settings.vapid_public_key}


@router.post("/push/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def subscribe_push_route(
    payload: PushSubscribeRequest,
    db: AsyncSession = Depends(get_db),
    client: Client = Depends(current_client),
) -> None:
    await notifications.subscribe(db, client, payload.endpoint, payload.keys.model_dump())
    await db.commit()


@router.delete("/push/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe_push_route(
    payload: PushUnsubscribeRequest,
    db: AsyncSession = Depends(get_db),
    client: Client = Depends(current_client),
) -> None:
    await notifications.unsubscribe(db, client, payload.endpoint)
    await db.commit()


@router.post("/trial-requests", status_code=201)
async def create_trial_request(
    payload: TrialRequestCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> dict:
    await enforce_rate_limit(
        redis, scope="trial", key=client_ip(request),
        limit=settings.rate_limit_trial_per_hour, window_seconds=3600,
    )
    db.add(TrialRequest(**payload.model_dump()))
    await db.commit()
    return {"accepted": True}
