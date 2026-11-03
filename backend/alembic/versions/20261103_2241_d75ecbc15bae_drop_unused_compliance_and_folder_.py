"""Drop the folder-backfill bookkeeping and the unused compliance tables

Two owner decisions of 2026-11-01, from "Upgraded and Fresh Databases Still
Differ" in ``docs/KNOWN_LIMITATIONS.md``:

- **Drop the backfill bookkeeping.** ``document_unfiled_backfill``
  (``dcb8a46ac50c``) and ``facility_folder_tier_backfill`` /
  ``facility_document_refile_backfill`` (``65128d5ccd50``) recorded each
  document those 2026-10-11 backfills moved, so their downgrades could move it
  back. Only a database that ran the chain has them; a fresh install never ran
  the backfills.
- **Retire the compliance tables.** ``compliance_policies``,
  ``policy_acknowledgments``, ``compliance_checklists``,
  ``checklist_submissions`` and ``compliance_incidents`` came from
  ``20260201_0016``. No model maps them and nothing in the application reads
  or writes them; the facilities checklists are the separate
  ``facility_compliance_checklists`` family. ``main.py`` stops replaying
  ``20260201_0016`` on fresh installs and schema repair in the same change, or
  the next startup would rebuild them.

**Irreversible.** Any rows in the eight tables are deleted with them — the
owner accepted that for the compliance tables, and the bookkeeping rows have no
use without the downgrades they served. ``downgrade()`` therefore restores
nothing, and does not recreate empty tables either, which would only look like a
restore. The consequences for older downgrades:

- ``dcb8a46ac50c`` and ``65128d5ccd50`` skip their restore when the record is
  absent, so stepping down past them now leaves documents filed where the
  backfills put them, and folders with the permissions they were given.
- ``20260201_0016``'s downgrade drops its tables without a guard, so stepping
  down past it now fails on the first missing table.

Each drop is skipped when the table is absent (a fresh install, or a re-run).
The only foreign keys onto these tables are the two inside the set
(``policy_acknowledgments.policy_id``, ``checklist_submissions.checklist_id``),
so each child goes before its parent.

Revision ID: d75ecbc15bae
Revises: 6b81e95d4157
Create Date: 2026-11-03 22:41:20.380553

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d75ecbc15bae"
down_revision: Union[str, None] = "6b81e95d4157"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# A module constant so a test can point the migration at scratch copies.
# Children precede the tables they reference.
TABLES = (
    "document_unfiled_backfill",
    "facility_document_refile_backfill",
    "facility_folder_tier_backfill",
    "policy_acknowledgments",
    "compliance_policies",
    "checklist_submissions",
    "compliance_checklists",
    "compliance_incidents",
)


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in TABLES:
        if table in existing:
            op.execute(f"DROP TABLE IF EXISTS {table}")


def downgrade() -> None:
    """Deliberately irreversible; see the module docstring.

    The rows are gone, and empty copies of the tables would only suggest
    otherwise.
    """
    return
