"""Temporary encrypted face photo for administrator enrollment review."""
from alembic import op
import sqlalchemy as sa

revision = "c3d5e7f9a1b3"
down_revision = "b2c4e6f8a0d2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("attendance_employees", sa.Column("pending_face_photo", sa.LargeBinary(), nullable=True))


def downgrade():
    op.drop_column("attendance_employees", "pending_face_photo")
