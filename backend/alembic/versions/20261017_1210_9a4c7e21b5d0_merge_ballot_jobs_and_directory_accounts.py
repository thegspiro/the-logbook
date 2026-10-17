"""merge ballot send jobs and directory account heads

Ballot send jobs (244b0fd07205, reminders as a job kind) and the Microsoft 365
directory-account columns (d3bb8f81ed07) were each written against a different
parent and merged the same day, which left main with two heads. ``alembic
upgrade head`` refuses to run with two, so every job that migrates an empty
database failed. Schema-neutral: this only joins the two lines.

Revision ID: 9a4c7e21b5d0
Revises: 244b0fd07205, d3bb8f81ed07
Create Date: 2026-10-17 12:10:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "9a4c7e21b5d0"
down_revision: Union[str, None] = ("244b0fd07205", "d3bb8f81ed07")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
