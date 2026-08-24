"""Canonical form for the item types on an equipment-check template.

``check_template_items.check_type`` is a free-text column that accumulated nine
values over time — ``pass_fail``, ``present``, ``functional``, ``quantity``,
``level``, ``date_lot``, ``reading``, ``text`` and ``header``. Seven of those
are *checks*, and between them they only ever store four kinds of answer: a
number, a pass/fail, a quantity, or a date.

The extra values were layout decisions wearing a type's clothing. ``present``
and ``functional`` both store pass/fail and differ only in what the crew is
asked to do, which is a sentence on the item rather than a column in the
database; ``reading`` and ``level`` both store a number against a threshold.
An admin building a checklist had to choose between near-synonyms, and the
form had to carry a distinct control for each, so the same question rendered
two ways depending on which one somebody picked years earlier.

The four canonical types below are the answer shapes, and each one decides its
own control, pass rule, and stored record. ``header`` and ``text`` survive
untouched because they are not checks at all — they are the layout, and the
point of naming the four is that a type is no longer a layout choice.

Writers settle the shape here so readers do not have to.
"""

from typing import Dict, Optional

#: A reading against a threshold — O2 cylinder pressure, fuel, coolant,
#: booster tank, battery volts. Stores a number, and keeps it, so the trend
#: over shifts stays visible.
LEVEL = "level"

#: Something switched on and watched — suction, lights and siren, radio,
#: monitor, powered cot. Stores pass/fail.
FUNCTION = "function"

#: A par level to match — dressings, ET tubes, spare bottles. Stores a
#: quantity. Short of par is a restock line, not a failure.
COUNT = "count"

#: A date on record, confirmed rather than retyped — medications, IV fluids,
#: AED pads, extinguisher inspection. Stores a date.
EXPIRY = "expiry"

#: The four answer shapes a check item can have.
CANONICAL_CHECK_TYPES = (LEVEL, FUNCTION, COUNT, EXPIRY)

#: Structural rows that are not checks and have no answer to store. They are
#: deliberately outside the four: they are the layout a type is no longer
#: allowed to be.
STRUCTURAL_TYPES = ("header", "text")

#: Legacy value -> canonical type. Every historical value maps; nothing is
#: dropped. ``present`` and ``functional`` collapse because both store
#: pass/fail, and ``reading`` joins ``level`` because both store a number.
LEGACY_CHECK_TYPES: Dict[str, str] = {
    "pass_fail": FUNCTION,
    "present": FUNCTION,
    "functional": FUNCTION,
    "reading": LEVEL,
    "level": LEVEL,
    "quantity": COUNT,
    "date_lot": EXPIRY,
}

#: What a crew is asked to do, for legacy items whose type carried the
#: instruction implicitly and whose description is empty.
#:
#: Collapsing ``present`` into ``function`` would otherwise lose real
#: information: "is it on the truck" and "does it work when you switch it on"
#: are different jobs, and the old type name was the only place that
#: distinction lived. The design puts the test on the item — "the test itself
#: is written on the item so two people run it the same way" — so the
#: migration writes the instruction into the field that now carries it rather
#: than letting it evaporate with the type name.
LEGACY_TYPE_INSTRUCTIONS: Dict[str, str] = {
    "present": "Confirm the item is in place.",
    "pass_fail": "Confirm the item passes inspection.",
    "functional": "Switch it on and confirm it works.",
}


def normalize_check_type(check_type: Optional[str]) -> str:
    """Return the canonical type for ``check_type``.

    Structural rows (``header``, ``text``) pass through untouched — they are
    not checks and have nothing to store.

    An unrecognised value becomes ``function``. That is the safe direction:
    a pass/fail prompt asks the crew to look at the thing and say whether it
    is right, which is answerable for any item. Defaulting to ``count`` or
    ``expiry`` would invent a par level or a date that nobody set, and
    ``level`` would render a threshold control with no threshold behind it.
    """
    key = (check_type or "").strip().lower()
    if key in STRUCTURAL_TYPES:
        return key
    if key in CANONICAL_CHECK_TYPES:
        return key
    return LEGACY_CHECK_TYPES.get(key, FUNCTION)


def is_check_type(check_type: Optional[str]) -> bool:
    """True when the row is an actual check rather than layout."""
    return normalize_check_type(check_type) in CANONICAL_CHECK_TYPES


def legacy_instruction_for(check_type: Optional[str]) -> Optional[str]:
    """The instruction a legacy type implied, or ``None`` if it implied none.

    Only meaningful while migrating: a canonical item carries its own
    description and does not need one supplied.
    """
    return LEGACY_TYPE_INSTRUCTIONS.get((check_type or "").strip().lower())
