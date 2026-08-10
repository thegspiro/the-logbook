"""
Tests for the member audit history's Event Type filter.

The page's dropdown speaks a coarser vocabulary than the stored event types:
"Profile Updates" covers `user_profile_updated`, `user_updated` and the two
photo events. The endpoint compared the dropdown's value for equality against
the stored type, so `profile_update` never equalled `user_profile_updated` and
every option except "All Events" emptied the page — then told the reader to
clear the filter, as though the member simply had no such history.

Pure mapping assertions; no database.
"""

import pytest

from app.api.v1.endpoints.users import (
    _AUDIT_EVENT_DESCRIPTIONS,
    _AUDIT_EVENT_FILTERS,
)

# The values MemberAuditHistoryPage's dropdown can send, minus "all" (which
# skips the filter entirely).
DROPDOWN_VALUES = [
    "profile_update",
    "status_change",
    "role_change",
    "password_reset",
    "membership_change",
]


@pytest.mark.parametrize("value", DROPDOWN_VALUES)
def test_every_dropdown_value_maps_to_something(value):
    assert _AUDIT_EVENT_FILTERS.get(value), f"{value} matches no stored event type"


@pytest.mark.parametrize("value", DROPDOWN_VALUES)
def test_mapped_types_are_types_the_endpoint_returns(value):
    """A mapping onto a type outside the whitelist would still match nothing."""
    for stored in _AUDIT_EVENT_FILTERS[value]:
        assert (
            stored in _AUDIT_EVENT_DESCRIPTIONS
        ), f"{value} maps to {stored}, which this endpoint never returns"


def test_profile_updates_covers_the_photo_events():
    # A photo change is a profile update to everyone except the audit log,
    # which records it under its own type.
    mapped = _AUDIT_EVENT_FILTERS["profile_update"]
    assert "user_profile_updated" in mapped
    assert "user_photo_updated" in mapped
    assert "user_photo_removed" in mapped


def test_status_changes_cover_leave_of_absence():
    mapped = _AUDIT_EVENT_FILTERS["status_change"]
    assert "member_status_changed" in mapped
    assert "leave_of_absence_created" in mapped


def test_no_filter_maps_to_logins():
    """The dropdown must not offer a filter this endpoint cannot serve.

    Sign-ins are not member-management events and are not in the whitelist, so
    a "Logins" option would be permanently empty however the filter is wired.
    """
    assert "login" not in _AUDIT_EVENT_FILTERS
    assert not any(
        "login" in stored
        for mapped in _AUDIT_EVENT_FILTERS.values()
        for stored in mapped
    )


def test_unknown_value_is_left_to_exact_match():
    """A caller naming a stored type directly still works."""
    assert _AUDIT_EVENT_FILTERS.get("user_viewed") is None
