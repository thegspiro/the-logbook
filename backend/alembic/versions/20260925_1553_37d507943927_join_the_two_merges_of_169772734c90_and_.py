"""join the two merges of 169772734c90 and a0e4764c1b55

#2722 and #2724 were opened at the same moment to join the same pair of heads,
``169772734c90`` and ``a0e4764c1b55``. They were merged twelve seconds apart:

* #2722 added ``d93f53426d5f``.
* #2724 added ``8eeb495f35bd``.

Each is valid alone, but together they leave two heads again and
``alembic upgrade head`` refuses to run. This joins them. It creates nothing:
both parents are schema no-ops, and Alembic applies each revision below once
however many paths reach it.

Revision ID: 37d507943927
Revises: 8eeb495f35bd, d93f53426d5f
Create Date: 2026-09-25 15:53:06.764722

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "37d507943927"
down_revision: Union[str, Sequence[str], None] = ("8eeb495f35bd", "d93f53426d5f")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
