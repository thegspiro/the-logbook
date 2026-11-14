"""merge the two independent fixes for the outside-shift-evaluations/screening-relink fork

PR #3963 (`b840c0d2b961`) and another, independently-opened PR
(`bbe101d29964`, with `5438939506b9` built on top of it) each rejoined the
same original fork — `400ce5009f5e` and `beedcad5b36a` — and merged into
`main` within minutes of each other. Validating a chain before it merges
cannot catch this: GitHub does not re-check a PR against a `main` that has
moved since its run started, so two merge-revision PRs can each look like a
clean single-head chain and still fork the moment both land. This is the
second fork of the evening for the same reason, rejoined the same way.

This is a pure join: every parent already did its work, so there is nothing
to run here.

Revision ID: cbb9726e8af7
Revises: 5438939506b9, b840c0d2b961
Create Date: 2026-11-03 02:52:00.793522

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "cbb9726e8af7"
down_revision: Union[str, None] = ("5438939506b9", "b840c0d2b961")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
