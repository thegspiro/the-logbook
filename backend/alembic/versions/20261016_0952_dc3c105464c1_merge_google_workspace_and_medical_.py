"""merge google workspace and medical storage heads

PR 3279 (Google Workspace accounts, 61dfbcc23cba) and the Medical Supplies
storage auto-match (58522b08f6a7) were both written against c903fc771081 and
merged on the same day, which left main with two heads. ``alembic upgrade
head`` refuses to run with two, so neither migration reached a database
upgraded from main, and every job that migrates an empty database failed.

Revision ID: dc3c105464c1
Revises: 61dfbcc23cba, 58522b08f6a7
Create Date: 2026-10-16 09:52:01.019293

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "dc3c105464c1"
down_revision: Union[str, None] = ("61dfbcc23cba", "58522b08f6a7")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
