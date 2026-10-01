import json
import logging

import httpx
from fastapi import APIRouter, Depends
from redis.asyncio import Redis

from app.api.deps import current_user
from app.assistant_catalog import action_allowed, catalog_text
from app.config import settings
from app.models.user import User
from app.redis import get_redis
from app.schemas.assistant import AssistantAnswer, AssistantQuestion, AssistantStatus
from app.services.errors import ServiceError
from app.services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/assistant", tags=["assistant"])
logger = logging.getLogger(__name__)

LANGUAGE_NAMES = {"ru": "Russian", "kk": "Kazakh", "en": "English"}

INTERFACE_NAMES = {
    "ru": (
        "Настройки организации; Настройки профиля; Главная; Учёт рабочего времени; "
        "Центр проблем; Очереди; Кабинеты; Сотрудники; ТВ-экраны; Расписание и ролики; "
        "Дневной отчёт; Аналитика; Журнал действий"
    ),
    "kk": (
        "Ұйым баптаулары; Профиль баптаулары; Басты бет; Жұмыс уақытын есепке алу; "
        "Мәселелер орталығы; Кезектер; Кабинеттер; Қызметкерлер; ТВ-экрандар; "
        "Кесте және бейнелер; Күндік есеп; Аналитика; Әрекеттер журналы"
    ),
    "en": (
        "Organization settings; Profile settings; Overview; Attendance; Problem center; "
        "Queues; Cabinets; Staff; TV screens; Schedules and media; Daily report; Analytics; Activity log"
    ),
}

SYSTEM_PROMPT = """You are Navigator, the in-product guide for OmniBook, a queue,
TV signage and staff attendance system. Help the signed-in staff member understand the current
screen, find the right section and complete forms correctly. Answer only about using OmniBook. Never claim that you
changed, deleted, created or approved anything. Never request passwords, authentication codes,
face images, patient names, ticket data or other personal data. If the user asks you to perform
an action, explain the exact safe steps in the interface, including which fields to fill and which
button completes the action. Use short plain sentences and at most one short list. Use only names
and facts from the supplied site map. Do not invent pages, buttons, fields or capabilities.

For an organization administrator there are two different settings areas. Organization settings
is the sidebar item under the settings group. It changes organization name,
  logo, brand color, default language, timezone and the one-active-ticket rule.
Profile settings opens by clicking the signed-in user's name/avatar in the top-right corner.
  It changes that user's name, photo, password and assistant preferences.
When describing navigation, say which exact section to open and where it is. Choose the single
best action_id from the supplied map. If the question is informational or no action matches, use
null. Return only JSON with this shape: {"answer":"...","action_id":"catalog.id or null"}.
The interface will use action_id to highlight the destination. If the map does not contain the
requested function, say that it is unavailable instead of guessing."""


def _parse_model_answer(raw: str, role: str) -> tuple[str, str | None]:
    text = raw.strip()
    if text.startswith("```"):
        text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return raw.strip(), None
    if not isinstance(parsed, dict) or not isinstance(parsed.get("answer"), str):
        return raw.strip(), None
    action_id = parsed.get("action_id")
    if not isinstance(action_id, str) or not action_allowed(action_id, role):
        action_id = None
    return parsed["answer"].strip(), action_id


def _available_for(user: User) -> bool:
    return bool(
        settings.assistant_ai_enabled
        and settings.gemini_api_key
        and user.assistant_enabled
        and user.assistant_ai_enabled
    )


@router.get("/status", response_model=AssistantStatus)
async def assistant_status(user: User = Depends(current_user)) -> AssistantStatus:
    return AssistantStatus(available=_available_for(user))


@router.post("/chat", response_model=AssistantAnswer)
async def assistant_chat(
    payload: AssistantQuestion,
    user: User = Depends(current_user),
    redis: Redis = Depends(get_redis),
) -> AssistantAnswer:
    if not user.assistant_enabled:
        raise ServiceError("assistant_disabled", 403)
    if not user.assistant_ai_enabled:
        raise ServiceError("assistant_ai_disabled", 403)
    if not settings.assistant_ai_enabled or not settings.gemini_api_key:
        raise ServiceError("assistant_ai_unavailable", 503)

    await enforce_rate_limit(
        redis,
        scope="assistant",
        key=str(user.id),
        limit=settings.rate_limit_assistant_per_minute,
    )
    context = (
        f"Reply in {LANGUAGE_NAMES[payload.locale]}. "
        f"Exact interface labels in that language: {INTERFACE_NAMES[payload.locale]}. "
        f"User role: {user.role.value}. Current route: {payload.path}. "
        f"Question: {payload.message}\n\n{catalog_text(user.role.value)}"
    )
    body = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": context}]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 500,
            "responseMimeType": "application/json",
        },
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent"
    try:
        async with httpx.AsyncClient(timeout=settings.gemini_timeout_seconds) as client:
            response = await client.post(
                url,
                headers={"x-goog-api-key": settings.gemini_api_key, "Content-Type": "application/json"},
                json=body,
            )
            response.raise_for_status()
            data = response.json()
        parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        raw_answer = "\n".join(part.get("text", "") for part in parts if part.get("text")).strip()
        answer, action_id = _parse_model_answer(raw_answer, user.role.value)
        if not answer:
            raise ValueError("empty assistant answer")
        return AssistantAnswer(answer=answer, action_id=action_id)
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
        logger.warning("Gemini assistant request failed", exc_info=True)
        raise ServiceError("assistant_ai_unavailable", 503) from None
