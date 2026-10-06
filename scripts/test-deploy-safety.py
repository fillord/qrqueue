#!/usr/bin/env python3
"""Exercise deployment failure handling with shell mocks; never contact Oracle."""
from pathlib import Path
import subprocess
import unittest


SOURCE = (Path(__file__).parent / "deploy-oracle.sh").read_text()
HANDLER = "rollback() {" + SOURCE.split("rollback() {", 1)[1].split("\ntrap rollback EXIT", 1)[0]


class DeploySafetyTests(unittest.TestCase):
    def simulate_failure(self, started, completed):
        shell = f"""
success=false
migration_started={str(started).lower()}
migration_completed={str(completed).lower()}
archive=/tmp/mock-release.tar
new_manifest=/tmp/mock-manifest
source_snapshot=backups/mock-source.tar.gz
previous_version=mock-previous
compose=(mock_compose)
rm() {{ printf 'MOCK rm %s\\n' "$*"; }}
tar() {{ printf 'MOCK tar %s\\n' "$*"; }}
sudo() {{ printf 'MOCK sudo %s\\n' "$*"; }}
mock_compose() {{ printf 'MOCK compose %s\\n' "$*"; }}
{HANDLER}
false
rollback
"""
        result = subprocess.run(["bash", "-c", shell], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1, result.stderr)
        return result.stdout, result.stderr

    def test_before_migration_restores_old_code_only(self):
        output, _ = self.simulate_failure(False, False)
        self.assertIn("MOCK tar -xzf backups/mock-source.tar.gz", output)
        self.assertIn("docker tag qrqueue-backend:previous qrqueue-backend:latest", output)
        self.assertIn("APP_VERSION=mock-previous", output)
        self.assertNotIn("pg_restore", output)

    def test_failed_migration_does_not_start_any_backend(self):
        output, error = self.simulate_failure(True, False)
        self.assertNotIn("MOCK tar", output)
        self.assertNotIn("MOCK sudo", output)
        self.assertNotIn("MOCK compose", output)
        self.assertIn("rollback is unsafe", error)

    def test_after_migration_retries_only_new_code(self):
        output, _ = self.simulate_failure(True, True)
        self.assertIn("MOCK compose up -d --force-recreate backend frontend", output)
        self.assertIn("MOCK compose restart cloudflared", output)
        self.assertNotIn("MOCK tar", output)
        self.assertNotIn("MOCK sudo", output)
        self.assertNotIn("pg_restore", output)

    def test_build_precedes_stop_and_migration(self):
        remote = SOURCE.split("<<'REMOTE'\n", 1)[1].split("\nREMOTE\n", 1)[0]
        result = subprocess.run(["bash", "-n"], input=remote, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(remote.index('"${compose[@]}" build'), remote.index('"${compose[@]}" stop backend'))
        self.assertLess(remote.index('"${compose[@]}" stop backend'), remote.index("migration_started=true"))
        self.assertLess(remote.index("alembic upgrade head"), remote.index("migration_completed=true"))


if __name__ == "__main__":
    unittest.main()
