import uuid
from datetime import date
from io import BytesIO

import pytest
from openpyxl import load_workbook
from sqlalchemy import select

from app.models.attendance import AttendanceDepartment, Employee
from app.models.audit_log import AuditLog
from app.models.department import Department, DepartmentScheduleItem
from app.models.enums import UserRole
from tests.test_attendance import employee_workbook
from tests.utils import login

BASE = '/api/attendance/admin/departments'


async def setup_admin(client, make_user, make_organization):
    org = await make_organization(name='Independent attendance')
    user, password = await make_user(email='directory-admin@example.com', role=UserRole.org_admin, organization_id=org.id)
    await login(client, user.email, password)
    return org


async def test_attendance_directory_is_independent_of_tv_and_doctors(client, db_session, make_user, make_organization):
    org = await setup_admin(client, make_user, make_organization)
    tv = Department(organization_id=org.id, name='TV only')
    db_session.add(tv)
    await db_session.flush()
    from datetime import time
    db_session.add(DepartmentScheduleItem(department_id=tv.id, doctor_name='TV doctor', weekday=0,
        starts_at=time(9), ends_at=time(18)))
    await db_session.commit()
    assert (await client.get(BASE)).json() == []
    assert (await client.get('/api/attendance/admin/employees')).json() == []
    rejected = await client.post('/api/attendance/admin/employees', json={'full_name': 'Worker', 'department_id': str(tv.id)})
    assert rejected.status_code == 404
    own = await client.post(BASE, json={'name': 'TV only'})
    assert own.status_code == 201
    directory = own.json()
    assert directory['id'] != str(tv.id)
    created = await client.post('/api/attendance/admin/employees', json={'full_name': 'Worker', 'department_id': directory['id']})
    assert created.status_code == 201
    employee_id = uuid.UUID(created.json()['id'])
    # Deleting/renaming TV departments must never modify attendance employees.
    assert (await client.patch(f'/api/admin/departments/{tv.id}', json={'name': 'TV renamed'})).status_code == 200
    assert (await client.delete(f'/api/admin/departments/{tv.id}')).status_code == 204
    assert (await client.get('/api/attendance/admin/employees')).json()[0]['department'] == 'TV only'
    own_id = directory['id']
    renamed = await client.patch(f'{BASE}/{own_id}', json={'name': 'HR renamed'})
    assert renamed.status_code == 200
    await db_session.refresh(await db_session.get(Employee, employee_id))
    people = (await client.get('/api/attendance/admin/employees')).json()
    assert people[0]['department'] == 'HR renamed'
    assert (await client.get('/api/admin/departments')).json() == []
    assert (await client.get('/api/attendance/admin/stats')).json()['departments'][0]['name'] == 'HR renamed'
    report = (await client.get('/api/attendance/admin/calendar?month=2026-10')).json()
    assert report['rows'][0]['department'] == 'HR renamed'


async def test_directory_archive_restore_validation_and_audit(client, db_session, make_user, make_organization):
    org = await setup_admin(client, make_user, make_organization)
    assert (await client.post(BASE, json={'name': '   '})).status_code == 422
    assert (await client.post(BASE, json={'name': None})).status_code == 422
    assert (await client.post(BASE, json={'name': 'x' * 201})).status_code == 422
    item = (await client.post(BASE, json={'name': '  Finance  '})).json()
    own_id = item['id']
    assert item['name'] == 'Finance'
    assert (await client.post(BASE, json={'name': 'finance'})).status_code == 409
    assert (await client.patch(f'{BASE}/{own_id}', json={'name': None})).status_code == 422
    employee = (await client.post('/api/attendance/admin/employees', json={'full_name': 'Accountant', 'department_id': own_id})).json()
    assert (await client.delete(f'{BASE}/{own_id}')).status_code == 409
    assert (await client.delete(f"/api/attendance/admin/employees/{employee['id']}")).status_code == 204
    assert (await client.delete(f'{BASE}/{own_id}')).status_code == 204
    assert (await client.post(BASE, json={'name': 'Finance'})).status_code == 409
    assert (await client.get(BASE)).json()[0]['is_active'] is False
    blocked = await client.post('/api/attendance/admin/employees', json={'full_name': 'New accountant', 'department_id': own_id})
    assert blocked.status_code == 422
    assert (await client.post(f'{BASE}/{own_id}/restore')).json()['is_active'] is True
    assert await db_session.get(AttendanceDepartment, uuid.UUID(own_id)) is not None
    actions = (await db_session.scalars(select(AuditLog.action).where(AuditLog.organization_id == org.id))).all()
    assert {'attendance.department_created', 'attendance.department_archived', 'attendance.department_restored'} <= set(actions)


