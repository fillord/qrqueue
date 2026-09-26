from datetime import date

from sqlalchemy import select

from app.config import settings
from app.models.audit_log import AuditLog
from app.models.cabinet import Cabinet
from app.models.enums import TicketSource, TicketStatus, UserRole
from app.models.queue import Queue
from app.models.tv_screen import TVScreen
from app.models.department import Department
from app.models.ticket import Ticket
from tests.utils import login


async def test_organization_templates_create_inactive_setup(client, db_session, make_user):
    sa, password = await make_user(email='template-sa@example.com', role=UserRole.superadmin)
    await login(client, sa.email, password)
    for template, expected_screens in [('clinic', 2), ('service_center', 1)]:
        response = await client.post('/api/sa/organizations', json={
            'name': f'Template {template}', 'template': template,
        })
        assert response.status_code == 201, response.text
        org_id = response.json()['id']
        queues = list((await db_session.scalars(select(Queue).where(Queue.organization_id == org_id))).all())
        cabinets = list((await db_session.scalars(select(Cabinet).where(Cabinet.organization_id == org_id))).all())
        screens = list((await db_session.scalars(select(TVScreen).where(TVScreen.organization_id == org_id))).all())
        assert len(queues) == len(cabinets) == 3
        assert all(not queue.is_active and queue.status.value == 'closed' for queue in queues)
        assert all(not cabinet.is_active for cabinet in cabinets)
        assert len(screens) == expected_screens
        assert len({screen.pairing_code for screen in screens}) == expected_screens
        departments = list((await db_session.scalars(select(Department).where(Department.organization_id == org_id))).all())
        assert len(departments) == (1 if template == 'clinic' else 0)


async def test_superadmin_manages_and_archives_organization_and_users(client, make_user):
    sa, password = await make_user(email='crud-sa@example.com', role=UserRole.superadmin)
    await login(client, sa.email, password)

    response = await client.post('/api/sa/organizations', json={'name': 'Managed Clinic'})
    assert response.status_code == 201
    org_id = response.json()['id']
    response = await client.patch(f'/api/sa/organizations/{org_id}', json={'name': 'Updated Clinic', 'plan': 'pro'})
    assert response.status_code == 200
    assert response.json()['name'] == 'Updated Clinic' and response.json()['plan'] == 'pro'

    forbidden_role = await client.post('/api/sa/users', json={
        'email': 'second-sa@example.com', 'password': 'strong-pass-1234',
        'full_name': 'Second SA', 'role': 'superadmin', 'organization_id': org_id,
    })
    assert forbidden_role.status_code == 422

    response = await client.post('/api/sa/users', json={
        'email': 'managed-admin@example.com', 'password': 'strong-pass-1234',
        'full_name': 'Managed Admin', 'role': 'org_admin', 'organization_id': org_id,
    })
    assert response.status_code == 201, response.text
    user_id = response.json()['id']
    assert response.json()['organization_name'] == 'Updated Clinic'
    response = await client.patch(f'/api/sa/users/{user_id}', json={
        'email': 'renamed-admin@example.com', 'full_name': 'Renamed Admin', 'role': 'operator',
    })
    assert response.status_code == 200, response.text
    assert response.json()['email'] == 'renamed-admin@example.com' and response.json()['role'] == 'operator'

    assert (await client.delete(f'/api/sa/users/{sa.id}')).status_code == 404
    assert (await client.patch(f'/api/sa/users/{sa.id}', json={'full_name': 'Changed'})).status_code == 404
    assert (await client.delete(f'/api/sa/users/{user_id}')).status_code == 204
    assert all(item['id'] != user_id for item in (await client.get('/api/sa/users')).json())
    archived = (await client.get('/api/sa/users?include_archived=true')).json()
    assert next(item for item in archived if item['id'] == user_id)['deleted_at'] is not None
    response = await client.post(f'/api/sa/users/{user_id}/restore')
    assert response.status_code == 200 and response.json()['is_active'] is False

    assert (await client.delete(f'/api/sa/organizations/{org_id}')).status_code == 204
    assert all(item['id'] != org_id for item in (await client.get('/api/sa/organizations')).json())
    archived_org = next(item for item in (await client.get('/api/sa/organizations?include_archived=true')).json() if item['id'] == org_id)
    assert archived_org['deleted_at'] is not None
    assert all(item['id'] != user_id for item in (await client.get('/api/sa/users')).json())
    assert (await client.patch(f'/api/sa/organizations/{org_id}', json={'name': 'Bad edit'})).status_code == 404
    response = await client.post(f'/api/sa/organizations/{org_id}/restore')
    assert response.status_code == 200 and response.json()['is_active'] is False


