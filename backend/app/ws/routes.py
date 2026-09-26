import asyncio
import uuid
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_selected_cabinet, resolve_session_user
from app.api.tv import screen_organization_is_active
from app.config import settings
from app.db import get_db
from app.models.cabinet import Cabinet
from app.models.enums import UserRole
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.models.tv_screen import TVScreen
from app.models.user import User
from app.redis import redis_client
from app.schemas.operator import OperatorQueueOut
from app.schemas.public import TicketDetailOut
from app.schemas.tv import TVStateOut
from app.services.errors import ServiceError
from app.services.realtime import organization_channel, queue_channel
from app.services.operator_queue import build_operator_queue_snapshot
from app.services.tickets import build_ticket_detail
from app.services.tv_screens import get_screen_by_device_token
from app.services.tv_state import build_tv_state
from app.ws.manager import manager

router = APIRouter()

_POLICY_VIOLATION = 1008


class AccessRevoked(Exception):
    """Raised by a build_message when the connection's credentials no longer
    hold (user deactivated, operator unassigned, organization deactivated):
    the socket is closed so a live connection cannot outlive its access."""


BuildMessage = Callable[[dict], Awaitable[dict | None]]
ResolveChannels = Callable[[], Awaitable[list[str]]]

# Every route below takes `db: AsyncSession = Depends(get_db)` — the same
# dependency the REST routes use — and keeps that one session for the
# connection's whole lifetime (auth check, initial snapshot, every later
# push). That's what lets tests override get_db and see their fixture data
# from inside a WS handler. Two costs are paid for explicitly: the identity
# map goes stale as other requests change the same rows, so every recompute
# starts with `db.expire_all()`; and an idle session must not pin a pooled
# connection while it waits for the next event, so `_release(db)` ends the
# read transaction after every snapshot (see ARCHITECTURE.md section 5 —
# a hall of visitors on /ws/ticket must never starve REST of connections).


async def _release(db: AsyncSession) -> None:
    await db.commit()


async def _pump(
    websocket: WebSocket,
    channels: list[str],
    build_message: BuildMessage,
    db: AsyncSession,
    resolve_channels: ResolveChannels | None = None,
) -> None:
    """Sits on `channels` (manager.subscribe) and, for every event fanned out
    to any of them, sends whatever `build_message` computes for it — skipping
    the send when it returns None. Runs until the client disconnects, or
    build_message raises AccessRevoked.

    `resolve_channels`, when given, is re-run after every event so a hall
    screen picks up queues created after it connected (and drops removed
    ones) without reconnecting.

    A concurrent receive_text() is what detects that disconnect (clients
    otherwise never send anything on these one-way channels); it's raced
    against the next queued event on every iteration so neither starves.
    """
    queues = {channel: manager.subscribe(channel) for channel in channels}
    try:
        while True:
            receive_task = asyncio.ensure_future(websocket.receive_text())
            get_tasks = {asyncio.ensure_future(queue.get()): channel for channel, queue in queues.items()}
            done, pending = await asyncio.wait(
                {receive_task, *get_tasks}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)

            if receive_task in done:
                receive_task.result()

            for task in done:
                if task is receive_task:
                    continue
                event = task.result()
                try:
                    message = await build_message(event)
                    if resolve_channels is not None:
                        # Re-subscribe before the client sees this snapshot, so
                        # anything it does next on a newly listed queue is heard.
                        wanted = set(await resolve_channels())
                        for channel in list(queues):
                            if channel not in wanted:
                                manager.unsubscribe(channel, queues.pop(channel))
                        for channel in wanted - queues.keys():
                            queues[channel] = manager.subscribe(channel)
                finally:
                    await _release(db)
                if message is not None:
                    await websocket.send_json(message)
    except WebSocketDisconnect:
        pass
    except AccessRevoked:
        await websocket.close(code=_POLICY_VIOLATION)
    finally:
        for channel, queue in queues.items():
            manager.unsubscribe(channel, queue)


async def _authenticate_operator(websocket: WebSocket, db: AsyncSession) -> tuple[User, Cabinet] | None:
    user = await resolve_session_user(db, websocket.cookies.get(settings.jwt_cookie_name))
    if user is None or user.role != UserRole.operator:
        return None
    cabinet = await resolve_selected_cabinet(db, redis_client, user)
    if cabinet is None or cabinet.queue_id is None:
        return None
    return user, cabinet


