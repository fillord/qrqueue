from datetime import datetime, timezone

import pytest
from pywebpush import WebPushException
from sqlalchemy import select

from app.models.client import Client, PushSubscription
from app.services import notifications

pytestmark = pytest.mark.asyncio


class _FakeResponse:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


async def _make_subscribed_client(db_session, endpoint="https://push.example.com/abc") -> PushSubscription:
    client = Client(last_seen_at=datetime.now(timezone.utc))
    db_session.add(client)
    await db_session.commit()
    await db_session.refresh(client)

    subscription = PushSubscription(client_id=client.id, endpoint=endpoint, keys={"p256dh": "x", "auth": "y"})
    db_session.add(subscription)
    await db_session.commit()
    await db_session.refresh(subscription)
    return subscription


def _configure_vapid(monkeypatch):
    monkeypatch.setattr(notifications.settings, "vapid_public_key", "pub")
    monkeypatch.setattr(notifications.settings, "vapid_private_key", "priv")


async def test_send_push_deletes_subscription_on_410(db_session, monkeypatch):
    _configure_vapid(monkeypatch)
    subscription = await _make_subscribed_client(db_session)
    subscription_id = subscription.id

    def _raise(**_kwargs):
        raise WebPushException("gone", response=_FakeResponse(410))

    monkeypatch.setattr(notifications, "webpush", _raise)

    await notifications.send_push(db_session, subscription, {"title": "x", "body": "y"})

    result = await db_session.execute(select(PushSubscription).where(PushSubscription.id == subscription_id))
    assert result.scalar_one_or_none() is None


async def test_send_push_deletes_subscription_on_404(db_session, monkeypatch):
    _configure_vapid(monkeypatch)
    subscription = await _make_subscribed_client(db_session, endpoint="https://push.example.com/def")
    subscription_id = subscription.id

    def _raise(**_kwargs):
        raise WebPushException("not found", response=_FakeResponse(404))

    monkeypatch.setattr(notifications, "webpush", _raise)

    await notifications.send_push(db_session, subscription, {"title": "x", "body": "y"})

    result = await db_session.execute(select(PushSubscription).where(PushSubscription.id == subscription_id))
    assert result.scalar_one_or_none() is None


async def test_send_push_other_failure_keeps_subscription_and_does_not_raise(db_session, monkeypatch):
    _configure_vapid(monkeypatch)
    subscription = await _make_subscribed_client(db_session, endpoint="https://push.example.com/ghi")
    subscription_id = subscription.id

    def _raise(**_kwargs):
        raise WebPushException("server error", response=_FakeResponse(500))

    monkeypatch.setattr(notifications, "webpush", _raise)

    await notifications.send_push(db_session, subscription, {"title": "x", "body": "y"})

    result = await db_session.execute(select(PushSubscription).where(PushSubscription.id == subscription_id))
    assert result.scalar_one_or_none() is not None


async def test_send_push_unexpected_exception_does_not_raise(db_session, monkeypatch):
    _configure_vapid(monkeypatch)
    subscription = await _make_subscribed_client(db_session, endpoint="https://push.example.com/jkl")

    def _raise(**_kwargs):
        raise RuntimeError("network is down")

    monkeypatch.setattr(notifications, "webpush", _raise)

    # Must not raise.
    await notifications.send_push(db_session, subscription, {"title": "x", "body": "y"})


async def test_send_push_skips_silently_when_vapid_not_configured(db_session, monkeypatch):
    monkeypatch.setattr(notifications.settings, "vapid_public_key", "")
    monkeypatch.setattr(notifications.settings, "vapid_private_key", "")
    subscription = await _make_subscribed_client(db_session, endpoint="https://push.example.com/mno")

    calls = []
    monkeypatch.setattr(notifications, "webpush", lambda **kw: calls.append(kw))

    await notifications.send_push(db_session, subscription, {"title": "x", "body": "y"})
    assert calls == []
