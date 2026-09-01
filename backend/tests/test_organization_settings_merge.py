"""Unit tests for the organization-settings deep merge (ORU-9).

A partial PATCH of one sub-key must not wipe the rest of its section, which the
old shallow ``{**base, **updates}`` merge did.
"""

import pytest

from app.services.organization_service import _deep_merge_settings


@pytest.mark.unit
def test_partial_subsection_preserves_siblings():
    base = {"events": {"visible": False, "color": "blue", "order": 3}}
    updates = {"events": {"visible": True}}
    merged = _deep_merge_settings(base, updates)
    assert merged["events"] == {"visible": True, "color": "blue", "order": 3}


@pytest.mark.unit
def test_deeply_nested_merge():
    base = {"a": {"b": {"c": 1, "d": 2}}}
    updates = {"a": {"b": {"c": 99}}}
    merged = _deep_merge_settings(base, updates)
    assert merged["a"]["b"] == {"c": 99, "d": 2}


@pytest.mark.unit
def test_non_dict_value_replaces():
    base = {"modules": {"events": True}}
    # A scalar/list on the update side replaces the section wholesale.
    updates = {"modules": ["events", "training"]}
    merged = _deep_merge_settings(base, updates)
    assert merged["modules"] == ["events", "training"]


@pytest.mark.unit
def test_new_section_added():
    base = {"events": {"visible": True}}
    updates = {"finance": {"enabled": True}}
    merged = _deep_merge_settings(base, updates)
    assert merged == {"events": {"visible": True}, "finance": {"enabled": True}}


@pytest.mark.unit
def test_explicit_null_replaces():
    base = {"auth": {"client_secret": "abc"}}
    updates = {"auth": {"client_secret": None}}
    merged = _deep_merge_settings(base, updates)
    assert merged["auth"]["client_secret"] is None


@pytest.mark.unit
def test_does_not_mutate_inputs():
    base = {"events": {"visible": False}}
    updates = {"events": {"visible": True}}
    _deep_merge_settings(base, updates)
    assert base == {"events": {"visible": False}}
    assert updates == {"events": {"visible": True}}


@pytest.mark.unit
def test_checklist_timing_and_post_shift_validation_do_not_clobber_each_other():
    """The invariant behind splitting one settings key across two modules.

    ``shift_reports`` is now edited from two screens: Inventory owns
    ``checklist_timing`` (Gear Admin > Checklist settings) and Scheduling owns
    ``post_shift_validation`` (Settings > Shift Reports). Each sends only its
    own half and relies on this merge to leave the other alone. If either ever
    starts sending the whole ``shift_reports`` object again, whichever screen
    saved last would silently revert the other's settings — a chief turning off
    end-of-shift checklists would quietly re-enable officer reports, or the
    reverse.
    """
    base = {
        "shift_reports": {
            "checklist_timing": {
                "start_of_shift_enabled": True,
                "end_of_shift_enabled": True,
                "checkin_opens_hours_before": 2,
                "checkin_closes_hours_after": 12,
            },
            "post_shift_validation": {
                "enabled": True,
                "require_officer_report": True,
                "validation_window_hours": 6,
            },
        }
    }

    # Inventory saves the checklist half.
    from_inventory = {
        "shift_reports": {
            "checklist_timing": {
                "start_of_shift_enabled": False,
                "end_of_shift_enabled": True,
                "checkin_opens_hours_before": 2,
                "checkin_closes_hours_after": 12,
            }
        }
    }
    merged = _deep_merge_settings(base, from_inventory)
    assert (
        merged["shift_reports"]["checklist_timing"]["start_of_shift_enabled"] is False
    )
    # The officer-report requirement is untouched.
    assert merged["shift_reports"]["post_shift_validation"] == {
        "enabled": True,
        "require_officer_report": True,
        "validation_window_hours": 6,
    }

    # Scheduling then saves its half, over the result.
    from_scheduling = {
        "shift_reports": {
            "post_shift_validation": {
                "enabled": True,
                "require_officer_report": False,
                "validation_window_hours": 6,
            }
        }
    }
    merged = _deep_merge_settings(merged, from_scheduling)
    assert (
        merged["shift_reports"]["post_shift_validation"]["require_officer_report"]
        is False
    )
    # Inventory's change survived Scheduling's save.
    assert (
        merged["shift_reports"]["checklist_timing"]["start_of_shift_enabled"] is False
    )


@pytest.mark.unit
def test_checklist_timing_payload_does_not_carry_defaulted_siblings():
    """``exclude_unset`` must reach INTO the nested settings model.

    ``ShiftReportSettings.post_shift_validation`` has a ``default_factory``, so
    a non-recursive exclude_unset would materialize it with default values and
    the merge above would then write those defaults over the organization's real
    ones — turning ``require_officer_report`` off for every department whose
    quartermaster touched a checklist toggle.
    """
    from app.schemas.organization import OrganizationSettingsUpdate

    payload = OrganizationSettingsUpdate(
        shift_reports={
            "checklist_timing": {
                "start_of_shift_enabled": False,
                "end_of_shift_enabled": True,
                "checkin_opens_hours_before": 3,
                "checkin_closes_hours_after": 12,
            }
        }
    )
    dumped = payload.model_dump(exclude_unset=True)
    assert set(dumped) == {"shift_reports"}
    assert set(dumped["shift_reports"]) == {"checklist_timing"}
