"""queue schedule_open worker baseline

Revision ID: a1c3e5f7b9d1
Revises: 9fe4fe679793
Create Date: 2026-09-14 12:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1c3e5f7b9d1'
down_revision: Union[str, None] = '9fe4fe679793'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('queues', sa.Column('schedule_open', sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column('queues', 'schedule_open')
