"""Add compliance_tasks_generated to grant_applications.

Revision ID: 472a1e34aa84
Revises: e2c8f5a71d40

`_generate_compliance_tasks` needs to know whether it already ran for an
application, without confusing that with a task an officer created by hand.
The first version of that guard checked `GrantComplianceTask.task_type`
against the three auto-generated types — but `task_type` is a fully
client-settable field on manual task creation (no application-status
restriction), so an officer who added, say, a pre-award "performance_report"
task for their own tracking would make the guard believe the auto-generation
had already run, and the application's actual award would generate nothing.

A boolean on the application itself has no such ambiguity: it means exactly
"has `_generate_compliance_tasks` run for this application," set only by
that method, never inferable from the tasks table's contents.

No backfill. Every existing application defaults to `false`, which is
correct for all of them — none has run through the new guarded code path
yet, so the first award any of them sees post-deploy will regenerate the
compliance task set exactly as it would have before this change (which is
the desired one-time-per-application-history behavior, not a real
duplicate — see GF-14 in docs/security-review/GF-22-grants-fundraising.md).
"""

import sqlalchemy as sa
from alembic import op

revision = "472a1e34aa84"
down_revision = "e2c8f5a71d40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "grant_applications",
        sa.Column(
            "compliance_tasks_generated",
            sa.Boolean(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("grant_applications", "compliance_tasks_generated")
