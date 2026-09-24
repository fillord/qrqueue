import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.redis import redis_client
from app.models.cabinet import Cabinet, CabinetOperator
from app.models.client import Client, PushSubscription
from app.models.enums import QueueStatus, TicketSource, TicketStatus, UserRole
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.services import notifications, tickets as tickets_service
from tests.utils import login

pytestmark = pytest.mark.asyncio


async def _make_queue(db_session, organization, **kwargs) -> Queue:
    today = datetime.now(timezone.utc).date()
    queue = Queue(
        organization_id=organization.id,
        name=kwargs.pop("name", "Очередь"),
        ticket_prefix=kwargs.pop("ticket_prefix", "A"),
        status=kwargs.pop("status", QueueStatus.open),
        counter_date=kwargs.pop("counter_date", today),
        **kwargs,
    )
    db_session.add(queue)
    await db_session.commit()
    await db_session.refresh(queue)
    return queue


async def _make_cabinet(db_session, organization, queue, label="Кабинет") -> Cabinet:
    cabinet = Cabinet(organization_id=organization.id, queue_id=queue.id, label=label)
    db_session.add(cabinet)
    await db_session.commit()
    await db_session.refresh(cabinet)
    return cabinet


async def _assign_operator(db_session, cabinet, operator) -> None:
    db_session.add(CabinetOperator(cabinet_id=cabinet.id, user_id=operator.id))
    await db_session.commit()


async def _make_subscribed_client(db_session, endpoint) -> Client:
    client = Client(last_seen_at=datetime.now(timezone.utc))
    db_session.add(client)
    await db_session.commit()
    await db_session.refresh(client)
    db_session.add(
        PushSubscription(client_id=client.id, endpoint=endpoint, keys={"p256dh": "x", "auth": "y"})
    )
    await db_session.commit()
    return client


async def _make_waiting_ticket(db_session, organization, queue, *, number, client=None, created_at=None) -> Ticket:
    ticket = Ticket(
        organization_id=organization.id,
        queue_id=queue.id,
        client_id=client.id if client else None,
        number=number,
        display_number=f"{queue.ticket_prefix}-{number:03d}",
        status=TicketStatus.waiting,
        source=TicketSource.qr,
        # Ascending with `number` so ticket 1 is the oldest (first in line) —
        # matches how these tests read: ticket N is the Nth to arrive.
        created_at=created_at or (datetime.now(timezone.utc) - timedelta(minutes=100 - number)),
    )
    db_session.add(ticket)
    await db_session.commit()
    await db_session.refresh(ticket)
    return ticket


def _configure_vapid(monkeypatch):
    monkeypatch.setattr(notifications.settings, "vapid_public_key", "pub")
    monkeypatch.setattr(notifications.settings, "vapid_private_key", "priv")


def _payloads(calls):
    # data is a JSON string with ensure_ascii=True (\uXXXX-escaped) — decode
    # before asserting on Cyrillic content instead of substring-matching the
    # raw escaped string.
    return [json.loads(call["data"]) for call in calls]


async def test_call_next_triggers_push_with_expected_payload_and_still_calls_ticket(
    client, db_session, make_user, make_organization, monkeypatch
):
    _configure_vapid(monkeypatch)
    org = await make_organization(name="Push Called Организация")
    queue = await _make_queue(db_session, org)
    cabinet = await _make_cabinet(db_session, org, queue, label="Окно 5")
    operator, password = await make_user(
        email="push-op1@example.com", role=UserRole.operator, organization_id=org.id
    )
    await _assign_operator(db_session, cabinet, operator)

    visitor = await _make_subscribed_client(db_session, "https://push.example.com/called")
    ticket = await _make_waiting_ticket(db_session, org, queue, number=1, client=visitor)

    calls = []
    monkeypatch.setattr(notifications, "webpush", lambda **kw: calls.append(kw))

    await login(client, "push-op1@example.com", password)
    await client.post(f"/api/operator/cabinets/{cabinet.id}/select")
    resp = await client.post("/api/operator/call-next")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "called"

    assert len(calls) == 1
    payload = _payloads(calls)[0]
    assert ticket.display_number in payload["title"]
    assert "Окно 5" in payload["body"]
    assert payload["ticket_id"] == str(ticket.id)


async def test_call_next_still_succeeds_when_push_delivery_raises(
    client, db_session, make_user, make_organization, monkeypatch
):
    _configure_vapid(monkeypatch)
    org = await make_organization(name="Push Failure Организация")
    queue = await _make_queue(db_session, org)
    cabinet = await _make_cabinet(db_session, org, queue)
    operator, password = await make_user(
        email="push-op2@example.com", role=UserRole.operator, organization_id=org.id
    )
    await _assign_operator(db_session, cabinet, operator)

    visitor = await _make_subscribed_client(db_session, "https://push.example.com/broken")
    await _make_waiting_ticket(db_session, org, queue, number=1, client=visitor)

    def _raise(**_kwargs):
        raise RuntimeError("push service unreachable")

    monkeypatch.setattr(notifications, "webpush", _raise)

    await login(client, "push-op2@example.com", password)
    await client.post(f"/api/operator/cabinets/{cabinet.id}/select")
    resp = await client.post("/api/operator/call-next")

    # The transition and the HTTP response must succeed regardless of the
    # push failure — push is strictly best-effort.
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "called"


