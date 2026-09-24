"""Recover a lost superadmin authenticator from a trusted server console.

Usage: docker compose exec backend python scripts/recover_superadmin_totp.py admin@example.com
Requires the existing account password. The password is never a command argument.
"""

import argparse
import asyncio
import getpass
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import async_session_factory
from app.services.superadmin_recovery import RecoveryDenied, recover_superadmin_totp


async def run(email: str, password: str) -> None:
    async with async_session_factory() as db:
        await recover_superadmin_totp(db, email, password)


def main() -> int:
    parser = argparse.ArgumentParser(description="Reset the configured superadmin's lost authenticator")
    parser.add_argument("email", help="Email of the configured superadmin account")
    args = parser.parse_args()
    if not sys.stdin.isatty():
        parser.error("Run this command from an interactive trusted server terminal")
    password = getpass.getpass("Existing superadmin password: ")
    try:
        asyncio.run(run(args.email, password))
    except RecoveryDenied as exc:
        print(f"Recovery denied: {exc}", file=sys.stderr)
        return 1
    print("2FA reset. Existing sessions are revoked; sign in and enroll a new authenticator.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
