"""Add per-user assistant preferences."""

from alembic import op
import sqlalchemy as sa

revision = "b8d0f2a4c6e8"
down_revision = "a7c9e1f3b5d7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column("assistant_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.add_column(
        "users",
        sa.Column("assistant_ai_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade():
    op.drop_column("users", "assistant_ai_enabled")
    op.drop_column("users", "assistant_enabled")
