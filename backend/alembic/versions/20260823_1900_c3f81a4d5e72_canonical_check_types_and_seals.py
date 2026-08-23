"""Collapse check item types to four, and give sealed containers a seal.

Revision ID: c3f81a4d5e72
Revises: a17c4e9d2b61

Two changes, both serving the same redesign: a check is walked as a lap of the
vehicle, and every line on it is one of four answer shapes.

1. ``check_template_items.check_type`` carried nine values, seven of which were
   checks. Between them they only ever stored four kinds of answer — a number,
   a pass/fail, a quantity, a date — so the extra values were layout decisions
   wearing a type's clothing. They collapse to ``level`` / ``function`` /
   ``count`` / ``expiry``; ``header`` and ``text`` are untouched because they
   are not checks.

   ``app/utils/check_types.normalize_check_type`` is the write-side authority;
   this settles the rows already stored.

2. ``apparatus_compartment_seals`` records the seal on a sealed container, per
   apparatus. A sealed bag is checked by reading its tag rather than counting
   its contents, and the tag survives the shift that changed it, so the state
   cannot live on a check or on the template.

Irreversibility
---------------
**The type collapse does not reverse.** ``pass_fail``, ``present`` and
``functional`` all become ``function``, and ``reading`` joins ``level``; the
original value is not recoverable from the result. The downgrade re-adds the
seal table's absence and the ``is_sealed`` column, but deliberately leaves the
types canonical rather than guessing which of three legacy names a
``function`` row started as — inventing that would be worse than leaving it,
because a wrong guess renders the wrong control on a safety checklist.

What the old type carried implicitly is preserved rather than dropped. The
three pass/fail variants differed only in what the crew was asked to do, and
the type name was the only place that instruction lived. Items with an empty
description get the instruction written into it, which is where the redesign
puts it — "the test itself is written on the item so two people run it the
same way". An item that already has a description keeps its own words.
"""

import sqlalchemy as sa
from alembic import op

revision = "c3f81a4d5e72"
down_revision = "a17c4e9d2b61"
branch_labels = None
depends_on = None


# Legacy value -> canonical type. Inlined rather than imported from
# app/utils/check_types: a migration must keep transforming rows the way it did
# the day it ran, so it cannot depend on a helper that is free to change.
_TYPE_MAP = {
    "pass_fail": "function",
    "present": "function",
    "functional": "function",
    "reading": "level",
    "quantity": "count",
    "date_lot": "expiry",
}

# The instruction each pass/fail variant implied, for items that never got a
# description of their own.
_INSTRUCTIONS = {
    "present": "Confirm the item is in place.",
    "pass_fail": "Confirm the item passes inspection.",
    "functional": "Switch it on and confirm it works.",
}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # --- 1. is_sealed on the compartment -----------------------------------
    if "check_template_compartments" in inspector.get_table_names():
        columns = {
            col["name"] for col in inspector.get_columns("check_template_compartments")
        }
        if "is_sealed" not in columns:
            op.add_column(
                "check_template_compartments",
                sa.Column(
                    "is_sealed",
                    sa.Boolean(),
                    nullable=False,
                    server_default="0",
                ),
            )

    # --- 2. the seal state table -------------------------------------------
    if "apparatus_compartment_seals" not in inspector.get_table_names():
        op.create_table(
            "apparatus_compartment_seals",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), nullable=False),
            # Polymorphic, no FK — matches Shift.apparatus_id, which this is
            # resolved against.
            sa.Column("apparatus_id", sa.String(36), nullable=False),
            sa.Column("compartment_id", sa.String(36), nullable=False),
            sa.Column("tag_number", sa.String(50), nullable=True),
            sa.Column(
                "status",
                sa.String(20),
                nullable=False,
                server_default="intact",
            ),
            sa.Column("broken_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("broken_note", sa.String(200), nullable=True),
            sa.Column("broken_by", sa.String(36), nullable=True),
            sa.Column("replacement_tag_number", sa.String(50), nullable=True),
            sa.Column("last_sealed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_sealed_by", sa.String(36), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["compartment_id"],
                ["check_template_compartments.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(["broken_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["last_sealed_by"], ["users.id"], ondelete="SET NULL"
            ),
            sa.UniqueConstraint(
                "apparatus_id",
                "compartment_id",
                name="uq_apparatus_compartment_seal",
            ),
        )
        op.create_index(
            "idx_apparatus_seal_org",
            "apparatus_compartment_seals",
            ["organization_id"],
        )
        op.create_index(
            "idx_apparatus_seal_compartment",
            "apparatus_compartment_seals",
            ["compartment_id"],
        )

    # --- 3. collapse the item types ----------------------------------------
    if "check_template_items" not in inspector.get_table_names():
        return

    items = sa.table(
        "check_template_items",
        sa.column("id", sa.String(36)),
        sa.column("check_type", sa.String(30)),
        sa.column("description", sa.Text()),
    )

    for legacy, canonical in _TYPE_MAP.items():
        instruction = _INSTRUCTIONS.get(legacy)
        if instruction:
            # Write the instruction only where the item has none of its own —
            # an item whose author described the test keeps their words.
            bind.execute(
                items.update()
                .where(
                    sa.and_(
                        items.c.check_type == legacy,
                        sa.or_(
                            items.c.description.is_(None),
                            sa.func.trim(items.c.description) == "",
                        ),
                    )
                )
                .values(description=instruction)
            )
        bind.execute(
            items.update()
            .where(items.c.check_type == legacy)
            .values(check_type=canonical)
        )


def downgrade() -> None:
    # The type collapse is deliberately NOT undone. Three legacy names map to
    # `function` and two to `level`; picking one back would render the wrong
    # control on a safety checklist, and no column records which it was. The
    # canonical values are readable by both the old and new code paths, so
    # leaving them is the safe direction.
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "apparatus_compartment_seals" in inspector.get_table_names():
        op.drop_index(
            "idx_apparatus_seal_compartment", table_name="apparatus_compartment_seals"
        )
        op.drop_index(
            "idx_apparatus_seal_org", table_name="apparatus_compartment_seals"
        )
        op.drop_table("apparatus_compartment_seals")

    if "check_template_compartments" in inspector.get_table_names():
        columns = {
            col["name"] for col in inspector.get_columns("check_template_compartments")
        }
        if "is_sealed" in columns:
            op.drop_column("check_template_compartments", "is_sealed")
