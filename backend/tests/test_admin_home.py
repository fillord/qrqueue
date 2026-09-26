from datetime import date, timedelta

import pytest

from app.clock import utcnow
from app.models.cabinet import Cabinet, CabinetOperator
from app.models.enums import Language, QueueStatus, UserRole
from app.models.queue import Queue
from app.models.tv_screen import TVScreen
from tests.utils import login

pytestmark = pytest.mark.asyncio


async def test_admin_home_tracks_real_setup_and_tv_connection(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Клиника для настройки")
    admin, password = await make_user(
        email="home-admin@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    await login(client, admin.email, password)

    empty = await client.get("/api/admin/home")
    assert empty.status_code == 200, empty.text
    assert empty.json()["organization_name"] == org.name
    assert empty.json()["queues"] == []
    assert empty.json()["cabinet_count"] == 0
    assert empty.json()["operator_count"] == 0
    assert empty.json()["has_operator_assignment"] is False
    assert empty.json()["paired_queue_screen_count"] == 0

    queue = Queue(organization_id=org.id, name="Терапевт", ticket_prefix="T",
                  status=QueueStatus.open, counter_date=date.today())
    db_session.add(queue)
    await db_session.flush()
    cabinet = Cabinet(organization_id=org.id, queue_id=queue.id, label="Кабинет 3")
    db_session.add(cabinet)
    operator, _ = await make_user(
        email="home-operator@example.com", role=UserRole.operator, organization_id=org.id
    )
    db_session.add(CabinetOperator(cabinet_id=cabinet.id, user_id=operator.id))
    screen = TVScreen(organization_id=org.id, queue_id=queue.id, name="Холл",
                      device_token="home-tv-token", pairing_code=None, language=Language.ru,
                      display_mode="queue", last_seen_at=utcnow())
    db_session.add(screen)
    await db_session.commit()

    ready = (await client.get("/api/admin/home")).json()
    assert [(item["name"], item["waiting_count"]) for item in ready["queues"]] == [("Терапевт", 0)]
    assert ready["cabinet_count"] == 1
    assert ready["operator_count"] == 1
    assert ready["has_operator_assignment"] is True
    assert ready["paired_queue_screen_count"] == 1
    assert ready["online_screen_count"] == 1

    screen.last_seen_at = utcnow() - timedelta(minutes=5)
    await db_session.commit()
    offline = (await client.get("/api/admin/home")).json()
    assert offline["online_screen_count"] == 0
    assert offline["offline_screen_count"] == 1

    queue.is_active = False
    await db_session.commit()
    disabled = (await client.get("/api/admin/home")).json()
    assert disabled["queues"] == []
    assert disabled["cabinet_count"] == 0
    assert disabled["has_operator_assignment"] is False


async def test_admin_home_does_not_include_another_organization(
    client, db_session, make_user, make_organization
):
    own = await make_organization(name="Своя организация")
    other = await make_organization(name="Чужая организация")
    admin, password = await make_user(
        email="home-scoped@example.com", role=UserRole.org_admin, organization_id=own.id
    )
    db_session.add(Queue(organization_id=other.id, name="Чужая очередь", ticket_prefix="X",
                         status=QueueStatus.open, counter_date=date.today()))
    await db_session.commit()

    await login(client, admin.email, password)
    result = (await client.get("/api/admin/home")).json()
    assert result["organization_name"] == own.name
    assert result["queues"] == []
