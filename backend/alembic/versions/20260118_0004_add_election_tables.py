"""add election tables

Revision ID: 20260118_0004
Revises: 20260118_0003
Create Date: 2026-01-18 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260118_0004'
down_revision = '20260118_0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create elections table
    op.create_table(
        'elections',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('election_type', sa.String(length=50), nullable=False),
        sa.Column('positions', sa.JSON(), nullable=True),
        sa.Column('start_date', sa.DateTime(), nullable=False),
        sa.Column('end_date', sa.DateTime(), nullable=False),
        sa.Column('status', sa.Enum('draft', 'open', 'closed', 'cancelled', name='electionstatus'), nullable=False),
        sa.Column('anonymous_voting', sa.Boolean(), nullable=False),
        sa.Column('allow_write_ins', sa.Boolean(), nullable=False),
        sa.Column('max_votes_per_position', sa.Integer(), nullable=False),
        sa.Column('results_visible_immediately', sa.Boolean(), nullable=False),
        sa.Column('eligible_voters', sa.JSON(), nullable=True),
        sa.Column('created_by', sa.String(36), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_elections_organization_id', 'elections', ['organization_id'], unique=False)
    op.create_index('ix_elections_status', 'elections', ['status'], unique=False)
    op.create_index('ix_elections_dates', 'elections', ['start_date', 'end_date'], unique=False)

    # Create candidates table
    op.create_table(
        'candidates',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('election_id', sa.String(36), nullable=False),
        sa.Column('user_id', sa.String(36), nullable=True),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('position', sa.String(length=100), nullable=True),
        sa.Column('statement', sa.Text(), nullable=True),
        sa.Column('photo_url', sa.String(length=500), nullable=True),
        sa.Column('nomination_date', sa.DateTime(), nullable=False),
        sa.Column('nominated_by', sa.String(36), nullable=True),
        sa.Column('accepted', sa.Boolean(), nullable=False),
        sa.Column('is_write_in', sa.Boolean(), nullable=False),
        sa.Column('display_order', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['election_id'], ['elections.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['nominated_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_candidates_election_id', 'candidates', ['election_id'], unique=False)
    op.create_index('ix_candidates_user_id', 'candidates', ['user_id'], unique=False)
    op.create_index('ix_candidates_position', 'candidates', ['position'], unique=False)

    # Create votes table
    op.create_table(
        'votes',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('election_id', sa.String(36), nullable=False),
        sa.Column('candidate_id', sa.String(36), nullable=False),
        sa.Column('voter_id', sa.String(36), nullable=True),
        sa.Column('voter_hash', sa.String(length=64), nullable=True),
        sa.Column('position', sa.String(length=100), nullable=True),
        sa.Column('voted_at', sa.DateTime(), nullable=False),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('user_agent', sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(['election_id'], ['elections.id'], ),
        sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], ),
        sa.ForeignKeyConstraint(['voter_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_votes_election_id', 'votes', ['election_id'], unique=False)
    op.create_index('ix_votes_candidate_id', 'votes', ['candidate_id'], unique=False)
    op.create_index('ix_votes_voter_id', 'votes', ['voter_id'], unique=False)
    op.create_index('ix_votes_voter_hash', 'votes', ['voter_hash'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_votes_voter_hash', table_name='votes')
    op.drop_index('ix_votes_voter_id', table_name='votes')
    op.drop_index('ix_votes_candidate_id', table_name='votes')
    op.drop_index('ix_votes_election_id', table_name='votes')
    op.drop_table('votes')

    op.drop_index('ix_candidates_position', table_name='candidates')
    op.drop_index('ix_candidates_user_id', table_name='candidates')
    op.drop_index('ix_candidates_election_id', table_name='candidates')
    op.drop_table('candidates')

    op.drop_index('ix_elections_dates', table_name='elections')
    op.drop_index('ix_elections_status', table_name='elections')
    op.drop_index('ix_elections_organization_id', table_name='elections')
    op.drop_table('elections')
