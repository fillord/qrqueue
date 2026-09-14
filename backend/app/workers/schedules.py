"""Opens and closes queues by their weekly schedule (ARCHITECTURE.md section 2,
queue_schedules): closed at closes_at, open at opens_at, in the organization's
timezone. Only edges act — a queue an admin closed or paused by hand stays so
until the next scheduled edge, which is how "manual pause wins until the end
of the day" is implemented. Queues without any schedule rows are never
touched (no schedule = no working-hours restriction, like geo_radius_m=None).
The daily ticket counter itself resets lazily in services/numbering.py.
"""
import logging
from datetime import datetime

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import local_date, utcnow
from app.models.enums import AuditActorType, QueueStatus
from app.models.organization import Organization
from app.models.queue import Queue, QueueSchedule
from app.services.audit import log_action
from app.services.queue_availability import within_schedule
from app.services.realtime import publish_event

logger = logging.getLogger(__name__)


async def _set_status(db: AsyncSession, queue: Queue, status: QueueStatus, action: str) -> None:
    queue.status = status
    queue.manually_paused = False
    await db.flush()
    await log_action(
        db,
        actor_type=AuditActorType.system,
        actor_id=None,
        action=action,
        entity_type="queue",
        entity_id=queue.id,
        organization_id=queue.organization_id,
        payload={"status": status.value},
    )


async def run_once(db: AsyncSession, redis: Redis, now: datetime | None = None) -> int:
    """Returns how many queues changed status. Events are published after commit."""
    now = now or utcnow()
    result = await db.execute(
        select(Queue, Organization)
        .join(Organization, Organization.id == Queue.organization_id)
        .where(
            Queue.is_active.is_(True),
            Organization.is_active.is_(True),
            Queue.id.in_(select(QueueSchedule.queue_id).distinct()),
        )
        .order_by(Queue.id)
        .with_for_update(of=Queue)
    )
    changed: list[Queue] = []
    for queue, organization in result.all():
        try:
            open_now = await within_schedule(
                db, queue, local_date(organization.timezone, now), now, organization.timezone
            )
        except Exception:
            logger.exception("schedule check failed for queue %s", queue.id)
            continue

        previous = queue.schedule_open
        queue.schedule_open = open_now
        if previous is None:
            # First look (deploy, or schedule just edited): only enforce "outside
            # hours = closed"; a closed queue inside hours may be a manual close.
            if not open_now and queue.status != QueueStatus.closed:
                await _set_status(db, queue, QueueStatus.closed, "queue.auto_closed")
                changed.append(queue)
        elif open_now and not previous:
            if queue.status == QueueStatus.closed:
                await _set_status(db, queue, QueueStatus.open, "queue.auto_opened")
                changed.append(queue)
        elif previous and not open_now:
            if queue.status != QueueStatus.closed:
                await _set_status(db, queue, QueueStatus.closed, "queue.auto_closed")
                changed.append(queue)

    await db.commit()
    for queue in changed:
        await publish_event(redis, queue.id, "queue.status", status=queue.status.value)
    return len(changed)
