import asyncio
import logging
import secrets
from datetime import timedelta
from zoneinfo import ZoneInfo

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.config import settings
from app.db import async_session_factory
from app.models.attendance import Employee
from app.models.organization import Organization
from app.services import telegram
from app.services.workforce import build_report

logger = logging.getLogger(__name__)
_LATE = {
    "ru": "Ваша смена началась в {start}. Приход ещё не отмечен. Если вы уже на работе, отметьте приход или обратитесь к администратору.",
    "kk": "Ауысымыңыз {start} басталды. Келу белгісі жоқ. Жұмыс орнында болсаңыз, келуіңізді белгілеңіз немесе әкімшіге хабарласыңыз.",
    "en": "Your shift started at {start}. No arrival is recorded. If you are already at work, check in or contact your administrator.",
}
_ARRIVED_LATE = {
    "ru": "Зафиксировано опоздание на {minutes} мин. Начало смены: {start}. Если отметка ошибочна, обратитесь к администратору.",
    "kk": "{minutes} минут кешігу тіркелді. Ауысымның басталуы: {start}. Белгі қате болса, әкімшіге хабарласыңыз.",
    "en": "An arrival {minutes} minutes late was recorded. Shift start: {start}. Contact your administrator if this is incorrect.",
}


async def run_reminders_once(db: AsyncSession, redis: Redis, *, now=None):
    if not telegram.enabled():
        return
    now = now or utcnow()
    orgs = (await db.scalars(select(Organization).join(Employee, Employee.organization_id == Organization.id).where(
        Organization.is_active.is_(True), Organization.deleted_at.is_(None), Employee.is_active.is_(True),
        Employee.deleted_at.is_(None), Employee.telegram_chat_id.is_not(None)).distinct())).all()
    for org in orgs:
        day = now.astimezone(ZoneInfo(org.timezone)).date()
        report = await build_report(db, org, day, day)
        for row in report["rows"]:
            start, end = row["planned_start"], row["planned_end"]
            if not start or not end or not (start + timedelta(minutes=settings.attendance_late_notify_minutes) <= now < end):
                continue
            employee = await db.get(Employee, row["employee_id"])
            if not employee.is_active or not employee.telegram_chat_id:
                continue
            if row["first_in"] and row["late_minutes"] < settings.attendance_late_notify_minutes:
                continue
            key = f"telegram:late:{employee.id}:{day}:{start.isoformat()}"
            if not await redis.set(key, "sent", nx=True, ex=172800):
                continue
            messages = _ARRIVED_LATE if row["first_in"] else _LATE
            message = messages.get(org.default_language, messages["ru"]).format(
                start=start.strftime("%H:%M"), minutes=row["late_minutes"])
            if not await telegram.send_message(employee.telegram_chat_id, message):
                await redis.delete(key)


async def reminder_loop(redis: Redis):
    while True:
        try:
            async with async_session_factory() as db:
                await run_reminders_once(db, redis)
        except Exception:
            logger.warning("Attendance reminder tick failed")
        await asyncio.sleep(60)


async def polling_loop(redis: Redis):
    # One polling consumer across app processes. The offset survives restarts.
    lease_key = "telegram:poller"
    renew = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], 90) else return 0 end"
    release = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"
    while True:
        token = secrets.token_hex(16)
        if not await redis.set(lease_key, token, nx=True, ex=90):
            await asyncio.sleep(15)
            continue
        try:
            while await redis.eval(renew, 1, lease_key, token):
                offset = int(await redis.get("telegram:offset") or 0)
                updates = await telegram.bot_call("getUpdates", {"offset": offset, "timeout": 25,
                    "allowed_updates": ["message", "callback_query"], "limit": 50})
                if updates is None:
                    await asyncio.sleep(10)
                    continue
                for update in updates:
                    if not await redis.eval(renew, 1, lease_key, token):
                        break
                    async with async_session_factory() as db:
                        await telegram.handle_update(db, redis, update)
                    await redis.set("telegram:offset", str(update["update_id"] + 1))
        except Exception:
            logger.warning("Telegram polling interrupted")
            await asyncio.sleep(10)
        finally:
            await redis.eval(release, 1, lease_key, token)
