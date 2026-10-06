"""Optional dedicated OmniBook bot. No credential or Telegram URL is logged."""
import json
import logging
import re
import secrets
import uuid

import httpx
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.attendance import Employee
from app.models.client import Client
from app.models.enums import AuditActorType
from app.models.organization import Organization
from app.models.ticket import Ticket
from app.services.audit import log_action
from app.services.errors import ServiceError

logger = logging.getLogger(__name__)
LINK_TTL = 600
_LABELS = {
    "ru": ("Открыть талон", "Отменить талон", "Подтвердить отмену", "Отменить этот талон?", "Талон отменён.", "Уведомления подключены. /stop — отключить.", "Уведомления отключены.", "Ссылка устарела. Получите новую ссылку в OmniBook.", "Действие недоступно."),
    "kk": ("Талонды ашу", "Талоннан бас тарту", "Бас тартуды растау", "Осы талоннан бас тартасыз ба?", "Талон жойылды.", "Хабарламалар қосылды. /stop — өшіру.", "Хабарламалар өшірілді.", "Сілтеме ескірді. OmniBook жүйесінен жаңа сілтеме алыңыз.", "Әрекет қолжетімсіз."),
    "en": ("Open ticket", "Cancel ticket", "Confirm cancellation", "Cancel this ticket?", "Ticket cancelled.", "Notifications connected. /stop — disconnect.", "Notifications disconnected.", "Link expired. Get a new link in OmniBook.", "Action unavailable."),
}


def enabled() -> bool:
    return bool(settings.telegram_bot_token and settings.telegram_bot_username
                and re.fullmatch(r"[A-Za-z0-9_]{5,32}", settings.telegram_bot_username))


async def bot_call(method: str, payload: dict):
    if not enabled():
        return None
    try:
        # httpx's INFO request logger contains the token in the URL: disable it.
        logging.getLogger("httpx").setLevel(logging.WARNING)
        async with httpx.AsyncClient(timeout=35 if method == "getUpdates" else 10) as client:
            response = await client.post(f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}", json=payload)
            result = response.json()
            if response.status_code == 200 and result.get("ok"):
                return result.get("result")
        logger.warning("Telegram operation failed: %s", method)
    except Exception:
        logger.warning("Telegram operation unavailable: %s", method)
    return None


async def send_message(chat_id: int, text: str, markup: dict | None = None) -> bool:
    payload = {"chat_id": chat_id, "text": text}
    if markup:
        payload["reply_markup"] = markup
    return await bot_call("sendMessage", payload) is not None


async def issue_link(redis: Redis, *, kind: str, subject_id: uuid.UUID, ticket_id: uuid.UUID | None = None) -> dict:
    if not enabled():
        raise ServiceError("telegram_not_configured", 503)
    code = secrets.token_urlsafe(24)
    await redis.set(f"telegram:link:{code}", json.dumps({"kind": kind, "id": str(subject_id),
        "ticket_id": str(ticket_id) if ticket_id else None}), ex=LINK_TTL)
    return {"url": f"https://t.me/{settings.telegram_bot_username}?start={code}", "expires_in": LINK_TTL}


def ticket_buttons(ticket_id: str, language: str | None) -> dict:
    labels = _LABELS.get(language, _LABELS["ru"])
    domain = settings.app_domain.removeprefix("https://").removeprefix("http://").rstrip("/")
    return {"inline_keyboard": [[{"text": labels[0], "url": f"https://{domain}/t/{ticket_id}"}],
                                [{"text": labels[1], "callback_data": f"ask:{ticket_id}"}]]}


async def notify_ticket(db: AsyncSession, client_id: uuid.UUID, payload: dict):
    if not enabled():
        return
    client = await db.get(Client, client_id)
    if client and client.telegram_chat_id:
        await send_message(client.telegram_chat_id, f"{payload['title']}\n{payload['body']}",
                           ticket_buttons(payload["ticket_id"], client.language))


