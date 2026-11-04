"""
"Member since" reads credited service, not the hire date (owner decision
2026-11-01, "Use credited service where relevant").

A member who left and came back has a hire date that overstates how long they
have served. The screens that present length of membership -- the profile's
"Member since", the digital ID card and the printed one -- now show the date
credited service runs from (``service_since``), from the same summary tier
advancement reads (CLAUDE.md pitfall #29). For a member who never left that is
exactly the hire date, so nobody's card changes unless they had a break.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from pypdf import PdfReader

from app.api.v1.endpoints.users import get_user_with_roles
from app.models.user import MemberServicePeriod, Organization, User, UserStatus
from app.services.member_id_card_service import MemberIdCardService
from app.services.member_service_history_service import (
    MemberServiceHistoryService,
    service_since,
    summarize,
)

UTC = timezone.utc
HIRED = date(2010, 1, 1)
LEFT = date(2014, 12, 31)
BACK = date(2018, 1, 1)
# Credited service for "hired, left, came back, earlier years still count",
# expressed as the start an unbroken stint of the same length would have had.
CONTINUED_SINCE = BACK - (LEFT - HIRED)


def _member(**kw):
    return SimpleNamespace(
        id="u1",
        hire_date=kw.get("hire_date", HIRED),
        status=kw.get("status", UserStatus.ACTIVE),
        status_changed_at=kw.get("status_changed_at"),
    )


def _stint(start, end=None, counts=True, sep=None):
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        start_date=start,
        end_date=end,
        counts_toward_service=counts,
        separation_status=sep,
        notes=None,
    )


def _with_break(counts_earlier=True):
    return [
        _stint(None, LEFT, counts=counts_earlier, sep="dropped_voluntary"),
        _stint(BACK),
    ]


@pytest.mark.unit
class TestServiceSince:
    def test_a_member_who_never_left_is_a_member_since_their_hire_date(self):
        assert service_since(_member(), [], date(2026, 11, 4), UTC) == HIRED

    def test_earlier_service_that_counts_moves_the_date_by_the_time_away(self):
        since = service_since(_member(), _with_break(), date(2026, 11, 4), UTC)
        assert since == CONTINUED_SINCE
        assert since.year == 2013

    def test_a_restart_runs_from_the_rejoin_date(self):
        since = service_since(
            _member(), _with_break(counts_earlier=False), date(2026, 11, 4), UTC
        )
        assert since == BACK

    def test_it_is_the_summary_tier_advancement_reads(self):
        today = date(2026, 11, 4)
        periods = _with_break()
        assert (
            service_since(_member(), periods, today, UTC)
            == summarize(_member(), periods, today, UTC).effective_service_start
        )

    def test_it_does_not_move_while_the_member_serves(self):
        periods = _with_break()
        assert service_since(_member(), periods, date(2026, 11, 4), UTC) == (
            service_since(_member(), periods, date(2027, 3, 1), UTC)
        )

    def test_a_separated_members_date_stays_where_their_service_ended(self):
        member = _member(status=UserStatus.DROPPED_VOLUNTARY)
        periods = [_stint(None, date(2020, 6, 30), sep="dropped_voluntary")]
        first = service_since(member, periods, date(2026, 11, 4), UTC)
        assert first == HIRED
        assert service_since(member, periods, date(2027, 11, 4), UTC) == first

    def test_a_separated_member_with_no_stints_stays_at_their_hire_date(self):
        member = _member(
            status=UserStatus.RETIRED,
            status_changed_at=datetime(2024, 5, 1, 12, tzinfo=UTC),
        )
        assert service_since(member, [], date(2026, 11, 4), UTC) == HIRED
        assert service_since(member, [], date(2028, 1, 1), UTC) == HIRED

    def test_no_hire_date_and_no_stints_has_no_date(self):
        assert (
            service_since(_member(hire_date=None), [], date(2026, 11, 4), UTC) is None
        )


# ---------------------------------------------------------------------------
# The readers
# ---------------------------------------------------------------------------


async def _org(db) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Service Since VFD",
        slug=f"since-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org


async def _user(db, org, **overrides) -> User:
    handle = uuid.uuid4().hex[:10]
    fields = dict(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"u-{handle}",
        email=f"{handle}@example.org",
        first_name=overrides.pop("first_name", "Robin"),
        last_name="Hale",
        password_hash="x",
        status=UserStatus.ACTIVE,
        hire_date=HIRED,
    )
    fields.update(overrides)
    user = User(**fields)
    db.add(user)
    await db.flush()
    return user


async def _returned_member(db, org, **overrides) -> User:
    member = await _user(db, org, **overrides)
    db.add_all(
        [
            MemberServicePeriod(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                user_id=member.id,
                start_date=None,
                end_date=LEFT,
                separation_status="dropped_voluntary",
                counts_toward_service=True,
            ),
            MemberServicePeriod(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                user_id=member.id,
                start_date=BACK,
                end_date=None,
                counts_toward_service=True,
            ),
        ]
    )
    await db.flush()
    return member


async def _profile(db, member):
    with (
        patch("app.api.v1.endpoints.users.log_audit_event", new=AsyncMock()),
        patch(
            "app.api.v1.endpoints.users._load_contact_visibility",
            new=AsyncMock(return_value={}),
        ),
    ):
        # The member reading their own record needs no grant.
        caller = SimpleNamespace(
            id=member.id,
            organization_id=member.organization_id,
            username=member.username,
            positions=[],
            rank=None,
        )
        return await get_user_with_roles(
            user_id=uuid.UUID(member.id), db=db, current_user=caller
        )


@pytest.mark.integration
class TestProfileReader:
    async def test_a_returned_member_is_a_member_since_their_credited_start(
        self, db_session
    ):
        org = await _org(db_session)
        member = await _returned_member(db_session, org)

        profile = await _profile(db_session, member)

        assert profile.service_since == CONTINUED_SINCE
        assert profile.hire_date == HIRED

    async def test_a_member_without_a_break_is_a_member_since_their_hire_date(
        self, db_session
    ):
        org = await _org(db_session)
        member = await _user(db_session, org)

        profile = await _profile(db_session, member)

        assert profile.service_since == HIRED

    async def test_stints_are_read_from_the_members_own_department(self, db_session):
        org = await _org(db_session)
        member = await _returned_member(db_session, org)

        by_user = await MemberServiceHistoryService(db_session).service_since_by_user(
            str(uuid.uuid4()), [member]
        )

        # No stints recorded under another organization: unbroken from hire.
        assert by_user == {member.id: HIRED}


def _card_text(pdf) -> str:
    return " ".join(p.extract_text() for p in PdfReader(pdf).pages)


@pytest.mark.integration
class TestPrintedIdCardReader:
    async def test_the_card_prints_the_credited_year(self, db_session):
        org = await _org(db_session)
        returned = await _returned_member(db_session, org, first_name="Returned")

        pdf, _ = await MemberIdCardService(db_session).generate(
            org.id, [returned.id], sides="front"
        )

        text = _card_text(pdf)
        assert f"Member since {CONTINUED_SINCE.year}" in text
        assert f"Member since {HIRED.year}" not in text

    async def test_a_member_without_a_break_prints_their_hire_year(self, db_session):
        org = await _org(db_session)
        steady = await _user(db_session, org, first_name="Steady")

        pdf, _ = await MemberIdCardService(db_session).generate(
            org.id, [steady.id], sides="front"
        )

        assert f"Member since {HIRED.year}" in _card_text(pdf)

    async def test_a_recent_return_after_a_restart_prints_the_rejoin_year(
        self, db_session
    ):
        org = await _org(db_session)
        member = await _user(db_session, org)
        rejoined = date.today() - timedelta(days=30)
        db_session.add_all(
            [
                MemberServicePeriod(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    user_id=member.id,
                    start_date=None,
                    end_date=LEFT,
                    separation_status="dropped_voluntary",
                    counts_toward_service=False,
                ),
                MemberServicePeriod(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    user_id=member.id,
                    start_date=rejoined,
                    end_date=None,
                    counts_toward_service=True,
                ),
            ]
        )
        await db_session.flush()

        pdf, _ = await MemberIdCardService(db_session).generate(
            org.id, [member.id], sides="front"
        )

        assert f"Member since {rejoined.year}" in _card_text(pdf)
