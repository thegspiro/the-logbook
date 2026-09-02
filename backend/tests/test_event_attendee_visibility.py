"""Who may see an event's attendee list.

Two things are under test. The resolver — per-event override wins, NULL
inherits the organization default, an absent or unrecognized setting falls back
to managers-only — and the *shape* of what the endpoint returns, which is the
security half: the member-facing roster must carry names and nothing else.

The shape assertion is deliberately structural rather than field-by-field. A
field-by-field test proves today's schema is safe; comparing the whole field
set against a hard-coded allowlist means adding ``guest_count`` or
``dietary_restrictions`` to that response has to be a decision somebody makes
on purpose, with this test in front of them.
"""

from types import SimpleNamespace

from app.models.event import AttendeeVisibility
from app.schemas.event import EventAttendeeResponse
from app.services.event_service import resolve_attendee_visibility


def _event(visibility=None):
    return SimpleNamespace(attendee_visibility=visibility)


def _org_settings(visibility=None):
    if visibility is None:
        return {"events": {"defaults": {}}}
    return {"events": {"defaults": {"attendee_visibility": visibility}}}


class TestTheResolver:
    def test_no_event_override_and_no_org_setting_is_managers_only(self):
        """The pre-existing behavior, which every installation must keep.

        CLAUDE.md pitfall #19: absence must mean "current behavior", never a
        new one. An organization that never opened Events settings must not
        find its rosters published by an upgrade.
        """
        assert (
            resolve_attendee_visibility(_event(), None) == AttendeeVisibility.MANAGERS
        )
        assert resolve_attendee_visibility(_event(), {}) == AttendeeVisibility.MANAGERS
        assert (
            resolve_attendee_visibility(_event(), _org_settings())
            == AttendeeVisibility.MANAGERS
        )

    def test_the_org_default_applies_when_the_event_does_not_override(self):
        assert (
            resolve_attendee_visibility(_event(), _org_settings("members"))
            == AttendeeVisibility.MEMBERS
        )

    def test_the_event_override_wins_over_a_permissive_org_default(self):
        assert (
            resolve_attendee_visibility(_event("managers"), _org_settings("members"))
            == AttendeeVisibility.MANAGERS
        )

    def test_the_event_override_wins_over_a_restrictive_org_default(self):
        """Both directions, or the override is only half an override."""
        assert (
            resolve_attendee_visibility(_event("members"), _org_settings("managers"))
            == AttendeeVisibility.MEMBERS
        )

    def test_an_unrecognized_stored_value_fails_closed(self):
        """settings is unvalidated JSON, so a bad value must not publish a roster.

        Failing open here would mean a typo saved through some other path
        exposes names the organizer meant to keep restricted. A visibility gate
        has only one safe failure direction.
        """
        assert (
            resolve_attendee_visibility(_event("everyone"), None)
            == AttendeeVisibility.MANAGERS
        )
        assert (
            resolve_attendee_visibility(_event(), _org_settings("public"))
            == AttendeeVisibility.MANAGERS
        )

    def test_an_empty_string_override_inherits_rather_than_failing(self):
        """ "" is absence, not a choice — it must fall through to the org default."""
        assert (
            resolve_attendee_visibility(_event(""), _org_settings("members"))
            == AttendeeVisibility.MEMBERS
        )

    def test_case_is_normalized(self):
        assert (
            resolve_attendee_visibility(_event("MEMBERS"), None)
            == AttendeeVisibility.MEMBERS
        )


class TestTheResponseShape:
    def test_the_roster_row_carries_names_and_nothing_else(self):
        """The security invariant of the whole feature.

        RSVPResponse — what events.manage callers get — additionally carries
        user_email, notes, dietary_restrictions, accessibility_needs,
        guest_count and the full check-in and override block. None of that may
        reach an ordinary member. If this assertion fails because a field was
        added, the question to answer is not "how do I update the test" but
        "should every member in the department see this".
        """
        assert set(EventAttendeeResponse.model_fields) == {
            "user_id",
            "user_name",
            "status",
        }

    def test_it_does_not_inherit_from_the_manager_rsvp_schema(self):
        """Inheriting would silently re-add every field the base later grows."""
        from app.schemas.event import RSVPBase, RSVPResponse

        assert not issubclass(EventAttendeeResponse, RSVPBase)
        assert not issubclass(EventAttendeeResponse, RSVPResponse)


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
