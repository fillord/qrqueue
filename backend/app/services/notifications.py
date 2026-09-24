import asyncio
import json
import logging
import uuid

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.client import Client, PushSubscription

logger = logging.getLogger(__name__)

_STALE_STATUS_CODES = {404, 410}


async def send_push(db: AsyncSession, subscription: PushSubscription, payload: dict) -> None:
    """Best-effort: never raises. A 404/410 from the push service means the
    browser dropped the subscription — deleted here so it stops being
    retried forever. Any other failure is just logged.
    """
    if not settings.vapid_private_key or not settings.vapid_public_key:
        return

    try:
        await asyncio.to_thread(
            webpush,
            subscription_info={"endpoint": subscription.endpoint, "keys": subscription.keys},
            data=json.dumps(payload),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject or "mailto:admin@example.com"},
        )
    except WebPushException as exc:
        status_code = getattr(exc.response, "status_code", None)
        if status_code in _STALE_STATUS_CODES:
            await db.delete(subscription)
            await db.flush()
            logger.info("dropped stale push subscription %s (%s)", subscription.id, status_code)
        else:
            logger.warning("push delivery failed (%s): %s", status_code, exc)
    except Exception:
        logger.exception("unexpected push delivery failure for subscription %s", subscription.id)


async def notify_client(db: AsyncSession, client_id: uuid.UUID, payload: dict) -> None:
    result = await db.execute(select(PushSubscription).where(PushSubscription.client_id == client_id))
    for subscription in result.scalars().all():
        await send_push(db, subscription, payload)


async def subscribe(db: AsyncSession, client: Client, endpoint: str, keys: dict) -> PushSubscription:
    """`endpoint` is unique per browser+device, not per client — resubscribing
    (e.g. after clearing the ticket cookie) re-points the same row at the new
    client rather than erroring on the unique constraint.
    """
    result = await db.execute(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    existing = result.scalar_one_or_none()
    if existing is not None:
        existing.client_id = client.id
        existing.keys = keys
        await db.flush()
        return existing

    subscription = PushSubscription(client_id=client.id, endpoint=endpoint, keys=keys)
    db.add(subscription)
    await db.flush()
    return subscription


async def unsubscribe(db: AsyncSession, client: Client, endpoint: str) -> None:
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.endpoint == endpoint, PushSubscription.client_id == client.id
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
        await db.flush()


_MESSAGES = {
    "ru": {
        "called": ("Вас вызывают — {number}", "Подойдите к {cabinet}."),
        "approaching": ("Скоро ваша очередь — {number}", "Вы в числе первых трёх — будьте рядом."),
        "missed": ("Вызов пропущен — {number}", "Обратитесь к сотруднику, чтобы вернуться в очередь."),
        "desk": "окну приёма",
    },
    "kk": {
        "called": ("Сізді шақырады — {number}", "{cabinet} келіңіз."),
        "approaching": ("Кезегіңіз жақындады — {number}", "Сіз алғашқы үштіктесіз — жақын жерде болыңыз."),
        "missed": ("Шақыру өткізіліп алынды — {number}", "Кезекке оралу үшін қызметкерге хабарласыңыз."),
        "desk": "қабылдау терезесіне",
    },
    "en": {
        "called": ("Your turn — {number}", "Please go to {cabinet}."),
        "approaching": ("Your turn is approaching — {number}", "You are among the first three — please stay nearby."),
        "missed": ("Missed call — {number}", "Contact a staff member to return to the queue."),
        "desk": "the service desk",
    },
}


def ticket_message(language, kind, ticket, cabinet=None):
    messages = _MESSAGES.get(language, _MESSAGES["ru"])
    title, body = messages[kind]
    values = {"number": ticket.display_number, "cabinet": cabinet or messages["desk"]}
    return {"title": title.format(**values), "body": body.format(**values), "ticket_id": str(ticket.id)}
