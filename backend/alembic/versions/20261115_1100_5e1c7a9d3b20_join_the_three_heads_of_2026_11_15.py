"""Join the three heads main was left with on 2026-11-15

Three pull requests each joined the same pair of heads (``4d8e2b6f1c93``,
history documents, and ``c4e81b7a2d95``, editable election and minutes
emails) in their own revision, and all three merged:

- ``b91f3c6d2e48`` (#4318), which #4303's leave revisions then continued
  from, ending at ``c8d2f61a7e34``;
- ``e2b7d94c1a63`` (#4317);
- ``169a11ebf589`` (#4319).

Each of them is published, so none can be removed: an installation may be
stamped at any of the three. This revision joins all three heads. They are
no-op joins apart from the leave chain, which an installation stamped at
either of the other two applies on its next upgrade.

Revision ID: 5e1c7a9d3b20
Revises: c8d2f61a7e34, e2b7d94c1a63, 169a11ebf589
Create Date: 2026-11-15 11:00:00
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "5e1c7a9d3b20"
down_revision = ("c8d2f61a7e34", "e2b7d94c1a63", "169a11ebf589")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: every parent already performed its own work."""


def downgrade() -> None:
    """No-op: reversing this join restores the three heads."""
