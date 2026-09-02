"""Close approval chains that were denied and left with actionable steps

A denial is terminal for the whole entity. ``_terminate_pending_steps`` closes
the rest of the chain from the moment it shipped, but an installation can
already hold the state it exists to prevent: a ``DENIED`` step followed by one
or more ``PENDING`` ones, created before that code existed.

Those rows are not inert. The next ``PENDING`` record becomes the entity's
"current" step, so a denied purchase request keeps appearing as awaiting
approval — and approving the last of them made ``_check_all_steps_complete()``
true, which reverses the denial and encumbers budget against a request the
department refused. An EMAIL-type step's token is live for the same reason.

``FinanceService._ensure_current_step`` now refuses to act on any chain
carrying a denial, so the reversal cannot happen whether or not this has run.
This is the other half: it takes the rows out of the pending listings and
revokes the tokens, which the runtime guard cannot do.

Irreversible in substance. ``downgrade`` cannot tell a step this closed from
one closed by a denial at the time, so it does nothing rather than reopening
chains the department has already refused.

Guarded on the table existing: fresh installs come up through ``create_all`` +
stamp-head rather than this chain (CLAUDE.md pitfall #26).
"""

import sqlalchemy as sa
from alembic import op

revision = "d5e1f6a8b037"
down_revision = "e93b6a4d21c7"
branch_labels = None
depends_on = None

_TABLE = "approval_step_records"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table(_TABLE):
        return
    op.execute(
        sa.text(
            "UPDATE approval_step_records r "
            "JOIN ("
            "  SELECT DISTINCT entity_type, entity_id"
            "  FROM approval_step_records WHERE status = 'denied'"
            ") d ON d.entity_type = r.entity_type AND d.entity_id = r.entity_id "
            "SET r.status = 'skipped', "
            "    r.approval_token = NULL, "
            "    r.token_expires_at = NULL "
            "WHERE r.status = 'pending'"
        )
    )


def downgrade() -> None:
    # Deliberately empty: see the module docstring. Reopening these steps would
    # make refused requests actionable again, which is the defect, not the
    # prior state worth restoring.
    pass
