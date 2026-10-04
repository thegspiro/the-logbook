"""A requirement counts a call by its type, however each side spelled it."""

import pytest

from app.utils.call_type_matching import call_type_key, matching_call_types

pytestmark = [pytest.mark.unit]

TYPES = [
    {"slug": "fire", "label": "Fire", "active": True},
    {"slug": "mva", "label": "Motor Vehicle Accident", "active": True},
    {"slug": "mutual_aid", "label": "Mutual Aid", "active": True},
    {"slug": "water_rescue", "label": "Water Rescue", "active": False},
]


class TestCallTypeKey:
    @pytest.mark.parametrize(
        "value", ["mva", "MVA", "Motor Vehicle Accident", " motor  vehicle accident "]
    )
    def test_slug_and_label_resolve_to_one_type(self, value):
        assert call_type_key(value, TYPES) == "type:mva"

    def test_separators_fold_alike(self):
        assert call_type_key("Mutual-Aid", TYPES) == "type:mutual_aid"

    def test_a_retired_type_still_resolves(self):
        # Reports filed before retirement still name it.
        assert call_type_key("Water Rescue", TYPES) == "type:water_rescue"

    def test_unknown_text_falls_back_to_folded_text(self):
        assert call_type_key("Structure  Fire", TYPES) == "text:structure fire"
        assert call_type_key("structure fire", TYPES) == "text:structure fire"


class TestMatchingCallTypes:
    def test_a_slug_requirement_counts_label_reports(self):
        # The defect: exact lowercase comparison credited nothing here.
        reports = ["Motor Vehicle Accident", "Fire", "Motor Vehicle Accident"]
        assert matching_call_types(reports, ["mva"], TYPES) == [
            "Motor Vehicle Accident",
            "Motor Vehicle Accident",
        ]

    def test_a_label_requirement_counts_slug_reports(self):
        assert matching_call_types(
            ["mva", "fire", "mva"], ["Motor Vehicle Accident"], TYPES
        ) == [
            "mva",
            "mva",
        ]

    def test_legacy_text_still_matches_case_insensitively(self):
        assert matching_call_types(["structure fire"], ["Structure Fire"], TYPES) == [
            "structure fire"
        ]

    def test_different_types_do_not_match(self):
        assert matching_call_types(["fire"], ["mva"], TYPES) == []

    def test_untyped_json_is_ignored(self):
        assert matching_call_types([None, 3, "", "mva"], ["mva", None, ""], TYPES) == [
            "mva"
        ]
