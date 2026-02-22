"""Add shift report review workflow and rating customization

Adds review_status, reviewed_by, reviewed_at, reviewer_notes to
shift_completion_reports for approval workflow before trainee visibility.

Adds report_review_required, report_review_role, rating_label,
rating_scale_type, rating_scale_labels to training_module_configs
for department-level customization of report privacy and ratings.

Revision ID: 20260222_0900
Revises: 20260222_0800
Create Date: 2026-02-22 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260222_0900"
down_revision: Union[str, None] = "20260222_0800"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- shift_completion_reports: review workflow --
    op.add_column('shift_completion_reports',
        sa.Column('review_status', sa.String(20), nullable=False, server_default='approved'))
    op.add_column('shift_completion_reports',
        sa.Column('reviewed_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True))
    op.add_column('shift_completion_reports',
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('shift_completion_reports',
        sa.Column('reviewer_notes', sa.Text(), nullable=True))
    op.create_index('idx_shift_report_review', 'shift_completion_reports',
        ['organization_id', 'review_status'])

    # -- training_module_configs: review workflow settings --
    op.add_column('training_module_configs',
        sa.Column('report_review_required', sa.Boolean(), nullable=False, server_default='0'))
    op.add_column('training_module_configs',
        sa.Column('report_review_role', sa.String(50), nullable=False, server_default='training_officer'))

    # -- training_module_configs: rating customization --
    op.add_column('training_module_configs',
        sa.Column('rating_label', sa.String(100), nullable=False, server_default='Performance Rating'))
    op.add_column('training_module_configs',
        sa.Column('rating_scale_type', sa.String(20), nullable=False, server_default='stars'))
    op.add_column('training_module_configs',
        sa.Column('rating_scale_labels', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('training_module_configs', 'rating_scale_labels')
    op.drop_column('training_module_configs', 'rating_scale_type')
    op.drop_column('training_module_configs', 'rating_label')
    op.drop_column('training_module_configs', 'report_review_role')
    op.drop_column('training_module_configs', 'report_review_required')

    op.drop_index('idx_shift_report_review', table_name='shift_completion_reports')
    op.drop_column('shift_completion_reports', 'reviewer_notes')
    op.drop_column('shift_completion_reports', 'reviewed_at')
    op.drop_column('shift_completion_reports', 'reviewed_by')
    op.drop_column('shift_completion_reports', 'review_status')