async def test_org_admin_can_manage_only_own_staff(client, make_user, make_organization):
    org_a = await make_organization(name='CRUD A')
    org_b = await make_organization(name='CRUD B')
    admin, password = await make_user(email='crud-admin@example.com', role=UserRole.org_admin, organization_id=org_a.id)
    other, _ = await make_user(email='other-staff@example.com', role=UserRole.operator, organization_id=org_b.id)
    await login(client, admin.email, password)

    assert (await client.post('/api/sa/users', json={})).status_code == 403
    response = await client.post('/api/admin/users', json={
        'email': 'crud-staff@example.com', 'password': 'strong-pass-1234',
        'full_name': 'CRUD Staff', 'role': 'operator',
    })
    assert response.status_code == 201, response.text
    staff_id = response.json()['id']
    response = await client.patch(f'/api/admin/users/{staff_id}', json={'email': 'new-staff@example.com'})
    assert response.status_code == 200 and response.json()['email'] == 'new-staff@example.com'
    assert (await client.delete(f'/api/admin/users/{other.id}')).status_code == 404
    assert (await client.delete(f'/api/admin/users/{admin.id}')).status_code == 404
    assert (await client.delete(f'/api/admin/users/{staff_id}')).status_code == 204
    denied_login = await client.post('/api/auth/login', json={'email': 'new-staff@example.com', 'password': 'strong-pass-1234'})
    assert denied_login.status_code == 401
    assert all(item['id'] != staff_id for item in (await client.get('/api/admin/users')).json())
    assert next(item for item in (await client.get('/api/admin/users?include_archived=true')).json() if item['id'] == staff_id)['deleted_at'] is not None
    response = await client.post(f'/api/admin/users/{staff_id}/restore')
    assert response.status_code == 200 and response.json()['is_active'] is False


async def test_archiving_blocks_active_tickets(client, db_session, make_user, make_organization):
    org = await make_organization(name='Busy Clinic')
    staff, _ = await make_user(email='busy-staff@example.com', role=UserRole.operator, organization_id=org.id)
    queue = Queue(organization_id=org.id, name='Busy', ticket_prefix='B', counter_date=date.today())
    db_session.add(queue)
    await db_session.flush()
    ticket = Ticket(organization_id=org.id, queue_id=queue.id, number=1, display_number='B-001',
                    status=TicketStatus.called, source=TicketSource.registrar, called_by=staff.id)
    db_session.add(ticket)
    await db_session.commit()
    sa, password = await make_user(email='busy-sa@example.com', role=UserRole.superadmin)
    await login(client, sa.email, password)
    assert (await client.delete(f'/api/sa/users/{staff.id}')).json()['detail']['code'] == 'active_tickets'
    assert (await client.delete(f'/api/sa/organizations/{org.id}')).json()['detail']['code'] == 'active_tickets'


async def test_archived_organization_revokes_old_staff_sessions(client, make_user, make_organization):
    org = await make_organization(name='Archive Session Clinic')
    admin, password = await make_user(email='archive-session-admin@example.com', role=UserRole.org_admin, organization_id=org.id)
    sa, sa_password = await make_user(email='archive-session-sa@example.com', role=UserRole.superadmin)
    await login(client, admin.email, password)
    old_session = client.cookies.get(settings.jwt_cookie_name)
    await client.post('/api/auth/logout')
    await login(client, sa.email, sa_password)
    assert (await client.delete(f'/api/sa/organizations/{org.id}')).status_code == 204
    assert (await client.post(f'/api/sa/organizations/{org.id}/restore')).status_code == 200
    assert (await client.patch(f'/api/sa/organizations/{org.id}', json={'is_active': True})).status_code == 200
    client.cookies.set(settings.jwt_cookie_name, old_session)
    assert (await client.get('/api/auth/me')).status_code == 401


