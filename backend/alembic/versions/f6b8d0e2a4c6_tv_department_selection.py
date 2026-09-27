"""Let each schedule TV select the departments it displays."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f6b8d0e2a4c6"
down_revision = "e5f7a9b1c3d5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tv_screens", sa.Column("department_selection_mode", sa.String(length=10),
                                        nullable=False, server_default="all"))
    op.add_column("tv_screens", sa.Column("selected_department_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
                                        nullable=False, server_default=sa.text("'{}'::uuid[]")))


def downgrade():
    op.drop_column("tv_screens", "selected_department_ids")
    op.drop_column("tv_screens", "department_selection_mode")
