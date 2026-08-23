"""The four canonical check-item types, and what the collapse must preserve.

These tests exist because the collapse is irreversible. Once
``present``/``pass_fail``/``functional`` have all become ``function`` there is
no column that remembers which one a row started as, so a mapping mistake is
not a bug that can be corrected later by re-running anything — it is a
checklist rendering the wrong control, permanently.
"""

import pytest

from app.schemas.equipment_check import _validate_check_type
from app.utils.check_types import (
    CANONICAL_CHECK_TYPES,
    COUNT,
    EXPIRY,
    FUNCTION,
    LEVEL,
    STRUCTURAL_TYPES,
    is_check_type,
    legacy_instruction_for,
    normalize_check_type,
)


class TestCanonicalTypes:
    def test_there_are_exactly_four(self):
        """Four answer shapes: a number, a pass/fail, a quantity, a date.

        Pinned because the whole redesign rests on an admin picking a type
        rather than a layout. A fifth type is a design decision, not a
        refactor, and should fail here first.
        """
        assert CANONICAL_CHECK_TYPES == (LEVEL, FUNCTION, COUNT, EXPIRY)

    @pytest.mark.parametrize(
        ("legacy", "expected"),
        [
            ("pass_fail", FUNCTION),
            ("present", FUNCTION),
            ("functional", FUNCTION),
            ("reading", LEVEL),
            ("level", LEVEL),
            ("quantity", COUNT),
            ("date_lot", EXPIRY),
        ],
    )
    def test_every_legacy_value_maps(self, legacy, expected):
        assert normalize_check_type(legacy) == expected

    @pytest.mark.parametrize("structural", STRUCTURAL_TYPES)
    def test_structural_rows_pass_through(self, structural):
        """``header`` and ``text`` are layout, not checks, and must survive.

        Folding them into the four would turn a section heading into a
        pass/fail line the crew is asked to answer.
        """
        assert normalize_check_type(structural) == structural
        assert is_check_type(structural) is False

    @pytest.mark.parametrize("canonical", CANONICAL_CHECK_TYPES)
    def test_canonical_values_are_stable(self, canonical):
        """Normalizing twice must not move — the write path runs on every save."""
        assert normalize_check_type(canonical) == canonical
        assert normalize_check_type(normalize_check_type(canonical)) == canonical
        assert is_check_type(canonical) is True

    @pytest.mark.parametrize("junk", ["", None, "   ", "presence", "unknown"])
    def test_unrecognised_reads_as_function(self, junk):
        """Reading an unknown stored value falls back to the answerable shape.

        ``function`` asks the crew to look at the thing and say whether it is
        right, which is answerable for any item. ``count`` or ``expiry`` would
        invent a par level or a date nobody set, and ``level`` would draw a
        threshold control with no threshold behind it.
        """
        assert normalize_check_type(junk) == FUNCTION

    def test_case_and_padding_are_tolerated(self):
        assert normalize_check_type("  PASS_FAIL  ") == FUNCTION
        assert normalize_check_type("Level") == LEVEL


class TestInstructionPreservation:
    """The three pass/fail variants differed only in what the crew was asked.

    That instruction lived nowhere but the type name, so collapsing them
    without carrying it across would lose real information — "is it on the
    truck" and "does it work when you switch it on" are different jobs.
    """

    @pytest.mark.parametrize("legacy", ["present", "pass_fail", "functional"])
    def test_each_pass_fail_variant_carries_an_instruction(self, legacy):
        instruction = legacy_instruction_for(legacy)
        assert instruction
        assert instruction.endswith(".")

    def test_the_three_instructions_are_distinct(self):
        """If two variants shared wording the distinction would be lost anyway."""
        instructions = {
            legacy_instruction_for(v) for v in ("present", "pass_fail", "functional")
        }
        assert len(instructions) == 3

    @pytest.mark.parametrize("legacy", ["level", "reading", "quantity", "date_lot"])
    def test_types_that_implied_nothing_supply_nothing(self, legacy):
        """A level or a count already states its own units and par.

        Writing a generic sentence into their description would be noise on
        every one of those items.
        """
        assert legacy_instruction_for(legacy) is None


class TestRequestBoundary:
    """The schema is stricter than the reader, deliberately."""

    @pytest.mark.parametrize(
        ("sent", "stored"),
        [
            ("present", FUNCTION),
            ("functional", FUNCTION),
            ("reading", LEVEL),
            ("quantity", COUNT),
            ("date_lot", EXPIRY),
            ("count", COUNT),
            ("header", "header"),
        ],
    )
    def test_legacy_input_is_accepted_and_stored_canonical(self, sent, stored):
        """An older client must not break over a rename it never asked for."""
        assert _validate_check_type(sent) == stored

    def test_unknown_is_rejected_rather_than_coerced(self):
        """At a request boundary an unknown value is the caller's mistake.

        The reader's ``function`` fallback is right for a column somebody
        already wrote; applying it here would silently turn a typo into a
        pass/fail prompt on a safety checklist.
        """
        with pytest.raises(ValueError, match="presence"):
            _validate_check_type("presence")

    def test_none_passes_through(self):
        """``None`` means "not supplied" on a partial update, not "unknown"."""
        assert _validate_check_type(None) is None