async def test_admin_archives_and_restores_cabinet_and_queue(client, db_session, make_user, make_organization):
    org = await make_organization(name='Archive Resources Clinic')
    admin, password = await make_user(email='archive-resources-admin@example.com', role=UserRole.org_admin, organization_id=org.id)
    await login(client, admin.email, password)
    queue_response = await client.post('/api/admin/queues', json={'name': 'Records', 'ticket_prefix': 'R'})
    assert queue_response.status_code == 201, queue_response.text
    queue_id = queue_response.json()['id']
    cabinet_response = await client.post('/api/admin/cabinets', json={'label': 'Room 1', 'queue_id': queue_id})
    assert cabinet_response.status_code == 201, cabinet_response.text
    cabinet_id = cabinet_response.json()['id']
    historical_ticket = Ticket(organization_id=org.id, queue_id=queue_id, cabinet_id=cabinet_id,
                               number=1, display_number='R-001', status=TicketStatus.served,
                               source=TicketSource.registrar)
    db_session.add(historical_ticket)
    await db_session.commit()

    response = await client.delete(f'/api/admin/queues/{queue_id}')
    assert response.status_code == 409 and response.json()['detail']['code'] == 'attached_cabinets'
    assert (await client.delete(f'/api/admin/cabinets/{cabinet_id}')).status_code == 204
    assert all(row['id'] != cabinet_id for row in (await client.get('/api/admin/cabinets')).json())
    archived_cabinet = next(row for row in (await client.get('/api/admin/cabinets?include_archived=true')).json() if row['id'] == cabinet_id)
    assert archived_cabinet['deleted_at'] and archived_cabinet['is_active'] is False
    assert (await client.patch(f'/api/admin/cabinets/{cabinet_id}', json={'label': 'Hidden'})).status_code == 404

    assert (await client.delete(f'/api/admin/queues/{queue_id}')).status_code == 204
    assert all(row['id'] != queue_id for row in (await client.get('/api/admin/queues')).json())
    archived_queue = next(row for row in (await client.get('/api/admin/queues?include_archived=true')).json() if row['id'] == queue_id)
    assert archived_queue['deleted_at'] and archived_queue['is_active'] is False
    assert (await client.patch(f'/api/admin/queues/{queue_id}', json={'name': 'Hidden'})).status_code == 404
    assert (await client.post('/api/admin/cabinets', json={'label': 'Blocked', 'queue_id': queue_id})).status_code == 404
    blocked_restore = await client.post(f'/api/admin/cabinets/{cabinet_id}/restore')
    assert blocked_restore.status_code == 409 and blocked_restore.json()['detail']['code'] == 'archived_queue'

    response = await client.post(f'/api/admin/queues/{queue_id}/restore')
    assert response.status_code == 200 and response.json()['is_active'] is False and response.json()['status'] == 'closed'
    response = await client.post(f'/api/admin/cabinets/{cabinet_id}/restore')
    assert response.status_code == 200 and response.json()['is_active'] is False and response.json()['status'] == 'offline'
    assert await db_session.get(Ticket, historical_ticket.id) is not None
    actions = (await db_session.scalars(select(AuditLog.action).where(
        AuditLog.organization_id == org.id,
        AuditLog.action.in_(['queue.archived', 'queue.restored', 'cabinet.archived', 'cabinet.restored']),
    ))).all()
    assert set(actions) == {'queue.archived', 'queue.restored', 'cabinet.archived', 'cabinet.restored'}


async def test_resource_archive_respects_tenant_and_active_tickets(client, db_session, make_user, make_organization):
    org = await make_organization(name='Archive Guard A')
    other_org = await make_organization(name='Archive Guard B')
    admin, password = await make_user(email='archive-guard-admin@example.com', role=UserRole.org_admin, organization_id=org.id)
    other_queue = Queue(organization_id=other_org.id, name='Other', ticket_prefix='O', counter_date=date.today())
    db_session.add(other_queue)
    await db_session.flush()
    other_cabinet = Cabinet(organization_id=other_org.id, queue_id=other_queue.id, label='Other room')
    db_session.add(other_cabinet)
    await db_session.commit()
    await login(client, admin.email, password)
    assert (await client.delete(f'/api/admin/queues/{other_queue.id}')).status_code == 404
    assert (await client.post(f'/api/admin/queues/{other_queue.id}/restore')).status_code == 404
    assert (await client.delete(f'/api/admin/cabinets/{other_cabinet.id}')).status_code == 404
    assert (await client.post(f'/api/admin/cabinets/{other_cabinet.id}/restore')).status_code == 404

    queue_response = await client.post('/api/admin/queues', json={'name': 'Busy', 'ticket_prefix': 'B'})
    queue_id = queue_response.json()['id']
    cabinet_response = await client.post('/api/admin/cabinets', json={'label': 'Room', 'queue_id': queue_id})
    cabinet_id = cabinet_response.json()['id']
    ticket = Ticket(organization_id=org.id, queue_id=queue_id, cabinet_id=cabinet_id,
                    number=1, display_number='B-001', status=TicketStatus.called, source=TicketSource.registrar)
    db_session.add(ticket)
    await db_session.commit()
    for path in (f'/api/admin/queues/{queue_id}', f'/api/admin/cabinets/{cabinet_id}'):
        response = await client.delete(path)
        assert response.status_code == 409 and response.json()['detail']['code'] == 'active_tickets'
