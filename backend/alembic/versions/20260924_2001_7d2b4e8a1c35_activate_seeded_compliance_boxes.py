"""Switch on the Compliance suggestion boxes 3c918c06466d seeded inactive

Revision ``3c918c06466d`` created each department's default **Compliance** box
inactive, so it would not accept reports before anyone held the Compliance
Officer position. The owner has since decided the box should be live from the
start (2026-09-24), accepting that reports filed before an officer is appointed
wait unread. ``3c918c06466d`` is published and frozen, so the change ships here.

**Only a box that is still exactly what the seed wrote is switched on**, since
this is an addition and an addition needs positive evidence that the row is an
unedited seed:

* named ``Compliance`` with the seeded description and no creator. A
  department's own box always has ``created_by`` set by the admin endpoint.
* ``updated_at`` still equals ``created_at``. Both take ``NOW()`` in the one
  INSERT, and any save through the admin screen moves ``updated_at``, so an
  administrator who opened the box and left it off is not overridden.
* at least one reviewer. A live box nobody can read is the void
  ``SuggestionService._validate_box_write`` refuses, and this revision does not
  create one.

If this is wrong about a box, the cost is a box an administrator meant to keep
off being on until they switch it off again. It discloses nothing: only the
box's reviewers can read what it receives.

This revision also **merges two heads**. ``3c918c06466d`` and ``ced0061dedc8``
(inventory NFC tags) were written in parallel against the same parent,
``941e1251ad74``, and merged together. It does no work for the NFC branch.

Revision ID: 7d2b4e8a1c35
Revises: 3c918c06466d, ced0061dedc8
Create Date: 2026-09-24 20:01:32.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7d2b4e8a1c35"
down_revision: Union[str, Sequence[str], None] = ("3c918c06466d", "ced0061dedc8")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Frozen copy of what 3c918c06466d wrote. It must match that revision's frozen
# copy, not today's service constants, which are free to change.
_BOX_NAME = "Compliance"
_BOX_DESCRIPTION = (
    "Report a compliance concern: a policy, safety, training-record or "
    "regulatory issue. Reviewed by the Compliance Officer."
)

# Written out in full in both directions rather than assembled from a shared
# fragment, so the statements stay literal SQL.
_ACTIVATE = (
    "UPDATE suggestion_boxes SET is_active = 1 "
    "WHERE is_active = 0 AND name = :name AND description = :description "
    "AND created_by IS NULL AND updated_at = created_at "
    "AND id IN (SELECT box_id FROM suggestion_box_reviewers)"
)
_DEACTIVATE = (
    "UPDATE suggestion_boxes SET is_active = 0 "
    "WHERE is_active = 1 AND name = :name AND description = :description "
    "AND created_by IS NULL AND updated_at = created_at "
    "AND id IN (SELECT box_id FROM suggestion_box_reviewers)"
)


def _has_tables() -> bool:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    return {"suggestion_boxes", "suggestion_box_reviewers"} <= tables


def upgrade() -> None:
    # Defensive only: both tables are created by 80e2004cd691.
    if not _has_tables():
        return
    op.get_bind().execute(
        sa.text(_ACTIVATE),
        {"name": _BOX_NAME, "description": _BOX_DESCRIPTION},
    )


def downgrade() -> None:
    if not _has_tables():
        return
    # The same signature, reversed. A box the seed created active (onboarding
    # after this revision) matches too, and is switched off with the rest,
    # which is 3c918c06466d's behaviour that this downgrade returns to.
    op.get_bind().execute(
        sa.text(_DEACTIVATE),
        {"name": _BOX_NAME, "description": _BOX_DESCRIPTION},
    )
