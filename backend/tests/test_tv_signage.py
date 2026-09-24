from io import BytesIO

from openpyxl import Workbook

from app.models.enums import UserRole
from app.models.tv_media import TVMedia
from app.media import TV_MEDIA_CHUNK_BYTES
from tests.utils import login


def schedule_xlsx(rows):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Расписание"
    sheet.append(["Отделение", "Врач", "Специализация", "Кабинет", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"])
    for row in rows:
        sheet.append(row)
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


async def test_excel_import_replaces_only_named_departments_atomically(client, make_user, make_organization):
    org_a = await make_organization(name="Import Clinic A")
    org_b = await make_organization(name="Import Clinic B")
    admin_a, password_a = await make_user(
        email="import-admin-a@example.com", role=UserRole.org_admin, organization_id=org_a.id
    )
    admin_b, password_b = await make_user(
        email="import-admin-b@example.com", role=UserRole.org_admin, organization_id=org_b.id
    )
    await login(client, admin_a.email, password_a)
    existing = (await client.post("/api/admin/departments", json={"name": "Кардиология"})).json()
    untouched = (await client.post("/api/admin/departments", json={"name": "Лаборатория"})).json()
    old = {"doctor_name": "Старый врач", "weekday": 0, "starts_at": "08:00", "ends_at": "09:00"}
    assert (await client.post(f"/api/admin/departments/{existing['id']}/schedule", json=old)).status_code == 201
    assert (await client.post(f"/api/admin/departments/{untouched['id']}/schedule", json=old)).status_code == 201

    rows = [
        ["Кардиология", "Айгуль Садыкова", "Кардиолог", "12", "09:00–13:00", "", "", "", "", "", "10:00–12:00"],
        ["Терапия", "Асхат Нуров", "Терапевт", "5", "", "", "14:00–18:00", "", "", "", ""],
    ]
    imported = await client.post("/api/admin/departments/import", content=schedule_xlsx(rows),
                                 headers={"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})
    assert imported.status_code == 200, imported.text
    assert imported.json() == {"departments": 2, "created_departments": 1, "schedule_items": 3}
    cardiology = (await client.get(f"/api/admin/departments/{existing['id']}/schedule")).json()
    assert [(item["weekday"], item["doctor_name"]) for item in cardiology] == [
        (0, "Айгуль Садыкова"), (6, "Айгуль Садыкова")]
    assert (await client.get(f"/api/admin/departments/{untouched['id']}/schedule")).json()[0]["doctor_name"] == "Старый врач"
    assert {department["name"] for department in (await client.get("/api/admin/departments")).json()} == {
        "Кардиология", "Лаборатория", "Терапия"}

    bad_rows = rows + [["Неврология", "Неверный врач", "", "1", "", "", "", "17:00–09:00", "", "", ""]]
    invalid = await client.post("/api/admin/departments/import", content=schedule_xlsx(bad_rows))
    assert invalid.status_code == 422 and invalid.json()["detail"] == {"code": "invalid_schedule_row", "row": 4}
    assert (await client.get(f"/api/admin/departments/{existing['id']}/schedule")).json() == cardiology

    await login(client, admin_b.email, password_b)
    assert (await client.get("/api/admin/departments")).json() == []
    other_import = await client.post("/api/admin/departments/import", content=schedule_xlsx([rows[0]]))
    assert other_import.status_code == 200
    await login(client, admin_a.email, password_a)
    assert (await client.get(f"/api/admin/departments/{existing['id']}/schedule")).json() == cardiology


async def test_excel_import_rejects_bad_template_and_duplicate_rows(client, make_user, make_organization):
    org = await make_organization(name="Import Validation Clinic")
    admin, password = await make_user(
        email="import-validation@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    await login(client, admin.email, password)
    assert (await client.post("/api/admin/departments/import", content=b"not an xlsx")).json()["detail"]["code"] == "invalid_excel_format"
    empty = await client.post("/api/admin/departments/import", content=schedule_xlsx([]))
    assert empty.status_code == 422 and empty.json()["detail"]["code"] == "empty_schedule_file"
    row = ["Терапия", "Асхат Нуров", "", "5", "", "", "", "", "10:00–16:00", "", ""]
    duplicate = await client.post("/api/admin/departments/import", content=schedule_xlsx([row, row]))
    assert duplicate.status_code == 422 and duplicate.json()["detail"] == {"code": "duplicate_schedule_row", "row": 3}
    two_periods = row.copy()
    two_periods[8] = "10:00–12:00; 14:00–16:00"
    invalid_period = await client.post("/api/admin/departments/import", content=schedule_xlsx([two_periods]))
    assert invalid_period.status_code == 422 and invalid_period.json()["detail"] == {"code": "invalid_schedule_row", "row": 2}
    assert (await client.get("/api/admin/departments")).json() == []


async def test_department_schedule_is_tenant_scoped_and_visible_only_on_schedule_tv(
    client, make_user, make_organization,
):
    org_a = await make_organization(name="Signage Clinic A")
    org_b = await make_organization(name="Signage Clinic B")
    admin_a, password_a = await make_user(
        email="signage-admin-a@example.com", role=UserRole.org_admin, organization_id=org_a.id
    )
    admin_b, password_b = await make_user(
        email="signage-admin-b@example.com", role=UserRole.org_admin, organization_id=org_b.id
    )
    await login(client, admin_a.email, password_a)
    department_response = await client.post("/api/admin/departments", json={"name": "Кардиология"})
    assert department_response.status_code == 201, department_response.text
    department_id = department_response.json()["id"]
    item_response = await client.post(f"/api/admin/departments/{department_id}/schedule", json={
        "doctor_name": "Доктор Айгуль", "service_name": "Кардиолог", "room": "12",
        "weekday": 0, "starts_at": "09:00", "ends_at": "13:00",
    })
    assert item_response.status_code == 201, item_response.text
    item_id = item_response.json()["id"]
    bad_interval = await client.patch(
        f"/api/admin/departments/{department_id}/schedule/{item_id}", json={"ends_at": "08:00"}
    )
    assert bad_interval.status_code == 422

    screen_response = await client.post("/api/admin/tv-screens", json={
        "name": "Расписание холла", "display_mode": "schedule", "slide_seconds": 12,
    })
    assert screen_response.status_code == 201, screen_response.text
    screen_id = screen_response.json()["id"]
    code = screen_response.json()["pairing_code"]
    pair = await client.post("/api/tv/pair", json={"code": code})
    assert pair.status_code == 200, pair.text
    state_response = await client.get("/api/tv/state", headers={"X-Device-Token": pair.json()["device_token"]})
    assert state_response.status_code == 200, state_response.text
    state = state_response.json()
    assert state["display_mode"] == "schedule" and state["slide_seconds"] == 12
    assert state["timezone"] == org_a.timezone
    assert state["departments"][0]["name"] == "Кардиология"
    assert state["departments"][0]["entries"][0]["doctor_name"] == "Доктор Айгуль"
    assert state["media"] == [] and state["queues"] == []
    changed = await client.patch(f"/api/admin/tv-screens/{screen_id}", json={"display_mode": "media"})
    assert changed.status_code == 200 and changed.json()["display_mode"] == "media"
    media_state = (await client.get("/api/tv/state", headers={"X-Device-Token": pair.json()["device_token"]})).json()
    assert media_state["display_mode"] == "media" and media_state["departments"] == []

    await login(client, admin_b.email, password_b)
    assert (await client.get("/api/admin/departments")).json() == []
    assert (await client.patch(f"/api/admin/departments/{department_id}", json={"name": "Чужое"})).status_code == 404
    assert (await client.delete(f"/api/admin/departments/{department_id}/schedule/{item_id}")).status_code == 404
    assert (await client.patch(f"/api/admin/tv-screens/{screen_id}", json={"display_mode": "queue"})).status_code == 404


async def test_media_upload_limit_streaming_and_ad_opt_in(client, make_user, make_organization):
    org = await make_organization(name="Media Clinic")
    admin, password = await make_user(
        email="media-admin@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    superadmin, superadmin_password = await make_user(
        email="media-superadmin@example.com", role=UserRole.superadmin
    )
    await login(client, admin.email, password)
    limits = (await client.get("/api/admin/tv-media/limits")).json()
    assert limits["max_video_bytes"] == 50 * 1024 * 1024
    rejected = await client.post("/api/admin/tv-media", json={
        "title": "Too large", "kind": "video", "mime_type": "video/mp4",
        "size_bytes": 50 * 1024 * 1024 + 1,
    })
    assert rejected.status_code == 413 and rejected.json()["detail"]["code"] == "media_too_large"

    data = b"\x00\x00\x00\x0cftypisom"
    created = await client.post("/api/admin/tv-media", json={
        "title": "Announcement", "kind": "advertisement", "mime_type": "video/mp4",
        "size_bytes": len(data),
    })
    assert created.status_code == 201, created.text
    media_id = created.json()["id"]
    assert (await client.post(f"/api/admin/tv-media/{media_id}/complete")).status_code == 409
    chunk = await client.put(f"/api/admin/tv-media/{media_id}/chunks/0", content=data,
                             headers={"Content-Type": "application/octet-stream"})
    assert chunk.status_code == 200, chunk.text
    assert chunk.json()["uploaded_bytes"] == len(data)
    assert (await client.post(f"/api/admin/tv-media/{media_id}/complete")).status_code == 200
    range_response = await client.get(f"/api/tv/media/{media_id}", headers={"Range": "bytes=4-7"})
    assert range_response.status_code == 206 and range_response.content == b"ftyp"
    assert range_response.headers["content-range"] == f"bytes 4-7/{len(data)}"

    screen = await client.post("/api/admin/tv-screens", json={"name": "Ad board", "display_mode": "media"})
    device_token = (await client.post("/api/tv/pair", json={"code": screen.json()["pairing_code"]})).json()["device_token"]
    state = (await client.get("/api/tv/state", headers={"X-Device-Token": device_token})).json()
    assert state["media"] == []  # Ads are opt-in per screen.
    assert state["departments"] == [] and state["queues"] == []
    assert (await client.patch(f"/api/admin/tv-screens/{screen.json()['id']}", json={"ads_enabled": True})).status_code == 200
    state = (await client.get("/api/tv/state", headers={"X-Device-Token": device_token})).json()
    assert state["media"][0]["id"] == media_id

    await login(client, superadmin.email, superadmin_password)
    upgraded = await client.patch(f"/api/sa/organizations/{org.id}", json={"video_large_upload_enabled": True})
    assert upgraded.status_code == 200 and upgraded.json()["video_large_upload_enabled"] is True
    await login(client, admin.email, password)
    assert (await client.get("/api/admin/tv-media/limits")).json()["max_video_bytes"] == 100 * 1024 * 1024
    after_upgrade = await client.post("/api/admin/tv-media", json={
        "title": "Extended", "kind": "video", "mime_type": "video/mp4",
        "size_bytes": 50 * 1024 * 1024 + 1,
    })
    assert after_upgrade.status_code == 201, after_upgrade.text


async def test_media_screen_can_repeat_all_or_only_selected_assets(
    client, db_session, make_user, make_organization,
):
    org = await make_organization(name="Playlist Clinic")
    other_org = await make_organization(name="Other Playlist Clinic")
    admin, password = await make_user(
        email="playlist-admin@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    first = TVMedia(organization_id=org.id, title="First", kind="video", mime_type="video/mp4",
                    size_bytes=1, uploaded_bytes=1, is_ready=True, is_active=True, sort_order=0)
    second = TVMedia(organization_id=org.id, title="Second", kind="video", mime_type="video/mp4",
                     size_bytes=1, uploaded_bytes=1, is_ready=True, is_active=True, sort_order=1)
    foreign = TVMedia(organization_id=other_org.id, title="Foreign", kind="video", mime_type="video/mp4",
                      size_bytes=1, uploaded_bytes=1, is_ready=True, is_active=True, sort_order=0)
    db_session.add_all([first, second, foreign])
    await db_session.flush()
    await login(client, admin.email, password)

    created = await client.post("/api/admin/tv-screens", json={
        "name": "Selected clips", "display_mode": "media", "media_playlist_mode": "selected",
        "selected_media_ids": [str(second.id)],
    })
    assert created.status_code == 201, created.text
    screen = created.json()
    assert screen["media_playlist_mode"] == "selected" and screen["selected_media_ids"] == [str(second.id)]
    token = (await client.post("/api/tv/pair", json={"code": screen["pairing_code"]})).json()["device_token"]

    async def media_ids():
        state = (await client.get("/api/tv/state", headers={"X-Device-Token": token})).json()
        return [item["id"] for item in state["media"]]

    assert await media_ids() == [str(second.id)]
    changed = await client.patch(f"/api/admin/tv-screens/{screen['id']}", json={"media_playlist_mode": "all"})
    assert changed.status_code == 200 and await media_ids() == [str(first.id), str(second.id)]
    changed = await client.patch(f"/api/admin/tv-screens/{screen['id']}", json={
        "media_playlist_mode": "selected", "selected_media_ids": [str(first.id), str(first.id)],
    })
    assert changed.status_code == 200 and changed.json()["selected_media_ids"] == [str(first.id)]
    assert await media_ids() == [str(first.id)]
    assert (await client.patch(f"/api/admin/tv-screens/{screen['id']}", json={
        "selected_media_ids": [str(foreign.id)],
    })).status_code == 404
    assert await media_ids() == [str(first.id)]
    assert (await client.post("/api/admin/tv-screens", json={
        "name": "Invalid", "display_mode": "media", "selected_media_ids": [str(foreign.id)],
    })).status_code == 404


async def test_media_upload_rejects_mismatched_content_and_other_org_access(
    client, make_user, make_organization,
):
    org_a = await make_organization(name="Upload Guard A")
    org_b = await make_organization(name="Upload Guard B")
    admin_a, password_a = await make_user(
        email="upload-guard-a@example.com", role=UserRole.org_admin, organization_id=org_a.id
    )
    admin_b, password_b = await make_user(
        email="upload-guard-b@example.com", role=UserRole.org_admin, organization_id=org_b.id
    )
    await login(client, admin_a.email, password_a)
    media = await client.post("/api/admin/tv-media", json={
        "title": "Wrong bytes", "kind": "video", "mime_type": "video/mp4", "size_bytes": 12,
    })
    media_id = media.json()["id"]
    assert (await client.put(f"/api/admin/tv-media/{media_id}/chunks/0", content=b"bad",
                             headers={"Content-Type": "application/octet-stream"})).status_code == 422
    assert (await client.put(f"/api/admin/tv-media/{media_id}/chunks/0", content=b"not a video!",
                             headers={"Content-Type": "application/octet-stream"})).status_code == 200
    invalid = await client.post(f"/api/admin/tv-media/{media_id}/complete")
    assert invalid.status_code == 422 and invalid.json()["detail"]["code"] == "invalid_media_format"
    assert (await client.get(f"/api/tv/media/{media_id}")).status_code == 404

    await login(client, admin_b.email, password_b)
    assert (await client.get("/api/admin/tv-media")).json() == []
    assert (await client.delete(f"/api/admin/tv-media/{media_id}")).status_code == 404
    assert (await client.put(f"/api/admin/tv-media/{media_id}/chunks/0", content=b"not a video!",
                             headers={"Content-Type": "application/octet-stream"})).status_code == 404


async def test_tv_media_range_can_cross_upload_chunks(client, make_user, make_organization):
    org = await make_organization(name="Range Clinic")
    admin, password = await make_user(
        email="range-admin@example.com", role=UserRole.org_admin, organization_id=org.id
    )
    await login(client, admin.email, password)
    data = b"\x89PNG\r\n\x1a\n" + b"A" * (TV_MEDIA_CHUNK_BYTES - 8) + b"BCDE"
    created = await client.post("/api/admin/tv-media", json={
        "title": "Poster", "kind": "advertisement", "mime_type": "image/png", "size_bytes": len(data),
    })
    assert created.status_code == 201, created.text
    media_id = created.json()["id"]
    for index in range(2):
        response = await client.put(f"/api/admin/tv-media/{media_id}/chunks/{index}",
                                    content=data[index * TV_MEDIA_CHUNK_BYTES:(index + 1) * TV_MEDIA_CHUNK_BYTES],
                                    headers={"Content-Type": "application/octet-stream"})
        assert response.status_code == 200, response.text
    assert (await client.post(f"/api/admin/tv-media/{media_id}/complete")).status_code == 200
    response = await client.get(f"/api/tv/media/{media_id}",
                                headers={"Range": f"bytes={TV_MEDIA_CHUNK_BYTES - 2}-{TV_MEDIA_CHUNK_BYTES + 2}"})
    assert response.status_code == 206 and response.content == b"AABCD"
    invalid = await client.get(f"/api/tv/media/{media_id}", headers={"Range": "bytes=99999999-"})
    assert invalid.status_code == 416
