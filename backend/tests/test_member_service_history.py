"""
Length of service from recorded stints (member_service_history_service.py).

The pure arithmetic is unit-tested without a database; the lifecycle hooks,
the officer's full-list replacement and the endpoints run against MySQL,
because what they guarantee -- one open stint, no overlaps, nothing written
when a check fails, nothing visible across organizations -- is a property of
the rows, not of the Python.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.models.user import MemberServicePeriod, Organization, User, UserStatus
from app.schemas.member_service import (
    RejoinServiceOptions,
    ServiceHistoryReplace,
    ServicePeriodItem,
)
from app.schemas.organization import RejoinServiceCredit
from app.services.member_service_history_service import (
    MemberServiceHistoryService,
    is_separated,
    resolve_rejoin_credit,
    summarize,
    whole_years,
)
from app.services.membership_tier_service import MembershipTierService

TODAY = date(2026, 9, 24)


def _member(**kw):
    return SimpleNamespace(
        id=kw.get("id", "m-1"),
        organization_id=kw.get("organization_id", "org-1"),
        hire_date=kw.get("hire_date"),
        status=kw.get("status", UserStatus.ACTIVE),
        status_changed_at=kw.get("status_changed_at"),
    )


def _stint(start, end=None, counts=True, sep=None, pid=None):
    return MemberServicePeriod(
        id=pid,
        start_date=start,
        end_date=end,
        counts_toward_service=counts,
        separation_status=sep,
    )


# ----------------------------------------------------------------------
# Arithmetic -- no database
# ----------------------------------------------------------------------


@pytest.mark.unit
class TestSummarize:
    def test_no_stints_is_one_unbroken_stint_from_hire(self):
        hire = date(2016, 3, 15)
        summary = summarize(_member(hire_date=hire), [], TODAY)

        assert summary.effective_service_start == hire
        assert summary.credited_years == 10
        assert summary.credited_days == (TODAY - hire).days
        assert summary.prior_days == 0
        assert (summary.is_recorded, summary.is_estimated) == (False, False)

    @pytest.mark.parametrize("years_ago", [0, 1, 9, 10, 20, 31])
    def test_unrecorded_member_matches_the_old_hire_date_calculation(self, years_ago):
        # Existing installations have no stints; tier advancement must give
        # every one of their members exactly the years it always did,
        # including on and the day before an anniversary.
        today = date.today()
        for hire in (
            today.replace(year=today.year - years_ago),
            today.replace(year=today.year - years_ago) + timedelta(days=1),
        ):
            if hire > today:
                continue
            summary = summarize(_member(hire_date=hire), [])
            assert summary.credited_years == MembershipTierService.years_of_service(
                hire
            )

    def test_no_hire_date_and_no_stints_is_zero(self):
        summary = summarize(_member(), [], TODAY)
        assert (summary.credited_days, summary.credited_years) == (0, 0)
        assert summary.effective_service_start is None
        assert summary.periods == []

    def test_separated_member_without_stints_stops_at_last_status_change(self):
        hire = date(2015, 1, 1)
        left = datetime(2020, 1, 1, 12, tzinfo=timezone.utc)
        summary = summarize(
            _member(
                hire_date=hire,
                status=UserStatus.ARCHIVED,
                status_changed_at=left,
            ),
            [],
            TODAY,
        )
        assert summary.periods[0].end == date(2020, 1, 1)
        assert summary.credited_days == (date(2020, 1, 1) - hire).days
        assert summary.is_estimated is True

    def test_time_away_is_not_counted(self):
        # Five years, a four-year gap, then back for two.
        stints = [
            _stint(date(2015, 9, 24), date(2020, 9, 24), sep="dropped_voluntary"),
            _stint(date(2024, 9, 24)),
        ]
        summary = summarize(_member(hire_date=date(2015, 9, 24)), stints, TODAY)

        assert summary.credited_days == (
            (date(2020, 9, 24) - date(2015, 9, 24)).days
            + (TODAY - date(2024, 9, 24)).days
        )
        assert summary.credited_years == 7
        assert summary.prior_days == 0

    def test_restarted_member_counts_only_the_new_stint_and_notes_the_rest(self):
        stints = [
            _stint(date(2015, 9, 24), date(2020, 9, 24), counts=False),
            _stint(date(2024, 9, 24)),
        ]
        summary = summarize(_member(hire_date=date(2015, 9, 24)), stints, TODAY)

        assert summary.credited_years == 2
        assert summary.effective_service_start == date(2024, 9, 24)
        assert summary.prior_days == (date(2020, 9, 24) - date(2015, 9, 24)).days

    def test_a_hire_linked_stint_follows_the_hire_date(self):
        stints = [_stint(None, date(2020, 1, 1)), _stint(date(2022, 1, 1))]
        summary = summarize(_member(hire_date=date(2010, 1, 1)), stints, TODAY)

        first = summary.periods[0]
        assert (first.start, first.start_is_hire_date) == (date(2010, 1, 1), True)
        assert first.days == (date(2020, 1, 1) - date(2010, 1, 1)).days


@pytest.mark.unit
class TestHelpers:
    def test_whole_years_counts_completed_anniversaries(self):
        assert whole_years(date(2016, 9, 24), TODAY) == 10
        assert whole_years(date(2016, 9, 25), TODAY) == 9
        assert whole_years(None, TODAY) == 0

    @pytest.mark.parametrize(
        ("status", "expected"),
        [
            (UserStatus.DROPPED_VOLUNTARY, True),
            (UserStatus.DROPPED_INVOLUNTARY, True),
            (UserStatus.RETIRED, True),
            (UserStatus.ARCHIVED, True),
            (UserStatus.ACTIVE, False),
            (UserStatus.INACTIVE, False),
            (UserStatus.LEAVE, False),
            (UserStatus.SUSPENDED, False),
            (UserStatus.PROBATIONARY, False),
            ("not-a-status", False),
        ],
    )
    def test_only_leaving_the_department_is_time_away(self, status, expected):
        assert is_separated(status) is expected

    @pytest.mark.parametrize(
        ("settings", "expected"),
        [
            (None, RejoinServiceCredit.CONTINUE),
            ({}, RejoinServiceCredit.CONTINUE),
            ({"membership_tiers": {}}, RejoinServiceCredit.CONTINUE),
            ({"membership_tiers": "garbage"}, RejoinServiceCredit.CONTINUE),
            (
                {"membership_tiers": {"rejoin_service_credit": "bogus"}},
                RejoinServiceCredit.CONTINUE,
            ),
            (
                {"membership_tiers": {"rejoin_service_credit": "restart"}},
                RejoinServiceCredit.RESTART,
            ),
        ],
    )
    def test_the_department_default_degrades_to_continue(self, settings, expected):
        assert resolve_rejoin_credit(settings) is expected


@pytest.mark.unit
class TestValidate:
    def _check(self, periods, **member_kw):
        member = _member(hire_date=date(2010, 1, 1), **member_kw)
        MemberServiceHistoryService._validate(member, periods, TODAY)

    def test_accepts_a_clean_history(self):
        self._check([_stint(None, date(2015, 1, 1)), _stint(date(2018, 1, 1))])

    @pytest.mark.parametrize(
        ("periods", "message"),
        [
            (
                [_stint(date(2011, 1, 1), date(2016, 1, 1)), _stint(date(2015, 1, 1))],
                "cannot overlap",
            ),
            (
                [_stint(date(2011, 1, 1), date(2015, 1, 1)), _stint(date(2015, 1, 1))],
                "cannot overlap",
            ),
            ([_stint(date(2011, 1, 1)), _stint(date(2015, 1, 1))], "only one stint"),
            ([_stint(date(2027, 1, 1))], "start in the future"),
            ([_stint(date(2011, 1, 1), date(2010, 1, 1))], "end before it starts"),
            ([_stint(date(2011, 1, 1), date(2015, 1, 1))], "must have no end date"),
            (
                [_stint(date(2011, 1, 1), sep="dropped_voluntary")],
                "Only a stint with an end date",
            ),
            (
                [_stint(None, date(2011, 1, 1)), _stint(None)],
                "Only one service stint can start on the hire date",
            ),
        ],
    )
    def test_refuses(self, periods, message):
        with pytest.raises(ValueError, match=message):
            self._check(periods)

    def test_a_separated_member_may_not_have_an_open_stint(self):
        with pytest.raises(ValueError, match="not currently serving"):
            self._check([_stint(date(2011, 1, 1))], status=UserStatus.RETIRED)

    def test_hire_linked_stint_needs_a_hire_date(self):
        with pytest.raises(ValueError, match="no hire date"):
            MemberServiceHistoryService._validate(_member(), [_stint(None)], TODAY)


# ----------------------------------------------------------------------
# Rows -- MySQL
# ----------------------------------------------------------------------


async def _org(db, settings=None):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Service History Test Department",
        slug=f"svc-hist-{uuid.uuid4().hex[:8]}",
        settings=settings or {},
    )
    db.add(org)
    await db.flush()
    return org


async def _user(db, org, *, hire_date=None, status=UserStatus.ACTIVE, **kw):
    name = kw.get("username", f"u{uuid.uuid4().hex[:8]}")
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=name,
        email=f"{name}@svc-hist.test",
        first_name="Test",
        last_name=name.title(),
        password_hash="x",
        status=status,
        hire_date=hire_date,
        status_changed_at=kw.get("status_changed_at"),
    )
    db.add(user)
    await db.flush()
    return user


async def _stints(db, user):
    return await MemberServiceHistoryService(db).list_periods(
        user.organization_id, user.id
    )


@pytest.mark.integration
class TestLifecycleHooks:
    async def test_first_separation_writes_the_stint_from_hire(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org, hire_date=date(2015, 4, 1))
        svc = MemberServiceHistoryService(db_session)

        await svc.record_separation(
            member, UserStatus.DROPPED_VOLUNTARY, date(2020, 4, 1), None
        )
        await db_session.flush()

        [stint] = await _stints(db_session, member)
        assert stint.start_date is None  # linked to hire_date
        assert stint.end_date == date(2020, 4, 1)
        assert stint.separation_status == "dropped_voluntary"

    async def test_separation_closes_the_open_stint(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org, hire_date=date(2015, 4, 1))
        db_session.add(
            MemberServicePeriod(
                organization_id=org.id, user_id=member.id, start_date=date(2022, 1, 1)
            )
        )
        await db_session.flush()

        await MemberServiceHistoryService(db_session).record_separation(
            member, UserStatus.RETIRED, date(2026, 1, 1), None
        )
        await db_session.flush()

        [stint] = await _stints(db_session, member)
        assert (stint.end_date, stint.separation_status) == (
            date(2026, 1, 1),
            "retired",
        )

    async def test_rejoin_continuing_keeps_earlier_service(self, db_session):
        org = await _org(db_session)
        member = await _user(
            db_session,
            org,
            hire_date=date(2015, 9, 24),
            status=UserStatus.ARCHIVED,
            status_changed_at=datetime(2021, 1, 1, tzinfo=timezone.utc),
        )
        svc = MemberServiceHistoryService(db_session)

        await svc.record_rejoin(
            member,
            date(2024, 9, 24),
            RejoinServiceCredit.CONTINUE,
            None,
            previous_service_end=date(2020, 9, 24),
            today=TODAY,
        )
        await db_session.flush()

        prior, current = await _stints(db_session, member)
        assert (prior.start_date, prior.end_date) == (None, date(2020, 9, 24))
        assert prior.counts_toward_service is True
        assert (current.start_date, current.end_date) == (date(2024, 9, 24), None)
        summary = summarize(member, [prior, current], TODAY)
        assert summary.credited_years == 7

    async def test_rejoin_restarting_keeps_earlier_service_as_prior(self, db_session):
        org = await _org(db_session)
        member = await _user(
            db_session,
            org,
            hire_date=date(2015, 9, 24),
            status=UserStatus.DROPPED_VOLUNTARY,
            status_changed_at=datetime(2020, 9, 24, tzinfo=timezone.utc),
        )

        await MemberServiceHistoryService(db_session).record_rejoin(
            member, date(2024, 9, 24), RejoinServiceCredit.RESTART, None, today=TODAY
        )
        await db_session.flush()

        prior, current = await _stints(db_session, member)
        assert prior.counts_toward_service is False
        assert prior.separation_status == "dropped_voluntary"
        summary = summarize(member, [prior, current], TODAY)
        assert summary.credited_years == 2
        assert summary.prior_days == (date(2020, 9, 24) - date(2015, 9, 24)).days

    async def test_rejoin_uses_the_department_default(self, db_session):
        org = await _org(
            db_session, {"membership_tiers": {"rejoin_service_credit": "restart"}}
        )
        member = await _user(
            db_session,
            org,
            hire_date=date(2015, 1, 1),
            status=UserStatus.RETIRED,
            status_changed_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
        )

        await MemberServiceHistoryService(db_session).record_rejoin(
            member, date(2024, 1, 1), None, None, today=TODAY
        )
        await db_session.flush()

        prior, _current = await _stints(db_session, member)
        assert prior.counts_toward_service is False

    @pytest.mark.parametrize(
        ("rejoin", "previous_end", "message"),
        [
            (date(2019, 1, 1), None, "must be after"),
            (date(2020, 1, 1), None, "must be after"),
            (TODAY + timedelta(days=1), None, "cannot be in the future"),
            (date(2024, 1, 1), date(2014, 1, 1), "before the member's hire date"),
        ],
    )
    async def test_rejoin_refuses_an_impossible_date(
        self, db_session, rejoin, previous_end, message
    ):
        org = await _org(db_session)
        member = await _user(
            db_session,
            org,
            hire_date=date(2015, 1, 1),
            status=UserStatus.RETIRED,
            status_changed_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
        )
        with pytest.raises(ValueError, match=message):
            await MemberServiceHistoryService(db_session).record_rejoin(
                member,
                rejoin,
                RejoinServiceCredit.CONTINUE,
                None,
                previous_service_end=previous_end,
                today=TODAY,
            )

    async def test_rejoin_refuses_while_a_stint_is_still_open(self, db_session):
        org = await _org(db_session)
        member = await _user(
            db_session, org, hire_date=date(2015, 1, 1), status=UserStatus.RETIRED
        )
        db_session.add(
            MemberServicePeriod(
                organization_id=org.id, user_id=member.id, start_date=date(2015, 1, 1)
            )
        )
        await db_session.flush()

        with pytest.raises(ValueError, match="no end date"):
            await MemberServiceHistoryService(db_session).record_rejoin(
                member, date(2024, 1, 1), RejoinServiceCredit.CONTINUE, None
            )

    async def test_another_organizations_stints_are_invisible(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        member = await _user(db_session, org, hire_date=date(2015, 1, 1))
        db_session.add(
            MemberServicePeriod(
                organization_id=other.id,
                user_id=member.id,
                start_date=date(2015, 1, 1),
            )
        )
        await db_session.flush()

        svc = MemberServiceHistoryService(db_session)
        assert await svc.list_periods(org.id, member.id) == []
        assert await svc.periods_by_user(org.id, [member.id]) == {}


@pytest.mark.integration
class TestReplacePeriods:
    async def test_corrects_the_implicit_stint_and_adds_earlier_service(
        self, db_session
    ):
        # The case per-row edits could not handle: a member who never had a
        # recorded stint, whose hire date covers time they were away.
        org = await _org(db_session)
        member = await _user(db_session, org, hire_date=date(2010, 1, 1))
        svc = MemberServiceHistoryService(db_session)

        await svc.replace_periods(
            member,
            [
                {
                    "start_date": None,
                    "end_date": date(2015, 1, 1),
                    "separation_status": "dropped_voluntary",
                },
                {"start_date": date(2020, 1, 1), "end_date": None},
            ],
            None,
            today=TODAY,
        )
        await db_session.flush()

        stints = await _stints(db_session, member)
        assert [(s.start_date, s.end_date) for s in stints] == [
            (None, date(2015, 1, 1)),
            (date(2020, 1, 1), None),
        ]

    async def test_updates_by_id_and_deletes_what_is_left_out(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org, hire_date=date(2010, 1, 1))
        keep = MemberServicePeriod(
            organization_id=org.id, user_id=member.id, start_date=date(2018, 1, 1)
        )
        drop = MemberServicePeriod(
            organization_id=org.id,
            user_id=member.id,
            start_date=date(2011, 1, 1),
            end_date=date(2012, 1, 1),
        )
        db_session.add_all([keep, drop])
        await db_session.flush()

        await MemberServiceHistoryService(db_session).replace_periods(
            member,
            [{"id": keep.id, "start_date": date(2017, 6, 1), "notes": "Corrected"}],
            None,
            today=TODAY,
        )
        await db_session.flush()

        [stint] = await _stints(db_session, member)
        assert (stint.id, stint.start_date, stint.notes) == (
            keep.id,
            date(2017, 6, 1),
            "Corrected",
        )

    async def test_an_invalid_list_changes_nothing(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org, hire_date=date(2010, 1, 1))
        await db_session.flush()

        with pytest.raises(ValueError, match="overlap"):
            await MemberServiceHistoryService(db_session).replace_periods(
                member,
                [
                    {"start_date": date(2011, 1, 1), "end_date": date(2016, 1, 1)},
                    {"start_date": date(2015, 1, 1)},
                ],
                None,
                today=TODAY,
            )
        await db_session.flush()
        assert await _stints(db_session, member) == []

    async def test_refuses_an_id_from_another_member(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org, hire_date=date(2010, 1, 1))
        someone_else = await _user(db_session, org, hire_date=date(2010, 1, 1))
        theirs = MemberServicePeriod(
            organization_id=org.id, user_id=someone_else.id, start_date=date(2012, 1, 1)
        )
        db_session.add(theirs)
        await db_session.flush()

        with pytest.raises(ValueError, match="does not exist"):
            await MemberServiceHistoryService(db_session).replace_periods(
                member, [{"id": theirs.id, "start_date": date(2013, 1, 1)}], None
            )


def _caller(org, user_id=None, username="officer"):
    return SimpleNamespace(
        id=user_id or str(uuid.uuid4()),
        organization_id=org.id,
        username=username,
    )


@pytest.mark.integration
class TestEndpoints:
    async def test_a_member_reads_their_own_history(self, db_session, monkeypatch):
        from app.api.v1.endpoints import member_service_history as ep

        org = await _org(db_session)
        member = await _user(db_session, org, hire_date=date(2016, 1, 1))
        monkeypatch.setattr(ep, "user_has_permission", lambda *_: False)

        result = await ep.get_service_history(
            member.id, db=db_session, current_user=_caller(org, member.id)
        )

        assert result.hire_date == date(2016, 1, 1)
        assert result.is_recorded is False
        assert result.default_rejoin_credit == RejoinServiceCredit.CONTINUE
        assert result.periods[0].start_is_hire_date is True

    async def test_a_colleague_without_members_manage_is_refused(
        self, db_session, monkeypatch
    ):
        from app.api.v1.endpoints import member_service_history as ep

        org = await _org(db_session)
        member = await _user(db_session, org, hire_date=date(2016, 1, 1))
        monkeypatch.setattr(ep, "user_has_permission", lambda *_: False)

        with pytest.raises(HTTPException) as exc:
            await ep.get_service_history(
                member.id, db=db_session, current_user=_caller(org)
            )
        assert exc.value.status_code == 403

    async def test_another_organizations_member_is_not_found(
        self, db_session, monkeypatch
    ):
        from app.api.v1.endpoints import member_service_history as ep

        org = await _org(db_session)
        other = await _org(db_session)
        outsider = await _user(db_session, other, hire_date=date(2016, 1, 1))
        monkeypatch.setattr(ep, "user_has_permission", lambda *_: True)

        with pytest.raises(HTTPException) as exc:
            await ep.get_service_history(
                outsider.id, db=db_session, current_user=_caller(org)
            )
        assert exc.value.status_code == 404
        with pytest.raises(HTTPException) as exc:
            await ep.replace_service_periods(
                outsider.id,
                ServiceHistoryReplace(periods=[]),
                db=db_session,
                current_user=_caller(org),
            )
        assert exc.value.status_code == 404

    async def test_replace_saves_and_reports_the_new_totals(self, db_session):
        from app.api.v1.endpoints import member_service_history as ep

        org = await _org(db_session)
        member = await _user(db_session, org, hire_date=date(2010, 1, 1))
        officer = await _user(db_session, org, hire_date=date(2000, 1, 1))

        result = await ep.replace_service_periods(
            member.id,
            ServiceHistoryReplace(
                periods=[
                    ServicePeriodItem(
                        start_date=None,
                        end_date=date(2015, 1, 1),
                        separation_status="retired",
                        counts_toward_service=False,
                        notes="  ",
                    ),
                    ServicePeriodItem(start_date=date(2020, 1, 1)),
                ]
            ),
            db=db_session,
            current_user=_caller(org, officer.id),
        )

        assert result.is_recorded is True
        assert result.prior_days == (date(2015, 1, 1) - date(2010, 1, 1)).days
        assert result.periods[0].separation_status == "retired"
        assert result.periods[0].notes is None

    async def test_replace_reports_a_bad_list_as_400(self, db_session):
        from app.api.v1.endpoints import member_service_history as ep

        org = await _org(db_session)
        member = await _user(db_session, org, hire_date=date(2010, 1, 1))

        with pytest.raises(HTTPException) as exc:
            await ep.replace_service_periods(
                member.id,
                ServiceHistoryReplace(
                    periods=[ServicePeriodItem(start_date=date(2011, 1, 1))] * 2
                ),
                db=db_session,
                current_user=_caller(org),
            )
        assert exc.value.status_code == 400


@pytest.mark.integration
class TestStatusChangeWritesStints:
    """The status endpoint is where stints come from; drive it end to end."""

    async def test_retire_then_reinstate_restarting(self, db_session):
        from app.api.v1.endpoints.member_status import (
            MemberStatusChangeRequest,
            change_member_status,
        )

        org = await _org(db_session)
        officer = await _user(db_session, org, hire_date=date(2000, 1, 1))
        member = await _user(db_session, org, hire_date=date(2012, 1, 1))
        caller = _caller(org, officer.id)

        await change_member_status(
            member.id,
            MemberStatusChangeRequest(new_status="retired"),
            BackgroundTasks(),
            db=db_session,
            current_user=caller,
        )
        [closed] = await _stints(db_session, member)
        assert (closed.end_date, closed.separation_status) == (
            date.today(),
            "retired",
        )

        with pytest.raises(HTTPException) as exc:
            await change_member_status(
                member.id,
                MemberStatusChangeRequest(
                    new_status="active", rejoin_date=date.today()
                ),
                BackgroundTasks(),
                db=db_session,
                current_user=caller,
            )
        assert exc.value.status_code == 400
        assert "must be after" in exc.value.detail
        await db_session.refresh(member)
        assert member.status == UserStatus.RETIRED

        # Back-date the retirement so a rejoin today is after it.
        closed.end_date = date.today() - timedelta(days=30)
        await db_session.flush()
        await change_member_status(
            member.id,
            MemberStatusChangeRequest(
                new_status="active", service_credit=RejoinServiceCredit.RESTART
            ),
            BackgroundTasks(),
            db=db_session,
            current_user=caller,
        )

        prior, current = await _stints(db_session, member)
        assert prior.counts_toward_service is False
        assert (current.start_date, current.end_date) == (date.today(), None)
        await db_session.refresh(member)
        assert member.status == UserStatus.ACTIVE

    async def test_a_change_within_membership_writes_nothing(self, db_session):
        from app.api.v1.endpoints.member_status import (
            MemberStatusChangeRequest,
            change_member_status,
        )

        org = await _org(db_session)
        officer = await _user(db_session, org, hire_date=date(2000, 1, 1))
        member = await _user(db_session, org, hire_date=date(2012, 1, 1))

        await change_member_status(
            member.id,
            MemberStatusChangeRequest(new_status="leave"),
            BackgroundTasks(),
            db=db_session,
            current_user=_caller(org, officer.id),
        )
        assert await _stints(db_session, member) == []


@pytest.mark.unit
def test_rejoin_options_are_optional():
    assert RejoinServiceOptions().model_dump() == {
        "service_credit": None,
        "rejoin_date": None,
        "previous_service_end": None,
    }


@pytest.mark.unit
class TestRejoinSetting:
    def test_defaults_to_continue_and_stores_as_plain_text(self):
        import json

        from app.schemas.organization import MembershipTierSettings

        dumped = MembershipTierSettings().model_dump()
        assert dumped["rejoin_service_credit"] == "continue"
        # Stored in the organization's JSON settings column.
        assert json.loads(json.dumps(dumped))["rejoin_service_credit"] == "continue"

    def test_rejects_an_unknown_choice(self):
        from pydantic import ValidationError

        from app.schemas.organization import MembershipTierSettings

        with pytest.raises(ValidationError):
            MembershipTierSettings.model_validate({"rejoin_service_credit": "bridge"})
