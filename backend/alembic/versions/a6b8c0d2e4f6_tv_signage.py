"""Departments, schedules, TV playlists and chunked media storage."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "a6b8c0d2e4f6"
down_revision = "f5a7b9c1d3e5"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "departments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.UniqueConstraint("organization_id", "name", name="uq_departments_org_name"),
    )
    op.create_index("ix_departments_organization_id", "departments", ["organization_id"])
    op.create_table(
        "department_schedule_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("department_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("departments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("doctor_name", sa.Text(), nullable=False),
        sa.Column("service_name", sa.Text(), nullable=True),
        sa.Column("room", sa.Text(), nullable=True),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("starts_at", sa.Time(), nullable=False),
        sa.Column("ends_at", sa.Time(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
    )
    op.create_index("ix_department_schedule_items_department_id", "department_schedule_items", ["department_id"])
    op.create_table(
        "tv_media",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=12), nullable=False),
        sa.Column("mime_type", sa.String(length=32), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("uploaded_bytes", sa.Integer(), nullable=False),
        sa.Column("is_ready", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_tv_media_organization_id", "tv_media", ["organization_id"])
    op.create_table(
        "tv_media_chunks",
        sa.Column("media_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tv_media.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("chunk_index", sa.Integer(), primary_key=True),
        sa.Column("data", sa.LargeBinary(), nullable=False),
    )
    op.add_column("tv_screens", sa.Column("display_mode", sa.String(length=12), server_default="queue", nullable=False))
    op.add_column("tv_screens", sa.Column("slide_seconds", sa.Integer(), server_default="15", nullable=False))
    op.add_column("tv_screens", sa.Column("ads_enabled", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("organizations", sa.Column("video_large_upload_enabled", sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade():
    op.drop_column("organizations", "video_large_upload_enabled")
    op.drop_column("tv_screens", "ads_enabled")
    op.drop_column("tv_screens", "slide_seconds")
    op.drop_column("tv_screens", "display_mode")
    op.drop_table("tv_media_chunks")
    op.drop_index("ix_tv_media_organization_id", table_name="tv_media")
    op.drop_table("tv_media")
    op.drop_index("ix_department_schedule_items_department_id", table_name="department_schedule_items")
    op.drop_table("department_schedule_items")
    op.drop_index("ix_departments_organization_id", table_name="departments")
    op.drop_table("departments")
