"""Equal-priority compliance profiles resolve in one fixed order.

Owner decision 2026-11-21: on a tie the older profile wins, then the smaller
id. Before it, a tie went to whichever row the database returned first, so
which profile graded a member depended on row order. The winner is read off
the threshold override each profile carries, which ``for_member`` reports
without needing a requirement to apply. No database.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services.training_compliance import ComplianceGrading, _find_matching_profile
from app.utils.compliance_profiles import ordered_profiles

pytestmark = pytest.mark.unit

_T = datetime(2026, 3, 3, 12, 0, tzinfo=timezone.utc)


def _profile(name, *, priority=0, created_at=_T, id_="", threshold=50.0):
    return SimpleNamespace(
        name=name,
        id=id_,
        priority=priority,
        created_at=created_at,
        is_active=True,
        membership_types=None,
        role_ids=None,
        required_requirement_ids=None,
        optional_requirement_ids=None,
        compliant_threshold_override=threshold,
        at_risk_threshold_override=None,
    )


def _config(profiles):
    return SimpleNamespace(
        compliant_threshold=100.0,
        at_risk_threshold=75.0,
        threshold_type="percentage",
        include_current_month=True,
        profiles=profiles,
    )


def _member():
    return SimpleNamespace(membership_type="active", member_status=None, positions=[])


def _winner(profiles):
    grading = ComplianceGrading.from_config(_config(profiles)).for_member(_member(), [])
    return grading.compliant_threshold


class TestEqualPriorityTieBreak:
    def test_equal_priority_resolves_to_the_older_profile_whatever_the_order(self):
        newer = _profile("newer", created_at=_T, id_="0" * 8, threshold=50.0)
        older = _profile(
            "older", created_at=_T - timedelta(days=1), id_="f" * 8, threshold=90.0
        )
        assert _winner([newer, older]) == 90.0
        assert _winner([older, newer]) == 90.0

    def test_equal_priority_and_created_at_falls_back_to_the_smaller_id(self):
        larger = _profile("larger", id_="b" * 8, threshold=50.0)
        smaller = _profile("smaller", id_="a" * 8, threshold=90.0)
        assert _winner([larger, smaller]) == 90.0

    def test_higher_priority_beats_an_older_profile(self):
        # A guard: priority already decided this before the tie-break existed.
        older = _profile("older", created_at=_T - timedelta(days=30), threshold=50.0)
        higher = _profile("higher", priority=5, threshold=90.0)
        assert _winner([older, higher]) == 90.0

    def test_profile_without_created_at_sorts_after_one_with_it(self):
        unsaved = _profile("unsaved", created_at=None, id_="0", threshold=50.0)
        saved = _profile("saved", id_="f", threshold=90.0)
        assert _winner([unsaved, saved]) == 90.0

    def test_naive_and_aware_created_at_compare_without_error(self):
        naive = _profile(
            "naive",
            created_at=(_T - timedelta(days=1)).replace(tzinfo=None),
            id_="f",
            threshold=90.0,
        )
        aware = _profile("aware", created_at=_T, id_="0", threshold=50.0)
        assert _winner([aware, naive]) == 90.0

    def test_find_matching_profile_orders_an_unordered_list(self):
        newer = _profile("newer", created_at=_T, id_="0")
        older = _profile("older", created_at=_T - timedelta(days=1), id_="f")
        assert _find_matching_profile(_member(), [newer, older]) is older

    def test_missing_priority_reads_as_zero(self):
        bare = SimpleNamespace(name="bare")
        ranked = SimpleNamespace(name="ranked", priority=1)
        assert [p.name for p in ordered_profiles([bare, ranked])] == ["ranked", "bare"]

    def test_negative_priority_sorts_below_zero(self):
        negative = _profile("negative", priority=-3, created_at=_T - timedelta(days=9))
        zero = _profile("zero")
        assert [p.name for p in ordered_profiles([negative, zero])] == [
            "zero",
            "negative",
        ]


class TestConfigResponseOrder:
    """GET/PUT /compliance-config list profiles in resolution order, so the
    editor shows the profile that wins a tie first without deciding it."""

    def test_profiles_are_listed_in_resolution_order(self):
        from app.schemas.compliance_config import ComplianceConfigResponse

        def row(name, id_, created_at, priority=0):
            return {
                "id": id_,
                "config_id": "cfg",
                "name": name,
                "priority": priority,
                "created_at": created_at,
                "updated_at": created_at,
            }

        payload = {
            "id": "cfg",
            "organization_id": "org",
            "created_at": _T,
            "updated_at": _T,
            "profiles": [
                row("newer", "0" * 8, _T),
                row("low", "1" * 8, _T - timedelta(days=9), priority=-1),
                row("older", "f" * 8, _T - timedelta(days=1)),
                row("high", "2" * 8, _T, priority=3),
            ],
        }
        response = ComplianceConfigResponse.model_validate(payload)
        assert [p.name for p in response.profiles] == ["high", "older", "newer", "low"]
