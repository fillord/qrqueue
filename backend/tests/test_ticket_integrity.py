"""Regression checks with independent, committed DB sessions.

Each test owns a uniquely named organization and deletes only its own rows.
Unlike savepoint fixtures, these sessions exercise real PostgreSQL locks.
"""
import asyncio
import uuid
from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, update

from app.clock import local_date, utcnow
from app.db import async_session_factory
from app.models.audit_log import AuditLog
from app.models.cabinet import Cabinet
from app.models.client import Client
from app.models.enums import AuditActorType, CabinetStatus, Language, Plan, TicketSource, TicketStatus, UserRole
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.models.user import User
from app.services import tickets
from app.services.cabinets import pause_cabinet
from app.services.errors import ServiceError
from app.services.numbering import next_number
from app.services.tv_state import _now_serving


@pytest_asyncio.fixture
async def scenario():
    async with async_session_factory() as db:
        org = Organization(name='Integrity test', slug=f'integrity-{uuid.uuid4()}', default_language=Language.ru, plan=Plan.trial)
        db.add(org)
        await db.flush()
        queues = [Queue(organization_id=org.id, name=f'Queue {i}', ticket_prefix=prefix, counter_date=local_date(org.timezone)) for i, prefix in enumerate(['A', 'B'])]
        db.add_all(queues)
        await db.flush()
        cabinets = [Cabinet(organization_id=org.id, queue_id=queues[0].id, label=str(i), status=CabinetStatus.free) for i in range(2)]
        operator = User(organization_id=org.id, email=f'{uuid.uuid4()}@example.com', password_hash='unused', full_name='Integrity operator', role=UserRole.operator)
        clients = [Client(last_seen_at=utcnow()) for _ in range(2)]
        db.add_all([*cabinets, operator, *clients])
        await db.commit()
        ids = dict(org=org.id, queues=[q.id for q in queues], cabinets=[c.id for c in cabinets], operator=operator.id, clients=[c.id for c in clients])
    try:
        yield ids
    finally:
        async with async_session_factory() as db:
            await db.execute(update(Cabinet).where(Cabinet.organization_id == ids['org']).values(current_ticket_id=None))
            await db.execute(delete(Ticket).where(Ticket.organization_id == ids['org']))
            await db.execute(delete(AuditLog).where(AuditLog.organization_id == ids['org']))
            await db.execute(delete(Cabinet).where(Cabinet.organization_id == ids['org']))
            await db.execute(delete(Queue).where(Queue.organization_id == ids['org']))
            await db.execute(delete(User).where(User.organization_id == ids['org']))
            await db.execute(delete(Organization).where(Organization.id == ids['org']))
            await db.execute(delete(Client).where(Client.id.in_(ids['clients'])))
            await db.commit()


async def seed_ticket(ids, *, queue_index=0, client_index=None, number=1, **values):
    async with async_session_factory() as db:
        ticket = Ticket(organization_id=ids['org'], queue_id=ids['queues'][queue_index], client_id=ids['clients'][client_index] if client_index is not None else None, number=number, display_number=f'A-{number:03}', source=TicketSource.registrar, **values)
        db.add(ticket)
        await db.commit()
        return ticket.id


async def test_parallel_numbering_refreshes_preloaded_counter(scenario):
    barrier = asyncio.Barrier(6)
    async def issue():
        async with async_session_factory() as db:
            queue = await db.get(Queue, scenario['queues'][0])
            org = await db.get(Organization, scenario['org'])
            await barrier.wait()
            number, _ = await next_number(db, queue, org)
            await db.commit()
            return number
    numbers = await asyncio.wait_for(asyncio.gather(*(issue() for _ in range(6))), timeout=10)
    assert sorted(numbers) == list(range(1, 7))


@pytest.mark.parametrize('org_limit', [False, True])
async def test_parallel_creation_respects_limits(scenario, org_limit):
    async with async_session_factory() as db:
        if org_limit:
            await db.execute(update(Organization).where(Organization.id == scenario['org']).values(one_ticket_per_org=True))
        else:
            await db.execute(update(Queue).where(Queue.id == scenario['queues'][0]).values(daily_ticket_limit=1))
        await db.commit()
    barrier = asyncio.Barrier(2)
    async def issue(index):
        async with async_session_factory() as db:
            org = await db.get(Organization, scenario['org'])
            queue = await db.get(Queue, scenario['queues'][index if org_limit else 0])
            client = await db.get(Client, scenario['clients'][0 if org_limit else index])
            await barrier.wait()
            try:
                await tickets.create_ticket(db, AsyncMock(), organization=org, queue=queue, client=client, source=TicketSource.qr)
                return 'created'
            except ServiceError as exc:
                await db.rollback()
                return exc.code
    outcomes = await asyncio.wait_for(asyncio.gather(issue(0), issue(1)), timeout=10)
    assert sorted(outcomes) == sorted(['created', 'already_in_queue' if org_limit else 'daily_limit_reached'])


