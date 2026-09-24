"""Persist landing trial requests."""
from alembic import op
import sqlalchemy as sa

revision = "c2d4e6f8a0b2"
down_revision = "a1c3e5f7b9d1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "trial_requests",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("organization", sa.String(200), nullable=False),
        sa.Column("contact", sa.String(200), nullable=False),
        sa.Column("processed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table("trial_requests")
