import asyncio

import pytest

from app.ws.manager import ConnectionManager

pytestmark = pytest.mark.asyncio


async def test_publish_local_delivers_to_all_subscribers_of_a_channel():
    manager = ConnectionManager()
    sub_a = manager.subscribe("queue:1")
    sub_b = manager.subscribe("queue:1")

    await manager.publish_local("queue:1", {"event": "ticket.called"})

    assert await sub_a.get() == {"event": "ticket.called"}
    assert await sub_b.get() == {"event": "ticket.called"}


async def test_channels_are_isolated():
    manager = ConnectionManager()
    sub_1 = manager.subscribe("queue:1")
    sub_2 = manager.subscribe("queue:2")

    await manager.publish_local("queue:1", {"event": "ticket.called"})

    assert await sub_1.get() == {"event": "ticket.called"}
    assert sub_2.qsize() == 0


async def test_unsubscribe_stops_delivery_without_affecting_other_subscribers():
    manager = ConnectionManager()
    sub_a = manager.subscribe("queue:1")
    sub_b = manager.subscribe("queue:1")

    manager.unsubscribe("queue:1", sub_a)
    await manager.publish_local("queue:1", {"event": "ticket.updated"})

    assert sub_a.qsize() == 0
    assert await sub_b.get() == {"event": "ticket.updated"}
    # unsubscribing the last queue of a channel drops the channel entirely
    manager.unsubscribe("queue:1", sub_b)
    assert manager.subscriber_count("queue:1") == 0


async def test_publish_to_unknown_channel_is_a_noop():
    manager = ConnectionManager()
    # No subscribers anywhere — must not raise.
    await manager.publish_local("queue:does-not-exist", {"event": "ticket.created"})


async def test_reconnect_does_not_lose_events_for_other_subscribers():
    """A client disconnecting (unsubscribe) and a fresh one connecting
    (subscribe) on the same channel must not disturb an already-connected
    third subscriber's delivery.
    """
    manager = ConnectionManager()
    steady = manager.subscribe("queue:1")
    reconnecting = manager.subscribe("queue:1")

    manager.unsubscribe("queue:1", reconnecting)
    fresh = manager.subscribe("queue:1")

    await manager.publish_local("queue:1", {"event": "ticket.updated"})

    assert await steady.get() == {"event": "ticket.updated"}
    assert await fresh.get() == {"event": "ticket.updated"}


async def test_start_is_idempotent_and_stop_cancels_listener():
    manager = ConnectionManager()
    started = asyncio.Event()

    class _FakePubSub:
        async def psubscribe(self, *_patterns):
            started.set()

        async def listen(self):
            await asyncio.Event().wait()  # blocks forever — only cancellation ends this
            yield  # pragma: no cover - unreachable, makes this an async generator

        async def punsubscribe(self, *_patterns):
            pass

        async def aclose(self):
            pass

    class _FakeRedis:
        def pubsub(self):
            return _FakePubSub()

    manager.start(_FakeRedis())
    task = manager._listen_task
    manager.start(_FakeRedis())  # second call must not replace the running task
    assert manager._listen_task is task

    await asyncio.wait_for(started.wait(), timeout=1)

    await manager.stop()
    assert manager._listen_task is None
    assert task.done()
