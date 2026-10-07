"""Dedicated visitor ticket kiosks and durable issue receipts."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = "a5c7e9f1b3d6"
down_revision = "f4a6b8c0d2e5"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE ticket_source ADD VALUE IF NOT EXISTS 'kiosk'")
    op.create_table("queue_kiosks",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", pg.UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("queue_ids", pg.ARRAY(pg.UUID(as_uuid=True)), nullable=False),
        sa.Column("printing_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("paper_width", sa.SmallInteger(), nullable=False, server_default="80"),
        sa.Column("language", sa.String(2), nullable=False, server_default="ru"),
        sa.Column("pairing_code", sa.String(6), unique=True),
        sa.Column("pairing_expires_at", sa.DateTime(timezone=True)),
        sa.Column("token_digest", sa.String(64), unique=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("paper_width IN (58, 80)", name="ck_queue_kiosk_paper"))
    op.create_index("ix_queue_kiosks_organization_id", "queue_kiosks", ["organization_id"])
    op.create_table("queue_kiosk_issues",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("kiosk_id", pg.UUID(as_uuid=True), sa.ForeignKey("queue_kiosks.id"), nullable=False),
        sa.Column("request_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("ticket_id", pg.UUID(as_uuid=True), sa.ForeignKey("tickets.id"), nullable=False, unique=True),
        sa.Column("receipt", pg.JSONB(), nullable=False),
        sa.UniqueConstraint("kiosk_id", "request_id", name="uq_queue_kiosk_request"))


def downgrade():
    raise RuntimeError("Kiosk receipts are durable ticket history. Plan a verified-backup recovery instead of deleting them.")
