"""Backfill stale due_date on non-fixed_date training requirements.

TR-17 (Training core) security-review pass 3 found ``RequirementModal.tsx``
seeds its ``due_date`` form field from the existing row and only clears or
edits it on the ``fixed_date`` screen. Switching an existing requirement's
``due_date_type`` away from ``fixed_date`` (to ``calendar_period``,
``rolling``, or ``certification_period``) therefore still submitted the old
``due_date`` alongside the new type, leaving a stale value stored on a
requirement whose deadline should come entirely from its period/anchor
calculation instead.

The API/service layer already stopped trusting that value for these three
types (the write path, in the same change as this migration, now clears it
going forward; the read-side calculators already ignored it). Neither
covers a requirement created or last edited *before* those fixes existed:
until somebody next edits it, ``GET /training/requirements`` and the
requirement detail page still render the stale date directly, unfiltered by
either calculator. This migration settles the rows already there, as the
repository's rule for a value with one canonical meaning requires (CLAUDE.md
pitfall #20's principle applied to a plain column, not just a JSON one): a
write-path fix alone never reaches a row nobody revisits.

**This migration is not reversible.** The pre-existing ``due_date`` values
this clears were never valid for these three due-date types in the first
place (there is no UI path that sets both a period/rolling/certification
configuration and a deliberate override date at once) -- there is nothing
correct to restore them to. ``downgrade()`` is deliberately a no-op.

Revision ID: bbdaca0844df
Revises: e3a9c1d5b7f2
Create Date: 2026-09-04 05:30:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "bbdaca0844df"
down_revision = "e3a9c1d5b7f2"
branch_labels = None
depends_on = None

# Frozen, not imported from app.models.training.DueDateType: a migration
# must keep transforming rows the way it did the day it ran (see
# 20260903_1300_e3a9c1d5b7f2 for the same rule applied to a JSON column).
_NON_FIXED_DATE_TYPES = ("calendar_period", "rolling", "certification_period")


def _backfill_statement():
    return sa.text(
        "UPDATE training_requirements "
        "SET due_date = NULL "
        "WHERE due_date IS NOT NULL "
        "AND due_date_type IN :types"
    ).bindparams(sa.bindparam("types", expanding=True))


def upgrade() -> None:
    bind = op.get_bind()
    if "training_requirements" not in sa.inspect(bind).get_table_names():
        return

    bind.execute(_backfill_statement(), {"types": list(_NON_FIXED_DATE_TYPES)})


def downgrade() -> None:
    # Irreversible by design: the cleared due_date values were never valid
    # for calendar_period/rolling/certification_period requirements (there
    # is no UI path that sets both a period/anchor configuration and a
    # deliberate override date at once) -- there is nothing correct to
    # restore them to, and the pre-fix code already ignored them for these
    # types wherever days_until_due was computed.
    pass