@pytest.mark.parametrize('same_cabinet', [True, False])
async def test_parallel_calls_keep_cabinets_and_tickets_consistent(scenario, same_cabinet):
    ids = [await seed_ticket(scenario, number=i + 1) for i in range(2)]
    barrier = asyncio.Barrier(2)
    async def call(index):
        async with async_session_factory() as db:
            queue = await db.get(Queue, scenario['queues'][0])
            cabinet = await db.get(Cabinet, scenario['cabinets'][0 if same_cabinet else index])
            operator = await db.get(User, scenario['operator'])
            await barrier.wait()
            try:
                ticket = await tickets.call_next(db, AsyncMock(), queue=queue, cabinet=cabinet, operator=operator)
                return ticket.id
            except ServiceError as exc:
                await db.rollback()
                return exc.code
    outcomes = await asyncio.wait_for(asyncio.gather(call(0), call(1)), timeout=10)
    if same_cabinet:
        assert outcomes.count('cabinet_busy') == 1
    else:
        assert set(outcomes) == set(ids)
    async with async_session_factory() as db:
        called = list((await db.scalars(select(Ticket).where(Ticket.id.in_(ids), Ticket.status == TicketStatus.called))).all())
        assert len(called) == (1 if same_cabinet else 2)
        for ticket in called:
            cabinet = await db.get(Cabinet, ticket.cabinet_id)
            assert cabinet.current_ticket_id == ticket.id
            assert cabinet.status == CabinetStatus.busy


async def test_failed_transfer_preserves_original_and_publishes_nothing(scenario, monkeypatch):
    ticket_id = await seed_ticket(scenario, status=TicketStatus.called, cabinet_id=scenario['cabinets'][0])
    async with async_session_factory() as db:
        await db.execute(update(Cabinet).where(Cabinet.id == scenario['cabinets'][0]).values(status=CabinetStatus.busy, current_ticket_id=ticket_id))
        await db.commit()
    monkeypatch.setattr(tickets, 'create_ticket', AsyncMock(side_effect=RuntimeError('simulated insert failure')))
    redis = AsyncMock()
    async with async_session_factory() as db:
        ticket = await db.get(Ticket, ticket_id)
        with pytest.raises(RuntimeError, match='simulated insert failure'):
            await tickets.transfer(db, redis, ticket=ticket, target_queue=await db.get(Queue, scenario['queues'][1]), organization=await db.get(Organization, scenario['org']), operator=await db.get(User, scenario['operator']))
        # Even a caller that commits after catching the error cannot save a partial transfer.
        await db.commit()
    async with async_session_factory() as db:
        assert (await db.get(Ticket, ticket_id)).status == TicketStatus.called
        cabinet = await db.get(Cabinet, scenario['cabinets'][0])
        assert cabinet.current_ticket_id == ticket_id
        assert cabinet.status == CabinetStatus.busy
    redis.publish.assert_not_called()


async def test_transfer_checks_destination_limit_and_rolls_back(scenario):
    ticket_id = await seed_ticket(scenario)
    async with async_session_factory() as db:
        target = await db.get(Queue, scenario['queues'][1])
        target.daily_ticket_limit = 1
        target.last_ticket_number = 1
        await db.commit()
        with pytest.raises(ServiceError, match='daily_limit_reached'):
            await tickets.transfer(db, AsyncMock(), ticket=await db.get(Ticket, ticket_id), target_queue=target, organization=await db.get(Organization, scenario['org']), operator=await db.get(User, scenario['operator']))
        await db.commit()
        assert (await db.get(Ticket, ticket_id)).status == TicketStatus.waiting


async def test_successful_transfer_is_visible_before_events_and_exposes_next_ticket(scenario):
    ticket_id = await seed_ticket(scenario, client_index=0)
    snapshots = []
    async def on_publish(*_):
        async with async_session_factory() as observer:
            old = await observer.get(Ticket, ticket_id)
            new = (await observer.scalars(select(Ticket).where(Ticket.transferred_from == ticket_id))).one()
            snapshots.append((old.status, new.status))
    redis = AsyncMock()
    redis.publish.side_effect = on_publish
    async with async_session_factory() as db:
        old = await db.get(Ticket, ticket_id)
        new = await tickets.transfer(db, redis, ticket=old, target_queue=await db.get(Queue, scenario['queues'][1]), organization=await db.get(Organization, scenario['org']), operator=await db.get(User, scenario['operator']))
        detail = await tickets.build_ticket_detail(db, old)
        assert detail['next_ticket_id'] == new.id
    assert snapshots == [(TicketStatus.transferred, TicketStatus.waiting)] * 2


