"""Add private, size-limited user profile photos."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e5f7a9b1c3d5"
down_revision = "d4e6f8a0b2c4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("has_photo", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("photo_revision", sa.Integer(), nullable=False, server_default="0"))
    op.create_table(
        "user_profile_photos",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("image_data", sa.LargeBinary(), nullable=False),
    )


def downgrade():
    op.drop_table("user_profile_photos")
    op.drop_column("users", "photo_revision")
    op.drop_column("users", "has_photo")
