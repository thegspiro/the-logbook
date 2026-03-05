"""Create prospect interviews table

Revision ID: 20260305_0100
Revises: 20260304_0300
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260305_0100'
down_revision = '20260304_0300'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'prospect_interviews',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column(
            'prospect_id',
            sa.String(36),
            sa.ForeignKey('prospective_members.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'pipeline_id',
            sa.String(36),
            sa.ForeignKey('membership_pipelines.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column(
            'step_id',
            sa.String(36),
            sa.ForeignKey('membership_pipeline_steps.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column(
            'interviewer_id',
            sa.String(36),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=False,
        ),
        sa.Column('interviewer_role', sa.String(100), nullable=True),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column(
            'recommendation',
            sa.Enum(
                'recommend',
                'recommend_with_reservations',
                'do_not_recommend',
                'undecided',
                name='interviewrecommendation',
            ),
            nullable=True,
        ),
        sa.Column('recommendation_notes', sa.Text, nullable=True),
        sa.Column('interview_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )

    op.create_index(
        'idx_interview_prospect', 'prospect_interviews', ['prospect_id']
    )
    op.create_index(
        'idx_interview_interviewer', 'prospect_interviews', ['interviewer_id']
    )
    op.create_index(
        'idx_interview_prospect_interviewer',
        'prospect_interviews',
        ['prospect_id', 'interviewer_id'],
    )


def downgrade() -> None:
    op.drop_index('idx_interview_prospect_interviewer', 'prospect_interviews')
    op.drop_index('idx_interview_interviewer', 'prospect_interviews')
    op.drop_index('idx_interview_prospect', 'prospect_interviews')
    op.drop_table('prospect_interviews')
    op.execute("DROP TYPE IF EXISTS interviewrecommendation")
