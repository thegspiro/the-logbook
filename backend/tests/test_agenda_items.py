"""The agenda-item shape, the sections it makes, and the printed record."""

import pytest

from app.utils.agenda_items import (
    MAX_AGENDA_ITEMS,
    agenda_item_key_of,
    normalize_agenda_items,
    sections_from_agenda,
)
from app.utils.minutes_snapshot import _section_snapshot
from app.utils.rich_text import section_is_printed

pytestmark = pytest.mark.unit


class TestNormalize:
    def test_not_a_list_is_empty(self):
        assert normalize_agenda_items(None) == []
        assert normalize_agenda_items({"key": "a"}) == []
        assert normalize_agenda_items("agenda") == []

    def test_malformed_entries_are_dropped_not_raised_on(self):
        items = normalize_agenda_items(
            [
                "text",
                {"key": "Bad Key", "title": "x"},
                {"key": "a", "title": "   "},
                {"key": "a", "title": "Kept"},
                {"key": "a", "title": "Duplicate key"},
            ]
        )
        assert [(i["key"], i["title"]) for i in items] == [("a", "Kept")]

    def test_every_field_is_filled_and_trimmed(self):
        (item,) = normalize_agenda_items(
            [{"key": "a", "title": "  One  ", "presenter": " Pat "}]
        )
        assert item == {
            "key": "a",
            "title": "One",
            "presenter": "Pat",
            "notes": "",
            "needs_motion": False,
            "motion_text": "",
            "documents": [],
        }

    def test_documents_are_deduplicated_and_capped(self):
        (item,) = normalize_agenda_items(
            [
                {
                    "key": "a",
                    "title": "One",
                    "documents": [{"id": str(n % 12), "name": "d"} for n in range(40)]
                    + ["junk", {"name": "no id"}],
                }
            ]
        )
        assert len(item["documents"]) == 10
        assert len({d["id"] for d in item["documents"]}) == 10

    def test_the_list_is_capped(self):
        items = normalize_agenda_items(
            [{"key": f"k{n}", "title": "T"} for n in range(MAX_AGENDA_ITEMS + 20)]
        )
        assert len(items) == MAX_AGENDA_ITEMS


class TestSections:
    def test_sections_follow_agenda_order_and_carry_the_agenda_key(self):
        sections = sections_from_agenda(
            [
                {"key": "b", "title": "Second", "presenter": "Pat"},
                {"key": "a", "title": "First", "needs_motion": True},
            ]
        )
        assert [s["key"] for s in sections] == ["agenda-b", "agenda-a"]
        assert [s["order"] for s in sections] == [0, 1]
        assert agenda_item_key_of(sections[0]) == "b"
        assert sections[0]["presenter"] == "Pat"
        assert "presenter" not in sections[1]
        assert sections[1]["needs_motion"] is True

    def test_an_ordinary_section_has_no_agenda_key(self):
        assert agenda_item_key_of({"key": "roll_call"}) is None


class TestPrinted:
    def test_blank_sections_are_left_out(self):
        assert not section_is_printed({"content": "  "})

    def test_a_not_taken_up_section_is_kept_even_when_blank(self):
        assert section_is_printed({"content": "", "not_taken_up": True})

    def test_a_section_with_words_is_printed(self):
        assert section_is_printed({"content": "Discussed."})


class TestSealedHashStability:
    BASE = {"order": 0, "key": "k", "title": "T", "content": "c"}

    def test_a_section_without_agenda_fields_hashes_as_it_always_did(self):
        assert _section_snapshot(self.BASE) == self.BASE
        assert _section_snapshot({**self.BASE, "presenter": "", "documents": []}) == (
            self.BASE
        )

    def test_presenter_and_not_taken_up_are_sealed_when_set(self):
        sealed = _section_snapshot(
            {**self.BASE, "presenter": "Pat", "not_taken_up": True}
        )
        assert sealed["presenter"] == "Pat"
        assert sealed["not_taken_up"] is True

    def test_linked_documents_are_reference_not_record(self):
        sealed = _section_snapshot({**self.BASE, "documents": [{"id": "x"}]})
        assert "documents" not in sealed
