"""
A member's membership tier, and a compliance profile's "junior" chip, are
judged by the member's status rather than the legacy ``membership_type``.

#3833 split class from status. The legacy column now collapses an
administrative or social member onto their class ("administrative",
"honorary") and a junior onto "probationary", so two readers that still keyed
on it lost information: the training-report tier exemption and the attendance
dashboard's tier vote check never found the Life tier for an administrative
Life member, and the compliance profile form's "junior" chip matched nobody.
DB mocked; no MySQL.
"""

import inspect
from types import SimpleNamespace

import pytest

from app.services.membership_tier_service import MembershipTierService
from app.services.training_compliance import _find_matching_profile
from app.services.training_service import TrainingService

pytestmark = pytest.mark.unit

LADDER = [
    {"id": "probationary", "sort_order": 0},
    {"id": "active", "sort_order": 1},
    {"id": "life", "sort_order": 2},
    {"id": "senior", "sort_order": 3},
]


def _member(membership_type=None, member_status=None, positions=()):
    return SimpleNamespace(
        membership_type=membership_type,
        member_status=member_status,
        positions=list(positions),
    )


def _tier_id(member):
    tier = MembershipTierService.tier_for_member(LADDER, member)
    return tier["id"] if tier else None


class TestTierForMember:
    def test_administrative_life_member_is_on_the_life_tier(self):
        assert _tier_id(_member("administrative", "life")) == "life"

    def test_social_life_member_is_on_the_life_tier(self):
        assert _tier_id(_member("honorary", "life")) == "life"

    def test_regular_status_is_the_active_rung(self):
        assert _tier_id(_member("active", "regular")) == "active"

    def test_department_tier_is_found_by_its_id(self):
        assert _tier_id(_member("senior", "senior")) == "senior"

    def test_row_without_a_status_falls_back_to_the_legacy_value(self):
        assert _tier_id(_member("life", None)) == "life"

    def test_member_with_nothing_recorded_is_on_the_active_rung(self):
        assert _tier_id(_member(None, None)) == "active"


class TestTrainingReportUsesTheStatusLookup:
    """The exemption block sits deep inside generate_training_report, which
    is source-inspected for the same reason as its org-scoping guard in
    test_training_service_user_scoping.py."""

    def test_the_exemption_tier_is_looked_up_by_member(self):
        source = inspect.getsource(TrainingService.generate_training_report)
        assert "tier_for_member(" in source
        assert '"membership_type"' not in source


def _profile(membership_types, role_ids=None):
    return SimpleNamespace(
        is_active=True, membership_types=membership_types, role_ids=role_ids or []
    )


class TestJuniorProfileChip:
    def test_junior_member_matches_a_junior_profile(self):
        junior = _member("probationary", "junior")
        profile = _profile(["junior"])
        assert _find_matching_profile(junior, [profile]) is profile

    def test_junior_member_still_matches_a_probationary_profile(self):
        junior = _member("probationary", "junior")
        profile = _profile(["probationary"])
        assert _find_matching_profile(junior, [profile]) is profile

    def test_probationary_member_does_not_match_a_junior_profile(self):
        probationer = _member("probationary", "probationary")
        assert _find_matching_profile(probationer, [_profile(["junior"])]) is None

    def test_other_chips_still_match_the_legacy_value(self):
        # Unchanged on purpose: guide 02 documents that "life" means an
        # operational life member, so an administrative life member keeps
        # matching "administrative" and not "life".
        admin_life = _member("administrative", "life")
        assert _find_matching_profile(admin_life, [_profile(["life"])]) is None
        assert _find_matching_profile(admin_life, [_profile(["administrative"])])
