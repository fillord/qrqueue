"""Revoke sessions when an authenticator is reset."""
from alembic import op
import sqlalchemy as sa

revision = "d3e5f7a9b1c3"
down_revision = "c2d4e6f8a0b2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("auth_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    op.drop_column("users", "auth_version")
