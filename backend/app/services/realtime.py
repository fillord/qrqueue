import json
import uuid
from typing import Any

from redis.asyncio import Redis


async def publish_event(redis: Redis, queue_id: uuid.UUID, event: str, **fields: Any) -> None:
    """Publishes to Redis channel queue:{queue_id} — see ARCHITECTURE.md section 5.

    No subscribers exist yet (the WebSocket manager lands in step 5); this is
    fire-and-forget so a transition never fails because nobody is listening.
    """
    channel = f"queue:{queue_id}"
    message = json.dumps({"event": event, **fields}, default=str)
    await redis.publish(channel, message)
