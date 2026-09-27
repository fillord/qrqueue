"""Pairable attendance kiosks with revocable device credentials."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b2c4e6f8a0d2"
down_revision = "a1b3d5f7c9e1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "attendance_kiosks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("pairing_code", sa.String(6), nullable=True, unique=True),
        sa.Column("token_digest", sa.String(64), nullable=True, unique=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_attendance_kiosks_organization_id", "attendance_kiosks", ["organization_id"])


def downgrade():
    op.drop_index("ix_attendance_kiosks_organization_id", table_name="attendance_kiosks")
    op.drop_table("attendance_kiosks")
