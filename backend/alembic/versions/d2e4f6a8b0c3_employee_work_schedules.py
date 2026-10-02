"""Weekly work schedules for attendance employees.

Revision ID: d2e4f6a8b0c3
Revises: c1d3e5f7a9b1
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "d2e4f6a8b0c3"
down_revision = "c1d3e5f7a9b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "attendance_employee_schedules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("attendance_employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("starts_at", sa.Time(), nullable=False),
        sa.Column("ends_at", sa.Time(), nullable=False),
        sa.CheckConstraint("weekday >= 0 AND weekday <= 6", name="ck_attendance_employee_schedule_weekday"),
        sa.CheckConstraint("starts_at < ends_at", name="ck_attendance_employee_schedule_time"),
        sa.UniqueConstraint("employee_id", "weekday", name="uq_attendance_employee_schedule_day"),
    )
    op.create_index("ix_attendance_employee_schedules_organization_id", "attendance_employee_schedules", ["organization_id"])
    op.create_index("ix_attendance_employee_schedules_employee_id", "attendance_employee_schedules", ["employee_id"])


def downgrade() -> None:
    op.drop_index("ix_attendance_employee_schedules_employee_id", table_name="attendance_employee_schedules")
    op.drop_index("ix_attendance_employee_schedules_organization_id", table_name="attendance_employee_schedules")
    op.drop_table("attendance_employee_schedules")
