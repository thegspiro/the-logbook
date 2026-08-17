"""Unit tests (no DB) for the retention policy report.

PR #1413 review: ``get_policy`` echoed the raw stored value as
``effective_days`` while enforcement resolves through ``_effective_days``
(default fallback for malformed values, class floor for low ones) — so for
a malformed setting the API misreported the policy the system actually
enforces. These lock the two paths together.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.retention_service import RECORD_CLASSES, RetentionService


def _policy(retention_config):
    org = SimpleNamespace(settings={"retention": retention_config})
    return RetentionService(MagicMock()).get_policy(org)


def _entry(policy, key):
    return next(p for p in policy if p["record_class"] == key)


def test_malformed_value_reports_the_enforced_default():
    entry = _entry(_policy({"message_history": {}}), "message_history")
    assert entry["effective_days"] == 90  # what enforce() actually applies
    assert entry["configured_days"] == {}  # raw value still exposed as-is
    assert entry["is_configured"] is True


def test_malformed_value_on_keep_forever_class_reports_forever():
    entry = _entry(_policy({"form_submissions": []}), "form_submissions")
    assert entry["effective_days"] is None
    assert entry["configured_days"] == []


def test_below_floor_value_reports_the_floored_duration():
    entry = _entry(_policy({"message_history": 1}), "message_history")
    assert entry["effective_days"] == 30  # enforcement floors at min_days
    assert entry["configured_days"] == 1


def test_unset_and_null_report_default_and_forever():
    policy = _policy({"notification_logs": None})
    unset = _entry(policy, "message_history")
    assert unset["effective_days"] == 90
    assert unset["is_configured"] is False
    keep_forever = _entry(policy, "notification_logs")
    assert keep_forever["effective_days"] is None
    assert keep_forever["is_configured"] is True


def test_report_matches_effective_days_for_every_class():
    config = {
        "message_history": {},
        "error_logs": "not-a-number",
        "form_submissions": 120,
        "notification_logs": None,
    }
    policy = _policy(config)
    for rc in RECORD_CLASSES:
        assert _entry(policy, rc.key)["effective_days"] == (
            RetentionService._effective_days(config, rc)
        )
