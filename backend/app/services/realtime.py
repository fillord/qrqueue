import asyncio
import json
import logging
import uuid
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import event
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_PENDING_KEY = "pending_events"
_background_tasks: set[asyncio.Task] = set()


def queue_channel(queue_id: uuid.UUID) -> str:
    return f"queue:{queue_id}"


def organization_channel(organization_id: uuid.UUID) -> str:
    """Organization-wide changes (a queue created/renamed, branding edited)
    that no single queue channel would carry — hall screens subscribe here."""
    return f"org:{organization_id}"


def _encode(event_name: str, fields: dict[str, Any]) -> str:
    return json.dumps({"event": event_name, **fields}, default=str)


async def publish_event(redis: Redis, queue_id: uuid.UUID, event_name: str, **fields: Any) -> None:
    """Publishes to queue:{queue_id} right now — see ARCHITECTURE.md section 5.
    Call it only after the state it announces is committed; inside a
    transaction use defer_event() instead."""
    await redis.publish(queue_channel(queue_id), _encode(event_name, fields))


async def publish_organization_event(
    redis: Redis, organization_id: uuid.UUID, event_name: str, **fields: Any
) -> None:
    await redis.publish(organization_channel(organization_id), _encode(event_name, fields))


def defer_event(db, channel: str, event_name: str, **fields: Any) -> None:
    """Queues a message on the session; it is published right after the
    session commits (and dropped on rollback), so a subscriber that re-reads
    state in response can never observe the pre-commit rows."""
    db.info.setdefault(_PENDING_KEY, []).append((channel, _encode(event_name, fields)))


def _drain(session: Session) -> list[tuple[str, str]]:
    pending = session.info.get(_PENDING_KEY) or []
    session.info[_PENDING_KEY] = []
    return pending


@event.listens_for(Session, "after_commit")
def _publish_pending(session: Session) -> None:
    pending = _drain(session)
    if not pending:
        return
    from app.redis import redis_client  # local import: app.redis must not import this module at load

    async def _send() -> None:
        for channel, message in pending:
            try:
                await redis_client.publish(channel, message)
            except Exception:
                logger.exception("failed to publish deferred event on %s", channel)

    task = asyncio.get_running_loop().create_task(_send())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


@event.listens_for(Session, "after_rollback")
def _discard_pending(session: Session) -> None:
    _drain(session)
