"""Add proxy voting support to elections

Revision ID: 20260214_1100
Revises: 20260214_1000
Create Date: 2026-02-14

Adds proxy_authorizations JSON column to elections table and proxy
vote tracking columns (is_proxy_vote, proxy_voter_id,
proxy_authorization_id, proxy_delegating_user_id) to votes table.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_1100'
down_revision = '20260214_1000'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Election-level proxy authorizations (JSON array)
    op.add_column('elections', sa.Column('proxy_authorizations', sa.JSON(), nullable=True))

    # Vote-level proxy tracking
    op.add_column('votes', sa.Column('is_proxy_vote', sa.Boolean(), nullable=False, server_default=sa.text('0')))
    op.add_column('votes', sa.Column('proxy_voter_id', sa.String(36), nullable=True))
    op.add_column('votes', sa.Column('proxy_authorization_id', sa.String(36), nullable=True))
    op.add_column('votes', sa.Column('proxy_delegating_user_id', sa.String(36), nullable=True))

    # Index for forensics queries on proxy votes
    op.create_index('ix_votes_proxy_voter_id', 'votes', ['proxy_voter_id'])
    op.create_index('ix_votes_is_proxy_vote', 'votes', ['is_proxy_vote'])

    # Foreign key for proxy_voter_id -> users.id
    op.create_foreign_key(
        'fk_votes_proxy_voter_id_users',
        'votes', 'users',
        ['proxy_voter_id'], ['id'],
    )


def downgrade() -> None:
    op.drop_constraint('fk_votes_proxy_voter_id_users', 'votes', type_='foreignkey')
    op.drop_index('ix_votes_is_proxy_vote', table_name='votes')
    op.drop_index('ix_votes_proxy_voter_id', table_name='votes')
    op.drop_column('votes', 'proxy_delegating_user_id')
    op.drop_column('votes', 'proxy_authorization_id')
    op.drop_column('votes', 'proxy_voter_id')
    op.drop_column('votes', 'is_proxy_vote')
    op.drop_column('elections', 'proxy_authorizations')
