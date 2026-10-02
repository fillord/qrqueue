"""Reactivate non-archived queues whose status is open or paused.

Revision ID: c1d3e5f7a9b1
Revises: b8d0f2a4c6e8
"""

from alembic import op
import sqlalchemy as sa


revision = "c1d3e5f7a9b1"
down_revision = "b8d0f2a4c6e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text(
        "UPDATE queues SET is_active = true "
        "WHERE deleted_at IS NULL AND status IN ('open', 'paused') AND is_active = false"
    ))


def downgrade() -> None:
    # This is a data repair. Re-introducing the invalid state on downgrade
    # would hide queues from TV and QR flows again.
    pass
