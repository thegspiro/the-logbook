"""add recruitment event type

Outreach aimed at prospective members had no event type of its own.
Departments filed open houses and recruitment nights under
``public_education`` or ``other``, so a membership-pipeline stage could not
point at "the next recruitment event" without also matching every fire-safety
demo on the calendar.

``recruitment`` is appended after ``other`` rather than placed beside the
other outward-facing types where it reads better. MySQL stores an ENUM as the
member's ordinal, so inserting mid-list would reassign the type of every event
already stored: a row holding ordinal 6 (``ceremony``) would come back as
whatever now sits sixth. Appending leaves every existing ordinal untouched.

Fresh installs built by ``create_all()`` already carry the full value set, so
the MODIFYs below are a no-op there.

Revision ID: 5223a69474b8
Revises: 4c8d7e2a91b3
Create Date: 2026-08-20 03:15:06.344545

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5223a69474b8"
down_revision: Union[str, None] = "4c8d7e2a91b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Must stay in the same order as ``EventType`` in app/models/event.py.
_EVENT_TYPE_VALUES = [
    "business_meeting",
    "public_education",
    "training",
    "social",
    "fundraiser",
    "ceremony",
    "other",
    "recruitment",
]

_TABLES = ("events", "event_templates")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table in _TABLES:
        if not inspector.has_table(table):
            continue
        columns = {c["name"] for c in inspector.get_columns(table)}
        if "event_type" not in columns:
            continue

        enum_type = sa.Enum(*_EVENT_TYPE_VALUES, name=f"{table}_event_type")
        op.alter_column(
            table,
            "event_type",
            existing_type=enum_type,
            type_=enum_type,
            existing_nullable=False,
            nullable=False,
            existing_server_default="other",
            server_default="other",
        )


def downgrade() -> None:
    # Dropping ``recruitment`` would coerce every recruitment event to '' under
    # MySQL's non-strict mode, or fail outright under strict mode. Either way
    # the department loses the classification its pipeline stages match on.
    # Left as a no-op.
    pass
