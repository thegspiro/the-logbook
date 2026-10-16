"""Reading the department's signature slots, and who may sign one. No database."""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.organization import OrganizationSettingsUpdate
from app.services.minutes_signature_service import accepted_names, can_sign
from app.utils.minutes_settings import (
    DEFAULT_SIGNATURE_SLOTS,
    MAX_SIGNATURE_SLOTS,
    SignatureSlot,
    signature_slots_in,
)

pytestmark = [pytest.mark.unit]


def _slots(raw):
    return signature_slots_in({"minutes": {"signature_slots": raw}})


class TestReadingSlots:
    def test_nothing_set_reads_as_the_two_slots_departments_started_with(self):
        assert signature_slots_in({}) == list(DEFAULT_SIGNATURE_SLOTS)
        assert signature_slots_in(None) == list(DEFAULT_SIGNATURE_SLOTS)
        assert [s.title for s in DEFAULT_SIGNATURE_SLOTS] == [
            "Recording Secretary",
            "Presiding Officer",
        ]

    def test_a_departments_slots_are_used_in_order(self):
        slots = _slots(
            [
                {"key": "clerk", "title": "Town Clerk"},
                {"key": "chair", "title": "Chair", "position_slug": "president"},
            ]
        )
        assert slots == [
            SignatureSlot("clerk", "Town Clerk", None),
            SignatureSlot("chair", "Chair", "president"),
        ]

    @pytest.mark.parametrize("bad", ["x", 3, {"key": "a"}, None, True])
    def test_a_value_that_is_not_a_list_reads_as_the_defaults(self, bad):
        assert _slots(bad) == list(DEFAULT_SIGNATURE_SLOTS)

    def test_an_empty_list_reads_as_the_defaults(self):
        assert _slots([]) == list(DEFAULT_SIGNATURE_SLOTS)

    def test_a_bad_entry_is_dropped_and_the_rest_kept(self):
        slots = _slots(
            [
                "nonsense",
                {"key": "Bad Key", "title": "Bad"},
                {"key": "ok", "title": "   "},
                {"key": "long", "title": "x" * 101},
                {"key": "clerk", "title": "Clerk"},
            ]
        )
        assert [s.key for s in slots] == ["clerk"]

    def test_a_repeated_key_keeps_the_first(self):
        slots = _slots(
            [{"key": "a", "title": "First"}, {"key": "a", "title": "Second"}]
        )
        assert [s.title for s in slots] == ["First"]

    def test_only_the_first_few_slots_are_read(self):
        slots = _slots([{"key": f"s{i}", "title": f"S{i}"} for i in range(20)])
        assert len(slots) == MAX_SIGNATURE_SLOTS

    def test_a_blank_position_means_no_position(self):
        assert (
            _slots([{"key": "a", "title": "A", "position_slug": ""}])[0].position_slug
            is None
        )


def _user(first="Pat", last="Chief", preferred=None, positions=()):
    roles = [SimpleNamespace(slug=slug, permissions=perms) for slug, perms in positions]
    return SimpleNamespace(
        full_name=f"{first} {last}",
        display_name=f"{preferred or first} {last}",
        roles=roles,
    )


class TestAcceptedNames:
    def test_the_legal_name_and_the_known_name_are_both_accepted(self):
        assert accepted_names(_user("Terrence", "Heather", preferred="Terry")) == {
            "terrence heather",
            "terry heather",
        }

    def test_case_and_spacing_are_ignored(self):
        assert accepted_names(_user("Pat", "Chief")) == {"pat chief"}


class TestWhoMaySign:
    def test_a_slot_without_a_position_goes_to_whoever_manages_minutes(self):
        slot = SignatureSlot("clerk", "Clerk")
        assert can_sign(_user(positions=[("sec", ["minutes.manage"])]), slot)
        assert can_sign(_user(positions=[("root", ["*"])]), slot)
        assert not can_sign(_user(positions=[("m", ["minutes.view"])]), slot)
        assert not can_sign(_user(), slot)

    def test_a_slot_with_a_position_goes_to_its_holders_only(self):
        slot = SignatureSlot("chair", "Chair", "president")
        assert can_sign(_user(positions=[("president", [])]), slot)
        assert not can_sign(_user(positions=[("secretary", ["minutes.manage"])]), slot)


class TestSlotsSetting:
    def test_slots_are_accepted_in_the_settings_update(self):
        update = OrganizationSettingsUpdate(
            minutes={"signature_slots": [{"key": "clerk", "title": "Clerk"}]}
        )
        assert update.model_dump(exclude_unset=True)["minutes"]["signature_slots"] == [
            {"key": "clerk", "title": "Clerk"}
        ]

    @pytest.mark.parametrize(
        "bad",
        [
            [{"key": "Bad Key", "title": "x"}],
            [{"key": "a", "title": ""}],
            [{"key": "a", "title": "x" * 101}],
            [{"key": f"s{i}", "title": "x"} for i in range(7)],
        ],
    )
    def test_unusable_slots_are_refused_at_the_door(self, bad):
        with pytest.raises(ValidationError):
            OrganizationSettingsUpdate(minutes={"signature_slots": bad})
