"""Add meeting attendance waiver fields

Revision ID: 20260214_1300
Revises: 20260214_1200
Create Date: 2026-02-14

Adds:
- waiver_reason, waiver_granted_by, waiver_granted_at to meeting_attendees
  (allows secretary/president/chief to excuse a member from a meeting
   without penalizing their attendance percentage)
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_1300'
down_revision = '20260214_1200'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Meeting attendance waivers
    op.add_column('meeting_attendees', sa.Column('waiver_reason', sa.Text(), nullable=True))
    op.add_column('meeting_attendees', sa.Column('waiver_granted_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True))
    op.add_column('meeting_attendees', sa.Column('waiver_granted_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('meeting_attendees', 'waiver_granted_at')
    op.drop_column('meeting_attendees', 'waiver_granted_by')
    op.drop_column('meeting_attendees', 'waiver_reason')
