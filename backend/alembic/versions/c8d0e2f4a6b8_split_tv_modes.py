"""Separate schedule screens from media screens.

Existing signage screens keep showing schedules after the upgrade.
"""

from alembic import op
import sqlalchemy as sa

revision = "c8d0e2f4a6b8"
down_revision = "b7c9d1e3f5a7"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("UPDATE tv_screens SET display_mode = 'schedule' WHERE display_mode = 'signage'"))


def downgrade():
    op.execute(sa.text("UPDATE tv_screens SET display_mode = 'signage' WHERE display_mode IN ('schedule', 'media')"))
