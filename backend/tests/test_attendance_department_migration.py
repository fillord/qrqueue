"""Run the real migration against old-schema data in another disposable DB."""
import asyncio
import os
from pathlib import Path
import sys
import uuid

import asyncpg
from sqlalchemy.engine import make_url

from app.config import settings


async def migrate(database_url, revision):
    # Pass URL objects with a masked repr, not credential-bearing strings, so
    # pytest cannot expose credentials when rendering a failed test's arguments.
    env = dict(os.environ, DATABASE_URL=database_url.set(drivername='postgresql+asyncpg').render_as_string(hide_password=False),
        TELEGRAM_BOT_TOKEN='', TELEGRAM_BOT_USERNAME='')
    process = await asyncio.create_subprocess_exec(sys.executable, '-m', 'alembic', 'upgrade', revision,
        cwd=Path(__file__).resolve().parents[1], env=env,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    output, _ = await process.communicate()
    safe_output = output.decode()
    if database_url.password:
        safe_output = safe_output.replace(database_url.password, '[redacted]')
    assert process.returncode == 0, safe_output


async def test_separation_migration_preserves_staff_history_and_never_seeds_unused_tv():
    database = f'queue_migration_test_{uuid.uuid4().hex}'
    original = make_url(settings.database_url).set(drivername='postgresql')
    admin = await asyncpg.connect(original.render_as_string(hide_password=False))
    connection = None
    database_created = False
    try:
        await admin.execute(f'CREATE DATABASE "{database}"')
        database_created = True
        new_url = original.set(database=database)
        await migrate(new_url, 'e3f5a7b9c1d4')
        connection = await asyncpg.connect(new_url.render_as_string(hide_password=False))
        org_a, org_b = uuid.uuid4(), uuid.uuid4()
        for org_id in [org_a, org_b]:
            await connection.execute("""INSERT INTO organizations
                (id,name,slug,timezone,default_language,plan,one_ticket_per_org,is_active)
                VALUES ($1,'Migration test',$2,'UTC','ru','trial',false,true)""", org_id, str(org_id))
        tv_a, tv_b, unused = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        for dep_id, org_id, name in [(tv_a, org_a, 'Clinic'), (tv_b, org_b, 'Clinic'), (unused, org_a, 'TV only')]:
            await connection.execute("INSERT INTO departments(id,organization_id,name,is_active,sort_order) VALUES ($1,$2,$3,true,0)", dep_id, org_id, name)
        people = [uuid.uuid4() for _ in range(4)]
        for index, (person_id, org_id, dep_id, name) in enumerate([
            (people[0], org_a, tv_a, 'Original fallback'), (people[1], org_b, tv_b, 'Clinic'),
            (people[2], org_a, None, '  clinic  '), (people[3], org_a, None, 'Old HR')]):
            await connection.execute("""INSERT INTO attendance_employees
                (id,organization_id,full_name,department_id,department,code_digest,face_template,telegram_chat_id)
                VALUES ($1,$2,'Migration employee',$3,$4,$5,$6,12345)""", person_id, org_id, dep_id, name, str(index) * 64, b'fake-encrypted-face')
        await connection.execute("UPDATE attendance_employees SET deleted_at=now(),is_active=false WHERE id=$1", people[3])
        await connection.execute("INSERT INTO attendance_events(id,organization_id,employee_id,kind,source) VALUES ($1,$2,$3,'in','manual')", uuid.uuid4(), org_a, people[0])
        await connection.execute("""INSERT INTO attendance_employee_schedules(id,organization_id,employee_id,weekday,starts_at,ends_at)
            VALUES ($1,$2,$3,0,'09:00','18:00')""", uuid.uuid4(), org_a, people[0])
        actor = uuid.uuid4()
        await connection.execute("""INSERT INTO users(id,email,password_hash,full_name,role,organization_id,is_active)
            VALUES ($1,'migration-test@example.com','unused-test-hash','Test admin','org_admin',$2,true)""", actor, org_a)
        await connection.execute("""INSERT INTO attendance_calendar_days
            (id,organization_id,employee_id,day,kind,reason,updated_by)
            VALUES ($1,$2,$3,'2026-10-01','sick','Migration test leave',$4)""", uuid.uuid4(), org_a, people[0], actor)
        before_people = {row['id']: dict(row) for row in await connection.fetch('SELECT * FROM attendance_employees')}
        preserved_tables = ['departments', 'attendance_events', 'attendance_employee_schedules', 'attendance_calendar_days']
        before_tables = {table: [dict(row) for row in await connection.fetch(f'SELECT * FROM {table} ORDER BY id')] for table in preserved_tables}
        await migrate(new_url, 'head')
        own = await connection.fetch('SELECT * FROM attendance_departments')
        assert len(own) == 3  # Two organizations' Clinic, plus the legacy Old HR.
        assert not any(row['name'] == 'TV only' for row in own)
        assert {row['id'] for row in own}.isdisjoint({tv_a, tv_b, unused})
        after_people = {row['id']: dict(row) for row in await connection.fetch('SELECT * FROM attendance_employees')}
        assert after_people[people[0]]['department_id'] == after_people[people[2]]['department_id']
        assert after_people[people[0]]['department_id'] != after_people[people[1]]['department_id']
        for person_id, before in before_people.items():
            after = after_people[person_id]
            assert {key: value for key, value in before.items() if key != 'department_id'} == {
                key: value for key, value in after.items() if key != 'department_id'}
        for table, before in before_tables.items():
            assert before == [dict(row) for row in await connection.fetch(f'SELECT * FROM {table} ORDER BY id')]
        assert await connection.fetchval('SELECT version_num FROM alembic_version') == 'f4a6b8c0d2e5'
        # The old TV records can be removed without affecting attendance now.
        await connection.execute('DELETE FROM departments WHERE id=$1', tv_a)
        assert await connection.fetchval('SELECT count(*) FROM attendance_employees') == 4
        assert await connection.fetchval('SELECT count(*) FROM attendance_departments') == 3
    finally:
        if connection is not None:
            await connection.close()
        # Only the UUID-named database created in this test is removed.
        if database_created:
            await admin.execute(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')
        await admin.close()
