"""Add the ``medical`` value to inventory_categories.item_type

Medical supplies had no item type of their own. They were filed under
``equipment`` or ``consumable`` by convention, which meant nothing in the
schema distinguished a box of gauze from a halligan — and so nothing could
gate them separately or list them on their own page.

``medical`` is appended after ``other`` rather than placed next to
``equipment`` where it reads better. MySQL stores an ENUM as the member's
ordinal, so inserting mid-list would reassign the type of every category
already stored: a row holding ordinal 5 (``electronics``) would come back as
whatever now sits fifth. Appending leaves every existing ordinal untouched.

Fresh installs built by ``create_all()`` already carry the full value set, so
the MODIFY below is a no-op there.

Revision ID: 20260816_0001
Revises: 20260814_0004
Create Date: 2026-08-16 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260816_0001"
down_revision = "20260814_0004"
branch_labels = None
depends_on = None


# Must stay in the same order as ``ItemType`` in app/models/inventory.py.
_ITEM_TYPE_VALUES = [
    "uniform",
    "ppe",
    "tool",
    "equipment",
    "vehicle",
    "electronics",
    "consumable",
    "other",
    "medical",
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("inventory_categories"):
        return
    columns = {c["name"] for c in inspector.get_columns("inventory_categories")}
    if "item_type" not in columns:
        return

    enum_type = sa.Enum(*_ITEM_TYPE_VALUES, name="inventory_categories_item_type")
    op.alter_column(
        "inventory_categories",
        "item_type",
        existing_type=enum_type,
        type_=enum_type,
        existing_nullable=False,
        nullable=False,
    )


def downgrade() -> None:
    # Dropping ``medical`` would coerce every medical category to '' under
    # MySQL's non-strict mode, or fail outright under strict mode. Either way
    # the department loses the classification that says which supplies are
    # whose. Left as a no-op.
    pass
