"""
A membership tier's benefits are found by the member's status, not by the
legacy ``membership_type`` (owner decision 2026-11-01, "Move readers to
status").

The legacy column collapses an administrative or social member onto their
class word (``administrative`` / ``honorary``), so every reader keyed on it
missed the tier such a member stands on: an administrative member on the
department's own ``senior`` tier, or an administrative Life member, got no
voting rule, no office-holding rule and was required at no tier-scoped event.
Each reader now resolves the tier through ``app.utils.membership``'s
``tier_for_member``.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService, _tier_benefits, _tier_name
from app.services.event_service import EventService
from app.utils.membership import (
    configured_tiers,
    member_holds_tier,
    tier_benefits,
    tier_for_member,
)

SETTINGS = {
    "membership_tiers": {
        "tiers": [
            {"id": "probationary", "name": "Probationary", "sort_order": 0},
            {"id": "active", "name": "Active Member", "sort_order": 1},
            {
                "id": "senior",
                "name": "Senior Member",
                "sort_order": 2,
                "benefits": {"voting_eligible": False, "can_hold_office": False},
            },
            {
                "id": "life",
                "name": "Life Member",
                "sort_order": 3,
                "benefits": {"training_exempt": True},
            },
        ]
    }
}
ORG = SimpleNamespace(settings=SETTINGS)


def _member(membership_type, member_status, member_class=None):
    return SimpleNamespace(
        membership_type=membership_type,
        member_status=member_status,
        member_class=member_class,
        hire_date=None,
    )


ADMIN_SENIOR = _member("administrative", "senior", "administrative")
ADMIN_LIFE = _member("administrative", "life", "administrative")


@pytest.mark.unit
class TestCanonicalHelper:
    def test_configured_tiers_are_in_ladder_order_and_malformed_is_empty(self):
        ids = [t["id"] for t in configured_tiers(SETTINGS)]
        assert ids == ["probationary", "active", "senior", "life"]
        assert configured_tiers(None) == []
        assert configured_tiers({"membership_tiers": "nonsense"}) == []
        assert configured_tiers({"membership_tiers": {"tiers": ["x", 3]}}) == []

    def test_an_administrative_member_on_a_department_tier_finds_it(self):
        tier = tier_for_member(configured_tiers(SETTINGS), ADMIN_SENIOR)
        assert tier is not None
        assert tier["id"] == "senior"
        assert tier_benefits(tier) == {
            "voting_eligible": False,
            "can_hold_office": False,
        }

    def test_status_absent_falls_back_to_the_legacy_value(self):
        tier = tier_for_member(configured_tiers(SETTINGS), _member("senior", None))
        assert tier is not None
        assert tier["id"] == "senior"

    def test_holding_a_tier_is_judged_by_status_in_canonical_spelling(self):
        assert member_holds_tier(ADMIN_LIFE, ["life"])
        assert member_holds_tier(_member("active", "regular"), ["active"])
        assert not member_holds_tier(ADMIN_LIFE, ["administrative_only_tier"])
        assert not member_holds_tier(ADMIN_SENIOR, ["active"])


@pytest.mark.unit
class TestElectionReaders:
    def test_voting_and_office_rules_reach_an_administrative_senior_member(self):
        benefits = _tier_benefits(ADMIN_SENIOR, ORG)
        assert benefits.get("voting_eligible") is False
        assert benefits.get("can_hold_office") is False

    def test_the_refusal_names_the_tier_the_member_stands_on(self):
        assert _tier_name(ADMIN_SENIOR, ORG) == "Senior Member"

    def test_an_operational_member_on_the_same_tier_is_unchanged(self):
        assert _tier_benefits(_member("senior", "senior"), ORG)["voting_eligible"] is (
            False
        )


@pytest.mark.unit
class TestEventReader:
    EVENING = datetime(2026, 10, 6, 23, 0, tzinfo=timezone.utc)

    def _expected(self, member, required):
        event = SimpleNamespace(
            start_datetime=self.EVENING, mandatory_membership_types=required
        )
        return EventService._was_expected_at(
            event, member, [], ZoneInfo("America/New_York")
        )

    def test_an_event_for_life_members_expects_an_administrative_life_member(self):
        assert self._expected(ADMIN_LIFE, ["life"]) is True

    def test_an_event_for_a_department_tier_expects_its_administrative_members(self):
        assert self._expected(ADMIN_SENIOR, ["senior"]) is True

    def test_a_member_on_another_tier_is_still_not_expected(self):
        assert self._expected(ADMIN_SENIOR, ["life"]) is False


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC', :settings)"
        ),
        {
            "id": org_id,
            "name": f"Tier Status FD {org_id[:8]}",
            "slug": f"ts-{org_id[:8]}",
            "settings": json.dumps(SETTINGS),
        },
    )
    return org_id


async def _user(db: AsyncSession, org_id: str, mtype: str, status, klass) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, email, "
            "password_hash, status, membership_type, member_status, member_class) "
            "VALUES (:id, :org, :un, 'Tier', 'Member', :em, 'hashed', 'active', "
            ":mt, :ms, :mc)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"ts-{user_id[:8]}",
            "em": f"ts-{user_id[:8]}@test.com",
            "mt": mtype,
            "ms": status,
            "mc": klass,
        },
    )
    return user_id


async def _election(db: AsyncSession, org_id: str, creator: str) -> str:
    election_id = _uid()
    now = datetime.now(timezone.utc)
    await db.execute(
        text(
            "INSERT INTO elections "
            "(id, organization_id, title, election_type, positions, "
            "start_date, end_date, status, anonymous_voting, allow_write_ins, "
            "max_votes_per_position, voting_method, victory_condition, "
            "voter_anonymity_salt, quorum_type, created_by, email_sent, "
            "results_visible_immediately, enable_runoffs, runoff_type, "
            "max_runoff_rounds, is_runoff, runoff_round, created_at, updated_at) "
            "VALUES (:id, :org, 'Tier Status Election', 'general', "
            "'[\"President\"]', :start, :end, 'open', 1, 0, 1, "
            "'simple_majority', 'most_votes', 'salt', 'none', :creator, 0, 0, 0, "
            "'top_two', 3, 0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "start": now - timedelta(days=1),
            "end": now + timedelta(days=1),
            "creator": creator,
        },
    )
    return election_id


@pytest.mark.integration
class TestElectionAgainstTheDatabase:
    async def test_an_administrative_senior_member_is_refused_a_ballot(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        voter = await _user(db_session, org_id, "active", "regular", "operational")
        senior = await _user(
            db_session, org_id, "administrative", "senior", "administrative"
        )
        election_id = await _election(db_session, org_id, voter)
        await db_session.flush()
        svc = ElectionService(db_session)

        refused = await svc.check_voter_eligibility(
            senior, uuid.UUID(election_id), org_id
        )
        allowed = await svc.check_voter_eligibility(
            voter, uuid.UUID(election_id), org_id
        )

        assert refused.is_eligible is False
        assert "Senior Member" in (refused.reason or "")
        assert allowed.is_eligible is True

    async def test_the_turnout_denominator_leaves_out_non_voting_tiers(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        voter = await _user(db_session, org_id, "active", "regular", "operational")
        await _user(db_session, org_id, "administrative", "senior", "administrative")
        await _user(db_session, org_id, "senior", "senior", "operational")
        election_id = await _election(db_session, org_id, voter)
        await db_session.flush()
        svc = ElectionService(db_session)
        election = await svc.get_election(uuid.UUID(election_id), org_id)

        assert await svc._count_eligible_voters(election, org_id) == 1
