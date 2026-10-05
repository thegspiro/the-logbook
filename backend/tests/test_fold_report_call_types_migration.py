"""edf608b5a8ea folds the free-text shift-report call types into the
department's one call-type list."""

import importlib.util
from pathlib import Path

import pytest

from app.models.call_tracking import DEFAULT_CALL_TYPES, MAX_CALL_TYPES

pytestmark = [pytest.mark.unit]

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261004_1556_edf608b5a8ea_fold_shift_report_call_types_into_.py"
)


def _m():
    spec = importlib.util.spec_from_file_location("_fold_migration", _PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _slugs(settings):
    return [t["slug"] for t in settings["scheduling"]["call_tracking"]["call_types"]]


def test_frozen_defaults_match_the_registry_they_were_copied_from():
    assert [
        {"slug": s, "label": label} for s, label in _m()._DEFAULTS
    ] == DEFAULT_CALL_TYPES


def test_a_department_on_defaults_keeps_them_and_gains_its_own():
    updated, added = _m().fold_in({}, ["Structure Fire", "Brush Fire"])
    assert added == ["structure_fire", "brush_fire"]
    assert _slugs(updated) == [t["slug"] for t in DEFAULT_CALL_TYPES] + added


def test_entries_that_already_name_a_type_are_skipped():
    # By label, by slug, and across case and separators.
    updated, added = _m().fold_in({}, ["EMS", "mva", "motor-vehicle  accident"])
    assert (updated, added) == (None, [])


def test_a_stored_list_is_extended_not_replaced():
    stored = {
        "scheduling": {
            "call_tracking": {
                "mode": "detailed",
                "call_types": [{"slug": "fire", "label": "Fire", "active": False}],
            }
        },
        "other": {"kept": True},
    }
    updated, added = _m().fold_in(stored, ["Fire", "Hazmat"])
    assert added == ["hazmat"]
    tracking = updated["scheduling"]["call_tracking"]
    assert tracking["mode"] == "detailed"
    assert tracking["call_types"][0] == {
        "slug": "fire",
        "label": "Fire",
        "active": False,
    }
    assert updated["other"] == {"kept": True}


def test_slugs_are_unique_and_never_the_reserved_one():
    stored = {
        "scheduling": {
            "call_tracking": {"call_types": [{"slug": "brush", "label": "Brush"}]}
        }
    }
    updated, added = _m().fold_in(stored, ["Brush!", "Unclassified"])
    # "Brush!" folds differently from "Brush" only in punctuation, so it is new.
    assert added == ["brush_2", "unclassified_2"]


def test_the_cap_is_respected():
    many = [f"Type {i}" for i in range(MAX_CALL_TYPES)]
    updated, added = _m().fold_in({}, many)
    assert len(_slugs(updated)) == MAX_CALL_TYPES
    assert len(added) == MAX_CALL_TYPES - len(DEFAULT_CALL_TYPES)


def test_downgrade_removes_only_what_was_added():
    m = _m()
    original = {
        "scheduling": {
            "call_tracking": {"call_types": [{"slug": "fire", "label": "Fire"}]}
        }
    }
    updated, _ = m.fold_in(original, ["Brush Fire"])
    restored = m.unfold(updated)
    assert (
        restored["scheduling"]["call_tracking"]
        == original["scheduling"]["call_tracking"]
    )


def test_downgrade_leaves_a_list_saved_since():
    # Saving call types replaces the call_tracking object, dropping the marker:
    # the list is the department's own from then on.
    assert _m().unfold({"scheduling": {"call_tracking": {"call_types": []}}}) is None
