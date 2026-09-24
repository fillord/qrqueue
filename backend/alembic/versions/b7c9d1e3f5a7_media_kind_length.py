"""Allow the full advertisement media-kind value."""
from alembic import op
import sqlalchemy as sa

revision = "b7c9d1e3f5a7"
down_revision = "a6b8c0d2e4f6"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("tv_media", "kind", existing_type=sa.String(length=12),
                    type_=sa.String(length=20), existing_nullable=False)


def downgrade():
    op.alter_column("tv_media", "kind", existing_type=sa.String(length=20),
                    type_=sa.String(length=12), existing_nullable=False)
