"""Election-wide voter eligibility rules and the department's defaults.

Covers the rules a secretary sets on Election Settings → Voter Eligibility:
a meeting-attendance requirement ("6 of the last 12 meetings" or "50% over 12
months"), a minimum membership tenure, and the defaults that seed new
elections and ballot items. The rules are copied onto an election when it is
created, and every eligibility path — the in-app ballot check, the roster,
and the turnout denominator — must apply them identically.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from dateutil.relativedelta import relativedelta
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text

from app.api.v1.endpoints.elections import (
    ElectionSettingsUpdate,
    _active_rules_or_none,
    _eligibility_defaults,
    _tier_voting_rules,
    create_election,
    get_election_settings,
    update_election,
    update_election_settings,
)
from app.models.election import Election, ElectionStatus
from app.models.meeting import Meeting, MeetingAttendee, MeetingType
from app.models.user import Organization, User, UserStatus
from app.schemas.election import (
    AttendanceRule,
    ElectionCreate,
    ElectionUpdate,
    EligibilityDefaults,
)
from app.services.election_service import ElectionService
from app.services.membership_tier_service import (
    required_recent_meetings,
    tally_recent_attendance,
    whole_months_between,
)
from app.utils.org_timezone import org_today

COUNT_2_OF_3 = {
    "attendance": {"mode": "count", "min_meetings": 2, "of_last_meetings": 3},
    "waiting_periods": {},
}


@pytest.fixture(autouse=True)
def _no_audit_write(monkeypatch):
    monkeypatch.setattr("app.api.v1.endpoints.elections.log_audit_event", AsyncMock())


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestRequiredRecentMeetings:
    def test_full_look_back_requires_the_whole_count(self):
        assert required_recent_meetings(6, 12, 12) == 6

    def test_fewer_meetings_scale_the_requirement(self):
        assert required_recent_meetings(6, 12, 4) == 2

    def test_scaling_rounds_up(self):
        # 6 of 12 over 5 meetings is 2.5 -> 3, never relaxed to 2.
        assert required_recent_meetings(6, 12, 5) == 3

    def test_no_meetings_requires_none(self):
        assert required_recent_meetings(6, 12, 0) == 0


@pytest.mark.unit
class TestTallyRecentAttendance:
    WINDOW = (date(2026, 1, 1), date(2026, 9, 1))

    def _meetings(self):
        return [(f"m{m}", date(2026, m, 1)) for m in range(1, 9)]

    def test_only_the_most_recent_meetings_count(self):
        # Present at the first five, absent at the last three.
        present = {f"m{m}" for m in range(1, 6)}
        result = tally_recent_attendance(
            self._meetings(), self.WINDOW, set(), present, [], last_meetings=3
        )
        assert (result.attended, result.considered) == (0, 3)

    def test_waived_meetings_are_skipped_not_counted_as_absences(self):
        present = {"m6"}
        result = tally_recent_attendance(
            self._meetings(), self.WINDOW, {"m8", "m7"}, present, [], last_meetings=2
        )
        # m8, m7 waived: the last two eligible meetings are m6 and m5.
        assert (result.attended, result.considered) == (1, 2)

    def test_meetings_during_leave_are_skipped(self):
        leave = SimpleNamespace(start_date=date(2026, 7, 15), end_date=None)
        result = tally_recent_attendance(
            self._meetings(), self.WINDOW, set(), {"m7"}, [leave], last_meetings=2
        )
        # m8 falls inside the open-ended leave: m7 and m6 are considered.
        assert (result.attended, result.considered) == (1, 2)

    def test_fewer_meetings_than_the_look_back_considers_all_of_them(self):
        result = tally_recent_attendance(
            [("a", date(2026, 3, 1))], self.WINDOW, set(), {"a"}, [], last_meetings=12
        )
        assert (result.attended, result.considered) == (1, 1)


@pytest.mark.unit
class TestWholeMonths:
    def test_counts_completed_months(self):
        assert whole_months_between(date(2026, 1, 15), date(2026, 7, 14)) == 5
        assert whole_months_between(date(2026, 1, 15), date(2026, 7, 15)) == 6

    def test_start_after_end_is_zero(self):
        assert whole_months_between(date(2026, 8, 1), date(2026, 7, 1)) == 0


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestAttendanceRuleSchema:
    def test_count_rule_needs_both_numbers(self):
        with pytest.raises(ValidationError, match="meeting-count rule"):
            AttendanceRule(mode="count", min_meetings=6)

    def test_count_rule_cannot_require_more_than_it_looks_at(self):
        with pytest.raises(ValidationError, match="cannot exceed"):
            AttendanceRule(mode="count", min_meetings=7, of_last_meetings=6)

    def test_percent_rule_needs_both_numbers(self):
        with pytest.raises(ValidationError, match="percentage rule"):
            AttendanceRule(mode="percent", min_pct=50)

    def test_unknown_mode_is_refused(self):
        with pytest.raises(ValidationError, match="attendance rule mode"):
            AttendanceRule(mode="sometimes")

    def test_unknown_meeting_type_is_refused(self):
        with pytest.raises(ValidationError, match="meeting type"):
            AttendanceRule(mode="none", meeting_types=["picnic"])

    def test_empty_meeting_types_means_every_meeting(self):
        assert AttendanceRule(mode="none", meeting_types=[]).meeting_types is None

    def test_unknown_field_is_refused(self):
        with pytest.raises(ValidationError):
            AttendanceRule(mode="none", minimum=3)


@pytest.mark.unit
class TestEligibilityDefaultsSchema:
    def test_built_in_defaults_match_todays_behaviour(self):
        defaults = EligibilityDefaults()
        assert defaults.default_require_attendance is True
        assert defaults.default_voter_types == ["all"]
        assert defaults.position_voter_types == {}
        assert defaults.rules.attendance.mode == "none"
        assert defaults.rules.waiting_periods == {}

    def test_position_names_are_trimmed(self):
        defaults = EligibilityDefaults(
            position_voter_types={" Chief ": ["operational"]}
        )
        assert defaults.position_voter_types == {"Chief": ["operational"]}

    def test_a_position_listed_twice_in_different_case_is_refused(self):
        with pytest.raises(ValidationError, match="more than once"):
            EligibilityDefaults(
                position_voter_types={"Chief": ["operational"], "chief": ["all"]}
            )

    def test_voter_types_follow_the_ballot_item_rules(self):
        with pytest.raises(ValidationError, match="cannot be combined"):
            EligibilityDefaults(default_voter_types=["all", "regular"])

    def test_settings_update_refuses_an_explicit_null(self):
        with pytest.raises(ValidationError, match="eligibility must be an object"):
            ElectionSettingsUpdate.model_validate({"eligibility": None})


@pytest.mark.unit
class TestStoredValues:
    def test_inactive_rules_are_stored_as_null(self):
        assert _active_rules_or_none(EligibilityDefaults().rules.model_dump()) is None
        assert _active_rules_or_none(None) is None

    def test_active_rules_are_kept(self):
        assert _active_rules_or_none(COUNT_2_OF_3) == COUNT_2_OF_3
        wait_only = {
            "attendance": {"mode": "none"},
            "waiting_periods": {"probationary": {"mode": "never"}},
        }
        assert _active_rules_or_none(wait_only) == wait_only

    def test_invalid_stored_defaults_fall_back_rather_than_fail(self):
        stored = {"election_eligibility": {"rules": {"attendance": {"mode": "?"}}}}
        assert _eligibility_defaults(stored) == EligibilityDefaults()

    def test_tier_rules_report_what_the_ballot_check_applies(self):
        rules = _tier_voting_rules(
            {
                "membership_tiers": {
                    "tiers": [
                        {
                            "id": "probationary",
                            "name": "Probationary",
                            "benefits": {"voting_eligible": False},
                        },
                        {
                            "id": "active",
                            "name": "Active",
                            "benefits": {
                                "voting_requires_meeting_attendance": True,
                                "voting_min_attendance_pct": 50,
                                "voting_attendance_period_months": 12,
                            },
                        },
                        {"id": "life"},
                    ]
                }
            }
        )
        assert rules == [
            {
                "tier_id": "probationary",
                "name": "Probationary",
                "voting_eligible": False,
                "requires_meeting_attendance": False,
                "min_attendance_pct": 0.0,
                "attendance_period_months": 12,
            },
            {
                "tier_id": "active",
                "name": "Active",
                "voting_eligible": True,
                "requires_meeting_attendance": True,
                "min_attendance_pct": 50.0,
                "attendance_period_months": 12,
            },
            {
                "tier_id": "life",
                "name": "life",
                "voting_eligible": True,
                "requires_meeting_attendance": False,
                "min_attendance_pct": 0.0,
                "attendance_period_months": 12,
            },
        ]


# ---------------------------------------------------------------------------
# Settings endpoints (mocked organization)
# ---------------------------------------------------------------------------


def _settings_db(org_settings):
    organization = Mock(settings=org_settings)
    result = Mock()
    result.scalar_one_or_none.return_value = organization
    db = Mock()
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    return db, organization


@pytest.mark.unit
class TestSettingsEndpoints:
    async def test_get_reports_built_in_defaults_when_nothing_is_stored(self):
        db, _ = _settings_db({})
        response = await get_election_settings(db=db, current_user=Mock())
        assert response["eligibility"] == EligibilityDefaults().model_dump()
        assert response["tier_voting_rules"] == []

    async def test_patch_stores_eligibility_and_leaves_other_settings_alone(self):
        db, organization = _settings_db(
            {"proxy_voting": {"enabled": True, "max_proxies_per_person": 3}}
        )
        payload = {
            "rules": COUNT_2_OF_3,
            "default_require_attendance": False,
            "default_voter_types": ["regular", "life"],
            "position_voter_types": {"Chief": ["operational"]},
        }
        response = await update_election_settings(
            settings_update=ElectionSettingsUpdate.model_validate(
                {"eligibility": payload}
            ),
            db=db,
            current_user=Mock(),
        )
        stored = organization.settings["election_eligibility"]
        assert stored["rules"]["attendance"]["min_meetings"] == 2
        assert stored["default_require_attendance"] is False
        assert stored["position_voter_types"] == {"Chief": ["operational"]}
        assert organization.settings["proxy_voting"]["max_proxies_per_person"] == 3
        assert response["eligibility"]["default_voter_types"] == ["regular", "life"]

    async def test_patch_without_eligibility_keeps_the_stored_value(self):
        stored = EligibilityDefaults(default_require_attendance=False).model_dump()
        db, organization = _settings_db({"election_eligibility": stored})
        await update_election_settings(
            settings_update=ElectionSettingsUpdate(proxy_voting_enabled=True),
            db=db,
            current_user=Mock(),
        )
        assert organization.settings["election_eligibility"] == stored


# ---------------------------------------------------------------------------
# Database-backed behaviour
# ---------------------------------------------------------------------------


async def _org(db, eligibility=None):
    settings = {"election_eligibility": eligibility} if eligibility else {}
    org = Organization(
        name="Eligibility FD",
        slug=f"elig-{uuid.uuid4().hex[:8]}",
        settings=settings,
    )
    db.add(org)
    await db.flush()
    return org


async def _member(db, org, tag, hire_date=None):
    user = User(
        organization_id=org.id,
        username=f"{tag}-{uuid.uuid4().hex[:8]}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@example.org",
        first_name=tag.capitalize(),
        last_name="Member",
        hire_date=hire_date,
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    return user


async def _meetings(db, org, dates, meeting_type=MeetingType.BUSINESS):
    meetings = [
        Meeting(
            organization_id=org.id,
            title=f"Meeting {d}",
            meeting_date=d,
            meeting_type=meeting_type,
        )
        for d in dates
    ]
    db.add_all(meetings)
    await db.flush()
    return meetings


async def _attend(db, org, member, meetings):
    db.add_all(
        MeetingAttendee(
            organization_id=org.id, meeting_id=m.id, user_id=member.id, present=True
        )
        for m in meetings
    )
    await db.flush()


async def _election(db, org, creator, rules, status=ElectionStatus.OPEN, **extra):
    now = datetime.now(timezone.utc)
    election = Election(
        organization_id=org.id,
        title="Chief 2026",
        positions=["Chief"],
        start_date=now - timedelta(days=1),
        end_date=now + timedelta(days=1),
        status=status,
        created_by=creator.id,
        voter_anonymity_salt=uuid.uuid4().hex,
        eligibility_rules=rules,
        **extra,
    )
    db.add(election)
    await db.flush()
    return election


@pytest.fixture
async def attendance_org(db_session):
    """Three monthly business meetings before today. ``steady`` attended the
    last two, ``lapsed`` only the first; both joined years ago."""
    org = await _org(db_session)
    today = org_today(org)
    steady = await _member(db_session, org, "steady", date(2010, 1, 1))
    lapsed = await _member(db_session, org, "lapsed", date(2010, 1, 1))
    meetings = await _meetings(
        db_session, org, [today - relativedelta(months=k) for k in (3, 2, 1)]
    )
    await _attend(db_session, org, steady, meetings[1:])
    await _attend(db_session, org, lapsed, meetings[:1])
    return SimpleNamespace(org=org, steady=steady, lapsed=lapsed, today=today)


@pytest.mark.integration
class TestAttendanceCountRule:
    async def test_the_ballot_check_applies_the_rule(self, db_session, attendance_org):
        ns = attendance_org
        election = await _election(db_session, ns.org, ns.steady, COUNT_2_OF_3)
        service = ElectionService(db_session)

        steady = await service.check_voter_eligibility(
            ns.steady.id, election.id, ns.org.id
        )
        lapsed = await service.check_voter_eligibility(
            ns.lapsed.id, election.id, ns.org.id
        )

        assert steady.is_eligible is True
        assert lapsed.is_eligible is False
        assert lapsed.reason == "Attended 1 of the last 3 meetings; 2 required to vote"

    async def test_the_roster_agrees_with_the_ballot_check(
        self, db_session, attendance_org
    ):
        ns = attendance_org
        election = await _election(db_session, ns.org, ns.steady, COUNT_2_OF_3)

        roster = await ElectionService(db_session).get_eligibility_roster(
            election.id, ns.org.id
        )
        by_id = {r["user_id"]: r for r in roster["roster"]}

        assert by_id[str(ns.steady.id)]["will_receive_ballot"] is True
        lapsed = by_id[str(ns.lapsed.id)]
        assert lapsed["will_receive_ballot"] is False
        assert lapsed["ineligibility_reason"] == (
            "Attended 1 of the last 3 meetings; 2 required to vote"
        )

    async def test_the_rule_applies_to_ballot_items_too(
        self, db_session, attendance_org
    ):
        ns = attendance_org
        item = {
            "id": "motion-1",
            "type": "general_vote",
            "title": "Budget",
            "eligible_voter_types": ["all"],
            "vote_type": "approval",
            "require_attendance": False,
        }
        election = await _election(
            db_session, ns.org, ns.steady, COUNT_2_OF_3, ballot_items=[item]
        )
        annotated = await ElectionService(db_session).annotate_ballot_items_for_user(
            ns.lapsed, election, str(ns.org.id)
        )
        assert annotated[0]["eligibility"] == {
            "eligible": False,
            "reason": "Attended 1 of the last 3 meetings; 2 required to vote",
        }

    async def test_a_voter_override_bypasses_the_rule(self, db_session, attendance_org):
        ns = attendance_org
        election = await _election(
            db_session,
            ns.org,
            ns.steady,
            COUNT_2_OF_3,
            voter_overrides=[{"user_id": str(ns.lapsed.id), "reason": "excused"}],
        )
        result = await ElectionService(db_session).check_voter_eligibility(
            ns.lapsed.id, election.id, ns.org.id
        )
        assert result.is_eligible is True

    async def test_a_member_on_the_frozen_roll_keeps_their_ballot(
        self, db_session, attendance_org
    ):
        # The roll was drawn when voting opened; a meeting held since that
        # the member missed must not take the in-app ballot away while their
        # emailed link, which carries the send-time snapshot, still works.
        ns = attendance_org
        election = await _election(
            db_session,
            ns.org,
            ns.steady,
            COUNT_2_OF_3,
            eligible_roster_snapshot=[str(ns.lapsed.id)],
        )
        result = await ElectionService(db_session).check_voter_eligibility(
            ns.lapsed.id, election.id, ns.org.id
        )
        assert result.is_eligible is True

    async def test_the_turnout_denominator_excludes_members_who_fail(
        self, db_session, attendance_org
    ):
        ns = attendance_org
        election = await _election(
            db_session, ns.org, ns.steady, COUNT_2_OF_3, status=ElectionStatus.DRAFT
        )
        count = await ElectionService(db_session)._count_eligible_voters(
            election, ns.org.id
        )
        assert count == 1

    async def test_an_election_without_rules_is_unchanged(
        self, db_session, attendance_org
    ):
        # Every election that predates the column has NULL here.
        ns = attendance_org
        election = await _election(db_session, ns.org, ns.steady, None)
        result = await ElectionService(db_session).check_voter_eligibility(
            ns.lapsed.id, election.id, ns.org.id
        )
        assert result.is_eligible is True

    async def test_only_the_listed_meeting_types_count(
        self, db_session, attendance_org
    ):
        ns = attendance_org
        # Two recent committee meetings ``lapsed`` attended; a business-only
        # rule must not credit them.
        committee = await _meetings(
            db_session,
            ns.org,
            [ns.today - timedelta(days=3), ns.today - timedelta(days=2)],
            MeetingType.COMMITTEE,
        )
        await _attend(db_session, ns.org, ns.lapsed, committee)
        any_meeting = await _election(db_session, ns.org, ns.steady, COUNT_2_OF_3)
        business_only = await _election(
            db_session,
            ns.org,
            ns.steady,
            {
                "attendance": {
                    **COUNT_2_OF_3["attendance"],
                    "meeting_types": ["business"],
                }
            },
        )
        service = ElectionService(db_session)
        assert (
            await service.check_voter_eligibility(
                ns.lapsed.id, any_meeting.id, ns.org.id
            )
        ).is_eligible is True
        assert (
            await service.check_voter_eligibility(
                ns.lapsed.id, business_only.id, ns.org.id
            )
        ).is_eligible is False


@pytest.mark.integration
class TestAttendancePercentRule:
    async def test_percent_rule(self, db_session, attendance_org):
        ns = attendance_org
        rules = {"attendance": {"mode": "percent", "min_pct": 60, "period_months": 12}}
        election = await _election(db_session, ns.org, ns.steady, rules)
        service = ElectionService(db_session)

        assert (
            await service.check_voter_eligibility(ns.steady.id, election.id, ns.org.id)
        ).is_eligible is True
        lapsed = await service.check_voter_eligibility(
            ns.lapsed.id, election.id, ns.org.id
        )
        assert lapsed.is_eligible is False
        assert lapsed.reason == (
            "Meeting attendance is 33.3% over the last 12 months; 60% required to vote"
        )


def _waits(**periods):
    return {"attendance": {"mode": "none"}, "waiting_periods": periods}


ADMIN_A_YEAR = {"mode": "months", "months": 12}
NEVER = {"mode": "never"}


async def _typed_member(db, org, tag, member_class, member_status, since=None):
    """A member of one type who became it ``since`` (a datetime)."""
    user = await _member(db, org, tag, date(2010, 1, 1))
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


def _ago(**kw):
    return datetime.now(timezone.utc) - relativedelta(**kw)


@pytest.mark.integration
class TestWaitingPeriods:
    async def _check(self, db, member, election, org):
        return await ElectionService(db).check_voter_eligibility(
            member.id, election.id, org.id
        )

    async def test_a_type_that_may_never_vote_is_refused(self, db_session):
        org = await _org(db_session)
        probie = await _typed_member(
            db_session, org, "probie", "operational", "probationary", _ago(years=3)
        )
        election = await _election(db_session, org, probie, _waits(probationary=NEVER))

        result = await self._check(db_session, probie, election, org)
        assert result.is_eligible is False
        assert result.reason == "Probationary members are not eligible to vote"

    async def test_a_wait_counts_from_becoming_the_type(self, db_session):
        org = await _org(db_session)
        recent = await _typed_member(
            db_session, org, "recent", "administrative", "regular", _ago(months=2)
        )
        settled = await _typed_member(
            db_session, org, "settled", "administrative", "regular", _ago(months=13)
        )
        election = await _election(
            db_session, org, settled, _waits(administrative=ADMIN_A_YEAR)
        )

        assert (await self._check(db_session, settled, election, org)).is_eligible
        result = await self._check(db_session, recent, election, org)
        assert result.is_eligible is False
        assert result.reason.startswith(
            "Administrative members may vote 12 months after becoming "
            "administrative; eligible from "
        )

    async def test_class_decides_before_status(self, db_session):
        # An administrative probationer is judged by the administrative rule.
        org = await _org(db_session)
        member = await _typed_member(
            db_session,
            org,
            "adminprobie",
            "administrative",
            "probationary",
            _ago(years=2),
        )
        election = await _election(
            db_session,
            org,
            member,
            _waits(administrative=ADMIN_A_YEAR, probationary=NEVER),
        )
        assert (await self._check(db_session, member, election, org)).is_eligible

    async def test_types_without_a_rule_are_unaffected(self, db_session):
        org = await _org(db_session)
        lifer = await _typed_member(
            db_session, org, "lifer", "operational", "life", _ago(days=1)
        )
        election = await _election(
            db_session, org, lifer, _waits(administrative=ADMIN_A_YEAR)
        )
        assert (await self._check(db_session, lifer, election, org)).is_eligible

    async def test_a_corrected_start_date_moves_the_wait(self, db_session):
        org = await _org(db_session)
        member = await _typed_member(
            db_session, org, "corrected", "administrative", "regular", _ago(months=1)
        )
        member.voting_wait_from = date.today() - relativedelta(years=2)
        member.voting_wait_override_reason = "Administrative since 2024 per minutes"
        await db_session.flush()
        election = await _election(
            db_session, org, member, _waits(administrative=ADMIN_A_YEAR)
        )
        assert (await self._check(db_session, member, election, org)).is_eligible

    async def test_a_waiver_lifts_the_wait_but_not_never(self, db_session):
        org = await _org(db_session)
        admin = await _typed_member(
            db_session, org, "waivedadmin", "administrative", "regular", _ago(days=3)
        )
        probie = await _typed_member(
            db_session, org, "waivedprobie", "operational", "probationary"
        )
        for member in (admin, probie):
            member.voting_wait_waived = True
            member.voting_wait_override_reason = "Board vote 2026-10-01"
        await db_session.flush()
        election = await _election(
            db_session,
            org,
            admin,
            _waits(administrative=ADMIN_A_YEAR, probationary=NEVER),
        )
        assert (await self._check(db_session, admin, election, org)).is_eligible
        assert not (await self._check(db_session, probie, election, org)).is_eligible

    async def test_a_waiver_does_not_lift_attendance(self, db_session):
        org = await _org(db_session)
        today = org_today(org)
        admin = await _typed_member(
            db_session, org, "waivedabsent", "administrative", "regular", _ago(days=3)
        )
        admin.voting_wait_waived = True
        admin.voting_wait_override_reason = "Board vote"
        await _meetings(
            db_session, org, [today - relativedelta(months=k) for k in (3, 2, 1)]
        )
        await db_session.flush()
        election = await _election(
            db_session,
            org,
            admin,
            {**COUNT_2_OF_3, "waiting_periods": {"administrative": ADMIN_A_YEAR}},
        )
        result = await self._check(db_session, admin, election, org)
        assert result.is_eligible is False
        assert result.reason.startswith("Attended 0 of the last 3 meetings")

    async def test_the_wait_never_reaches_back_before_a_rejoin(self, db_session):
        org = await _org(db_session)
        member = await _typed_member(
            db_session, org, "rejoined", "administrative", "regular", _ago(years=5)
        )
        member.hire_date = date.today() - relativedelta(months=3)
        await db_session.flush()
        election = await _election(
            db_session, org, member, _waits(administrative=ADMIN_A_YEAR)
        )
        assert not (await self._check(db_session, member, election, org)).is_eligible

    async def test_no_recorded_date_is_not_a_reason_to_refuse(self, db_session):
        org = await _org(db_session)
        member = await _typed_member(
            db_session, org, "undated", "administrative", "regular"
        )
        member.hire_date = None
        member.member_class_since = None
        member.member_status_since = None
        await db_session.flush()
        election = await _election(
            db_session, org, member, _waits(administrative=ADMIN_A_YEAR)
        )
        assert (await self._check(db_session, member, election, org)).is_eligible

    async def test_the_roster_agrees_with_the_ballot_check(self, db_session):
        org = await _org(db_session)
        recent = await _typed_member(
            db_session, org, "rosterrecent", "administrative", "regular", _ago(days=5)
        )
        election = await _election(
            db_session,
            org,
            recent,
            _waits(administrative=ADMIN_A_YEAR),
            status=ElectionStatus.DRAFT,
        )
        roster = await ElectionService(db_session).get_eligibility_roster(
            election.id, org.id
        )
        row = next(r for r in roster["roster"] if r["user_id"] == str(recent.id))
        assert row["will_receive_ballot"] is False
        assert row["ineligibility_reason"].startswith("Administrative members may vote")

    async def _tier_org(self, db, ranks_as):
        org = await _org(db)
        tier = {"id": "cadet", "name": "Cadet", "sort_order": 0}
        if ranks_as:
            tier["ranks_as"] = ranks_as
        org.settings = {"membership_tiers": {"tiers": [tier]}}
        await db.flush()
        return org

    async def test_a_tier_takes_the_wait_of_the_status_it_counts_as(self, db_session):
        # The same "Counts as" that decides who may vote decides the wait, so
        # one member is never a probationer for the ballot and typeless here.
        org = await self._tier_org(db_session, "probationary")
        cadet = await _typed_member(
            db_session, org, "cadet", "operational", "cadet", _ago(years=3)
        )
        election = await _election(db_session, org, cadet, _waits(probationary=NEVER))
        result = await self._check(db_session, cadet, election, org)
        assert result.is_eligible is False
        assert result.reason == "Probationary members are not eligible to vote"

        roster = await ElectionService(db_session).get_eligibility_roster(
            election.id, org.id
        )
        row = next(r for r in roster["roster"] if r["user_id"] == str(cadet.id))
        assert row["will_receive_ballot"] is False

    async def test_a_tier_that_counts_as_nothing_has_no_wait(self, db_session):
        org = await self._tier_org(db_session, None)
        cadet = await _typed_member(
            db_session, org, "cadetfree", "operational", "cadet", _ago(days=3)
        )
        election = await _election(db_session, org, cadet, _waits(probationary=NEVER))
        assert (await self._check(db_session, cadet, election, org)).is_eligible


@pytest.mark.integration
class TestCreateAndUpdate:
    def _payload(self, **extra):
        now = datetime.now(timezone.utc)
        return {
            "title": "Officers 2027",
            "positions": ["chief", "Secretary"],
            "start_date": now + timedelta(days=1),
            "end_date": now + timedelta(days=2),
            **extra,
        }

    async def _admin_org(self, db_session):
        org = await _org(
            db_session,
            {
                "rules": COUNT_2_OF_3,
                "default_require_attendance": True,
                "default_voter_types": ["all"],
                "position_voter_types": {"Chief": ["operational"]},
            },
        )
        admin = await _member(db_session, org, "secretary", date(2010, 1, 1))
        return org, admin

    async def test_a_new_election_copies_the_departments_defaults(self, db_session):
        org, admin = await self._admin_org(db_session)
        response = await create_election(
            election=ElectionCreate.model_validate(self._payload()),
            db=db_session,
            current_user=admin,
        )
        assert response.eligibility_rules is not None
        assert response.eligibility_rules.model_dump() == {
            "attendance": {
                "mode": "count",
                "min_meetings": 2,
                "of_last_meetings": 3,
                "min_pct": None,
                "period_months": None,
                "meeting_types": None,
            },
            "waiting_periods": {},
        }
        # "chief" matches the configured "Chief"; Secretary is not configured.
        assert {k: v.voter_types for k, v in response.position_eligibility.items()} == {
            "chief": ["operational"]
        }

    async def test_an_explicit_null_means_no_rules(self, db_session):
        org, admin = await self._admin_org(db_session)
        response = await create_election(
            election=ElectionCreate.model_validate(
                self._payload(eligibility_rules=None)
            ),
            db=db_session,
            current_user=admin,
        )
        assert response.eligibility_rules is None

    async def test_explicit_position_rules_win(self, db_session):
        org, admin = await self._admin_org(db_session)
        response = await create_election(
            election=ElectionCreate.model_validate(
                self._payload(position_eligibility={"chief": {"voter_types": ["all"]}})
            ),
            db=db_session,
            current_user=admin,
        )
        assert response.position_eligibility["chief"].voter_types == ["all"]

    async def test_changing_the_defaults_leaves_existing_elections_alone(
        self, db_session
    ):
        org, admin = await self._admin_org(db_session)
        response = await create_election(
            election=ElectionCreate.model_validate(self._payload()),
            db=db_session,
            current_user=admin,
        )
        org.settings = {"election_eligibility": EligibilityDefaults().model_dump()}
        await db_session.flush()
        election = await db_session.get(Election, str(response.id))
        assert election.eligibility_rules["attendance"]["mode"] == "count"
        assert election.eligibility_rules["attendance"]["min_meetings"] == 2

    async def test_a_draft_election_can_change_its_rules(self, db_session):
        org, admin = await self._admin_org(db_session)
        election = await _election(
            db_session, org, admin, COUNT_2_OF_3, status=ElectionStatus.DRAFT
        )
        response = await update_election(
            election_id=election.id,
            election_update=ElectionUpdate.model_validate(
                {
                    "eligibility_rules": {
                        "attendance": {"mode": "none"},
                        "waiting_periods": {
                            "administrative": {"mode": "months", "months": 12}
                        },
                    }
                }
            ),
            db=db_session,
            current_user=admin,
        )
        assert response.eligibility_rules.waiting_periods["administrative"].months == 12

    async def test_an_open_election_cannot_change_its_rules(self, db_session):
        org, admin = await self._admin_org(db_session)
        election = await _election(db_session, org, admin, COUNT_2_OF_3)
        with pytest.raises(HTTPException) as exc:
            await update_election(
                election_id=election.id,
                election_update=ElectionUpdate.model_validate(
                    {"eligibility_rules": None}
                ),
                db=db_session,
                current_user=admin,
            )
        assert exc.value.status_code == 400
        assert election.eligibility_rules == COUNT_2_OF_3


# ---------------------------------------------------------------------------
# Regular business meetings and the annual meeting
# ---------------------------------------------------------------------------

ANNUAL_DEFAULTS = {
    "rules": {
        "attendance": {"mode": "count", "min_meetings": 3, "of_last_meetings": 3},
        "waiting_periods": {"administrative": {"mode": "months", "months": 12}},
    },
    "default_require_attendance": True,
    "default_voter_types": ["all"],
    "position_voter_types": {"Secretary": ["regular", "life"]},
}


@pytest.mark.unit
class TestMeetingKindSchema:
    def test_unknown_kind_is_refused(self):
        with pytest.raises(ValidationError, match="meeting kind"):
            ElectionUpdate.model_validate({"meeting_kind": "quarterly"})

    def test_kind_cannot_be_cleared(self):
        with pytest.raises(ValidationError):
            ElectionUpdate.model_validate({"meeting_kind": None})


@pytest.mark.unit
class TestAnnualSettings:
    async def test_get_reports_no_annual_defaults_until_set(self):
        db, _ = _settings_db({})
        response = await get_election_settings(db=db, current_user=Mock())
        assert response["annual_eligibility"] is None

    async def test_patch_stores_and_clears_the_annual_defaults(self):
        db, organization = _settings_db({})
        response = await update_election_settings(
            settings_update=ElectionSettingsUpdate.model_validate(
                {"annual_eligibility": ANNUAL_DEFAULTS}
            ),
            db=db,
            current_user=Mock(),
        )
        assert (
            organization.settings["election_eligibility_annual"]["rules"][
                "waiting_periods"
            ]["administrative"]["months"]
            == 12
        )
        assert response["annual_eligibility"]["position_voter_types"] == {
            "Secretary": ["regular", "life"]
        }

        # null means "the annual meeting uses the regular defaults"
        response = await update_election_settings(
            settings_update=ElectionSettingsUpdate.model_validate(
                {"annual_eligibility": None}
            ),
            db=db,
            current_user=Mock(),
        )
        assert "election_eligibility_annual" not in organization.settings
        assert response["annual_eligibility"] is None


@pytest.mark.integration
class TestMeetingKind:
    def _payload(self, **extra):
        now = datetime.now(timezone.utc)
        return {
            "title": "Officers 2027",
            "positions": ["Chief", "Secretary"],
            "start_date": now + timedelta(days=1),
            "end_date": now + timedelta(days=2),
            **extra,
        }

    async def _org_with(self, db_session, annual=True):
        org = await _org(
            db_session,
            {
                "rules": COUNT_2_OF_3,
                "default_require_attendance": True,
                "default_voter_types": ["all"],
                "position_voter_types": {"Chief": ["operational"]},
            },
        )
        if annual:
            org.settings = {
                **org.settings,
                "election_eligibility_annual": ANNUAL_DEFAULTS,
            }
            await db_session.flush()
        admin = await _member(db_session, org, "secretary", date(2010, 1, 1))
        return org, admin

    async def _create(self, db_session, admin, **extra):
        return await create_election(
            election=ElectionCreate.model_validate(self._payload(**extra)),
            db=db_session,
            current_user=admin,
        )

    async def test_an_annual_election_copies_the_annual_defaults(self, db_session):
        org, admin = await self._org_with(db_session)
        response = await self._create(db_session, admin, meeting_kind="annual")

        assert response.meeting_kind == "annual"
        assert response.eligibility_rules.waiting_periods["administrative"].months == 12
        assert response.eligibility_rules.attendance.min_meetings == 3
        assert {k: v.voter_types for k, v in response.position_eligibility.items()} == {
            "Secretary": ["regular", "life"]
        }

    async def test_a_regular_election_ignores_the_annual_defaults(self, db_session):
        org, admin = await self._org_with(db_session)
        response = await self._create(db_session, admin)

        assert response.meeting_kind == "regular"
        assert response.eligibility_rules.attendance.min_meetings == 2
        assert set(response.position_eligibility) == {"Chief"}

    async def test_the_kind_follows_a_linked_annual_meeting(self, db_session):
        org, admin = await self._org_with(db_session)
        [annual_meeting] = await _meetings(
            db_session, org, [date(2027, 1, 15)], MeetingType.ANNUAL
        )
        response = await self._create(
            db_session, admin, meeting_id=str(annual_meeting.id)
        )
        assert response.meeting_kind == "annual"
        assert response.eligibility_rules.waiting_periods["administrative"].months == 12

    async def test_an_explicit_kind_wins_over_the_linked_meeting(self, db_session):
        org, admin = await self._org_with(db_session)
        [annual_meeting] = await _meetings(
            db_session, org, [date(2027, 1, 15)], MeetingType.ANNUAL
        )
        response = await self._create(
            db_session,
            admin,
            meeting_id=str(annual_meeting.id),
            meeting_kind="regular",
        )
        assert response.meeting_kind == "regular"

    async def test_without_annual_defaults_the_annual_meeting_uses_the_regular_ones(
        self, db_session
    ):
        org, admin = await self._org_with(db_session, annual=False)
        response = await self._create(db_session, admin, meeting_kind="annual")

        assert response.meeting_kind == "annual"
        assert response.eligibility_rules.attendance.min_meetings == 2

    async def test_changing_the_kind_reapplies_that_kinds_rules(self, db_session):
        org, admin = await self._org_with(db_session)
        created = await self._create(db_session, admin)

        response = await update_election(
            election_id=created.id,
            election_update=ElectionUpdate(meeting_kind="annual"),
            db=db_session,
            current_user=admin,
        )
        assert response.meeting_kind == "annual"
        assert response.eligibility_rules.waiting_periods["administrative"].months == 12
        # The regular meeting's Chief rule does not survive the move.
        assert set(response.position_eligibility) == {"Secretary"}

    async def test_rules_sent_with_the_kind_change_win(self, db_session):
        org, admin = await self._org_with(db_session)
        created = await self._create(db_session, admin)

        response = await update_election(
            election_id=created.id,
            election_update=ElectionUpdate.model_validate(
                {"meeting_kind": "annual", "eligibility_rules": None}
            ),
            db=db_session,
            current_user=admin,
        )
        assert response.meeting_kind == "annual"
        assert response.eligibility_rules is None

    async def test_an_open_election_cannot_change_its_kind(self, db_session):
        org, admin = await self._org_with(db_session)
        election = await _election(db_session, org, admin, COUNT_2_OF_3)
        with pytest.raises(HTTPException) as exc:
            await update_election(
                election_id=election.id,
                election_update=ElectionUpdate(meeting_kind="annual"),
                db=db_session,
                current_user=admin,
            )
        assert exc.value.status_code == 400
        assert election.meeting_kind == "regular"

    async def test_an_existing_election_reads_as_regular(self, db_session):
        # A row written without the column — as every row before the
        # migration was — takes the server default.
        org, admin = await self._org_with(db_session)
        election_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        await db_session.execute(
            text(
                "INSERT INTO elections (id, organization_id, title, election_type, "
                "start_date, end_date, status, anonymous_voting, allow_write_ins, "
                "max_votes_per_position, voting_method, victory_condition, "
                "quorum_type, email_sent, results_visible_immediately, "
                "enable_runoffs, runoff_type, max_runoff_rounds, is_runoff, "
                "runoff_round, created_at, updated_at) VALUES (:id, :org, "
                "'Legacy', 'general', :start, :end, 'draft', 1, 0, 1, "
                "'simple_majority', 'most_votes', 'none', 0, 0, 0, 'top_two', "
                "3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org.id,
                "start": now + timedelta(days=1),
                "end": now + timedelta(days=2),
            },
        )
        result = await db_session.execute(
            text("SELECT meeting_kind FROM elections WHERE id = :id"),
            {"id": election_id},
        )
        assert result.scalar_one() == "regular"


# ---------------------------------------------------------------------------
# _get_ineligibility_reason_for_user agrees with the real gate
# (security review ELEC-06, pass 14)
# ---------------------------------------------------------------------------


class TestIneligibilityReasonUsesTheSharedGate:
    """The skipped-recipient message (ballot send, eligibility roster) is
    built from ``_universal_gate`` rather than its own copy of the
    override/tier check, so it can never disagree with the real decision in
    ``annotate_ballot_items_for_user`` — and a malformed stored tier value
    degrades instead of 500ing the admin's screen.
    """

    @pytest.mark.unit
    async def test_a_non_dict_membership_tiers_setting_does_not_crash(self):
        # A malformed org.settings["membership_tiers"] (any non-dict value)
        # used to reach a bare `.get("tiers", [])` and raise AttributeError,
        # taking down the ballot-send/eligibility-roster request for the
        # whole org instead of degrading the way _tier_benefits already does.
        db = Mock()
        svc = ElectionService(db)
        user = Mock(id="u1", membership_type="active")
        org = Mock(settings={"membership_tiers": "not-a-dict"})
        election = Mock(
            ballot_items=[{"id": "i1", "title": "T", "eligible_voter_types": ["all"]}],
            voter_overrides=None,
            eligibility_rules=None,
        )

        reason = await svc._get_ineligibility_reason_for_user(
            user, election, "org-1", org
        )

        assert reason is None

    @pytest.mark.unit
    async def test_a_voting_ineligible_tier_reports_through_the_shared_gate(self):
        db = Mock()
        svc = ElectionService(db)
        user = Mock(id="u1", membership_type="probationary")
        org = Mock(
            settings={
                "membership_tiers": {
                    "tiers": [
                        {
                            "id": "probationary",
                            "name": "Probationary",
                            "benefits": {"voting_eligible": False},
                        }
                    ]
                }
            }
        )
        election = Mock(
            ballot_items=[{"id": "i1", "title": "T", "eligible_voter_types": ["all"]}],
            voter_overrides=None,
            eligibility_rules=None,
        )

        reason = await svc._get_ineligibility_reason_for_user(
            user, election, "org-1", org
        )

        assert reason == "Membership tier 'Probationary' is not eligible to vote"

    @pytest.mark.unit
    async def test_a_voter_override_still_short_circuits(self):
        db = Mock()
        svc = ElectionService(db)
        user = Mock(id="u1", membership_type="probationary")
        org = Mock(
            settings={
                "membership_tiers": {
                    "tiers": [
                        {
                            "id": "probationary",
                            "name": "Probationary",
                            "benefits": {"voting_eligible": False},
                        }
                    ]
                }
            }
        )
        election = Mock(
            ballot_items=[{"id": "i1", "title": "T", "eligible_voter_types": ["all"]}],
            voter_overrides=[{"user_id": "u1"}],
            eligibility_rules=None,
        )

        reason = await svc._get_ineligibility_reason_for_user(
            user, election, "org-1", org
        )

        assert reason is None
