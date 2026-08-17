"""DB-free coverage for scheduled event reminder audience resolution."""

from types import SimpleNamespace

from app.services.scheduled_tasks import _resolve_event_reminder_target


def test_explicit_event_reminder_target_wins():
    event = SimpleNamespace(reminder_target="going", is_mandatory=True)
    assert _resolve_event_reminder_target(event) == "going"


def test_legacy_mandatory_event_defaults_to_all_members():
    event = SimpleNamespace(is_mandatory=True)
    assert _resolve_event_reminder_target(event) == "all"


def test_legacy_optional_event_defaults_to_signed_up_members():
    event = SimpleNamespace(is_mandatory=False)
    assert _resolve_event_reminder_target(event) == "going"
