"""Add voting methods and victory conditions to elections

Revision ID: 20260119_0007
Revises: 20260119_0006
Create Date: 2026-01-19 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260119_0007'
down_revision = '20260119_0006'
branch_labels = None
depends_on = None


def upgrade():
    # Add voting method and victory condition fields
    op.add_column('elections', sa.Column('voting_method', sa.String(50), nullable=False, server_default='simple_majority'))
    op.add_column('elections', sa.Column('victory_condition', sa.String(50), nullable=False, server_default='most_votes'))
    op.add_column('elections', sa.Column('victory_threshold', sa.Integer, nullable=True))
    op.add_column('elections', sa.Column('victory_percentage', sa.Integer, nullable=True))


def downgrade():
    op.drop_column('elections', 'victory_percentage')
    op.drop_column('elections', 'victory_threshold')
    op.drop_column('elections', 'victory_condition')
    op.drop_column('elections', 'voting_method')
