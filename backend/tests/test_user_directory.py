from app.models.enums import UserRole
from tests.utils import login


async def test_directory_is_superadmin_only_and_contains_no_secrets(client, make_user, make_organization):
    org = await make_organization(name='Directory Clinic')
    staff, password = await make_user(email='directory-op@example.com', full_name='Directory Operator', role=UserRole.operator, organization_id=org.id)
    assert (await client.get('/api/sa/users')).status_code == 401
    await login(client, staff.email, password)
    assert (await client.get('/api/sa/users')).status_code == 403
    admin, password = await make_user(email='directory-admin@example.com', role=UserRole.org_admin, organization_id=org.id)
    await login(client, admin.email, password)
    assert (await client.get('/api/sa/users')).status_code == 403
    sa, password = await make_user(email='directory-sa@example.com', role=UserRole.superadmin)
    await login(client, sa.email, password)
    response = await client.get('/api/sa/users')
    assert response.status_code == 200
    row = next(item for item in response.json() if item['id'] == str(staff.id))
    assert row['organization_name'] == 'Directory Clinic'
    assert set(row) == {'id', 'email', 'full_name', 'role', 'organization_id', 'organization_name', 'is_active', 'totp_enabled', 'deleted_at'}
    assert next(item for item in response.json() if item['id'] == str(sa.id))['organization_id'] is None
