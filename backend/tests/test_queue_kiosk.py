import asyncio
import hashlib
import uuid
from datetime import timedelta, time
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete, func, select, update

from app.api.queue_kiosk import IssueInput, device, issue_ticket
from app.clock import utcnow
from app.db import async_session_factory
from app.models.audit_log import AuditLog
from app.models.cabinet import Cabinet, CabinetOperator
from app.models.enums import CabinetStatus, QueueStatus, TicketSource, TicketStatus, UserRole
from app.models.queue import Queue, QueueSchedule
from app.models.queue_kiosk import QueueKiosk, QueueKioskIssue
from app.models.ticket import Ticket
from tests.test_registrar import _make_queue
from tests.test_ticket_integrity import scenario  # independent DB sessions for real locks
from tests.utils import login

ADMIN = '/api/admin/queue-kiosks'
PUBLIC = '/api/queue-kiosk'


async def setup(client, db, make_user, make_organization, printing=False):
    org = await make_organization()
    queue = await _make_queue(db, org, name='Consultation')
    second = await _make_queue(db, org, name='Laboratory', ticket_prefix='L')
    admin, password = await make_user(email='kiosk-admin@example.com', role=UserRole.org_admin, organization_id=org.id)
    await login(client, admin.email, password)
    config = dict(name='Entrance', queue_ids=[str(queue.id)], printing_enabled=printing, paper_width=80, language='ru')
    response = await client.post(ADMIN, json=config)
    assert response.status_code == 201, response.text
    station = response.json()
    pair = await client.post(f'{PUBLIC}/pair', json={'code': station['pairing_code']})
    assert pair.status_code == 200, pair.text
    token = pair.json()['device_token']
    return org, queue, second, station, config, {'X-Queue-Kiosk-Token': token}


async def test_pairing_is_one_use_revocable_and_separate_from_attendance(client, db_session, make_user, make_organization):
    org, queue, _, station, config, headers = await setup(client, db_session, make_user, make_organization)
    assert (await client.post(f'{PUBLIC}/pair', json={'code': station['pairing_code']})).status_code == 404
    assert (await client.get(f'{PUBLIC}/state')).status_code == 401
    assert (await client.get(f'{PUBLIC}/state', headers={'X-Kiosk-Token': headers['X-Queue-Kiosk-Token']})).status_code == 401
    assert (await client.get('/api/attendance/kiosk/state', headers={'X-Kiosk-Token': headers['X-Queue-Kiosk-Token']})).status_code == 401
    state = (await client.get(f'{PUBLIC}/state', headers=headers)).json()
    assert [q['id'] for q in state['queues']] == [str(queue.id)]
    assert state['printing_enabled'] is False
    assert 'token_digest' not in state and 'pairing_code' not in state
    assert (await client.get(ADMIN)).json()[0]['pairing_code'] is None
    new = (await client.post(f"{ADMIN}/{station['id']}/unpair")).json()
    assert new['pairing_code']
    assert (await client.get(f'{PUBLIC}/state', headers=headers)).status_code == 401
    item = await db_session.get(QueueKiosk, uuid.UUID(station['id']))
    item.pairing_expires_at = utcnow() - timedelta(seconds=1)
    await db_session.commit()
    assert (await client.post(f'{PUBLIC}/pair', json={'code': new['pairing_code']})).status_code == 404


