"""Add voter_overrides column to elections table

Revision ID: 20260214_1000
Revises: 20260214_0900
Create Date: 2026-02-14

Stores secretary-granted voting eligibility overrides per election.
Each override records the member, reason, and granting officer.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_1000'
down_revision = '20260214_0900'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('elections', sa.Column('voter_overrides', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('elections', 'voter_overrides')
