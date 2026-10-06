"""Separate attendance departments from TV schedules, preserving employees."""
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f4a6b8c0d2e5"
down_revision = "e3f5a7b9c1d4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("attendance_departments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.UniqueConstraint("organization_id", "name", name="uq_attendance_departments_org_name"))
    op.create_index("ix_attendance_departments_organization_id", "attendance_departments", ["organization_id"])

    connection = op.get_bind()
    for foreign_key in sa.inspect(connection).get_foreign_keys("attendance_employees"):
        if foreign_key["constrained_columns"] == ["department_id"]:
            op.drop_constraint(foreign_key["name"], "attendance_employees", type_="foreignkey")

    employees = connection.execute(sa.text("""
        SELECT employee.id, employee.organization_id, employee.department,
               department.name AS linked_name
        FROM attendance_employees employee
        LEFT JOIN departments department ON employee.department_id = department.id
            AND employee.organization_id = department.organization_id
        ORDER BY employee.organization_id, employee.created_at, employee.id
    """)).mappings().all()
    directory = sa.table("attendance_departments",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("organization_id", postgresql.UUID(as_uuid=True)),
        sa.column("name", sa.Text()), sa.column("is_active", sa.Boolean()))
    staff = sa.table("attendance_employees", sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("department_id", postgresql.UUID(as_uuid=True)))
    names = {}
    for employee in employees:
        # Only migrate departments actually used by attendance. Never import the
        # entire TV directory or its doctors. No recurring synchronization exists.
        name = (employee["linked_name"] or employee["department"] or "").strip()
        new_id = None
        if name:
            key = (employee["organization_id"], name.casefold())
            if key not in names:
                names[key] = uuid.uuid4()
                connection.execute(directory.insert().values(id=names[key],
                    organization_id=employee["organization_id"], name=name, is_active=True))
            new_id = names[key]
        connection.execute(staff.update().where(staff.c.id == employee["id"]).values(department_id=new_id))

    op.create_foreign_key("fk_attendance_employee_department", "attendance_employees",
        "attendance_departments", ["department_id"], ["id"])


def downgrade():
    # Rejoining independent HR/TV directories would create or overwrite TV data.
    # Keep all records intact; roll forward or plan a backup-based rollback.
    raise RuntimeError("Separating attendance departments cannot be automatically reversed. Keep the schema and roll forward, or plan a verified-backup rollback.")
