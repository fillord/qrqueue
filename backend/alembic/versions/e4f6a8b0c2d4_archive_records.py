"""Archive organizations and users without discarding their history."""
from alembic import op
import sqlalchemy as sa

revision = "e4f6a8b0c2d4"
down_revision = "d3e5f7a9b1c3"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("organizations", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("users", "deleted_at")
    op.drop_column("organizations", "deleted_at")