async def handle_update(db: AsyncSession, redis: Redis, update: dict):
    message = update.get("message")
    callback = update.get("callback_query")
    chat = (message or (callback or {}).get("message", {})).get("chat", {})
    if chat.get("type") != "private" or not isinstance(chat.get("id"), int):
        return
    chat_id = chat["id"]
    if message:
        text = message.get("text", "")
        labels = _LABELS.get(message.get("from", {}).get("language_code"), _LABELS["ru"])
        if text == "/stop":
            for model in (Client, Employee):
                for subject in (await db.scalars(select(model).where(model.telegram_chat_id == chat_id))).all():
                    subject.telegram_chat_id = None
                    if isinstance(subject, Employee):
                        await log_action(db, actor_type=AuditActorType.system, actor_id=None,
                            action="attendance.telegram.disconnected", entity_type="employee", entity_id=subject.id,
                            organization_id=subject.organization_id)
            await db.commit()
            await send_message(chat_id, labels[6])
        elif text.startswith("/start "):
            code = text.split(maxsplit=1)[1]
            if not re.fullmatch(r"[A-Za-z0-9_-]{32}", code):
                return
            raw = await redis.getdel(f"telegram:link:{code}")
            if not raw:
                await send_message(chat_id, labels[7])
                return
            link = json.loads(raw)
            model = Client if link["kind"] == "client" else Employee
            subject = await db.get(model, uuid.UUID(link["id"]))
            if subject is None:
                return
            if isinstance(subject, Employee):
                org = await db.get(Organization, subject.organization_id)
                if subject.deleted_at or not subject.is_active or not org or not org.is_active or org.deleted_at:
                    return
                labels = _LABELS.get(org.default_language, _LABELS["ru"])
                await log_action(db, actor_type=AuditActorType.system, actor_id=None,
                    action="attendance.telegram.connected", entity_type="employee", entity_id=subject.id,
                    organization_id=subject.organization_id)
            else:
                ticket = await db.get(Ticket, uuid.UUID(link["ticket_id"])) if link.get("ticket_id") else None
                org = await db.get(Organization, ticket.organization_id) if ticket and ticket.client_id == subject.id else None
                if not org or not org.is_active or org.deleted_at:
                    return
                labels = _LABELS.get(subject.language, _LABELS["ru"])
            subject.telegram_chat_id = chat_id
            await db.commit()
            await send_message(chat_id, labels[5])
            if model is Client and link.get("ticket_id"):
                from app.services.tickets import build_ticket_detail
                ticket = await db.get(Ticket, uuid.UUID(link["ticket_id"]))
                if ticket and ticket.client_id == subject.id:
                    detail = await build_ticket_detail(db, ticket)
                    position = detail.get("position")
                    ahead = max(0, position - 1) if position is not None else None
                    from app.services.notifications import ticket_message
                    if ticket.status.value == "waiting" and ahead is not None:
                        await notify_ticket(db, subject.id, ticket_message(subject.language, "approaching", ticket, ahead=ahead))
                    elif ticket.status.value == "called":
                        cabinet = detail.get("cabinet")
                        await notify_ticket(db, subject.id, ticket_message(subject.language, "called", ticket,
                            cabinet.get("label") if cabinet else None))
        return
    if not callback:
        return
    data = callback.get("data", "")
    match = re.fullmatch(r"(ask|leave):([a-f0-9-]{36})", data)
    labels = _LABELS["ru"]
    answer = labels[8]
    if match:
        try:
            ticket_id = uuid.UUID(match[2])
        except ValueError:
            ticket_id = None
        ticket = await db.get(Ticket, ticket_id) if ticket_id else None
        owner = await db.get(Client, ticket.client_id) if ticket and ticket.client_id else None
        org = await db.get(Organization, ticket.organization_id) if ticket else None
        if owner and owner.telegram_chat_id == chat_id and org and org.is_active and not org.deleted_at:
            labels = _LABELS.get(owner.language, labels)
            if ticket.status.value in ("waiting", "called", "confirmed"):
                if match[1] == "ask":
                    await send_message(chat_id, labels[3], {"inline_keyboard": [[{
                        "text": labels[2], "callback_data": f"leave:{ticket.id}"}]]})
                    answer = labels[3]
                else:
                    from app.services.tickets import leave
                    try:
                        await leave(db, redis, ticket=ticket, client=owner)
                        answer = labels[4]
                        await send_message(chat_id, answer)
                    except ServiceError:
                        await db.rollback()
                        answer = labels[8]
    await bot_call("answerCallbackQuery", {"callback_query_id": callback["id"], "text": answer})
