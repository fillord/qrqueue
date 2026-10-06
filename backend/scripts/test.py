"""Run migrations and pytest in a disposable database, never the app database.

Usage: docker compose exec -T backend python scripts/test.py -q
The PostgreSQL role must have CREATEDB permission.
"""
import asyncio
import os
from pathlib import Path
import subprocess
import sys
import uuid

import asyncpg
from sqlalchemy.engine import make_url

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings


async def manage_database(name: str, *, create: bool) -> None:
    url = make_url(settings.database_url).set(drivername='postgresql')
    conn = await asyncpg.connect(url.render_as_string(hide_password=False))
    try:
        # name is generated internally from a UUID, never supplied by a caller.
        statement = f'CREATE DATABASE "{name}"' if create else f'DROP DATABASE "{name}" WITH (FORCE)'
        await conn.execute(statement)
    finally:
        await conn.close()


def main() -> int:
    database = f'queue_test_{uuid.uuid4().hex}'
    asyncio.run(manage_database(database, create=True))
    try:
        env = dict(os.environ)
        env['RATE_LIMIT_ENABLED'] = 'false'  # limit tests enable it explicitly
        # Never contact a live bot with synthetic clients during a test run.
        env['TELEGRAM_BOT_TOKEN'] = ''
        env['TELEGRAM_BOT_USERNAME'] = ''
        env['DATABASE_URL'] = make_url(settings.database_url).set(database=database).render_as_string(hide_password=False)
        root = Path(__file__).resolve().parents[1]
        migration = subprocess.run([sys.executable, '-m', 'alembic', 'upgrade', 'head'], cwd=root, env=env)
        if migration.returncode:
            return migration.returncode
        return subprocess.run([sys.executable, '-m', 'pytest', *sys.argv[1:]], cwd=root, env=env).returncode
    finally:
        asyncio.run(manage_database(database, create=False))


if __name__ == '__main__':
    raise SystemExit(main())
