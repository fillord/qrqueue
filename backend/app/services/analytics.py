import uuid
from datetime import date, datetime, time as dt_time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import TicketStatus
from app.models.ticket import Ticket
from app.models.user import User

_HOURS = range(24)
_WEEKDAYS = range(7)  # 0 = Monday .. 6 = Sunday, matching queue_schedules.weekday


def _range_to_utc(timezone_name: str, date_from: date, date_to: date) -> tuple[datetime, datetime]:
    tz = ZoneInfo(timezone_name)
    start_local = datetime.combine(date_from, dt_time.min, tzinfo=tz)
    end_local = datetime.combine(date_to + timedelta(days=1), dt_time.min, tzinfo=tz)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


async def get_analytics(
    db: AsyncSession,
    *,
    organization_id: uuid.UUID | None,
    timezone_name: str,
    date_from: date,
    date_to: date,
    queue_id: uuid.UUID | None = None,
) -> dict:
    """organization_id=None aggregates across every organization (superadmin,
    no ?organization_id=) — timezone_name should be "UTC" in that case since
    there's no single organization timezone to group hours/weekdays by.

    Every metric here is one aggregate SQL pass (FILTER-clause conditional
    aggregates for the headline numbers, one GROUP BY each for the
    breakdowns) — never a per-ticket or per-operator query.
    """
    start_utc, end_utc = _range_to_utc(timezone_name, date_from, date_to)

    conditions = [Ticket.created_at >= start_utc, Ticket.created_at < end_utc]
    if organization_id is not None:
        conditions.append(Ticket.organization_id == organization_id)
    if queue_id is not None:
        conditions.append(Ticket.queue_id == queue_id)

    wait_seconds = func.extract("epoch", Ticket.called_at - Ticket.created_at)
    serving_seconds = func.extract("epoch", Ticket.finished_at - Ticket.serving_started_at)

    summary_stmt = select(
        func.avg(wait_seconds).filter(
            Ticket.status == TicketStatus.served, Ticket.called_at.is_not(None)
        ),
        func.avg(serving_seconds).filter(
            Ticket.status == TicketStatus.served,
            Ticket.serving_started_at.is_not(None),
            Ticket.finished_at.is_not(None),
        ),
        func.avg(Ticket.rating).filter(Ticket.rating.is_not(None)),
        func.count().filter(Ticket.rating.is_not(None)),
        func.count().filter(Ticket.status == TicketStatus.served),
        func.count().filter(Ticket.status == TicketStatus.no_show),
        func.count().filter(Ticket.status == TicketStatus.left),
    ).where(*conditions)
    summary = (await db.execute(summary_stmt)).one()
    avg_wait, avg_serving, avg_rating, ratings_count, served_count, no_show_count, left_count = summary

    left_queue_total = served_count + no_show_count + left_count
    no_show_rate = (no_show_count / left_queue_total) if left_queue_total > 0 else None

    operator_stmt = (
        select(
            User.id,
            User.full_name,
            func.count(),
            func.avg(serving_seconds),
        )
        .select_from(Ticket)
        .join(User, User.id == Ticket.called_by)
        .where(*conditions, Ticket.status == TicketStatus.served, Ticket.called_by.is_not(None))
        .group_by(User.id, User.full_name)
        .order_by(func.count().desc())
    )
    by_operator = [
        {
            "operator_id": operator_id,
            "full_name": full_name,
            "served_count": count,
            "avg_serving_seconds": round(avg) if avg is not None else None,
        }
        for operator_id, full_name, count, avg in (await db.execute(operator_stmt)).all()
    ]

    hour_expr = func.extract("hour", func.timezone(timezone_name, Ticket.created_at))
    hour_stmt = (
        select(hour_expr, func.count()).where(*conditions).group_by(hour_expr).order_by(hour_expr)
    )
    hour_counts = {int(hour): count for hour, count in (await db.execute(hour_stmt)).all()}
    peaks_by_hour = [{"hour": hour, "count": hour_counts.get(hour, 0)} for hour in _HOURS]

    # Postgres ISODOW is 1=Monday..7=Sunday; shift to 0=Monday..6=Sunday to
    # match ARCHITECTURE.md's queue_schedules.weekday convention.
    weekday_expr = func.extract("isodow", func.timezone(timezone_name, Ticket.created_at)) - 1
    weekday_stmt = (
        select(weekday_expr, func.count())
        .where(*conditions)
        .group_by(weekday_expr)
        .order_by(weekday_expr)
    )
    weekday_counts = {int(day): count for day, count in (await db.execute(weekday_stmt)).all()}
    peaks_by_weekday = [
        {"weekday": day, "count": weekday_counts.get(day, 0)} for day in _WEEKDAYS
    ]

    return {
        "date_from": date_from,
        "date_to": date_to,
        "avg_wait_seconds": round(avg_wait) if avg_wait is not None else None,
        "avg_serving_seconds": round(avg_serving) if avg_serving is not None else None,
        "no_show_rate": no_show_rate,
        "avg_rating": round(float(avg_rating), 2) if avg_rating is not None else None,
        "ratings_count": ratings_count,
        "served_count": served_count,
        "no_show_count": no_show_count,
        "left_count": left_count,
        "by_operator": by_operator,
        "peaks_by_hour": peaks_by_hour,
        "peaks_by_weekday": peaks_by_weekday,
    }
