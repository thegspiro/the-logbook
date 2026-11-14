"""Per-member-type voting rules (eligibility rules version 2).

Covers the row vocabulary, the conversion of a department's version 1 rules
and tier voting benefits into rows, the schema's version shapes, and the
ballot check judging a member by their status row and, for an administrative
or social member, their class row as well.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from dateutil.relativedelta import relativedelta
from pydantic import ValidationError

from app.api.v1.endpoints.elections import (
    ElectionSettingsUpdate,
    create_election,
    get_election_settings,
    update_election_settings,
)
from app.models.election import Election, ElectionStatus
from app.models.meeting import Meeting, MeetingAttendee, MeetingType
from app.models.user import Organization, User, UserStatus
from app.schemas.election import ElectionCreate, ElectionEligibilityRules, TypeRule
from app.services.election_service import ElectionService
from app.services.voter_rules import member_row_keys, rules_from_v1, voter_rows
from app.utils.org_timezone import org_today

SHIPPED_LADDER = [
    {
        "id": "probationary",
        "name": "Probationary",
        "sort_order": 0,
        "benefits": {"voting_eligible": False},
    },
    {
        "id": "active",
        "name": "Active Member",
        "sort_order": 1,
        "benefits": {
            "voting_requires_meeting_attendance": True,
            "voting_min_attendance_pct": 50.0,
            "voting_attendance_period_months": 12,
        },
    },
    {"id": "senior", "name": "Senior Member", "sort_order": 2, "benefits": {}},
    {"id": "life", "name": "Life Member", "sort_order": 3, "benefits": {}},
]
COUNT_6_OF_12 = {"mode": "count", "min_meetings": 6, "of_last_meetings": 12}
COUNT_2_OF_3 = {"mode": "count", "min_meetings": 2, "of_last_meetings": 3}
NO_RULE = {"may_vote": True, "wait": None, "attendance": []}


def _v2(**types):
    return {
        "version": 2,
        "types": {key: {**NO_RULE, **rule} for key, rule in types.items()},
    }


@pytest.fixture(autouse=True)
def _no_audit_write(monkeypatch):
    monkeypatch.setattr("app.api.v1.endpoints.elections.log_audit_event", AsyncMock())


@pytest.mark.unit
class TestRows:
    def test_rows_list_every_status_the_departments_tiers_and_the_classes(self):
        rows = voter_rows(SHIPPED_LADDER)
        assert [r["key"] for r in rows] == [
            "regular",
            "senior",
            "life",
            "probationary",
            "retired",
            "honorary",
            "junior",
            "prospective",
            "administrative",
            "social",
        ]
        by_key = {r["key"]: r for r in rows}
        # A tier's name loses its noun, since reasons read "<label> members".
        assert by_key["senior"]["label"] == "Senior"
        assert by_key["administrative"]["decided_by"] == "class"
        assert by_key["regular"]["decided_by"] == "status"

    def test_a_tier_row_names_the_status_it_counts_as(self):
        ladder = [dict(t) for t in SHIPPED_LADDER]
        ladder[2] = {**ladder[2], "ranks_as": "regular"}
        by_key = {r["key"]: r for r in voter_rows(ladder)}
        assert by_key["senior"]["counts_as"] == "regular"
        assert by_key["life"]["counts_as"] is None

    def test_an_administrative_member_is_judged_by_both_rows(self):
        member = SimpleNamespace(
            member_status="regular", member_class="administrative", membership_type=None
        )
        types = {"regular": {}, "administrative": {}}
        assert member_row_keys(member, types, {}) == ["regular", "administrative"]

    def test_an_operational_member_is_judged_by_their_status_row_only(self):
        member = SimpleNamespace(
            member_status="life", member_class="operational", membership_type=None
        )
        assert member_row_keys(member, {"life": {}, "administrative": {}}, {}) == [
            "life"
        ]

    def test_a_tier_with_its_own_row_uses_it(self):
        member = SimpleNamespace(
            member_status="senior", member_class="operational", membership_type=None
        )
        types = {"senior": {}, "regular": {}}
        assert member_row_keys(member, types, {"senior": "regular"}) == ["senior"]

    def test_a_tier_without_a_row_uses_the_status_it_counts_as(self):
        member = SimpleNamespace(
            member_status="senior", member_class="operational", membership_type=None
        )
        assert member_row_keys(member, {"regular": {}}, {"senior": "regular"}) == [
            "regular"
        ]


@pytest.mark.unit
class TestConversionFromVersion1:
    def _converted(self, rules=None, tiers=SHIPPED_LADDER):
        converted = rules_from_v1(rules, tiers)
        # Whatever the conversion produces must be a rule set the API accepts.
        ElectionEligibilityRules.model_validate(converted)
        return converted["types"]

    def test_a_tier_that_may_not_vote_becomes_a_row_that_may_not_vote(self):
        assert self._converted()["probationary"] == {
            "may_vote": False,
            "wait": None,
            "attendance": [],
        }

    def test_a_tiers_attendance_percentage_joins_the_election_wide_rule(self):
        types = self._converted({"attendance": COUNT_6_OF_12, "waiting_periods": {}})
        assert types["regular"]["attendance"] == [
            COUNT_6_OF_12,
            {"mode": "percent", "min_pct": 50.0, "period_months": 12},
        ]
        # A row whose tier sets no attendance keeps only the shared rule.
        assert types["life"]["attendance"] == [COUNT_6_OF_12]
        assert types["administrative"]["attendance"] == [COUNT_6_OF_12]

    def test_waiting_periods_move_to_their_rows(self):
        types = self._converted(
            {
                "attendance": {"mode": "none"},
                "waiting_periods": {
                    "regular": {"mode": "months", "months": 12},
                    "administrative": {"mode": "never"},
                },
            }
        )
        assert types["regular"]["wait"] == {"months": 12, "counted_from": "type"}
        assert types["administrative"]["may_vote"] is False
        # The senior tier counts as nothing, so no status wait reached it.
        assert types["senior"]["wait"] is None

    def test_a_tier_takes_the_wait_of_the_status_it_counts_as(self):
        ladder = [dict(t) for t in SHIPPED_LADDER]
        ladder[2] = {**ladder[2], "ranks_as": "regular"}
        types = self._converted(
            {
                "attendance": {"mode": "none"},
                "waiting_periods": {"regular": {"mode": "months", "months": 12}},
            },
            ladder,
        )
        assert types["senior"]["wait"] == {"months": 12, "counted_from": "type"}

    def test_with_no_rules_and_no_ladder_every_row_is_open(self):
        assert all(row == NO_RULE for row in self._converted(None, []).values())


@pytest.mark.unit
class TestSchema:
    def test_version_2_refuses_the_version_1_fields(self):
        with pytest.raises(ValidationError):
            ElectionEligibilityRules.model_validate(
                {"version": 2, "attendance": COUNT_2_OF_3, "types": {}}
            )

    def test_version_1_refuses_per_type_rows(self):
        with pytest.raises(ValidationError):
            ElectionEligibilityRules.model_validate({"types": {"regular": NO_RULE}})

    def test_a_row_that_may_not_vote_carries_no_other_rule(self):
        rule = TypeRule.model_validate(
            {
                "may_vote": False,
                "wait": {"months": 6},
                "attendance": [COUNT_2_OF_3],
            }
        )
        assert rule.wait is None
        assert rule.attendance == []

    def test_a_none_attendance_rule_is_dropped(self):
        rule = TypeRule.model_validate({"attendance": [{"mode": "none"}]})
        assert rule.attendance == []

    def test_a_malformed_row_key_is_refused(self):
        with pytest.raises(ValidationError):
            ElectionEligibilityRules.model_validate(
                {"version": 2, "types": {"Not A Key": NO_RULE}}
            )

    def test_a_wait_start_must_be_type_or_joined(self):
        with pytest.raises(ValidationError):
            TypeRule.model_validate({"wait": {"months": 6, "counted_from": "never"}})


async def _org(db, settings=None):
    org = Organization(
        name="Type Rules FD",
        slug=f"type-rules-{uuid.uuid4().hex[:8]}",
        settings=settings or {},
    )
    db.add(org)
    await db.flush()
    return org


async def _member(db, org, tag, member_class, member_status, since=None):
    user = User(
        organization_id=org.id,
        username=f"{tag}-{uuid.uuid4().hex[:8]}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@example.org",
        first_name=tag.capitalize(),
        last_name="Member",
        hire_date=date(2010, 1, 1),
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    user.member_class = member_class
    user.member_status = member_status
    await db.flush()
    if since is not None:
        # Written after the type, so the stamp is the backdated value rather
        # than the flush time.
        user.member_class_since = since
        user.member_status_since = since
        await db.flush()
    return user


async def _election(db, org, creator, rules):
    now = datetime.now(timezone.utc)
    election = Election(
        organization_id=org.id,
        title="Chief 2027",
        positions=["Chief"],
        start_date=now - timedelta(days=1),
        end_date=now + timedelta(days=1),
        status=ElectionStatus.OPEN,
        created_by=creator.id,
        voter_anonymity_salt=uuid.uuid4().hex,
        eligibility_rules=rules,
    )
    db.add(election)
    await db.flush()
    return election


async def _three_meetings(db, org, attended_by):
    today = org_today(org)
    meetings = [
        Meeting(
            organization_id=org.id,
            title=f"Meeting {k}",
            meeting_date=today - relativedelta(months=k),
            meeting_type=MeetingType.BUSINESS,
        )
        for k in (3, 2, 1)
    ]
    db.add_all(meetings)
    await db.flush()
    db.add_all(
        MeetingAttendee(
            organization_id=org.id, meeting_id=m.id, user_id=member.id, present=True
        )
        for member in attended_by
        for m in meetings
    )
    await db.flush()


def _ago(**kw):
    return datetime.now(timezone.utc) - relativedelta(**kw)


async def _check(db, member, election, org):
    return await ElectionService(db).check_voter_eligibility(
        member.id, election.id, org.id
    )


@pytest.mark.integration
class TestBallotCheck:
    async def test_an_administrative_member_must_also_meet_their_status_row(
        self, db_session
    ):
        org = await _org(db_session)
        regular = await _member(db_session, org, "regular", "operational", "regular")
        admin = await _member(db_session, org, "admin", "administrative", "regular")
        await _three_meetings(db_session, org, attended_by=[regular])
        election = await _election(
            db_session,
            org,
            regular,
            _v2(regular={"attendance": [COUNT_2_OF_3]}, administrative={}),
        )

        assert (await _check(db_session, regular, election, org)).is_eligible is True
        refused = await _check(db_session, admin, election, org)
        assert refused.is_eligible is False
        assert refused.reason == "Attended 0 of the last 3 meetings; 2 required to vote"

    async def test_a_class_row_that_may_not_vote_refuses(self, db_session):
        org = await _org(db_session)
        social = await _member(db_session, org, "social", "social", "regular")
        election = await _election(
            db_session, org, social, _v2(regular={}, social={"may_vote": False})
        )
        refused = await _check(db_session, social, election, org)
        assert refused.is_eligible is False
        assert refused.reason == "Social members may not vote"

    async def test_version_2_rules_replace_the_tier_flag(self, db_session):
        org = await _org(db_session, {"membership_tiers": {"tiers": SHIPPED_LADDER}})
        probie = await _member(db_session, org, "probie", "operational", "probationary")

        # Version 1: the tier ladder's "may not vote" applies.
        legacy = await _election(db_session, org, probie, None)
        assert (await _check(db_session, probie, legacy, org)).is_eligible is False

        # Version 2: the row says who may vote, and it says yes.
        rows = await _election(db_session, org, probie, _v2(probationary={}))
        assert (await _check(db_session, probie, rows, org)).is_eligible is True

    async def test_the_roster_gate_applies_the_rows(self, db_session):
        org = await _org(db_session)
        probie = await _member(db_session, org, "probie", "operational", "probationary")
        election = await _election(
            db_session, org, probie, _v2(probationary={"may_vote": False})
        )
        reason, has_override = await ElectionService(db_session)._universal_gate(
            probie, election, str(org.id)
        )
        assert reason == "Probationary members may not vote"
        assert has_override is False


@pytest.mark.integration
class TestWaitStart:
    async def _rules(self, counted_from):
        return _v2(regular={"wait": {"months": 12, "counted_from": counted_from}})

    async def test_counted_from_becoming_the_type(self, db_session):
        org = await _org(db_session)
        # In the department since 2010, regular for three months.
        member = await _member(
            db_session, org, "promoted", "operational", "regular", _ago(months=3)
        )
        election = await _election(db_session, org, member, await self._rules("type"))
        refused = await _check(db_session, member, election, org)
        assert refused.is_eligible is False
        assert refused.reason.startswith(
            "Regular members may vote 12 months after becoming regular; eligible from"
        )

    async def test_counted_from_joining_the_department(self, db_session):
        org = await _org(db_session)
        member = await _member(
            db_session, org, "promoted", "operational", "regular", _ago(months=3)
        )
        election = await _election(db_session, org, member, await self._rules("joined"))
        assert (await _check(db_session, member, election, org)).is_eligible is True


@pytest.mark.integration
class TestNewElections:
    async def test_a_new_election_carries_the_tier_rules_as_rows(self, db_session):
        # Nothing saved in Election Settings: the tier ladder's voting rules
        # reach the new election as rows, so no member gains a vote.
        org = await _org(db_session, {"membership_tiers": {"tiers": SHIPPED_LADDER}})
        secretary = await _member(
            db_session, org, "secretary", "operational", "regular"
        )
        now = datetime.now(timezone.utc)
        response = await create_election(
            election=ElectionCreate.model_validate(
                {
                    "title": "Officers 2027",
                    "start_date": now + timedelta(days=1),
                    "end_date": now + timedelta(days=2),
                }
            ),
            db=db_session,
            current_user=secretary,
        )
        rules = response.eligibility_rules
        assert rules.version == 2
        assert rules.types["probationary"].may_vote is False
        assert [
            a.model_dump(exclude_none=True) for a in rules.types["regular"].attendance
        ] == [{"mode": "percent", "min_pct": 50.0, "period_months": 12}]


def _settings_db(org_settings):
    organization = Mock(settings=org_settings)
    result = Mock()
    result.scalar_one_or_none.return_value = organization
    db = Mock()
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    return db, organization


@pytest.mark.unit
class TestSettings:
    async def test_get_reports_the_rows_and_every_kind(self):
        db, _ = _settings_db({"membership_tiers": {"tiers": SHIPPED_LADDER}})
        response = await get_election_settings(db=db, current_user=Mock())
        assert [r["key"] for r in response["voter_rows"]][:2] == ["regular", "senior"]
        assert response["bylaws_eligibility"] is None
        assert response["special_eligibility"] is None
        # Nothing saved: the tier ladder's rules, as rows.
        types = response["eligibility"]["rules"]["types"]
        assert types["probationary"]["may_vote"] is False

    async def test_patch_stores_and_clears_the_bylaws_rules(self):
        db, organization = _settings_db({})
        payload = {
            "rules": _v2(probationary={"may_vote": False}),
            "default_require_attendance": True,
            "default_voter_types": ["all"],
            "position_voter_types": {},
        }
        response = await update_election_settings(
            settings_update=ElectionSettingsUpdate.model_validate(
                {"bylaws_eligibility": payload}
            ),
            db=db,
            current_user=Mock(),
        )
        stored = organization.settings["election_eligibility_bylaws"]
        assert stored["rules"]["types"]["probationary"]["may_vote"] is False
        assert response["bylaws_eligibility"]["rules"]["version"] == 2

        await update_election_settings(
            settings_update=ElectionSettingsUpdate.model_validate(
                {"bylaws_eligibility": None}
            ),
            db=db,
            current_user=Mock(),
        )
        assert "election_eligibility_bylaws" not in organization.settings