async def test_first_three_notified_exactly_once_not_on_every_recompute(
    db_session, make_organization, monkeypatch
):
    _configure_vapid(monkeypatch)
    org = await make_organization(name="Push Position Организация")
    queue = await _make_queue(db_session, org)

    clients = [
        await _make_subscribed_client(db_session, f"https://push.example.com/pos-{i}") for i in range(4)
    ]
    tickets = [
        await _make_waiting_ticket(db_session, org, queue, number=i + 1, client=clients[i])
        for i in range(4)
    ]
    third_ticket = tickets[2]

    calls = []
    monkeypatch.setattr(notifications, "webpush", lambda **kw: calls.append(kw))

    await tickets_service._notify_approaching_position(db_session, queue)
    assert len(calls) == 3
    assert {p["ticket_id"] for p in _payloads(calls)} == {str(t.id) for t in tickets[:3]}

    await db_session.refresh(third_ticket)
    assert third_ticket.position_notified is True

    # Recomputing again with no change in the queue must not re-notify.
    await tickets_service._notify_approaching_position(db_session, queue)
    assert len(calls) == 3


async def test_call_next_notifies_new_position_three_ticket_each_time_without_duplicates(
    client, db_session, make_user, make_organization, monkeypatch
):
    _configure_vapid(monkeypatch)
    org = await make_organization(name="Push Position Call Next Организация")
    queue = await _make_queue(db_session, org)
    cabinet = await _make_cabinet(db_session, org, queue)
    operator, password = await make_user(
        email="push-op3@example.com", role=UserRole.operator, organization_id=org.id
    )
    await _assign_operator(db_session, cabinet, operator)

    clients = [
        await _make_subscribed_client(db_session, f"https://push.example.com/cn-{i}") for i in range(5)
    ]
    for i in range(5):
        await _make_waiting_ticket(db_session, org, queue, number=i + 1, client=clients[i])

    calls = []
    monkeypatch.setattr(notifications, "webpush", lambda **kw: calls.append(kw))

    def approaching_titles():
        return [p["title"] for p in _payloads(calls) if p["title"].startswith("Скоро")]

    await login(client, "push-op3@example.com", password)
    await client.post(f"/api/operator/cabinets/{cabinet.id}/select")

    # Ticket 1 called (its own "you're called" push) -> waiting becomes
    # [2,3,4,5]: notify all first three, each once.
    await client.post("/api/operator/call-next")
    assert len(approaching_titles()) == 3
    first_approaching = approaching_titles()[0]

    # Free the cabinet, call again: ticket 2 called -> waiting is [3,4,5],
    # position 3 is ticket 5: one more "approaching" push, but ticket 4
    # (already notified above) must not be pushed again even though it
    # shifted position in the meantime.
    result = await db_session.execute(
        select(Ticket).where(Ticket.queue_id == queue.id, Ticket.status == TicketStatus.called)
    )
    current = result.scalar_one()
    await client.post(f"/api/operator/tickets/{current.id}/start")
    await client.post(f"/api/operator/tickets/{current.id}/finish")
    await client.post("/api/operator/call-next")

    assert len(approaching_titles()) == 4
    assert approaching_titles()[0] == first_approaching  # unchanged, not repeated
    assert approaching_titles()[3] != first_approaching  # a different ticket this time


async def test_missed_call_push_uses_client_language(db_session, make_organization, monkeypatch):
    from app.models.enums import AuditActorType, Language
    _configure_vapid(monkeypatch)
    org = await make_organization(name='Missed call language')
    queue = await _make_queue(db_session, org)
    visitor = await _make_subscribed_client(db_session, 'https://push.example.com/missed')
    visitor.language = Language.en
    ticket = await _make_waiting_ticket(db_session, org, queue, number=1, client=visitor)
    ticket.status = TicketStatus.called
    await db_session.commit()
    calls = []
    monkeypatch.setattr(notifications, 'webpush', lambda **kw: calls.append(kw))
    await tickets_service.mark_no_show(db_session, redis_client, ticket=ticket, actor_type=AuditActorType.user, actor_id=None)
    assert _payloads(calls)[0]['title'].startswith('Missed call')
    assert _payloads(calls)[0]['ticket_id'] == str(ticket.id)


async def test_short_queue_also_gets_approaching_notification(db_session, make_organization, monkeypatch):
    _configure_vapid(monkeypatch)
    org = await make_organization(name='Short queue')
    queue = await _make_queue(db_session, org)
    visitor = await _make_subscribed_client(db_session, 'https://push.example.com/short')
    ticket = await _make_waiting_ticket(db_session, org, queue, number=1, client=visitor)
    calls = []
    monkeypatch.setattr(notifications, 'webpush', lambda **kw: calls.append(kw))
    await tickets_service._notify_approaching_position(db_session, queue)
    await tickets_service._notify_approaching_position(db_session, queue)
    assert len(calls) == 1
    assert _payloads(calls)[0]['ticket_id'] == str(ticket.id)
