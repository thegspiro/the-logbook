"""Per-member-type voting waiting periods: when a member became their type,
the pure wait helpers, the secretary's per-member override, and the migration
that adds and backfills the columns.

The election-level behaviour (the ballot check, roster and waiver) is covered
in ``test_election_eligibility_rules.py``.
"""

import importlib.util
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints.elections import (
    get_member_voting_eligibility,
    update_member_voting_eligibility,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.election import (
    ElectionEligibilityRules,
    ElectionEligibilityRulesRead,
    MemberVotingEligibilityUpdate,
)
from app.services.membership_tier_service import (
    evaluate_wait,
    type_wait_start,
    wait_ineligibility_reason,
)
from app.utils.membership import voter_type_key
from app.utils.org_timezone import org_today

UTC = ZoneInfo("UTC")
TODAY = date(2026, 10, 29)
A_YEAR = {"administrative": {"mode": "months", "months": 12}}


@pytest.fixture(autouse=True)
def _no_audit_write(monkeypatch):
    monkeypatch.setattr("app.api.v1.endpoints.elections.log_audit_event", AsyncMock())


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestVoterTypeKey:
    @pytest.mark.parametrize(
        ("member_class", "member_status", "expected"),
        [
            ("administrative", "regular", "administrative"),
            # Class decides first: an administrative probationer is administrative.
            ("administrative", "probationary", "administrative"),
            ("social", "honorary", "social"),
            ("operational", "regular", "regular"),
            ("operational", "life", "life"),
            ("operational", "probationary", "probationary"),
            ("operational", "junior", "junior"),
            # Not a member yet: no rule applies.
            ("operational", "prospective", None),
        ],
    )
    def test_class_first_then_status(self, member_class, member_status, expected):
        assert voter_type_key(member_class, member_status) == expected

    def test_an_unreconciled_member_is_read_from_the_legacy_type(self):
        assert voter_type_key(None, None, "administrative") == "administrative"
        assert voter_type_key(None, None, "life") == "life"

    def test_a_custom_tier_has_no_type(self):
        assert voter_type_key(None, None, "senior") is None

    # A department tier on the ladder column takes the waiting period of the
    # built-in status its "Counts as" names -- the same resolution
    # `_user_has_role_type` uses for who may vote, so one member is never
    # "regular" for the ballot and typeless for the wait.
    def test_a_tier_that_counts_as_a_status_takes_that_status(self):
        ranks_as = {"senior": "regular", "cadet": "probationary"}
        assert voter_type_key("operational", "senior", None, ranks_as) == "regular"
        assert voter_type_key("operational", "cadet", None, ranks_as) == "probationary"

    def test_a_tier_with_no_counts_as_has_no_type(self):
        assert voter_type_key("operational", "senior", None, {}) is None
        assert voter_type_key("operational", "senior") is None

    def test_class_still_decides_before_a_tier(self):
        ranks_as = {"senior": "regular"}
        assert (
            voter_type_key("administrative", "senior", None, ranks_as)
            == "administrative"
        )

    def test_the_shipped_ladder_spelling_resolves(self):
        # The shipped `active` tier is stored as the `regular` status.
        assert voter_type_key("operational", "active") == "regular"


@pytest.mark.unit
class TestEvaluateWait:
    def test_no_rule_for_the_type(self):
        assert evaluate_wait(A_YEAR, "life", None, False, TODAY).state == "no_rule"

    def test_never(self):
        outcome = evaluate_wait(
            {"probationary": {"mode": "never"}}, "probationary", None, False, TODAY
        )
        assert outcome.state == "never"
        assert wait_ineligibility_reason(outcome) == (
            "Probationary members are not eligible to vote"
        )

    def test_still_waiting(self):
        outcome = evaluate_wait(
            A_YEAR, "administrative", date(2026, 3, 14), False, TODAY
        )
        assert outcome.state == "waiting"
        assert outcome.eligible_from == date(2027, 3, 14)
        assert wait_ineligibility_reason(outcome) == (
            "Administrative members may vote 12 months after becoming "
            "administrative; eligible from 14 March 2027"
        )

    def test_the_wait_ends_on_the_anniversary(self):
        outcome = evaluate_wait(
            A_YEAR, "administrative", date(2025, 10, 29), False, TODAY
        )
        assert outcome.state == "eligible"
        assert wait_ineligibility_reason(outcome) is None

    def test_a_waiver_lifts_a_wait_but_never_a_never(self):
        assert (
            evaluate_wait(A_YEAR, "administrative", TODAY, True, TODAY).state
            == "waived"
        )
        assert (
            evaluate_wait(
                {"probationary": {"mode": "never"}}, "probationary", None, True, TODAY
            ).state
            == "never"
        )

    def test_no_start_date_does_not_refuse(self):
        assert evaluate_wait(A_YEAR, "administrative", None, False, TODAY).state == (
            "eligible"
        )

    @pytest.mark.parametrize(
        "periods",
        [
            None,
            "administrative",
            {"administrative": "12"},
            {"administrative": {"mode": "months", "months": "12"}},
            {"administrative": {"mode": "months", "months": True}},
            {"administrative": {"mode": "weeks", "months": 12}},
        ],
    )
    def test_a_malformed_stored_rule_reads_as_no_rule(self, periods):
        assert evaluate_wait(periods, "administrative", TODAY, False, TODAY).state == (
            "no_rule"
        )


@pytest.mark.unit
class TestTypeWaitStart:
    def _member(self, **kw):
        base = dict(
            member_class="administrative",
            member_status="regular",
            membership_type="administrative",
            member_class_since=datetime(2024, 5, 1, 15, tzinfo=timezone.utc),
            member_status_since=datetime(2019, 1, 1, tzinfo=timezone.utc),
            hire_date=date(2010, 1, 1),
            voting_wait_from=None,
        )
        base.update(kw)
        return SimpleNamespace(**base)

    def test_a_class_type_counts_from_the_class_change(self):
        assert type_wait_start(self._member(), [], UTC) == date(2024, 5, 1)

    def test_a_status_type_counts_from_the_status_change(self):
        member = self._member(member_class="operational", membership_type="active")
        assert type_wait_start(member, [], UTC) == date(2019, 1, 1)

    def test_never_before_the_current_stint(self):
        member = self._member(hire_date=date(2025, 6, 1))
        assert type_wait_start(member, [], UTC) == date(2025, 6, 1)

    def test_the_secretarys_date_wins_outright(self):
        member = self._member(
            voting_wait_from=date(2001, 1, 1), hire_date=date(2025, 6, 1)
        )
        assert type_wait_start(member, [], UTC) == date(2001, 1, 1)

    def test_no_stamp_falls_back_to_the_stint(self):
        member = self._member(member_class_since=None)
        assert type_wait_start(member, [], UTC) == date(2010, 1, 1)


@pytest.mark.unit
class TestSchemas:
    def test_an_unknown_member_type_is_refused(self):
        with pytest.raises(ValidationError, match="Unknown member type"):
            ElectionEligibilityRules.model_validate(
                {"waiting_periods": {"captain": {"mode": "never"}}}
            )

    def test_months_mode_needs_months(self):
        with pytest.raises(ValidationError, match="number of months"):
            ElectionEligibilityRules.model_validate(
                {"waiting_periods": {"administrative": {"mode": "months"}}}
            )

    def test_no_wait_is_not_stored(self):
        rules = ElectionEligibilityRules.model_validate(
            {"waiting_periods": {"life": {"mode": "none"}, **A_YEAR}}
        )
        assert set(rules.waiting_periods) == {"administrative"}

    def test_a_stored_row_from_the_earlier_shape_still_reads(self):
        rules = ElectionEligibilityRulesRead.model_validate(
            {"attendance": {"mode": "none"}, "min_tenure_months": 6}
        )
        assert rules.waiting_periods == {}

    def test_the_waiver_cannot_be_nulled(self):
        with pytest.raises(ValidationError):
            MemberVotingEligibilityUpdate.model_validate({"voting_wait_waived": None})


# ---------------------------------------------------------------------------
# Stamps written by _reconcile_membership
# ---------------------------------------------------------------------------


async def _org(db, settings=None):
    org = Organization(
        name="Wait FD", slug=f"wait-{uuid.uuid4().hex[:8]}", settings=settings or {}
    )
    db.add(org)
    await db.flush()
    return org


async def _member(db, org, tag, **fields):
    user = User(
        organization_id=org.id,
        username=f"{tag}-{uuid.uuid4().hex[:8]}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@example.org",
        first_name=tag.capitalize(),
        last_name="Member",
        hire_date=date(2010, 1, 1),
        status=UserStatus.ACTIVE,
        **fields,
    )
    db.add(user)
    await db.flush()
    return user


BACKDATED = datetime(2020, 1, 1, tzinfo=timezone.utc)


@pytest.mark.integration
class TestMembershipSinceStamps:
    async def test_a_new_member_is_stamped(self, db_session):
        org = await _org(db_session)
        user = await _member(db_session, org, "fresh")
        assert user.member_class_since is not None
        assert user.member_status_since is not None

    async def test_a_status_change_restamps_only_the_status(self, db_session):
        org = await _org(db_session)
        user = await _member(
            db_session, org, "promoted", membership_type="probationary"
        )
        user.member_class_since = BACKDATED
        user.member_status_since = BACKDATED
        await db_session.flush()

        user.member_status = "regular"
        await db_session.flush()
        await db_session.refresh(user)

        assert user.member_status_since > BACKDATED
        assert user.member_class_since == BACKDATED

    async def test_a_legacy_type_write_restamps_the_class(self, db_session):
        org = await _org(db_session)
        user = await _member(db_session, org, "moved")
        user.member_class_since = BACKDATED
        await db_session.flush()

        user.membership_type = "administrative"
        await db_session.flush()
        await db_session.refresh(user)

        assert user.member_class == "administrative"
        assert user.member_class_since > BACKDATED

    async def test_resaving_the_same_type_keeps_the_date(self, db_session):
        org = await _org(db_session)
        user = await _member(db_session, org, "steady")
        user.member_status_since = BACKDATED
        await db_session.flush()

        user.member_status = "regular"
        user.first_name = "Renamed"
        await db_session.flush()
        await db_session.refresh(user)

        assert user.member_status_since == BACKDATED

    async def test_a_type_change_clears_a_corrected_start_date(self, db_session):
        org = await _org(db_session)
        user = await _member(db_session, org, "corrected")
        user.voting_wait_from = date(2019, 1, 1)
        user.voting_wait_override_reason = "Regular since 2019"
        await db_session.flush()

        user.member_class = "administrative"
        await db_session.flush()
        await db_session.refresh(user)

        assert user.voting_wait_from is None
        assert user.voting_wait_override_reason is None


# ---------------------------------------------------------------------------
# GET / PUT /elections/members/{id}/voting-eligibility
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestMemberVotingEligibilityEndpoints:
    async def _setup(self, db_session):
        org = await _org(
            db_session,
            {
                "election_eligibility": {
                    "rules": {"attendance": {"mode": "none"}, "waiting_periods": A_YEAR}
                }
            },
        )
        secretary = await _member(db_session, org, "secretary")
        member = await _member(
            db_session, org, "newadmin", member_class="administrative"
        )
        return org, secretary, member

    async def test_reports_the_wait_for_each_meeting_kind(self, db_session):
        org, secretary, member = await self._setup(db_session)
        response = await get_member_voting_eligibility(
            user_id=member.id, db=db_session, current_user=secretary
        )
        assert response.member_type == "administrative"
        assert response.member_type_label == "Administrative"
        assert [o.meeting_kind for o in response.outcomes] == ["regular", "annual"]
        # No annual set: the annual meeting uses the regular rules.
        assert {o.state for o in response.outcomes} == {"waiting"}
        assert response.outcomes[0].reason.startswith("Administrative members may vote")

    async def test_a_tier_member_is_reported_as_the_status_it_counts_as(
        self, db_session
    ):
        # The card resolves a department tier the way the ballot does.
        org = await _org(
            db_session,
            {
                "membership_tiers": {
                    "tiers": [
                        {"id": "cadet", "name": "Cadet", "ranks_as": "probationary"}
                    ]
                },
                "election_eligibility": {
                    "rules": {
                        "attendance": {"mode": "none"},
                        "waiting_periods": {"probationary": {"mode": "never"}},
                    }
                },
            },
        )
        secretary = await _member(db_session, org, "secretary")
        cadet = await _member(
            db_session, org, "cadet", member_class="operational", member_status="cadet"
        )
        response = await get_member_voting_eligibility(
            user_id=cadet.id, db=db_session, current_user=secretary
        )
        assert response.member_type == "probationary"
        assert {o.state for o in response.outcomes} == {"never"}

    async def test_another_organizations_member_is_not_found(self, db_session):
        org, secretary, _ = await self._setup(db_session)
        other_org = await _org(db_session)
        outsider = await _member(db_session, other_org, "outsider")
        with pytest.raises(HTTPException) as exc:
            await get_member_voting_eligibility(
                user_id=outsider.id, db=db_session, current_user=secretary
            )
        assert exc.value.status_code == 404
        with pytest.raises(HTTPException) as exc:
            await update_member_voting_eligibility(
                user_id=outsider.id,
                override=MemberVotingEligibilityUpdate(
                    voting_wait_waived=True, reason="x"
                ),
                db=db_session,
                current_user=secretary,
            )
        assert exc.value.status_code == 404

    async def test_an_override_needs_a_reason(self, db_session):
        org, secretary, member = await self._setup(db_session)
        with pytest.raises(HTTPException) as exc:
            await update_member_voting_eligibility(
                user_id=member.id,
                override=MemberVotingEligibilityUpdate(voting_wait_waived=True),
                db=db_session,
                current_user=secretary,
            )
        assert exc.value.status_code == 400
        assert member.voting_wait_waived is False

    async def test_waive_then_clear(self, db_session, monkeypatch):
        audit = AsyncMock()
        monkeypatch.setattr("app.api.v1.endpoints.elections.log_audit_event", audit)
        org, secretary, member = await self._setup(db_session)

        response = await update_member_voting_eligibility(
            user_id=member.id,
            override=MemberVotingEligibilityUpdate(
                voting_wait_waived=True, reason="Approved by the board"
            ),
            db=db_session,
            current_user=secretary,
        )
        assert response.voting_wait_waived is True
        assert response.voting_wait_override_reason == "Approved by the board"
        assert {o.state for o in response.outcomes} == {"waived"}
        event = audit.call_args.kwargs
        assert event["event_type"] == "member_voting_wait_override_changed"
        assert event["event_data"]["after"]["voting_wait_waived"] is True

        # Clearing needs no reason, and takes the reason with it.
        response = await update_member_voting_eligibility(
            user_id=member.id,
            override=MemberVotingEligibilityUpdate(voting_wait_waived=False),
            db=db_session,
            current_user=secretary,
        )
        assert response.voting_wait_waived is False
        assert response.voting_wait_override_reason is None

    async def test_a_corrected_date_is_set_and_cleared_with_null(self, db_session):
        org, secretary, member = await self._setup(db_session)
        response = await update_member_voting_eligibility(
            user_id=member.id,
            override=MemberVotingEligibilityUpdate(
                voting_wait_from=date(2020, 2, 1), reason="Administrative since 2020"
            ),
            db=db_session,
            current_user=secretary,
        )
        assert response.wait_starts == date(2020, 2, 1)
        assert {o.state for o in response.outcomes} == {"eligible"}

        response = await update_member_voting_eligibility(
            user_id=member.id,
            override=MemberVotingEligibilityUpdate.model_validate(
                {"voting_wait_from": None}
            ),
            db=db_session,
            current_user=secretary,
        )
        assert response.voting_wait_from is None
        assert {o.state for o in response.outcomes} == {"waiting"}

    async def test_a_date_after_the_departments_today_is_refused(self, db_session):
        # The date records when the member became their type. A future one
        # silently bars them until it passes and the wait runs out after it.
        org, secretary, member = await self._setup(db_session)
        today = org_today(org)
        with pytest.raises(HTTPException) as exc:
            await update_member_voting_eligibility(
                user_id=member.id,
                override=MemberVotingEligibilityUpdate(
                    voting_wait_from=today + timedelta(days=1), reason="Typo"
                ),
                db=db_session,
                current_user=secretary,
            )
        assert exc.value.status_code == 400
        assert member.voting_wait_from is None

        response = await update_member_voting_eligibility(
            user_id=member.id,
            override=MemberVotingEligibilityUpdate(
                voting_wait_from=today, reason="Became administrative today"
            ),
            db=db_session,
            current_user=secretary,
        )
        assert response.voting_wait_from == today


# ---------------------------------------------------------------------------
# Migration c7e2a91f4d36, run against rows
# ---------------------------------------------------------------------------

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
[MIGRATION] = sorted(VERSIONS.glob("*_c7e2a91f4d36_*.py"))


def _upgrade(engine):
    spec = importlib.util.spec_from_file_location("member_wait", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()


@pytest.fixture
def legacy_users():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE users (id TEXT PRIMARY KEY, hire_date DATE, "
                "membership_type_changed_at DATETIME)"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO users VALUES "
                "('hired', '2015-04-02', NULL), "
                "('promoted', '2015-04-02', '2021-06-30 14:00:00'), "
                "('undated', NULL, NULL)"
            )
        )
    yield engine
    engine.dispose()


def _rows(engine):
    with engine.connect() as connection:
        rows = connection.execute(
            sa.text(
                "SELECT id, member_class_since, member_status_since, "
                "voting_wait_waived FROM users"
            )
        )
        return {r[0]: (r[1], r[2], r[3]) for r in rows}


@pytest.mark.unit
class TestMigrationBackfill:
    def test_existing_members_get_a_best_guess(self, legacy_users):
        _upgrade(legacy_users)
        rows = _rows(legacy_users)
        assert rows["hired"][0].startswith("2015-04-02")
        assert rows["hired"][1].startswith("2015-04-02")
        # The last tier change is the better guess for the status.
        assert rows["promoted"][1].startswith("2021-06-30")
        assert rows["undated"][:2] == (None, None)
        assert {r[2] for r in rows.values()} == {0}

    def test_a_second_run_changes_nothing(self, legacy_users):
        _upgrade(legacy_users)
        before = _rows(legacy_users)
        _upgrade(legacy_users)
        assert _rows(legacy_users) == before

    def test_a_database_without_the_table_is_skipped(self):
        _upgrade(sa.create_engine("sqlite://"))
