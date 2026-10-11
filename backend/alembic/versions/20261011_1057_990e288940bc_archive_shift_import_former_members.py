"""Archive the former members the shift history import created as inactive

The shift history import used to file every person it could not match as an
``inactive`` member. Those are former members, often long gone, and inactive
reads as a current member who has stopped attending: it kept them on the
current roster. The import now writes them ``archived``; this moves the rows
it already wrote.

**A row is moved only when all three of the import's own marks are still on
it:**

* ``status`` is still ``inactive``;
* ``password_hash`` is NULL — nobody has turned the record into a login;
* ``status_change_reason`` still starts with the import's text, ``Created by
  shift history import of``. Every status change through the member screens
  rewrites that reason, so a record an administrator has touched since no
  longer carries it.

A member a department made inactive by hand never carries the import's reason,
so it is left alone. ``archived_at`` is set to when the import created the
record (``status_changed_at``), which is when it became a former member here.

The downgrade returns every row bearing the same marks with status
``archived`` to ``inactive`` and clears ``archived_at``. That includes records
an import created after this upgrade, which is correct: the code a downgrade
returns to writes them ``inactive``.

Revision ID: 990e288940bc
Revises: 4b7e1f0c9a2d
Create Date: 2026-10-11 10:57:46.135573

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "990e288940bc"
down_revision: Union[str, None] = "4b7e1f0c9a2d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copy of the reason prefix ShiftHistoryImportService._create_members
# writes. A migration must keep matching what it matched the day it ran.
_IMPORT_REASON_PREFIX = "Created by shift history import of "

# Compared with SUBSTR() rather than LIKE so an underscore or percent sign in
# the prefix can never act as a wildcard.
_IMPORT_MARKS = (
    "password_hash IS NULL "
    "AND SUBSTR(status_change_reason, 1, :prefix_length) = :prefix"
)
_PARAMS = {"prefix": _IMPORT_REASON_PREFIX, "prefix_length": len(_IMPORT_REASON_PREFIX)}


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE users "
            "SET status = 'archived', "
            "archived_at = COALESCE(archived_at, status_changed_at, CURRENT_TIMESTAMP) "
            f"WHERE status = 'inactive' AND {_IMPORT_MARKS}"
        ),
        _PARAMS,
    )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE users "
            "SET status = 'inactive', archived_at = NULL "
            f"WHERE status = 'archived' AND {_IMPORT_MARKS}"
        ),
        _PARAMS,
    )
