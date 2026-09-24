"""Archive queues and cabinets without discarding tickets or assignments."""
from alembic import op
import sqlalchemy as sa

revision = "f5a7b9c1d3e5"
down_revision = "e4f6a8b0c2d4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("queues", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("cabinets", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("cabinets", "deleted_at")
    op.drop_column("queues", "deleted_at")
