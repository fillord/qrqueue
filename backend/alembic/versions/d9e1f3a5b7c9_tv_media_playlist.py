"""Allow each TV to repeat all media or a selected subset."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d9e1f3a5b7c9"
down_revision = "c8d0e2f4a6b8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tv_screens", sa.Column("media_playlist_mode", sa.String(length=10),
                                          nullable=False, server_default="all"))
    op.add_column("tv_screens", sa.Column("selected_media_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
                                          nullable=False, server_default=sa.text("'{}'::uuid[]")))


def downgrade():
    op.drop_column("tv_screens", "selected_media_ids")
    op.drop_column("tv_screens", "media_playlist_mode")
