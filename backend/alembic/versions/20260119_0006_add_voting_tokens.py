"""Add voting tokens for secure anonymous ballot access

Revision ID: 20260119_0006
Revises: 20260118_0005
Create Date: 2026-01-19 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260119_0006'
down_revision = '20260118_0005'
branch_labels = None
depends_on = None


def upgrade():
    # Create voting_tokens table
    op.create_table(
        'voting_tokens',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('election_id', sa.String(36), sa.ForeignKey('elections.id'), nullable=False),
        sa.Column('token', sa.String(128), nullable=False, unique=True),
        sa.Column('voter_hash', sa.String(64), nullable=False),
        sa.Column('created_at', sa.DateTime, nullable=False),
        sa.Column('expires_at', sa.DateTime, nullable=False),
        sa.Column('used', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('used_at', sa.DateTime, nullable=True),
        sa.Column('first_accessed_at', sa.DateTime, nullable=True),
        sa.Column('access_count', sa.Integer, nullable=False, server_default='0'),
    )

    # Create indexes
    op.create_index('ix_voting_tokens_election_id', 'voting_tokens', ['election_id'])
    op.create_index('ix_voting_tokens_token', 'voting_tokens', ['token'])
    op.create_index('ix_voting_tokens_voter_hash', 'voting_tokens', ['voter_hash'])


def downgrade():
    op.drop_index('ix_voting_tokens_voter_hash', 'voting_tokens')
    op.drop_index('ix_voting_tokens_token', 'voting_tokens')
    op.drop_index('ix_voting_tokens_election_id', 'voting_tokens')
    op.drop_table('voting_tokens')
