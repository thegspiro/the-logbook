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
