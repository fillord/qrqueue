from unittest.mock import AsyncMock
from app.clock import utcnow

from app.api.deps import current_client
from app.main import app
from app.models.client import Client
from app.models.enums import Language, TicketStatus
from app.redis import redis_client
from app.services import telegram, notifications
from tests.test_push_hooks import _make_queue, _make_subscribed_client, _make_waiting_ticket
from tests.test_workforce import setup_employee


def callback(chat_id, data):
    return {'callback_query': {'id': 'test-callback', 'data': data,
        'message': {'chat': {'id': chat_id, 'type': 'private'}}}}


async def test_private_single_use_employee_binding_and_stop(client, db_session, make_user, make_organization, monkeypatch):
    org, employee, admin = await setup_employee(client, db_session, make_user, make_organization)
    monkeypatch.setattr(telegram, 'enabled', lambda: True)
    monkeypatch.setattr(telegram.settings, 'telegram_bot_username', 'OmniBookTestBot')
    send = AsyncMock(return_value=True)
    monkeypatch.setattr(telegram, 'send_message', send)
    response = await client.post(f'/api/attendance/admin/employees/{employee.id}/telegram')
    assert response.status_code == 200
    code = response.json()['url'].split('=')[1]
    update = {'message': {'chat': {'id': 12345, 'type': 'group'}, 'text': f'/start {code}'}}
    try:
        await telegram.handle_update(db_session, redis_client, update)
        assert employee.telegram_chat_id is None
        update['message']['chat']['type'] = 'private'
        await telegram.handle_update(db_session, redis_client, update)
        assert employee.telegram_chat_id == 12345
        update['message']['chat']['id'] = 99999
        await telegram.handle_update(db_session, redis_client, update)
        assert employee.telegram_chat_id == 12345
        await telegram.handle_update(db_session, redis_client, {'message': {'chat': {'id': 12345, 'type': 'private'}, 'text': '/stop'}})
        assert employee.telegram_chat_id is None
    finally:
        await redis_client.delete(f'telegram:link:{code}')


async def test_ticket_cancel_checks_ownership_and_requires_confirmation(db_session, make_organization, monkeypatch):
    org = await make_organization(name='Telegram cancel')
    queue = await _make_queue(db_session, org)
    owner = await _make_subscribed_client(db_session, 'https://push.example.com/telegram-owner')
    owner.telegram_chat_id = 12345
    ticket = await _make_waiting_ticket(db_session, org, queue, number=1, client=owner)
    monkeypatch.setattr(telegram, 'send_message', AsyncMock(return_value=True))
    monkeypatch.setattr(telegram, 'bot_call', AsyncMock(return_value=True))
    await telegram.handle_update(db_session, redis_client, callback(99999, f'leave:{ticket.id}'))
    assert ticket.status == TicketStatus.waiting
    org.is_active = False
    await db_session.commit()
    await telegram.handle_update(db_session, redis_client, callback(12345, f'leave:{ticket.id}'))
    assert ticket.status == TicketStatus.waiting
    org.is_active = True
    await db_session.commit()
    await telegram.handle_update(db_session, redis_client, callback(12345, f'ask:{ticket.id}'))
    assert ticket.status == TicketStatus.waiting
    assert telegram.send_message.call_args[0][1] == 'Отменить этот талон?'
    await telegram.handle_update(db_session, redis_client, callback(12345, f'leave:{ticket.id}'))
    assert ticket.status == TicketStatus.left
    await telegram.handle_update(db_session, redis_client, callback(12345, f'leave:{ticket.id}'))
    assert ticket.status == TicketStatus.left


async def test_telegram_ticket_buttons_localized_and_cancel_uuid_fits(db_session, make_organization, monkeypatch):
    org = await make_organization(name='Telegram localized')
    queue = await _make_queue(db_session, org)
    owner = await _make_subscribed_client(db_session, 'https://push.example.com/telegram-language')
    owner.telegram_chat_id = 12345
    owner.language = Language.en
    ticket = await _make_waiting_ticket(db_session, org, queue, number=1, client=owner)
    monkeypatch.setattr(telegram, 'enabled', lambda: True)
    send = AsyncMock(return_value=True)
    monkeypatch.setattr(telegram, 'send_message', send)
    await telegram.notify_ticket(db_session, owner.id, notifications.ticket_message('en', 'called', ticket, 'Desk 3'))
    assert 'Desk 3' in send.call_args[0][1]
    keyboard = send.call_args[0][2]['inline_keyboard']
    assert keyboard[0][0]['text'] == 'Open ticket'
    assert keyboard[1][0]['text'] == 'Cancel ticket'
    assert len(keyboard[1][0]['callback_data'].encode()) < 64


async def test_visitor_link_is_owner_only_and_disabled_without_bot(client, db_session, make_organization, monkeypatch):
    org = await make_organization(name='Telegram visitor')
    queue = await _make_queue(db_session, org)
    owner = await _make_subscribed_client(db_session, 'https://push.example.com/telegram-visitor')
    ticket = await _make_waiting_ticket(db_session, org, queue, number=1, client=owner)
    stranger = Client(last_seen_at=utcnow())
    db_session.add(stranger); await db_session.commit()
    app.dependency_overrides[current_client] = lambda: stranger
    assert (await client.post(f'/api/public/tickets/{ticket.id}/telegram')).status_code == 404
    app.dependency_overrides[current_client] = lambda: owner
    monkeypatch.setattr(telegram, 'enabled', lambda: False)
    assert (await client.get(f'/api/public/tickets/{ticket.id}/telegram')).json() == {'available': False, 'connected': False}
    assert (await client.post(f'/api/public/tickets/{ticket.id}/telegram')).status_code == 503


async def test_client_binding_immediately_reports_current_position(db_session, make_organization, monkeypatch):
    org = await make_organization(name='Telegram position')
    queue = await _make_queue(db_session, org)
    owner = await _make_subscribed_client(db_session, 'https://push.example.com/telegram-position')
    for index in range(3):
        await _make_waiting_ticket(db_session, org, queue, number=index + 1)
    ticket = await _make_waiting_ticket(db_session, org, queue, number=4, client=owner)
    monkeypatch.setattr(telegram, 'enabled', lambda: True)
    monkeypatch.setattr(telegram.settings, 'telegram_bot_username', 'OmniBookTestBot')
    send = AsyncMock(return_value=True)
    monkeypatch.setattr(telegram, 'send_message', send)
    link = await telegram.issue_link(redis_client, kind='client', subject_id=owner.id, ticket_id=ticket.id)
    code = link['url'].split('=')[1]
    try:
        await telegram.handle_update(db_session, redis_client, {'message': {'chat': {'id': 12345, 'type': 'private'}, 'text': f'/start {code}'}})
        assert owner.telegram_chat_id == 12345
        assert 'Перед вами 3 человека' in send.call_args[0][1]
    finally:
        await redis_client.delete(f'telegram:link:{code}')
