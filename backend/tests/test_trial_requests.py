from sqlalchemy import select
from app.models.trial_request import TrialRequest
from app.models.audit_log import AuditLog
from app.models.enums import UserRole
from tests.utils import login


async def test_trial_request_is_persisted_and_only_superadmin_can_process(client, db_session, make_user, make_organization):
    response = await client.post('/api/public/trial-requests', json={'name': '  Ada  ', 'organization': 'Clinic', 'contact': 'ada@example.com'})
    assert response.status_code == 201
    entry = (await db_session.execute(select(TrialRequest))).scalar_one()
    assert entry.name == 'Ada'
    assert not entry.processed
    assert (await client.get('/api/sa/trial-requests')).status_code == 401
    org = await make_organization()
    _, password = await make_user(email='lead-admin@example.com', role=UserRole.org_admin, organization_id=org.id)
    await login(client, 'lead-admin@example.com', password)
    assert (await client.get('/api/sa/trial-requests')).status_code == 403
    _, password = await make_user(email='lead-sa@example.com', role=UserRole.superadmin)
    await login(client, 'lead-sa@example.com', password)
    response = await client.get('/api/sa/trial-requests')
    assert response.status_code == 200
    assert response.json()[0]['contact'] == 'ada@example.com'
    response = await client.patch(f'/api/sa/trial-requests/{entry.id}', json={'processed': True})
    assert response.status_code == 200
    assert response.json()['processed'] is True
    assert (await db_session.execute(select(AuditLog).where(AuditLog.entity_id == entry.id))).scalar_one().action == 'trial_request.updated'


async def test_trial_request_rejects_empty_and_oversized_fields(client):
    for changes in ({'name': ' '}, {'contact': ''}, {'organization': 'a' * 201}):
        data = {'name': 'Ada', 'contact': 'ada@example.com', **changes}
        assert (await client.post('/api/public/trial-requests', json=data)).status_code == 422
