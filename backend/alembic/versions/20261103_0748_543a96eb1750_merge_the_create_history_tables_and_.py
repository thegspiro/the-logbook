"""merge the create-history-tables and outside-shift/screening-relink merge heads

`02c94bb742d6` and `cbb9726e8af7` are two independently-opened merge
revisions that each rejoin the same fork (`5438939506b9`, `b840c0d2b961`) —
the same race `cbb9726e8af7`'s own docstring describes, happening a second
time: `02c94bb742d6` landed with `038ade7a5cd0` (History module tables)
built on top of it, while `cbb9726e8af7` landed independently and stayed a
head on its own. Validating a chain before it merges cannot catch this,
for the same reason `cbb9726e8af7` could not catch the first one: GitHub
does not re-check a PR against a `main` that has moved since its run
started.

This is a pure join: every parent already did its work, so there is
nothing to run here.

Revision ID: 543a96eb1750
Revises: 038ade7a5cd0, cbb9726e8af7
Create Date: 2026-11-03 07:48:48.494244

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "543a96eb1750"
down_revision: Union[str, None] = ("038ade7a5cd0", "cbb9726e8af7")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
