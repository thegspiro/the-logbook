"""add vote unique constraints for ballot integrity

Revision ID: 20260210_0023
Revises: 20260209_0022
Create Date: 2026-02-10 12:00:00.000000

CRITICAL SECURITY FIX: Prevent double-voting at database level

This migration adds unique constraints to the votes table to ensure
ballot integrity and prevent duplicate votes through:
- Race conditions
- Direct database manipulation
- Application logic bypass

Four partial unique indexes are created to handle:
1. Non-anonymous voting with positions
2. Non-anonymous voting without positions (single-position elections)
3. Anonymous voting with positions
4. Anonymous voting without positions

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260210_0023'
down_revision = '20260209_0022'  # Update this to your latest migration
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Add unique constraints to votes table to prevent double-voting.

    Uses partial unique indexes to handle nullable columns correctly.
    """

    # 1. Non-anonymous voting with positions
    # Ensures a user can only vote once per position in non-anonymous elections
    op.execute("""
        CREATE UNIQUE INDEX idx_votes_unique_non_anon_position
        ON votes (election_id, voter_id, position)
        WHERE voter_id IS NOT NULL AND position IS NOT NULL
    """)

    # 2. Non-anonymous voting without positions (single-position elections)
    # Ensures a user can only vote once total in single-position non-anonymous elections
    op.execute("""
        CREATE UNIQUE INDEX idx_votes_unique_non_anon_single
        ON votes (election_id, voter_id)
        WHERE voter_id IS NOT NULL AND position IS NULL
    """)

    # 3. Anonymous voting with positions
    # Ensures an anonymous voter (by hash) can only vote once per position
    op.execute("""
        CREATE UNIQUE INDEX idx_votes_unique_anon_position
        ON votes (election_id, voter_hash, position)
        WHERE voter_hash IS NOT NULL AND position IS NOT NULL
    """)

    # 4. Anonymous voting without positions (single-position elections)
    # Ensures an anonymous voter can only vote once total in single-position elections
    op.execute("""
        CREATE UNIQUE INDEX idx_votes_unique_anon_single
        ON votes (election_id, voter_hash)
        WHERE voter_hash IS NOT NULL AND position IS NULL
    """)

    print("✅ Added 4 unique constraints to prevent double-voting")
    print("   - Non-anonymous with positions")
    print("   - Non-anonymous single-position")
    print("   - Anonymous with positions")
    print("   - Anonymous single-position")


def downgrade() -> None:
    """
    Remove unique constraints from votes table.

    WARNING: This will remove double-voting protection!
    Only run in development/testing environments.
    """
    op.execute("DROP INDEX IF EXISTS idx_votes_unique_anon_single")
    op.execute("DROP INDEX IF EXISTS idx_votes_unique_anon_position")
    op.execute("DROP INDEX IF EXISTS idx_votes_unique_non_anon_single")
    op.execute("DROP INDEX IF EXISTS idx_votes_unique_non_anon_position")

    print("⚠️  WARNING: Removed double-voting protection constraints")
