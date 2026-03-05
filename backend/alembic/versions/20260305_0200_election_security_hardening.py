"""Election security hardening

Revision ID: 20260305_0200
Revises: 20260305_0100
Create Date: 2026-03-05

Adds:
- vote_dedup_hash column + unique index (MySQL-compatible double-vote prevention)
- chain_hash column (sequential vote chain for integrity)
- receipt_hash column (voter receipt for verification)
- is_test column (test ballot exclusion)
- quorum_type + quorum_value columns on elections
- last_chain_hash column on elections
- Drops broken PostgreSQL-only partial indexes from 20260210_0023

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260305_0200'
down_revision = '20260305_0100'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- Elections table: quorum and chain hash --
    op.add_column('elections', sa.Column('quorum_type', sa.String(20), nullable=False, server_default='none'))
    op.add_column('elections', sa.Column('quorum_value', sa.Integer(), nullable=True))
    op.add_column('elections', sa.Column('last_chain_hash', sa.String(64), nullable=True))

    # -- Votes table: dedup, chain, receipt, test flag --
    op.add_column('votes', sa.Column('vote_dedup_hash', sa.String(64), nullable=True))
    op.add_column('votes', sa.Column('chain_hash', sa.String(64), nullable=True))
    op.add_column('votes', sa.Column('receipt_hash', sa.String(64), nullable=True))
    op.add_column('votes', sa.Column('is_test', sa.Boolean(), nullable=False, server_default=sa.text('0')))

    # MySQL-compatible unique index for double-vote prevention.
    # Replaces the broken PostgreSQL-only partial indexes from 20260210_0023.
    # vote_dedup_hash = SHA256(election_id + voter_id_or_hash + position)
    # computed at insert time in the application layer.
    op.create_index('ix_votes_dedup_hash', 'votes', ['vote_dedup_hash'], unique=True)

    # Drop the PostgreSQL-only partial indexes that don't work on MySQL.
    # These use WHERE clauses which MySQL silently ignores.
    for idx_name in [
        'idx_votes_unique_non_anon_position',
        'idx_votes_unique_non_anon_single',
        'idx_votes_unique_anon_position',
        'idx_votes_unique_anon_single',
    ]:
        try:
            op.execute(f"DROP INDEX IF EXISTS {idx_name} ON votes")
        except Exception:
            pass  # Index may not exist if migration 20260210_0023 failed silently

    print("  Election security hardening migration complete")
    print("  - Added quorum_type, quorum_value, last_chain_hash to elections")
    print("  - Added vote_dedup_hash (unique), chain_hash, receipt_hash, is_test to votes")
    print("  - Dropped broken PostgreSQL-only partial indexes")


def downgrade() -> None:
    op.drop_index('ix_votes_dedup_hash', table_name='votes')
    op.drop_column('votes', 'is_test')
    op.drop_column('votes', 'receipt_hash')
    op.drop_column('votes', 'chain_hash')
    op.drop_column('votes', 'vote_dedup_hash')
    op.drop_column('elections', 'last_chain_hash')
    op.drop_column('elections', 'quorum_value')
    op.drop_column('elections', 'quorum_type')
