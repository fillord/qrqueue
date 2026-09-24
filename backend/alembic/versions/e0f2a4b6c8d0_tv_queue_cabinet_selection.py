"""Allow a TV to show chosen queues and cabinets."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e0f2a4b6c8d0"
down_revision = "d9e1f3a5b7c9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tv_screens", sa.Column("queue_selection_mode", sa.String(length=10),
                                          nullable=False, server_default="all"))
    op.add_column("tv_screens", sa.Column("selected_queue_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
                                          nullable=False, server_default=sa.text("'{}'::uuid[]")))
    op.add_column("tv_screens", sa.Column("cabinet_selection_mode", sa.String(length=10),
                                          nullable=False, server_default="all"))
    op.add_column("tv_screens", sa.Column("selected_cabinet_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
                                          nullable=False, server_default=sa.text("'{}'::uuid[]")))


def downgrade():
    op.drop_column("tv_screens", "selected_cabinet_ids")
    op.drop_column("tv_screens", "cabinet_selection_mode")
    op.drop_column("tv_screens", "selected_queue_ids")
    op.drop_column("tv_screens", "queue_selection_mode")
