"""add vote signatures, soft-delete, rank column, and token positions_voted

Revision ID: 20260212_0500
Revises: 20260212_0400
Create Date: 2026-02-12 15:00:00.000000

Adds columns to support:
1. Vote signatures for tampering detection (vote_signature)
2. Soft-delete for votes (deleted_at, deleted_by, deletion_reason)
3. Vote rank for ranked-choice voting (vote_rank)
4. Token position tracking for multi-position elections (positions_voted)
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260212_0500'
down_revision = '20260212_0400'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Vote signatures for tampering detection
    op.add_column('votes', sa.Column('vote_signature', sa.String(128), nullable=True))

    # 2. Soft-delete columns for votes
    op.add_column('votes', sa.Column('deleted_at', sa.DateTime, nullable=True))
    op.add_column('votes', sa.Column('deleted_by', sa.String(36), nullable=True))
    op.add_column('votes', sa.Column('deletion_reason', sa.Text, nullable=True))

    # 3. Vote rank for ranked-choice voting (1 = first choice, 2 = second, etc.)
    op.add_column('votes', sa.Column('vote_rank', sa.Integer, nullable=True))

    # 4. Token position tracking for multi-position elections
    op.add_column('voting_tokens', sa.Column('positions_voted', sa.JSON, nullable=True))

    # Add index on deleted_at for efficient filtering of active votes
    op.create_index('ix_votes_deleted_at', 'votes', ['deleted_at'])

    print("✅ Added vote signatures, soft-delete, rank, and token positions_voted columns")


def downgrade() -> None:
    op.drop_index('ix_votes_deleted_at', table_name='votes')
    op.drop_column('voting_tokens', 'positions_voted')
    op.drop_column('votes', 'vote_rank')
    op.drop_column('votes', 'deletion_reason')
    op.drop_column('votes', 'deleted_by')
    op.drop_column('votes', 'deleted_at')
    op.drop_column('votes', 'vote_signature')

    print("⚠️  Removed vote signatures, soft-delete, rank, and token positions_voted columns")
