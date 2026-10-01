import logging

import httpx
from fastapi import APIRouter, Depends
from redis.asyncio import Redis

from app.api.deps import current_user
from app.config import settings
from app.models.user import User
from app.redis import get_redis
from app.schemas.assistant import AssistantAnswer, AssistantQuestion, AssistantStatus
from app.services.errors import ServiceError
from app.services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/assistant", tags=["assistant"])
logger = logging.getLogger(__name__)

LANGUAGE_NAMES = {"ru": "Russian", "kk": "Kazakh", "en": "English"}

SYSTEM_PROMPT = """You are Navigator, a concise in-product guide for OmniBook, a queue,
TV signage and staff attendance system. Help the signed-in staff member understand the current
screen and find the right section. Answer only about using OmniBook. Never claim that you
changed, deleted, created or approved anything. Never request passwords, authentication codes,
face images, patient names, ticket data or other personal data. If the user asks you to perform
an action, explain the safe steps in the interface. Use short plain sentences and at most one
short list. Use the exact interface names below and do not invent menu names.

For an organization administrator there are two different settings areas:
- "Organization settings" is the sidebar item under Settings. It changes organization name,
  logo, brand color, default language, timezone and the one-active-ticket rule.
- "Profile settings" opens by clicking the signed-in user's name/avatar in the top-right corner.
  It changes that user's name, photo, password and assistant preferences.

Other exact administrator section names are: Overview, Attendance, Problem center, Queues,
Cabinets, Staff, TV screens, Schedule and media, Daily report, Analytics and Action log.
When describing navigation, say which exact section to open and where it is. The interface will
offer a separate visual button that highlights the destination after your answer. If uncertain,
say so and direct the user to their organization administrator."""


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
        f"User role: {user.role.value}. Current route: {payload.path}. "
        f"Question: {payload.message}"
    )
    body = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": context}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 320},
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
        answer = "\n".join(part.get("text", "") for part in parts if part.get("text")).strip()
        if not answer:
            raise ValueError("empty assistant answer")
        return AssistantAnswer(answer=answer)
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
        logger.warning("Gemini assistant request failed", exc_info=True)
        raise ServiceError("assistant_ai_unavailable", 503) from None
