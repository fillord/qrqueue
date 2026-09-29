"""Store YouTube video and playlist IDs without storing video bytes."""

from alembic import op
import sqlalchemy as sa

revision = "a7c9e1f3b5d7"
down_revision = "f6b8d0e2a4c6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tv_media", sa.Column("youtube_id", sa.String(length=120), nullable=True))


def downgrade():
    op.drop_column("tv_media", "youtube_id")
