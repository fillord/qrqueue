"""Staff departments, enrollment approvals, and organization attendance settings."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "a1b3d5f7c9e1"
down_revision = "f9d2c4e6a8b0"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("attendance_employees", sa.Column("department_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("departments.id"), nullable=True))
    op.add_column("attendance_employees", sa.Column("position", sa.Text(), nullable=True))
    op.add_column("attendance_employees", sa.Column("code_length", sa.Integer(), nullable=False, server_default="10"))
    op.add_column("attendance_employees", sa.Column("pending_face_template", sa.LargeBinary(), nullable=True))
    op.add_column("attendance_employees", sa.Column("pending_face_consent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("attendance_employees", sa.Column("pending_face_submitted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_attendance_employees_department_id", "attendance_employees", ["department_id"])
    op.execute("""UPDATE attendance_employees AS employee SET department_id = department.id
        FROM departments AS department WHERE employee.organization_id = department.organization_id
        AND lower(trim(employee.department)) = lower(trim(department.name))""")
    op.add_column("organizations", sa.Column("attendance_enrollment_version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("organizations", sa.Column("attendance_enrollment_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("organizations", sa.Column("attendance_enrollment_on_kiosk", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("organizations", "attendance_enrollment_on_kiosk")
    op.drop_column("organizations", "attendance_enrollment_enabled")
    op.drop_column("organizations", "attendance_enrollment_version")
    op.drop_index("ix_attendance_employees_department_id", table_name="attendance_employees")
    op.drop_column("attendance_employees", "pending_face_submitted_at")
    op.drop_column("attendance_employees", "pending_face_consent_at")
    op.drop_column("attendance_employees", "pending_face_template")
    op.drop_column("attendance_employees", "code_length")
    op.drop_column("attendance_employees", "position")
    op.drop_column("attendance_employees", "department_id")
