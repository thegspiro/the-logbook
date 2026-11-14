"""The meeting-count voting rule: a waived meeting shortens the look-back.

Owner decision, 2026-11-13. "Attend ``x`` of the last ``y`` meetings" used to
drop a waived meeting and reach back one more, so the member was still judged
on ``y`` meetings they had not been excused from. Now the window stays at the
member's last ``y`` meetings and each waived one reduces ``y`` by one: 6 of the
last 12 with one waived is 6 of 11, judged over the same 12 meetings. When
``x`` exceeds the meetings left, the requirement is the meetings left.

A leave of absence keeps the old reach-back; only waivers changed. A waived
meeting the member attended still counts as attended (check-in wins).

Each case here is chosen so the old rule gives a different answer.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from dateutil.relativedelta import relativedelta

from app.models.election import Election, ElectionStatus
from app.models.meeting import Meeting, MeetingAttendee, MeetingType
from app.models.user import Organization, User, UserStatus
from app.services.election_service import ElectionService
from app.services.membership_tier_service import (
    MembershipTierService,
    tally_recent_attendance,
)
from app.utils.org_timezone import org_today

WINDOW = (date(2025, 1, 1), date(2027, 12, 31))


def _monthly(count):
    """``count`` meetings, m1 the oldest, one a month from January 2026."""
    start = date(2026, 1, 1)
    return [(f"m{k}", start + relativedelta(months=k - 1)) for k in range(1, count + 1)]


def _tally(meetings, waived=(), present=(), leaves=(), last=3):
    return tally_recent_attendance(
        meetings, WINDOW, set(waived), set(present), list(leaves), last_meetings=last
    )


@pytest.mark.unit
class TestTheWindowDoesNotReachBack:
    def test_six_of_twelve_with_one_waived_is_six_of_eleven(self):
        meetings = _monthly(13)
        # m13 waived; present at five of the other eleven, and at m1, which
        # is outside the last twelve. The old rule reached back to m1 and
        # found the six it needed.
        present = {"m1", "m8", "m9", "m10", "m11", "m12"}
        recent = _tally(meetings, waived={"m13"}, present=present, last=12)

        assert recent.looked_back == 12
        assert recent.waived == 1
        assert recent.considered == 11
        assert recent.attended == 5
        assert recent.required(6, 12) == 6

    def test_a_waived_meeting_is_not_replaced_by_an_older_one(self):
        # Last three: m4 waived, m3 attended, m2 missed; m1 attended. The old
        # rule judged m3, m2, m1 and found 2 attended.
        recent = _tally(_monthly(4), waived={"m4"}, present={"m3", "m1"})

        assert (recent.attended, recent.considered) == (1, 2)
        assert recent.required(2, 3) == 2

    def test_the_requirement_is_capped_at_the_meetings_left(self):
        # 3 of the last 3 with one waived: only two remain, so two are needed.
        recent = _tally(_monthly(4), waived={"m4"}, present={"m3", "m2"})

        assert (recent.attended, recent.considered) == (2, 2)
        assert recent.required(3, 3) == 2

    def test_every_meeting_waived_requires_none(self):
        recent = _tally(_monthly(4), waived={"m4", "m3", "m2"}, present={"m1"})

        assert (recent.attended, recent.considered) == (0, 0)
        assert recent.required(2, 3) == 0

    def test_a_waived_meeting_the_member_attended_counts_as_attended(self):
        recent = _tally(_monthly(4), waived={"m4"}, present={"m4"})

        assert recent.waived == 0
        assert (recent.attended, recent.considered) == (1, 3)

    def test_fewer_meetings_than_the_look_back_keeps_the_pro_rating(self):
        # Four meetings against 6 of 12: 2 of 4 before the waiver, and the
        # waiver leaves three to count, so still 2 -- not 6 of 12 over 3.
        recent = _tally(_monthly(4), waived={"m4"}, present={"m3"}, last=12)

        assert recent.looked_back == 4
        assert recent.considered == 3
        assert recent.required(6, 12) == 2

    def test_a_leave_still_reaches_back(self):
        # m4 falls inside a leave: it leaves the window, and m1 comes in.
        leave = SimpleNamespace(start_date=date(2026, 3, 15), end_date=None)
        recent = _tally(_monthly(4), present={"m1", "m2"}, leaves=[leave])

        assert recent.looked_back == 3
        assert (recent.attended, recent.considered) == (2, 3)

    def test_a_meeting_both_waived_and_on_leave_is_left_out_once(self):
        leave = SimpleNamespace(start_date=date(2026, 3, 15), end_date=None)
        recent = _tally(
            _monthly(4), waived={"m4"}, present={"m1", "m2"}, leaves=[leave]
        )

        # Leave takes m4 out and reaches back; it is not also a waiver.
        assert recent.waived == 0
        assert (recent.attended, recent.considered) == (2, 3)


# ---------------------------------------------------------------------------
# Through the ballot check
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _no_audit_write(monkeypatch):
    monkeypatch.setattr("app.api.v1.endpoints.elections.log_audit_event", AsyncMock())


async def _org(db):
    org = Organization(name="Window FD", slug=f"win-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _member(db, org, tag):
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
    return user


async def _election(db, org, creator, min_meetings, of_last):
    now = datetime.now(timezone.utc)
    election = Election(
        organization_id=org.id,
        title="Chief 2026",
        positions=["Chief"],
        start_date=now - timedelta(days=1),
        end_date=now + timedelta(days=1),
        status=ElectionStatus.OPEN,
        created_by=creator.id,
        voter_anonymity_salt=uuid.uuid4().hex,
        eligibility_rules={
            "attendance": {
                "mode": "count",
                "min_meetings": min_meetings,
                "of_last_meetings": of_last,
            },
            "waiting_periods": {},
        },
    )
    db.add(election)
    await db.flush()
    return election


@pytest.fixture
async def four_meetings(db_session):
    """Four monthly business meetings, oldest first, the newest a month ago.

    ``member`` holds a waiver for the newest, which they missed; ``creator``
    only owns the elections."""
    org = await _org(db_session)
    today = org_today(org)
    member = await _member(db_session, org, "waived")
    creator = await _member(db_session, org, "creator")
    meetings = [
        Meeting(
            organization_id=org.id,
            title=f"Meeting {k}",
            meeting_date=today - relativedelta(months=k),
            meeting_type=MeetingType.BUSINESS,
        )
        for k in (4, 3, 2, 1)
    ]
    db_session.add_all(meetings)
    await db_session.flush()
    db_session.add(
        MeetingAttendee(
            organization_id=org.id,
            meeting_id=meetings[3].id,
            user_id=member.id,
            present=False,
            excused=True,
            waiver_reason="Excused: approved request",
            waiver_granted_by=creator.id,
        )
    )
    await db_session.flush()
    return SimpleNamespace(org=org, member=member, creator=creator, meetings=meetings)


async def _present(db, ns, indexes):
    db.add_all(
        MeetingAttendee(
            organization_id=ns.org.id,
            meeting_id=ns.meetings[i].id,
            user_id=ns.member.id,
            present=True,
        )
        for i in indexes
    )
    await db.flush()


@pytest.mark.integration
class TestTheBallotCheck:
    async def test_the_service_reads_the_shortened_window(
        self, db_session, four_meetings
    ):
        ns = four_meetings
        await _present(db_session, ns, [0, 2])
        recent = await MembershipTierService(db_session).get_recent_meeting_attendance(
            str(ns.member.id), str(ns.org.id), 3
        )

        assert (recent.looked_back, recent.waived) == (3, 1)
        assert (recent.attended, recent.considered) == (1, 2)

    async def test_a_member_who_relied_on_the_reach_back_now_fails(
        self, db_session, four_meetings
    ):
        ns = four_meetings
        # Attended the oldest and the third; missed the second.
        await _present(db_session, ns, [0, 2])
        election = await _election(db_session, ns.org, ns.creator, 2, 3)

        result = await ElectionService(db_session).check_voter_eligibility(
            ns.member.id, election.id, ns.org.id
        )

        assert result.is_eligible is False
        assert result.reason == (
            "Attended 1 of 2 meetings counted (the last 3, 1 waived); "
            "2 required to vote"
        )

    async def test_a_member_short_of_the_full_count_now_passes(
        self, db_session, four_meetings
    ):
        ns = four_meetings
        # 3 of the last 3, newest waived, the two before it attended, the
        # oldest missed: the old rule judged 2 of 3 and refused.
        await _present(db_session, ns, [1, 2])
        election = await _election(db_session, ns.org, ns.creator, 3, 3)

        result = await ElectionService(db_session).check_voter_eligibility(
            ns.member.id, election.id, ns.org.id
        )

        assert result.is_eligible is True