@router.websocket("/ws/ticket/{ticket_id}")
async def ws_ticket(
    websocket: WebSocket, ticket_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> None:
    """Visitor's own ticket — ownership is the same `qc` cookie check GET
    /public/tickets/{id} does. Pushes ticket.updated/position/queue.status
    by recomputing the same TicketDetailOut the REST endpoint returns,
    since almost any event on the queue's channel (another ticket called,
    the queue pausing) can move this ticket's position or now_serving.
    """
    qc = websocket.cookies.get("qc")
    client_id: uuid.UUID | None = None
    if qc:
        try:
            client_id = uuid.UUID(qc)
        except ValueError:
            client_id = None

    ticket = await db.get(Ticket, ticket_id)
    if ticket is None or client_id is None or ticket.client_id != client_id:
        await websocket.close(code=_POLICY_VIOLATION)
        return
    queue_id = ticket.queue_id
    snapshot = TicketDetailOut.model_validate(await build_ticket_detail(db, ticket)).model_dump(
        mode="json"
    )
    await _release(db)

    await websocket.accept()
    await websocket.send_json(snapshot)

    async def build_message(_event: dict) -> dict | None:
        db.expire_all()
        current = await db.get(Ticket, ticket_id)
        if current is None:
            return None
        detail = await build_ticket_detail(db, current)
        return TicketDetailOut.model_validate(detail).model_dump(mode="json")

    await _pump(websocket, [queue_channel(queue_id)], build_message, db)


@router.websocket("/ws/operator")
async def ws_operator(websocket: WebSocket, db: AsyncSession = Depends(get_db)) -> None:
    """Operator's own cabinet queue — same auth shape as the REST operator
    routes (JWT cookie + role) plus the Redis-stored cabinet selection
    current_cabinet uses. Pushes the same OperatorQueueOut GET /operator/queue
    returns.
    """
    identity = await _authenticate_operator(websocket, db)
    if identity is None:
        await websocket.close(code=_POLICY_VIOLATION)
        return
    _user, cabinet = identity
    cabinet_id = cabinet.id
    queue_id = cabinet.queue_id

    async def build_message(_event: dict) -> dict | None:
        db.expire_all()
        current = await _authenticate_operator(websocket, db)
        if current is None or current[1].id != cabinet_id:
            raise AccessRevoked
        current_cabinet = current[1]
        try:
            snapshot = await build_operator_queue_snapshot(db, current_cabinet)
        except ServiceError:
            return None
        return OperatorQueueOut.model_validate(snapshot).model_dump(mode="json")

    await websocket.accept()
    initial = await build_message({})
    await _release(db)
    if initial is not None:
        await websocket.send_json(initial)

    await _pump(
        websocket,
        [queue_channel(queue_id), organization_channel(cabinet.organization_id)],
        build_message,
        db,
    )


@router.websocket("/ws/tv")
async def ws_tv(
    websocket: WebSocket,
    device_token: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> None:
    """TV screen — device_token via header (non-browser clients) or query
    param (browsers can't set custom headers on a WebSocket handshake).
    Watches its own queue, or every active queue of the organization for a
    null-queue hall screen.
    """
    token = websocket.headers.get("x-device-token") or device_token
    screen = await get_screen_by_device_token(db, token) if token else None
    if screen is None or not await screen_organization_is_active(db, screen):
        await websocket.close(code=_POLICY_VIOLATION)
        return
    organization_id = screen.organization_id
    queue_id = screen.queue_id
    screen_id = screen.id
    snapshot = TVStateOut.model_validate(await build_tv_state(db, screen)).model_dump(mode="json")

    async def resolve_channels() -> list[str]:
        # The organization channel carries branding edits and, for a hall
        # screen, "a queue was created" — after which the queue list is
        # re-resolved so the new queue's own events reach this socket too.
        if queue_id is not None:
            return [queue_channel(queue_id), organization_channel(organization_id)]
        result = await db.execute(
            select(Queue.id).where(Queue.organization_id == organization_id, Queue.is_active.is_(True))
        )
        return [queue_channel(row[0]) for row in result.all()] + [organization_channel(organization_id)]

    channels = await resolve_channels()
    await _release(db)

    await websocket.accept()
    await websocket.send_json(snapshot)

    async def build_message(_event: dict) -> dict | None:
        db.expire_all()
        current_screen = await db.get(TVScreen, screen_id)
        if current_screen is None or current_screen.device_token != token or not await screen_organization_is_active(db, current_screen):
            raise AccessRevoked
        return TVStateOut.model_validate(await build_tv_state(db, current_screen)).model_dump(
            mode="json"
        )

    await _pump(websocket, channels, build_message, db, resolve_channels if queue_id is None else None)
