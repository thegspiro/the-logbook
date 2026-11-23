"""The last day a member met each rolling requirement

Adds ``rolling_requirement_last_met`` (owner decision 2026-11-23): one row per
member and rolling requirement, holding the department's date of the last
daily compliance-notice run that found the requirement met. The
non-compliance notice keys a rolling requirement on that date, so a member who
meets it and later falls short again is emailed again, once. See
``app/models/training.py`` (``RollingRequirementLastMet``).

A new, empty table, so no existing row is touched and nothing needs settling
(CLAUDE.md pitfall #35). There is no backfill: the dates were never recorded,
and the task fills the table from its next run. Until a member's first row,
their rolling notice keeps the bare requirement key it has used since
2026-11-21, so nobody already told is told again by the upgrade. Unique on
``(user_id, requirement_id)``, so two runs racing past the lookup cannot both
insert (pitfall #36).

Created only when absent, so a database ``create_all`` already built is left
alone and running the upgrade twice is harmless (pitfall #26). It references
``organizations``, ``users`` and ``training_requirements``, which migrations
create.

The downgrade drops the table. The previous release reads nothing from it and
boots against the downgraded database; the dates are lost, so after a later
upgrade a member currently short of a rolling requirement who was told before
the downgrade is not told again until they next meet it and lapse.

Revision ID: 07abf8e6553b
Revises: 986d6575af35
Create Date: 2026-11-23 06:26:36.330988
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "07abf8e6553b"
down_revision: Union[str, None] = "986d6575af35"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "rolling_requirement_last_met"
UQ_USER_REQ = "uq_rolling_last_met_user_req"
IX_ORG = "ix_rolling_requirement_last_met_organization_id"


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if TABLE in _tables():
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "requirement_id",
            sa.String(36),
            sa.ForeignKey("training_requirements.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("last_met_on", sa.Date(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.UniqueConstraint("user_id", "requirement_id", name=UQ_USER_REQ),
    )
    op.create_index(IX_ORG, TABLE, ["organization_id"])


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE}")
