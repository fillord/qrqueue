import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.cabinet import Cabinet, CabinetOperator
from app.models.enums import QueueStatus, TicketSource, TicketStatus, UserRole
from app.models.queue import Queue
from app.models.ticket import Ticket
from tests.utils import login


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


async def _make_ticket(
    db_session, organization, queue, *, number=1, created_at=None, called_at=None
) -> Ticket:
    ticket = Ticket(
        organization_id=organization.id,
        queue_id=queue.id,
        number=number,
        display_number=f"{queue.ticket_prefix}-{number:03d}",
        status=TicketStatus.waiting,
        source=TicketSource.qr,
        created_at=created_at or datetime.now(timezone.utc),
        called_at=called_at,
    )
    db_session.add(ticket)
    await db_session.commit()
    await db_session.refresh(ticket)
    return ticket


async def test_call_next_takes_oldest_waiting_and_busy_cabinet_conflicts(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Оператор Организация 1")
    queue = await _make_queue(db_session, org)
    cabinet = await _make_cabinet(db_session, org, queue)
    operator, password = await make_user(
        email="op1@example.com", role=UserRole.operator, organization_id=org.id
    )
    await _assign_operator(db_session, cabinet, operator)

    t0 = datetime.now(timezone.utc) - timedelta(minutes=5)
    t1 = datetime.now(timezone.utc) - timedelta(minutes=1)
    older = await _make_ticket(db_session, org, queue, number=1, created_at=t0)
    await _make_ticket(db_session, org, queue, number=2, created_at=t1)

    await login(client, "op1@example.com", password)
    resp = await client.post(f"/api/operator/cabinets/{cabinet.id}/select")
    assert resp.status_code == 200, resp.text

    resp = await client.post("/api/operator/call-next")
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == str(older.id)

    resp = await client.post("/api/operator/call-next")
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["code"] == "cabinet_busy"


async def test_returned_no_show_ticket_takes_priority_over_earlier_waiting(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Оператор Организация 2")
    queue = await _make_queue(db_session, org)
    cabinet = await _make_cabinet(db_session, org, queue)
    operator, password = await make_user(
        email="op2@example.com", role=UserRole.operator, organization_id=org.id
    )
    await _assign_operator(db_session, cabinet, operator)

    returning_created_at = datetime.now(timezone.utc) - timedelta(hours=1)
    returning = await _make_ticket(db_session, org, queue, number=1, created_at=returning_created_at)

    await login(client, "op2@example.com", password)
    await client.post(f"/api/operator/cabinets/{cabinet.id}/select")

    resp = await client.post("/api/operator/call-next")
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == str(returning.id)

    resp = await client.post(f"/api/operator/tickets/{returning.id}/no-show")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "no_show"

    # An earlier-created waiting ticket shows up after the no_show.
    early_created_at = returning_created_at - timedelta(hours=1)
    await _make_ticket(db_session, org, queue, number=2, created_at=early_created_at)

    resp = await client.post(f"/api/operator/tickets/{returning.id}/return")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "waiting"

    resp = await client.post("/api/operator/call-next")
    assert resp.status_code == 200, resp.text
    # The returned ticket is picked, not the ticket that's older by created_at.
    assert resp.json()["id"] == str(returning.id)


async def test_finish_from_waiting_returns_409_invalid_transition(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Оператор Организация 3")
    queue = await _make_queue(db_session, org)
    cabinet = await _make_cabinet(db_session, org, queue)
    operator, password = await make_user(
        email="op3@example.com", role=UserRole.operator, organization_id=org.id
    )
    await _assign_operator(db_session, cabinet, operator)
    ticket = await _make_ticket(db_session, org, queue)

    await login(client, "op3@example.com", password)
    await client.post(f"/api/operator/cabinets/{cabinet.id}/select")

    resp = await client.post(f"/api/operator/tickets/{ticket.id}/finish")
    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "invalid_transition"
    assert detail["status"] == "waiting"


async def test_finish_ticket_from_other_queue_returns_404(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Оператор Организация 4")
    queue_a = await _make_queue(db_session, org, ticket_prefix="A")
    queue_b = await _make_queue(db_session, org, ticket_prefix="B")
    cabinet_a = await _make_cabinet(db_session, org, queue_a, label="Окно A")
    operator, password = await make_user(
        email="op4@example.com", role=UserRole.operator, organization_id=org.id
    )
    await _assign_operator(db_session, cabinet_a, operator)
    ticket_b = await _make_ticket(db_session, org, queue_b)

    await login(client, "op4@example.com", password)
    await client.post(f"/api/operator/cabinets/{cabinet_a.id}/select")

    resp = await client.post(f"/api/operator/tickets/{ticket_b.id}/finish")
    assert resp.status_code == 404, resp.text


async def test_transfer_old_transferred_new_waiting_with_source_and_link(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Оператор Организация 5")
    source_queue = await _make_queue(db_session, org, ticket_prefix="A")
    target_queue = await _make_queue(db_session, org, ticket_prefix="B")
    cabinet = await _make_cabinet(db_session, org, source_queue)
    operator, password = await make_user(
        email="op5@example.com", role=UserRole.operator, organization_id=org.id
    )
    await _assign_operator(db_session, cabinet, operator)
    ticket = await _make_ticket(db_session, org, source_queue)

    await login(client, "op5@example.com", password)
    await client.post(f"/api/operator/cabinets/{cabinet.id}/select")

    resp = await client.post(
        f"/api/operator/tickets/{ticket.id}/transfer", json={"queue_id": str(target_queue.id)}
    )
    assert resp.status_code == 201, resp.text
    new_ticket = resp.json()
    assert new_ticket["queue_id"] == str(target_queue.id)
    assert new_ticket["status"] == "waiting"
    assert new_ticket["display_number"].startswith("B-")

    await db_session.refresh(ticket)
    assert ticket.status == TicketStatus.transferred

    result = await db_session.execute(select(Ticket).where(Ticket.id == uuid.UUID(new_ticket["id"])))
    created = result.scalar_one()
    assert created.source == TicketSource.transfer
    assert created.transferred_from == ticket.id


async def test_pause_with_active_ticket_conflicts_and_cascades_queue_status(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Оператор Организация 6")
    queue = await _make_queue(db_session, org)
    cabinet_a = await _make_cabinet(db_session, org, queue, label="Окно 1")
    cabinet_b = await _make_cabinet(db_session, org, queue, label="Окно 2")
    operator_a, password_a = await make_user(
        email="op6a@example.com", role=UserRole.operator, organization_id=org.id
    )
    operator_b, password_b = await make_user(
        email="op6b@example.com", role=UserRole.operator, organization_id=org.id
    )
    await _assign_operator(db_session, cabinet_a, operator_a)
    await _assign_operator(db_session, cabinet_b, operator_b)
    ticket = await _make_ticket(db_session, org, queue)

    await login(client, "op6a@example.com", password_a)
    await client.post(f"/api/operator/cabinets/{cabinet_a.id}/select")

    resp = await client.post("/api/operator/call-next")
    assert resp.status_code == 200, resp.text

    resp = await client.post("/api/operator/cabinet/pause")
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["code"] == "active_ticket"

    resp = await client.post(f"/api/operator/tickets/{ticket.id}/start")
    assert resp.status_code == 200, resp.text
    resp = await client.post(f"/api/operator/tickets/{ticket.id}/finish")
    assert resp.status_code == 200, resp.text

    resp = await client.post("/api/operator/cabinet/pause")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "paused"

    await db_session.refresh(queue)
    assert queue.status == QueueStatus.open  # cabinet_b is still active

    await login(client, "op6b@example.com", password_b)
    await client.post(f"/api/operator/cabinets/{cabinet_b.id}/select")

    resp = await client.post("/api/operator/cabinet/pause")
    assert resp.status_code == 200, resp.text

    await db_session.refresh(queue)
    assert queue.status == QueueStatus.paused

    resp = await client.post("/api/operator/cabinet/resume")
    assert resp.status_code == 200, resp.text

    await db_session.refresh(queue)
    assert queue.status == QueueStatus.open
