from datetime import date, datetime, timedelta, timezone
from io import BytesIO

import pytest
from openpyxl import load_workbook

from app.clock import utcnow
from app.models.cabinet import Cabinet
from app.models.enums import CabinetStatus, Language, QueueStatus, TicketSource, TicketStatus, UserRole
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.models.tv_screen import TVScreen
from tests.utils import login

pytestmark = pytest.mark.asyncio


async def test_problems_are_scoped_and_point_to_the_actual_blocker(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Проблемы")
    other = await make_organization(name="Другая организация")
    admin, password = await make_user(email="problems-admin@example.com", role=UserRole.org_admin,
                                      organization_id=org.id)
    queue = Queue(organization_id=org.id, name="Терапия", ticket_prefix="T",
                  status=QueueStatus.open, counter_date=date.today())
    foreign = Queue(organization_id=other.id, name="Чужая очередь", ticket_prefix="X",
                    status=QueueStatus.open, counter_date=date.today())
    db_session.add_all([queue, foreign])
    await db_session.flush()
    cabinet = Cabinet(organization_id=org.id, queue_id=queue.id, label="Кабинет 1",
                      status=CabinetStatus.free)
    db_session.add_all([
        cabinet,
        Ticket(organization_id=org.id, queue_id=queue.id, number=1,
               display_number="T-001", status=TicketStatus.waiting, source=TicketSource.qr,
               created_at=utcnow() - timedelta(minutes=25)),
        Ticket(organization_id=other.id, queue_id=foreign.id, number=1,
               display_number="X-001", status=TicketStatus.waiting, source=TicketSource.qr,
               created_at=utcnow() - timedelta(minutes=40)),
        TVScreen(organization_id=org.id, name="Холл", device_token="problem-screen",
                 language=Language.ru, last_seen_at=utcnow() - timedelta(minutes=5)),
    ])
    await db_session.commit()
    await login(client, admin.email, password)

    result = await client.get("/api/admin/problems")
    assert result.status_code == 200, result.text
    problems = result.json()["items"]
    assert [item["code"] for item in problems] == ["long_wait", "screen_offline"]
    assert problems[0]["waiting_count"] == 1
    assert problems[0]["wait_minutes"] >= 25
    assert "Чужая очередь" not in str(problems)

    queue.status = QueueStatus.paused
    await db_session.commit()
    assert (await client.get("/api/admin/problems")).json()["items"][0]["code"] == "queue_not_open"
    queue.status = QueueStatus.open
    cabinet.status = CabinetStatus.offline
    await db_session.commit()
    assert (await client.get("/api/admin/problems")).json()["items"][0]["code"] == "no_cabinet"


async def test_daily_report_uses_organization_day_and_downloads_safe_excel(
    client, db_session, make_user, make_organization
):
    org = await make_organization(name="Отчёт")
    other = await make_organization(name="Чужой отчёт")
    admin, password = await make_user(email="report-admin@example.com", role=UserRole.org_admin,
                                      organization_id=org.id)
    queue = Queue(organization_id=org.id, name="=2+2", ticket_prefix="R",
                  status=QueueStatus.open, counter_date=date.today())
    foreign = Queue(organization_id=other.id, name="Чужая", ticket_prefix="X",
                    status=QueueStatus.open, counter_date=date.today())
    db_session.add_all([queue, foreign])
    await db_session.flush()
    # Asia/Almaty: 2026-09-23 19:00 UTC is 2026-09-24 00:00 local.
    start = datetime(2026, 9, 23, 19, 0, tzinfo=timezone.utc)
    db_session.add_all([
        Ticket(organization_id=org.id, queue_id=queue.id, number=1, display_number="R-001",
               status=TicketStatus.served, source=TicketSource.qr, created_at=start,
               called_at=start + timedelta(minutes=5),
               serving_started_at=start + timedelta(minutes=6),
               finished_at=start + timedelta(minutes=16)),
        Ticket(organization_id=org.id, queue_id=queue.id, number=2, display_number="R-002",
               status=TicketStatus.no_show, source=TicketSource.qr,
               created_at=start + timedelta(hours=1)),
        Ticket(organization_id=org.id, queue_id=queue.id, number=3, display_number="R-003",
               status=TicketStatus.waiting, source=TicketSource.qr,
               created_at=start + timedelta(hours=2)),
        Ticket(organization_id=org.id, queue_id=queue.id, number=4, display_number="R-004",
               status=TicketStatus.served, source=TicketSource.qr,
               created_at=start - timedelta(seconds=1)),
        Ticket(organization_id=other.id, queue_id=foreign.id, number=1, display_number="X-001",
               status=TicketStatus.served, source=TicketSource.qr, created_at=start),
    ])
    await db_session.commit()
    await login(client, admin.email, password)

    response = await client.get("/api/admin/daily-report?day=2026-09-24")
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["organization_name"] == "Отчёт"
    assert report["timezone"] == "Asia/Almaty"
    assert (report["issued_count"], report["served_count"], report["no_show_count"], report["active_count"]) == (3, 1, 1, 1)
    assert report["avg_wait_seconds"] == 300
    assert report["avg_serving_seconds"] == 600
    assert len(report["by_queue"]) == 1

    download = await client.get("/api/admin/daily-report.xlsx?day=2026-09-24")
    assert download.status_code == 200, download.text
    assert "attachment" in download.headers["content-disposition"]
    sheet = load_workbook(BytesIO(download.content), read_only=False).active
    assert sheet["B1"].value == "Отчёт"
    queue_name = next(cell for row in sheet for cell in row if cell.value == "=2+2")
    assert queue_name.data_type == "s"  # uploaded names cannot become Excel formulas


async def test_report_requires_admin(client):
    assert (await client.get("/api/admin/daily-report?day=2026-09-24")).status_code == 401
    assert (await client.get("/api/admin/daily-report.xlsx?day=2026-09-24")).status_code == 401
