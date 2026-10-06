"""Dated shifts, approved absences and opt-in Telegram recipients."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e3f5a7b9c1d4"
down_revision = "d2e4f6a8b0c3"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("clients", "attendance_employees"):
        op.add_column(table, sa.Column("telegram_chat_id", sa.BigInteger(), nullable=True))
        op.create_index(f"ix_{table}_telegram_chat_id", table, ["telegram_chat_id"])
    op.create_table("attendance_calendar_days",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("attendance_employees.id"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("starts_at", sa.Time(), nullable=True),
        sa.Column("ends_at", sa.Time(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("employee_id", "day", name="uq_attendance_calendar_day"),
        sa.CheckConstraint("kind IN ('shift','off','vacation','sick','absence')", name="ck_attendance_calendar_kind"),
        sa.CheckConstraint("(kind = 'shift' AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND starts_at < ends_at) OR (kind <> 'shift' AND starts_at IS NULL AND ends_at IS NULL)", name="ck_attendance_calendar_time"),
    )
    for field in ("organization_id", "employee_id", "day"):
        op.create_index(f"ix_attendance_calendar_days_{field}", "attendance_calendar_days", [field])


def downgrade():
    op.drop_table("attendance_calendar_days")
    for table in ("attendance_employees", "clients"):
        op.drop_index(f"ix_{table}_telegram_chat_id", table_name=table)
        op.drop_column(table, "telegram_chat_id")