async def test_ticket_retries_reprint_and_setting_change_never_duplicate_ticket(client, db_session, make_user, make_organization):
    org, queue, second, station, config, headers = await setup(client, db_session, make_user, make_organization, printing=True)
    payload = dict(queue_id=str(queue.id), request_id=str(uuid.uuid4()))
    first = await client.post(f'{PUBLIC}/tickets', headers=headers, json=payload)
    assert first.status_code == 201, first.text
    result = first.json()
    assert result['display_number'] == 'A-001' and result['ahead'] == 0
    ticket = await db_session.get(Ticket, uuid.UUID(result['ticket_id']))
    assert ticket.source == TicketSource.kiosk and ticket.client_id is None
    assert ticket.status == TicketStatus.waiting
    assert (await client.post(f'{PUBLIC}/tickets', headers=headers, json=payload)).json()['ticket_id'] == result['ticket_id']
    assert (await client.post(f'{PUBLIC}/tickets', headers=headers, json={**payload, 'queue_id': str(second.id)})).status_code == 409
    assert (await client.get(f"{PUBLIC}/receipts/{payload['request_id']}", headers=headers)).json()['ticket_id'] == result['ticket_id']
    for _ in range(2):
        printed = await client.post(f"{PUBLIC}/receipts/{payload['request_id']}/print", headers=headers)
        assert printed.status_code == 200
        assert printed.json()['display_number'] == 'A-001'
    await client.patch(f"{ADMIN}/{station['id']}", json={**config, 'printing_enabled': False})
    assert (await client.post(f"{PUBLIC}/receipts/{payload['request_id']}/print", headers=headers)).status_code == 409
    assert (await client.post(f'{PUBLIC}/tickets', headers=headers, json=payload)).json()['printing_enabled'] is False
    assert await db_session.scalar(select(func.count()).select_from(Ticket).where(Ticket.organization_id == org.id)) == 1
    actions = (await db_session.scalars(select(AuditLog.action).where(AuditLog.organization_id == org.id))).all()
    assert actions.count('ticket.created') == 1 and actions.count('queue_kiosk.print_requested') == 2
    assert (await client.delete(f"{ADMIN}/{station['id']}")).status_code == 204
    assert (await client.get(f'{PUBLIC}/state', headers=headers)).status_code == 401
    assert await db_session.get(Ticket, ticket.id) is not None


async def test_admin_tenant_role_and_selected_queue_boundaries(client, db_session, make_user, make_organization):
    org, queue, second, station, config, headers = await setup(client, db_session, make_user, make_organization)
    assert (await client.post(f'{PUBLIC}/tickets', headers=headers, json={'queue_id': str(second.id), 'request_id': str(uuid.uuid4())})).status_code == 404
    other = await make_organization(name='Other')
    foreign = await _make_queue(db_session, other)
    assert (await client.patch(f"{ADMIN}/{station['id']}", json={**config, 'queue_ids': [str(foreign.id)]})).status_code == 404
    assert (await client.post(f'{PUBLIC}/tickets', headers=headers, json={'queue_id': str(foreign.id), 'request_id': str(uuid.uuid4())})).status_code == 404
    person, pw = await make_user(email='kiosk-other@example.com', role=UserRole.org_admin, organization_id=other.id)
    await login(client, person.email, pw)
    assert (await client.get(ADMIN)).json() == []
    assert (await client.patch(f"{ADMIN}/{station['id']}", json=config)).status_code == 404
    assert (await client.post(f"{ADMIN}/{station['id']}/unpair")).status_code == 404
    assert (await client.delete(f"{ADMIN}/{station['id']}")).status_code == 404
    operator, pw = await make_user(email='kiosk-operator-role@example.com', role=UserRole.operator, organization_id=org.id)
    await login(client, operator.email, pw)
    assert (await client.get(ADMIN)).status_code == 403
    client.cookies.clear()
    assert (await client.post(ADMIN, json=config)).status_code == 401
    # Device access is revoked when its organization is disabled.
    org.is_active = False
    await db_session.commit()
    assert (await client.get(f'{PUBLIC}/state', headers=headers)).status_code == 401


@pytest.mark.parametrize('reason', ['queue_closed', 'queue_paused', 'outside_schedule', 'daily_limit_reached', 'archived'])
async def test_issue_obeys_current_queue_availability(client, db_session, make_user, make_organization, reason):
    org, queue, _, _, _, headers = await setup(client, db_session, make_user, make_organization)
    if reason == 'queue_closed': queue.status = QueueStatus.closed
    if reason == 'queue_paused': queue.status = QueueStatus.paused
    if reason == 'outside_schedule':
        db_session.add(QueueSchedule(queue_id=queue.id, weekday=utcnow().weekday(), opens_at=time(0), closes_at=time(0)))
    if reason == 'daily_limit_reached': queue.daily_ticket_limit = 0
    if reason == 'archived': queue.deleted_at = utcnow(); queue.is_active = False
    await db_session.commit()
    state = (await client.get(f'{PUBLIC}/state', headers=headers)).json()
    assert state['queues'] == [] if reason == 'archived' else state['queues'][0]['unavailable_reason'] == reason
    result = await client.post(f'{PUBLIC}/tickets', headers=headers, json={'queue_id': str(queue.id), 'request_id': str(uuid.uuid4())})
    assert result.status_code == (404 if reason == 'archived' else 422)
    assert await db_session.scalar(select(func.count()).select_from(Ticket).where(Ticket.organization_id == org.id)) == 0


