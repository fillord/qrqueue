from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.enums import QueueStatus, TicketSource, TicketStatus, UserRole
from app.models.queue import Queue
from app.models.ticket import Ticket
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


async def _make_ticket(db_session, organization, queue, *, number, **fields) -> Ticket:
    ticket = Ticket(
        organization_id=organization.id,
        queue_id=queue.id,
        number=number,
        display_number=f"{queue.ticket_prefix}-{number:03d}",
        source=TicketSource.qr,
        **fields,
    )
    db_session.add(ticket)
    await db_session.commit()
    await db_session.refresh(ticket)
    return ticket


async def test_analytics_averages_on_known_data(client, db_session, make_user, make_organization):
    org = await make_organization(name="Аналитика Организация 1")
    queue = await _make_queue(db_session, org)
    operator, _ = await make_user(
        email="analytics-op1@example.com", role=UserRole.operator, organization_id=org.id
    )
    admin, password = await make_user(
        email="analytics-admin1@example.com", role=UserRole.org_admin, organization_id=org.id
    )

    base = datetime.now(timezone.utc) - timedelta(hours=2)

    async def make_served(n, wait_s, serving_s, rating):
        created = base
        called = created + timedelta(seconds=wait_s)
        started = called + timedelta(seconds=10)
        finished = started + timedelta(seconds=serving_s)
        await _make_ticket(
            db_session, org, queue, number=n,
            status=TicketStatus.served, created_at=created, called_at=called,
            serving_started_at=started, finished_at=finished, called_by=operator.id, rating=rating,
        )

    await make_served(1, wait_s=60, serving_s=300, rating=5)
    await make_served(2, wait_s=120, serving_s=200, rating=3)
    await _make_ticket(
        db_session, org, queue, number=3, status=TicketStatus.no_show, created_at=base,
        called_at=base + timedelta(seconds=30),
    )

    await login(client, "analytics-admin1@example.com", password)
    date_from = (base - timedelta(days=1)).date()
    date_to = (base + timedelta(days=1)).date()
    resp = await client.get(f"/api/admin/analytics?from={date_from}&to={date_to}")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["avg_wait_seconds"] == 90  # (60+120)/2
    assert body["avg_serving_seconds"] == 250  # (300+200)/2
    assert body["avg_rating"] == 4.0
    assert body["ratings_count"] == 2
    assert body["served_count"] == 2
    assert body["no_show_count"] == 1
    assert body["left_count"] == 0
    assert body["no_show_rate"] == pytest.approx(1 / 3)

    assert len(body["by_operator"]) == 1
    op_stat = body["by_operator"][0]
    assert op_stat["operator_id"] == str(operator.id)
    assert op_stat["served_count"] == 2
    assert op_stat["avg_serving_seconds"] == 250

    assert len(body["peaks_by_hour"]) == 24
    assert sum(p["count"] for p in body["peaks_by_hour"]) == 3  # 2 served + 1 no_show
    assert len(body["peaks_by_weekday"]) == 7
    assert sum(p["count"] for p in body["peaks_by_weekday"]) == 3


async def test_analytics_empty_range_returns_nulls_not_500(client, db_session, make_user, make_organization):
    org = await make_organization(name="Аналитика Организация Пусто")
    admin, password = await make_user(
        email="analytics-admin2@example.com", role=UserRole.org_admin, organization_id=org.id
    )

    await login(client, "analytics-admin2@example.com", password)
    today = date.today()
    resp = await client.get(f"/api/admin/analytics?from={today}&to={today}")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["avg_wait_seconds"] is None
    assert body["avg_serving_seconds"] is None
    assert body["avg_rating"] is None
    assert body["no_show_rate"] is None
    assert body["ratings_count"] == 0
    assert body["served_count"] == 0
    assert body["by_operator"] == []
    assert all(p["count"] == 0 for p in body["peaks_by_hour"])


async def test_org_admin_does_not_see_other_organizations_data(
    client, db_session, make_user, make_organization
):
    org_a = await make_organization(name="Аналитика Org A")
    org_b = await make_organization(name="Аналитика Org B")
    queue_b = await _make_queue(db_session, org_b)
    admin_a, password_a = await make_user(
        email="analytics-admin-a@example.com", role=UserRole.org_admin, organization_id=org_a.id
    )

    now = datetime.now(timezone.utc)
    # A very visible ticket in org B — must never leak into org A's numbers.
    await _make_ticket(
        db_session, org_b, queue_b, number=1, status=TicketStatus.served,
        created_at=now, called_at=now + timedelta(seconds=9999),
        serving_started_at=now + timedelta(seconds=10000), finished_at=now + timedelta(seconds=19999),
        rating=1,
    )

    await login(client, "analytics-admin-a@example.com", password_a)
    today = date.today()
    tomorrow = today + timedelta(days=1)
    resp = await client.get(f"/api/admin/analytics?from={today}&to={tomorrow}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["served_count"] == 0
    assert body["avg_wait_seconds"] is None

    # And an explicit queue_id belonging to the other org is 404, not a
    # quiet empty/foreign result.
    resp = await client.get(f"/api/admin/analytics?from={today}&to={tomorrow}&queue_id={queue_b.id}")
    assert resp.status_code == 404, resp.text


async def test_sa_analytics_scoping(client, db_session, make_user, make_organization):
    org_a = await make_organization(name="Аналитика SA Org A")
    org_b = await make_organization(name="Аналитика SA Org B")
    queue_a = await _make_queue(db_session, org_a)
    queue_b = await _make_queue(db_session, org_b)

    now = datetime.now(timezone.utc)
    await _make_ticket(
        db_session, org_a, queue_a, number=1, status=TicketStatus.served,
        created_at=now, called_at=now + timedelta(seconds=50),
        serving_started_at=now + timedelta(seconds=60), finished_at=now + timedelta(seconds=160),
    )
    await _make_ticket(
        db_session, org_b, queue_b, number=1, status=TicketStatus.served,
        created_at=now, called_at=now + timedelta(seconds=150),
        serving_started_at=now + timedelta(seconds=160), finished_at=now + timedelta(seconds=260),
    )

    _superadmin, sa_password = await make_user(
        email="analytics-sa@example.com", role=UserRole.superadmin, organization_id=None
    )
    await login(client, "analytics-sa@example.com", sa_password)
    today = date.today()
    tomorrow = today + timedelta(days=1)

    resp = await client.get(f"/api/sa/analytics?from={today}&to={tomorrow}&organization_id={org_a.id}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["served_count"] == 1
    assert resp.json()["avg_wait_seconds"] == 50

    resp = await client.get(f"/api/sa/analytics?from={today}&to={tomorrow}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["served_count"] == 2
    assert body["avg_wait_seconds"] == 100  # (50+150)/2 across both orgs
