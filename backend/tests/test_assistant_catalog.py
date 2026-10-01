from app.api.assistant import _parse_model_answer
from app.assistant_catalog import action_allowed, capabilities_for_role, catalog_text


def test_catalog_is_role_scoped_and_contains_full_admin_navigation():
    admin_ids = {item.id for item in capabilities_for_role("org_admin")}
    assert {
        "admin.organization",
        "queue.create",
        "cabinet.assign",
        "attendance.employee.import",
        "attendance.geo",
        "tv.manage",
        "signage.media",
    } <= admin_ids
    assert "sa.organization.create" not in admin_ids
    assert "/admin/tv-screens" in catalog_text("org_admin")


def test_model_action_is_accepted_only_for_the_signed_in_role():
    answer, action_id = _parse_model_answer(
        '{"answer":"Откройте ТВ-экраны.","action_id":"tv.manage"}',
        "org_admin",
    )
    assert answer == "Откройте ТВ-экраны."
    assert action_id == "tv.manage"
    assert action_allowed("tv.manage", "superadmin") is False

    _, forbidden_action = _parse_model_answer(
        '{"answer":"Откройте организации.","action_id":"sa.organization.create"}',
        "org_admin",
    )
    assert forbidden_action is None


def test_plain_model_answer_remains_usable_without_an_action():
    assert _parse_model_answer("Краткий ответ", "operator") == ("Краткий ответ", None)