async def test_kiosk_ticket_reaches_normal_operator_flow_and_receipts_are_device_scoped(client, db_session, make_user, make_organization):
    org, queue, _, station, config, headers = await setup(client, db_session, make_user, make_organization)
    first = (await client.post(f'{PUBLIC}/tickets', headers=headers, json={'queue_id': str(queue.id), 'request_id': str(uuid.uuid4())})).json()
    second = (await client.post(f'{PUBLIC}/tickets', headers=headers, json={'queue_id': str(queue.id), 'request_id': str(uuid.uuid4())})).json()
    assert second['ahead'] == 1
    another = (await client.post(ADMIN, json={**config, 'name': 'Other device'})).json()
    token = (await client.post(f'{PUBLIC}/pair', json={'code': another['pairing_code']})).json()['device_token']
    assert (await client.get(f"{PUBLIC}/receipts/{first['request_id']}", headers={'X-Queue-Kiosk-Token': token})).status_code == 404
    cabinet = Cabinet(organization_id=org.id, queue_id=queue.id, label='12', status=CabinetStatus.free)
    db_session.add(cabinet); await db_session.flush()
    operator, pw = await make_user(email='kiosk-flow@example.com', role=UserRole.operator, organization_id=org.id)
    db_session.add(CabinetOperator(cabinet_id=cabinet.id, user_id=operator.id)); await db_session.commit()
    await login(client, operator.email, pw)
    await client.post(f'/api/operator/cabinets/{cabinet.id}/select')
    called = await client.post('/api/operator/call-next')
    assert called.json()['id'] == first['ticket_id']
    assert (await client.post(f"/api/operator/tickets/{first['ticket_id']}/start")).status_code == 200
    assert (await client.post(f"/api/operator/tickets/{first['ticket_id']}/finish")).status_code == 200
    assert (await client.post('/api/operator/call-next')).json()['id'] == second['ticket_id']


async def test_settings_reject_invalid_configuration(client, db_session, make_user, make_organization):
    _, _, _, station, config, _ = await setup(client, db_session, make_user, make_organization)
    for change in ({'name': ' '}, {'name': None}, {'paper_width': 42}, {'queue_ids': []}, {'language': 'xx'}, {'queue_ids': config['queue_ids'] * 2}):
        assert (await client.patch(f"{ADMIN}/{station['id']}", json={**config, **change})).status_code == 422


@pytest.mark.parametrize('same_request', [True, False])
async def test_concurrent_issue_has_durable_idempotency_and_unique_numbers(scenario, same_request):
    token = 'a' * 64
    async with async_session_factory() as db:
        await db.execute(update(Queue).where(Queue.id == scenario['queues'][0]).values(status=QueueStatus.open))
        station = QueueKiosk(organization_id=scenario['org'], name='Concurrent kiosk', queue_ids=[scenario['queues'][0]],
                             token_digest=hashlib.sha256(token.encode()).hexdigest())
        db.add(station); await db.commit(); kiosk_id = station.id
    request_id = uuid.uuid4()
    barrier = asyncio.Barrier(6)
    async def submit():
        async with async_session_factory() as db:
            await barrier.wait()
            item = await device(db=db, token=token)
            result = await issue_ticket(IssueInput(queue_id=scenario['queues'][0], request_id=request_id if same_request else uuid.uuid4()), item=item, db=db, redis=AsyncMock())
            await db.commit()
            return result['display_number']
    try:
        numbers = await asyncio.wait_for(asyncio.gather(*(submit() for _ in range(6))), timeout=15)
        assert len(set(numbers)) == (1 if same_request else 6)
        async with async_session_factory() as db:
            assert await db.scalar(select(func.count()).select_from(QueueKioskIssue).where(QueueKioskIssue.kiosk_id == kiosk_id)) == (1 if same_request else 6)
    finally:
        async with async_session_factory() as db:
            await db.execute(delete(QueueKioskIssue).where(QueueKioskIssue.kiosk_id == kiosk_id))
            await db.execute(delete(QueueKiosk).where(QueueKiosk.id == kiosk_id))
            await db.commit()
