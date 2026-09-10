from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def local_date(timezone_name: str, now: datetime | None = None) -> date:
    now = now or utcnow()
    return now.astimezone(ZoneInfo(timezone_name)).date()