async def test_department_tenant_isolation_and_report_filter(client, make_user, make_organization):
    await setup_admin(client, make_user, make_organization)
    item = (await client.post(BASE, json={'name': 'Private HR'})).json()
    other_org = await make_organization(name='Other attendance')
    other, password = await make_user(email='other-directory@example.com', role=UserRole.org_admin, organization_id=other_org.id)
    await login(client, other.email, password)
    assert (await client.get(BASE)).json() == []
    assert (await client.patch(f"{BASE}/{item['id']}", json={'name': 'Hijack'})).status_code == 404
    assert (await client.delete(f"{BASE}/{item['id']}")).status_code == 404
    assert (await client.post(f"{BASE}/{item['id']}/restore")).status_code == 404
    assert (await client.post('/api/attendance/admin/employees', json={'full_name': 'Worker', 'department_id': item['id']})).status_code == 404
    today = date.today().isoformat()
    assert (await client.get(f"/api/attendance/admin/report?date_from={today}&date_to={today}&department_id={item['id']}")).status_code == 404


@pytest.mark.parametrize('role', [UserRole.operator, UserRole.registrar])
async def test_non_admin_cannot_manage_attendance_directory(client, make_user, make_organization, role):
    org = await make_organization()
    user, password = await make_user(email=f'directory-{role.value}@example.com', role=role, organization_id=org.id)
    await login(client, user.email, password)
    own_id = uuid.uuid4()
    assert (await client.get(BASE)).status_code == 403
    assert (await client.post(BASE, json={'name': 'Forbidden'})).status_code == 403
    assert (await client.patch(f'{BASE}/{own_id}', json={'name': 'Forbidden'})).status_code == 403
    assert (await client.delete(f'{BASE}/{own_id}')).status_code == 403
    assert (await client.post(f'{BASE}/{own_id}/restore')).status_code == 403


async def test_template_and_import_use_only_attendance_directory(client, db_session, make_user, make_organization):
    org = await setup_admin(client, make_user, make_organization)
    tv = Department(organization_id=org.id, name='TV doctor department')
    db_session.add(tv)
    await db_session.commit()
    own = (await client.post(BASE, json={'name': '=HR department'})).json()
    template = load_workbook(BytesIO((await client.get('/api/attendance/admin/employees/template')).content))
    assert list(template['Отделения'].values)[1:] == [('=HR department',)]
    assert template['Отделения']['A2'].data_type == 's'
    # The worksheet builder normally interprets leading '=' as a formula: use
    # a plain directory name for the import check (the export test above covers it).
    await client.patch(f"{BASE}/{own['id']}", json={'name': 'HR department'})
    invalid = employee_workbook([('HR employee', 'HR department', 'Worker'), ('TV doctor', tv.name, 'Doctor')])
    rejected = await client.post('/api/attendance/admin/employees/import', content=invalid)
    assert rejected.status_code == 422 and rejected.json()['detail']['row'] == 3
    assert (await client.get('/api/attendance/admin/employees')).json() == []
    valid = employee_workbook([('HR employee', 'HR department', 'Worker')])
    assert (await client.post('/api/attendance/admin/employees/import', content=valid)).status_code == 200
    assert len((await client.get('/api/admin/departments')).json()) == 1
    assert len((await client.get(BASE)).json()) == 1


async def test_tv_department_ids_rejected_in_employee_edit_and_calendar_filter(client, db_session, make_user, make_organization):
    org = await setup_admin(client, make_user, make_organization)
    tv = Department(organization_id=org.id, name='TV')
    db_session.add(tv)
    await db_session.commit()
    own = (await client.post(BASE, json={'name': 'Attendance'})).json()
    employee = (await client.post('/api/attendance/admin/employees', json={'full_name': 'Worker', 'department_id': own['id']})).json()
    edited = await client.patch(f"/api/attendance/admin/employees/{employee['id']}", json={'department_id': str(tv.id)})
    assert edited.status_code == 404
    filtered = await client.get(f'/api/attendance/admin/calendar?month=2026-10&department_id={tv.id}')
    assert filtered.status_code == 404
