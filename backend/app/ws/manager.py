import asyncio
import contextlib
import json
import logging
from collections import defaultdict

from redis.asyncio import Redis

logger = logging.getLogger(__name__)

_CHANNEL_PATTERN = "queue:*"


class ConnectionManager:
    """Fans out queue:{queue_id} events to local subscribers.

    Exactly one Redis pub/sub subscription exists per process (a single
    PSUBSCRIBE on "queue:*", started once via `start()`) — independent of how
    many local subscribers come and go. A subscriber is just an asyncio.Queue
    registered under a channel name; `disconnect`/`unsubscribe` only removes
    that one queue from the local registry, so one client reconnecting (or
    dropping) never touches the shared Redis subscription or any other
    client's delivery.
    """

    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._listen_task: asyncio.Task | None = None

    def subscribe(self, channel: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers[channel].add(queue)
        return queue

    def unsubscribe(self, channel: str, queue: asyncio.Queue) -> None:
        subscribers = self._subscribers.get(channel)
        if not subscribers:
            return
        subscribers.discard(queue)
        if not subscribers:
            del self._subscribers[channel]

    def subscriber_count(self, channel: str) -> int:
        return len(self._subscribers.get(channel, ()))

    async def publish_local(self, channel: str, message: dict) -> None:
        """Delivers `message` to every local subscriber of `channel`. Used
        both by the Redis listener loop for real traffic and directly by
        tests, so manager fan-out can be tested without a Redis round trip.
        """
        for queue in list(self._subscribers.get(channel, ())):
            queue.put_nowait(message)

    async def _redis_listen_loop(self, redis: Redis) -> None:
        pubsub = redis.pubsub()
        await pubsub.psubscribe(_CHANNEL_PATTERN)
        try:
            async for raw in pubsub.listen():
                if raw["type"] != "pmessage":
                    continue
                try:
                    data = json.loads(raw["data"])
                except (TypeError, ValueError):
                    logger.warning("dropping malformed pub/sub payload on %s", raw.get("channel"))
                    continue
                await self.publish_local(raw["channel"], data)
        finally:
            with contextlib.suppress(Exception):
                await pubsub.punsubscribe(_CHANNEL_PATTERN)
                await pubsub.aclose()

    def start(self, redis: Redis) -> None:
        if self._listen_task is None:
            self._listen_task = asyncio.create_task(self._redis_listen_loop(redis))

    async def stop(self) -> None:
        if self._listen_task is not None:
            self._listen_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listen_task
            self._listen_task = None


manager = ConnectionManager()
