"""Add runoff configuration to elections

Revision ID: 20260119_0008
Revises: 20260119_0007
Create Date: 2026-01-19 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260119_0008'
down_revision = '20260119_0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add runoff configuration columns
    op.add_column('elections', sa.Column('enable_runoffs', sa.Boolean(), nullable=False, server_default='0'))
    op.add_column('elections', sa.Column('runoff_type', sa.String(length=50), nullable=False, server_default='top_two'))
    op.add_column('elections', sa.Column('max_runoff_rounds', sa.Integer(), nullable=False, server_default='3'))
    op.add_column('elections', sa.Column('is_runoff', sa.Boolean(), nullable=False, server_default='0'))
    op.add_column('elections', sa.Column('parent_election_id', sa.String(36), nullable=True))
    op.add_column('elections', sa.Column('runoff_round', sa.Integer(), nullable=False, server_default='0'))

    # Add foreign key constraint for parent_election_id
    op.create_foreign_key('fk_elections_parent_election_id', 'elections', 'elections', ['parent_election_id'], ['id'])

    # Add index for parent_election_id
    op.create_index('ix_elections_parent_election_id', 'elections', ['parent_election_id'], unique=False)


def downgrade() -> None:
    # Remove index and foreign key
    op.drop_index('ix_elections_parent_election_id', table_name='elections')
    op.drop_constraint('fk_elections_parent_election_id', 'elections', type_='foreignkey')

    # Remove columns
    op.drop_column('elections', 'runoff_round')
    op.drop_column('elections', 'parent_election_id')
    op.drop_column('elections', 'is_runoff')
    op.drop_column('elections', 'max_runoff_rounds')
    op.drop_column('elections', 'runoff_type')
    op.drop_column('elections', 'enable_runoffs')
