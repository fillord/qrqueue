"""Optional organization geofence for phone attendance marks."""
from alembic import op
import sqlalchemy as sa

revision = "d4e6f8a0b2c4"
down_revision = "c3d5e7f9a1b3"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("organizations", sa.Column("attendance_geo_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("organizations", sa.Column("attendance_geo_latitude", sa.Float(), nullable=True))
    op.add_column("organizations", sa.Column("attendance_geo_longitude", sa.Float(), nullable=True))
    op.add_column("organizations", sa.Column("attendance_geo_radius_m", sa.Integer(), nullable=True))


def downgrade():
    op.drop_column("organizations", "attendance_geo_radius_m")
    op.drop_column("organizations", "attendance_geo_longitude")
    op.drop_column("organizations", "attendance_geo_latitude")
    op.drop_column("organizations", "attendance_geo_enabled")
