"""Employee directory, encrypted face templates and attendance events."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f9d2c4e6a8b0"
down_revision = "e0f2a4b6c8d0"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "attendance_employees",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=False),
        sa.Column("department", sa.Text(), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("code_digest", sa.String(64), nullable=False, unique=True),
        sa.Column("face_template", sa.LargeBinary(), nullable=True),
        sa.Column("face_consent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_attendance_employees_organization_id", "attendance_employees", ["organization_id"])
    op.create_index("uq_attendance_employee_user", "attendance_employees", ["user_id"], unique=True, postgresql_where=sa.text("user_id IS NOT NULL"))
    op.create_table(
        "attendance_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("attendance_employees.id"), nullable=False),
        sa.Column("kind", sa.String(3), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("corrected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("correction_reason", sa.Text(), nullable=True),
        sa.Column("corrected_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.CheckConstraint("kind IN ('in', 'out')", name="ck_attendance_event_kind"),
        sa.CheckConstraint("source IN ('phone', 'kiosk', 'manual')", name="ck_attendance_event_source"),
    )
    op.create_index("ix_attendance_events_organization_id", "attendance_events", ["organization_id"])
    op.create_index("ix_attendance_events_employee_id", "attendance_events", ["employee_id"])
    op.create_index("ix_attendance_events_employee_time", "attendance_events", ["employee_id", "occurred_at"])


def downgrade():
    op.drop_table("attendance_events")
    op.drop_table("attendance_employees")
