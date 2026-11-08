"""The end-of-shift summary groups a member's call types into counts."""

import pytest

from app.services.scheduled_tasks import (
    _format_call_type_rollup,
    _rollup_call_types,
)

pytestmark = [pytest.mark.unit]


class TestRollupCallTypes:
    def test_repeated_types_collapse_to_one_entry_with_a_count(self):
        assert _rollup_call_types(["EMS"] * 10) == [("EMS", 10)]

    def test_most_frequent_type_comes_first(self):
        assert _rollup_call_types(["Fire", "EMS", "EMS", "EMS"]) == [
            ("EMS", 3),
            ("Fire", 1),
        ]

    def test_ties_keep_the_order_first_seen(self):
        assert _rollup_call_types(["MVA", "Fire", "Fire", "MVA", "EMS"]) == [
            ("MVA", 2),
            ("Fire", 2),
            ("EMS", 1),
        ]

    def test_no_calls_is_an_empty_rollup(self):
        assert _rollup_call_types([]) == []


class TestFormatCallTypeRollup:
    def test_each_type_carries_its_count(self):
        assert (
            _format_call_type_rollup([("EMS", 10), ("Fire", 2)]) == "EMS (10), Fire (2)"
        )

    def test_empty_rollup_is_an_empty_string(self):
        assert _format_call_type_rollup([]) == ""
