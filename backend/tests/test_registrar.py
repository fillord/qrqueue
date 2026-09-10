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


async def _make_ticket(db_session, organization, queue, *, number, created_at) -> Ticket:
    ticket = Ticket(
        organization_id=organization.id,
        queue_id=queue.id,
        client_id=None,
        number=number,
        display_number=f"{queue.ticket_prefix}-{number:03d}",
        status=TicketStatus.waiting,
        source=TicketSource.qr,
        created_at=created_at,
    )
    db_session.add(ticket)
    await db_session.commit()
    await db_session.refresh(ticket)
    return ticket


async def test_registrar_creates_ticket_without_client(client, db_session, make_user, make_organization):
    org = await make_organization(name="Регистратор Организация 1")
    queue = await _make_queue(db_session, org)
    registrar, password = await make_user(
        email="reg1@example.com", role=UserRole.registrar, organization_id=org.id
    )

    await login(client, "reg1@example.com", password)

    resp = await client.post("/api/registrar/tickets", json={"queue_id": str(queue.id), "note": "Иванов"})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["display_number"] == "A-001"
    assert body["status"] == "waiting"

    result = await db_session.execute(select(Ticket).where(Ticket.id == uuid.UUID(body["id"])))
    ticket = result.scalar_one()
    assert ticket.client_id is None
    assert ticket.source == TicketSource.registrar

    resp = await client.get(f"/api/registrar/tickets/{body['id']}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "waiting"


async def test_registrar_ticket_ordered_with_others_and_callable_normally(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Регистратор Организация 2")
    queue = await _make_queue(db_session, org)
    cabinet = await _make_cabinet(db_session, org, queue)
    registrar, reg_password = await make_user(
        email="reg2@example.com", role=UserRole.registrar, organization_id=org.id
    )
    operator, op_password = await make_user(
        email="reg2-op@example.com", role=UserRole.operator, organization_id=org.id
    )
    db_session.add(CabinetOperator(cabinet_id=cabinet.id, user_id=operator.id))
    await db_session.commit()

    t0 = datetime.now(timezone.utc) - timedelta(minutes=5)
    older_qr_ticket = await _make_ticket(db_session, org, queue, number=1, created_at=t0)

    await login(client, "reg2@example.com", reg_password)
    resp = await client.post("/api/registrar/tickets", json={"queue_id": str(queue.id)})
    assert resp.status_code == 201, resp.text
    registrar_ticket_id = resp.json()["id"]

    await login(client, "reg2-op@example.com", op_password)
    await client.post(f"/api/operator/cabinets/{cabinet.id}/select")

    # created_at ordering is untouched by the registrar ticket — the
    # earlier QR ticket is still called first, exactly like any other pair
    # of waiting tickets.
    resp = await client.post("/api/operator/call-next")
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == str(older_qr_ticket.id)

    await client.post(f"/api/operator/tickets/{older_qr_ticket.id}/start")
    await client.post(f"/api/operator/tickets/{older_qr_ticket.id}/finish")

    resp = await client.post("/api/operator/call-next")
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == registrar_ticket_id


async def test_registrar_cannot_create_ticket_in_other_org_queue(
    client, db_session, make_user, make_organization
):
    org_a = await make_organization(name="Регистратор Org A")
    org_b = await make_organization(name="Регистратор Org B")
    queue_b = await _make_queue(db_session, org_b)
    registrar, password = await make_user(
        email="reg3@example.com", role=UserRole.registrar, organization_id=org_a.id
    )

    await login(client, "reg3@example.com", password)
    resp = await client.post("/api/registrar/tickets", json={"queue_id": str(queue_b.id)})
    assert resp.status_code == 404, resp.text


async def test_registrar_cannot_create_ticket_in_closed_queue_or_nonexistent_queue(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Регистратор Организация 4")
    closed_queue = await _make_queue(db_session, org, status=QueueStatus.closed)
    registrar, password = await make_user(
        email="reg4@example.com", role=UserRole.registrar, organization_id=org.id
    )

    await login(client, "reg4@example.com", password)

    resp = await client.post("/api/registrar/tickets", json={"queue_id": str(closed_queue.id)})
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "queue_closed"

    resp = await client.post("/api/registrar/tickets", json={"queue_id": str(uuid.uuid4())})
    assert resp.status_code == 404, resp.text


async def test_registrar_ticket_not_in_public_me_tickets(client, db_session, make_user, make_organization):
    org = await make_organization(name="Регистратор Организация 5")
    queue = await _make_queue(db_session, org)
    registrar, password = await make_user(
        email="reg5@example.com", role=UserRole.registrar, organization_id=org.id
    )

    await login(client, "reg5@example.com", password)
    resp = await client.post("/api/registrar/tickets", json={"queue_id": str(queue.id)})
    assert resp.status_code == 201, resp.text

    await client.post("/api/auth/logout")
    resp = await client.get("/api/public/me/tickets")
    assert resp.status_code == 200, resp.text
    assert resp.json() == []