async def test_position_uses_return_priority_and_deterministic_ties(scenario):
    now = utcnow()
    fresh = await seed_ticket(scenario, number=1, created_at=now - timedelta(hours=2))
    returned = await seed_ticket(scenario, number=2, created_at=now, called_at=now - timedelta(minutes=5))
    same_time = await seed_ticket(scenario, number=3, created_at=now - timedelta(hours=2))
    expected = [returned, fresh, same_time]
    async with async_session_factory() as db:
        for position, ticket_id in enumerate(expected, 1):
            assert await tickets.get_position(db, await db.get(Ticket, ticket_id)) == position


async def test_stale_timeout_does_not_override_confirmation(scenario):
    ticket_id = await seed_ticket(scenario, client_index=0, status=TicketStatus.called, called_at=utcnow() - timedelta(hours=1))
    async with async_session_factory() as worker:
        stale = await worker.get(Ticket, ticket_id)
        async with async_session_factory() as visitor:
            await tickets.confirm(visitor, AsyncMock(), ticket=await visitor.get(Ticket, ticket_id), client=await visitor.get(Client, scenario['clients'][0]))
        result = await tickets.mark_no_show(worker, AsyncMock(), ticket=stale, actor_type=AuditActorType.system, actor_id=None)
        assert result.status == TicketStatus.confirmed
        assert (await _now_serving(worker, scenario['queues'][0]))[0] == 'A-001'


async def test_created_ticket_is_committed_before_event(scenario):
    seen = []
    async def on_publish(*_):
        async with async_session_factory() as observer:
            seen.extend((await observer.scalars(select(Ticket.id).where(Ticket.organization_id == scenario['org']))).all())
    redis = AsyncMock()
    redis.publish.side_effect = on_publish
    async with async_session_factory() as db:
        ticket = await tickets.create_ticket(db, redis, organization=await db.get(Organization, scenario['org']), queue=await db.get(Queue, scenario['queues'][0]), source=TicketSource.registrar)
        assert seen == [ticket.id]


async def test_transfer_rejects_existing_destination_ticket_without_losing_source(scenario):
    source_id = await seed_ticket(scenario, client_index=0)
    await seed_ticket(scenario, queue_index=1, client_index=0)
    async with async_session_factory() as db:
        with pytest.raises(ServiceError, match='already_in_queue'):
            await tickets.transfer(db, AsyncMock(), ticket=await db.get(Ticket, source_id), target_queue=await db.get(Queue, scenario['queues'][1]), organization=await db.get(Organization, scenario['org']), operator=await db.get(User, scenario['operator']))
        await db.commit()
        assert (await db.get(Ticket, source_id)).status == TicketStatus.waiting


async def test_return_rejects_duplicate_active_ticket(scenario):
    returning_id = await seed_ticket(scenario, client_index=0, status=TicketStatus.no_show)
    await seed_ticket(scenario, client_index=0, number=2)
    async with async_session_factory() as db:
        with pytest.raises(ServiceError, match='already_in_queue'):
            await tickets.return_to_queue(db, AsyncMock(), ticket=await db.get(Ticket, returning_id), operator=await db.get(User, scenario['operator']))
        await db.commit()
        assert (await db.get(Ticket, returning_id)).status == TicketStatus.no_show


async def test_parallel_call_next_and_pause_never_both_succeed(scenario):
    ticket_id = await seed_ticket(scenario)
    barrier = asyncio.Barrier(2)

    async def call():
        async with async_session_factory() as db:
            queue = await db.get(Queue, scenario['queues'][0])
            cabinet = await db.get(Cabinet, scenario['cabinets'][0])
            operator = await db.get(User, scenario['operator'])
            await barrier.wait()
            try:
                await tickets.call_next(db, AsyncMock(), queue=queue, cabinet=cabinet, operator=operator)
                await db.commit()
                return 'called'
            except ServiceError as exc:
                await db.rollback()
                return exc.code

    async def pause():
        async with async_session_factory() as db:
            cabinet = await db.get(Cabinet, scenario['cabinets'][0])
            operator = await db.get(User, scenario['operator'])
            await barrier.wait()
            try:
                await pause_cabinet(db, AsyncMock(), cabinet=cabinet, operator=operator)
                await db.commit()
                return 'paused'
            except ServiceError as exc:
                await db.rollback()
                return exc.code

    outcomes = await asyncio.wait_for(asyncio.gather(call(), pause()), timeout=10)
    assert sorted(outcomes) in (['active_ticket', 'called'], ['cabinet_busy', 'paused'])
    async with async_session_factory() as db:
        cabinet = await db.get(Cabinet, scenario['cabinets'][0])
        ticket = await db.get(Ticket, ticket_id)
        if 'called' in outcomes:
            assert cabinet.status == CabinetStatus.busy and cabinet.current_ticket_id == ticket.id
            assert ticket.status == TicketStatus.called
        else:
            assert cabinet.status == CabinetStatus.paused and cabinet.current_ticket_id is None
            assert ticket.status == TicketStatus.waiting
