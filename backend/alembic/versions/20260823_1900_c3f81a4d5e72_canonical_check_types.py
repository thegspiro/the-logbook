"""Collapse check item types to four canonical answer shapes.

Revision ID: c3f81a4d5e72
Revises: d5b207e4f139

``check_template_items.check_type`` carried nine values, seven of which were
checks. Between them they only ever stored four kinds of answer — a number, a
pass/fail, a quantity, a date — so the extra values were layout decisions
wearing a type's clothing. They collapse to ``level`` / ``function`` /
``count`` / ``expiry``; ``header`` and ``text`` are untouched because they are
not checks.

``app/utils/check_types.normalize_check_type`` is the write-side authority;
this settles the rows already stored.

Irreversibility
---------------
**This does not reverse.** ``pass_fail``, ``present`` and ``functional`` all
become ``function``, and ``reading`` joins ``level``; the original value is not
recoverable from the result. The downgrade deliberately leaves the types
canonical rather than guessing which of three legacy names a ``function`` row
started as — inventing that would be worse than leaving it, because a wrong
guess renders the wrong control on a safety checklist.

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
down_revision = "d5b207e4f139"
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
    # Deliberately a no-op. Three legacy names map to `function` and two to
    # `level`; no column records which a row started as, so picking one back
    # would render the wrong control on a safety checklist. The canonical
    # values are readable by both the old and new code paths, so leaving them
    # is the safe direction.
    pass
