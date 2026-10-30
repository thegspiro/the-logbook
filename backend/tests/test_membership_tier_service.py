"""
Tests for the membership tier service
(app/services/membership_tier_service.py).

Covers the pure tier-resolution helpers (years of service, highest-qualifying
tier, tier lookup, settings loading) and the meeting-attendance percentage —
including the permanent-leave (end_date NULL) regression that previously
raised TypeError and broke voting-eligibility checks. DB mocked; no MySQL.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.user import UserStatus
from app.services.membership_tier_service import MembershipTierService
from app.utils.membership import split_membership_type

TIERS = [
    {"id": "probationary", "years_required": 0, "sort_order": 0},
    {"id": "active", "years_required": 1, "sort_order": 1},
    {"id": "senior", "years_required": 10, "sort_order": 2},
    {"id": "life", "years_required": 20, "sort_order": 3},
]


class TestYearsOfService:
    def test_no_hire_date(self):
        assert MembershipTierService.years_of_service(None, date.today()) == 0

    def test_exact_anniversary_counts(self):
        ten_years_ago = date.today().replace(year=date.today().year - 10)
        assert MembershipTierService.years_of_service(ten_years_ago, date.today()) == 10

    def test_day_before_anniversary_does_not_count(self):
        almost = date.today().replace(year=date.today().year - 10) + timedelta(days=1)
        assert MembershipTierService.years_of_service(almost, date.today()) == 9


class TestResolveTier:
    def _svc(self):
        return MembershipTierService(MagicMock())

    def test_returns_highest_qualifying_tier(self):
        assert self._svc().resolve_tier(TIERS, 12)["id"] == "senior"
        assert self._svc().resolve_tier(TIERS, 25)["id"] == "life"
        assert self._svc().resolve_tier(TIERS, 0)["id"] == "probationary"

    def test_no_tiers(self):
        assert self._svc().resolve_tier([], 5) is None

    def test_get_tier_by_id(self):
        assert self._svc().get_tier_by_id(TIERS, "senior")["years_required"] == 10
        assert self._svc().get_tier_by_id(TIERS, "missing") is None

    def test_load_tiers_sorts_by_sort_order(self):
        org = SimpleNamespace(
            settings={
                "membership_tiers": {
                    "tiers": [
                        {"id": "b", "sort_order": 2},
                        {"id": "a", "sort_order": 1},
                    ]
                }
            }
        )
        tiers = MembershipTierService._load_tiers(org)
        assert [t["id"] for t in tiers] == ["a", "b"]

    def test_load_tiers_handles_missing_settings(self):
        assert MembershipTierService._load_tiers(SimpleNamespace(settings=None)) == []


class TestMeetingAttendancePct:
    @pytest.fixture(autouse=True)
    def _fixed_today(self, monkeypatch):
        # The window ends at the department's today; pin it so these dates
        # stay inside the look-back however long the suite lives.
        monkeypatch.setattr(
            "app.services.membership_tier_service.resolve_org_today",
            AsyncMock(return_value=date(2026, 9, 1)),
        )

    def _db(self, *results):
        # First execute is the member lookup; None means no member row, so no
        # service-stint query follows and the window is the plain look-back.
        db = MagicMock()
        no_member = MagicMock(scalar_one_or_none=MagicMock(return_value=None))
        db.execute = AsyncMock(side_effect=[no_member, *results])
        return db

    def _scalars(self, items):
        r = MagicMock()
        r.scalars.return_value.all.return_value = items
        return r

    def _rows(self, rows):
        return MagicMock(all=MagicMock(return_value=rows))

    async def test_no_meetings_returns_100(self):
        db = self._db(self._rows([]))
        pct = await MembershipTierService(db).get_meeting_attendance_pct("u", "o")
        assert pct == 100.0

    async def test_simple_percentage(self):
        meetings = [
            ("m1", date(2026, 1, 1)),
            ("m2", date(2026, 2, 1)),
            ("m3", date(2026, 3, 1)),
            ("m4", date(2026, 4, 1)),
        ]
        db = self._db(
            self._rows(meetings),  # all meetings (id, date)
            self._rows([]),  # waived meeting ids
            self._scalars([]),  # no leaves
            self._rows([("m1",), ("m2",), ("m3",)]),  # present at 3
        )
        pct = await MembershipTierService(db).get_meeting_attendance_pct("u", "o")
        assert pct == 75.0

    async def test_permanent_leave_excludes_meetings_not_crashes(self):
        # A permanent leave (end_date=None) must be treated as open-ended.
        leave = SimpleNamespace(start_date=date(2026, 5, 1), end_date=None)
        meetings = [("m_jun", date(2026, 6, 1)), ("m_apr", date(2026, 4, 1))]
        db = self._db(
            self._rows(meetings),
            self._rows([]),  # no waivers
            self._scalars([leave]),
            self._rows([("m_apr",)]),  # present at the April meeting
        )
        pct = await MembershipTierService(db).get_meeting_attendance_pct("u", "o")
        # June falls inside the open-ended leave: 1 eligible (April), 1 attended.
        assert pct == 100.0

    async def test_all_meetings_on_leave_returns_100(self):
        leave = SimpleNamespace(start_date=date(2026, 1, 1), end_date=None)
        meetings = [("m1", date(2026, 2, 1)), ("m2", date(2026, 3, 1))]
        db = self._db(
            self._rows(meetings),
            self._rows([]),
            self._scalars([leave]),
            self._rows([]),
        )
        pct = await MembershipTierService(db).get_meeting_attendance_pct("u", "o")
        assert pct == 100.0

    async def test_waived_and_on_leave_meeting_excluded_only_once(self):
        # Regression: m1 is BOTH waived and inside the leave. Subtracting the
        # waived count and the on-leave count separately removed it twice,
        # shrinking the denominator and inflating the percentage (the old code
        # returned 100.0 here instead of 50.0).
        meetings = [
            ("m1", date(2026, 6, 1)),
            ("m2", date(2026, 7, 1)),
            ("m3", date(2026, 8, 1)),
        ]
        leave = SimpleNamespace(start_date=date(2026, 6, 1), end_date=date(2026, 6, 30))
        db = self._db(
            self._rows(meetings),
            self._rows([("m1",)]),  # m1 waived
            self._scalars([leave]),  # leave also covers m1 only
            self._rows([("m2",)]),  # present at m2
        )
        pct = await MembershipTierService(db).get_meeting_attendance_pct("u", "o")
        # excluded = {m1}; eligible = {m2, m3}; attended within eligible = {m2}.
        assert pct == 50.0

    async def test_attendance_during_leave_cannot_exceed_100(self):
        # Regression: a member present at a meeting that fell during their leave
        # was counted in the numerator but not the denominator, so the old code
        # could return 200.0. Attendance is now intersected with the eligible
        # set, capping the result.
        meetings = [("m1", date(2026, 6, 1)), ("m2", date(2026, 7, 1))]
        leave = SimpleNamespace(start_date=date(2026, 6, 1), end_date=date(2026, 6, 30))
        db = self._db(
            self._rows(meetings),
            self._rows([]),  # no waivers
            self._scalars([leave]),  # covers m1
            self._rows([("m1",), ("m2",)]),  # present at both
        )
        pct = await MembershipTierService(db).get_meeting_attendance_pct("u", "o")
        # eligible = {m2}; m1 (during leave) does not count -> 1/1.
        assert pct == 100.0


class TestAdvanceAllStaysOnTheLadder:
    """The nightly job must not promote members who are not on the ladder.

    ``membership_type`` also carries the four legacy values that are *not*
    tiers in the shipped defaults — administrative, honorary, retired,
    prospective. Treating an unrecognised value as sort_order 0 put them on
    rung zero and climbed: an administrative member woke up ``active``, and
    because setting ``membership_type`` reconciles the class, ``operational``
    with it — able to self-sign up for shifts, matching operational ballots,
    and past the rank-clearing guard, which asks about the *new* type.
    """

    @staticmethod
    def _org():
        return SimpleNamespace(
            id="org-1",
            settings={"membership_tiers": {"auto_advance": True, "tiers": TIERS}},
        )

    @staticmethod
    def _member(membership_type, years=12, rank="captain"):
        # The pair the split migration settled every row onto, so the fake
        # looks like a row the scan actually meets.
        member_class, member_status = split_membership_type(membership_type)
        if member_status is None:
            member_status = membership_type
        return SimpleNamespace(
            id=f"u-{membership_type}",
            full_name=f"Pat {membership_type.title()}",
            display_name=f"Pat {membership_type.title()}",
            membership_type=membership_type,
            member_class=member_class,
            member_status=member_status,
            membership_type_changed_at=None,
            rank=rank,
            # The advance writes the account status too; start every mock
            # on the value a real member carries.
            status=UserStatus.ACTIVE,
            status_changed_at=None,
            status_change_reason=None,
            deleted_at=None,
            hire_date=date.today().replace(year=date.today().year - years),
        )

    def _db(self, org, members):
        """Answers the org read, the batch read, the stints read (none
        recorded), then one locked read each."""
        queue = [
            MagicMock(scalar_one_or_none=MagicMock(return_value=org)),
            MagicMock(
                scalars=MagicMock(
                    return_value=MagicMock(all=MagicMock(return_value=members))
                )
            ),
            MagicMock(
                scalars=MagicMock(
                    return_value=MagicMock(all=MagicMock(return_value=[]))
                )
            ),
        ]
        by_id = {m.id: m for m in members}

        async def _execute(statement, *_args, **_kwargs):
            if queue:
                return queue.pop(0)
            # The locked re-read. Resolved by the id in the statement rather
            # than by position: a member skipped before the lock consumes no
            # read, so a positional fake hands the next candidate the wrong
            # row and the test passes or fails for the wrong reason.
            wanted = next(iter(statement.compile().params.values()), None)
            return MagicMock(
                scalar_one_or_none=MagicMock(return_value=by_id.get(wanted))
            )

        db = MagicMock()
        db.execute = AsyncMock(side_effect=_execute)
        db.commit = AsyncMock()
        return db

    async def _advance(self, members, monkeypatch):
        import app.services.membership_tier_service as module

        monkeypatch.setattr(module, "log_audit_event", AsyncMock())
        db = self._db(self._org(), members)
        return await MembershipTierService(db).advance_all("org-1", "admin-1")

    @pytest.mark.parametrize("membership_type", ["honorary", "retired", "prospective"])
    async def test_a_standing_that_is_not_a_rung_is_left_alone(
        self, membership_type, monkeypatch
    ):
        member = self._member(membership_type)

        result = await self._advance([member], monkeypatch)

        assert member.membership_type == membership_type
        assert member.member_status == split_membership_type(membership_type)[1]
        assert member.rank == "captain"
        assert result["advanced"] == 0
        assert result["off_ladder"] == 1

    async def test_a_member_on_the_ladder_still_advances(self, monkeypatch):
        member = self._member("active", years=12)

        result = await self._advance([member], monkeypatch)

        assert member.member_status == "senior"
        assert member.membership_type == "senior"
        assert member.member_class == "operational"
        assert result["advanced"] == 1
        assert result["off_ladder"] == 0

    async def test_an_administrative_member_climbs_the_ladder_as_themselves(
        self, monkeypatch
    ):
        """The ladder is tenure, so every class is on it (owner decision
        2026-10-29). An administrative regular with twelve years reaches
        Senior -- and stays administrative, which is the part the old scan got
        wrong in the other direction: it rewrote the class to operational."""
        member = self._member("administrative", years=12, rank=None)

        result = await self._advance([member], monkeypatch)

        assert member.member_status == "senior"
        assert member.member_class == "administrative"
        # The legacy word still says what the legacy gates ask: not riding.
        assert member.membership_type == "administrative"
        assert (result["advanced"], result["off_ladder"]) == (1, 0)

    async def test_a_member_with_no_class_is_not_given_one(self, monkeypatch):
        """A tier member whose class was never recorded keeps no class.

        The scan writes the standing only; guessing the class is the
        migration's refusal, repeated here. The roster flags them instead.
        """
        member = self._member("active", years=25)
        member.member_class = None

        await self._advance([member], monkeypatch)

        assert member.member_status == "life"
        assert member.member_class is None

    async def test_the_skip_does_not_stop_the_scan(self, monkeypatch):
        """One off-ladder member must not shorten the rest of the roster."""
        honorary = self._member("honorary")
        operational = self._member("active", years=12)

        result = await self._advance([honorary, operational], monkeypatch)

        assert honorary.membership_type == "honorary"
        assert operational.membership_type == "senior"
        assert (result["advanced"], result["off_ladder"]) == (1, 1)

    async def test_a_tier_named_for_a_class_still_moves_the_class(self, monkeypatch):
        """A department whose ladder ends in a rung literally called
        ``administrative`` is asking for a class change, and gets the one it
        always got: the legacy column is written, the rank is cleared."""
        member = self._member("active", years=25)
        tiers = [
            {"id": "active", "years_required": 1, "sort_order": 1},
            {"id": "administrative", "years_required": 20, "sort_order": 2},
        ]
        org = SimpleNamespace(
            id="org-1",
            settings={"membership_tiers": {"auto_advance": True, "tiers": tiers}},
        )
        import app.services.membership_tier_service as module

        monkeypatch.setattr(module, "log_audit_event", AsyncMock())
        db = self._db(org, [member])
        await MembershipTierService(db).advance_all("org-1", "admin-1")

        assert member.membership_type == "administrative"
        assert member.rank is None

    async def test_a_member_already_at_their_tier_is_not_counted_off_ladder(
        self, monkeypatch
    ):
        member = self._member("senior", years=12)

        result = await self._advance([member], monkeypatch)

        assert (result["advanced"], result["off_ladder"]) == (0, 0)


class TestTierForStatus:
    def test_matches_in_canonical_spelling(self):
        tier = MembershipTierService.tier_for_status(TIERS, "regular")
        assert tier is not None
        assert tier["id"] == "active"
        assert MembershipTierService.tier_for_status(TIERS, "active")["id"] == "active"
        assert MembershipTierService.tier_for_status(TIERS, "senior")["id"] == "senior"
        assert MembershipTierService.tier_for_status(TIERS, "Life ")["id"] == "life"

    def test_a_standing_off_the_ladder_matches_nothing(self):
        assert MembershipTierService.tier_for_status(TIERS, "honorary") is None
        assert MembershipTierService.tier_for_status(TIERS, None) is None


class TestRanksAsByTier:
    def test_only_declared_tiers_appear(self):
        org = SimpleNamespace(
            settings={
                "membership_tiers": {
                    "tiers": [
                        {"id": "active", "ranks_as": None},
                        {"id": "senior", "ranks_as": "regular"},
                        {"id": "cadet", "ranks_as": " Probationary "},
                    ]
                }
            }
        )
        assert MembershipTierService.ranks_as_by_tier(org) == {
            "senior": "regular",
            "cadet": "probationary",
        }

    def test_tolerates_an_organization_without_settings(self):
        assert (
            MembershipTierService.ranks_as_by_tier(SimpleNamespace(settings=None)) == {}
        )
        assert MembershipTierService.ranks_as_by_tier(None) == {}
