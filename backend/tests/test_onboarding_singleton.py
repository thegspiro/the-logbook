"""`onboarding_status` is a singleton, and both halves of that are defended.

ONBOARD-7. `OnboardingService.start_onboarding` is a read-then-write with no
lock: two concurrent `POST /onboarding/start` calls both read "none exists" and
both insert. The wizard's own page load issues them in parallel, so an ordinary
first run reaches it -- reproduced twice on a freshly-migrated database.

The second row was not itself the damage. `needs_onboarding()` read the table
with `scalar_one_or_none()`, which raises `MultipleResultsFound` the moment two
rows match, so `GET /api/v1/onboarding/status` returned 500 *permanently* and
setup could not continue. Recovery needed direct database access at the one
moment no account exists to sign in with.

So there are two independent things to hold, and a test for each:

1. **Duplicates cannot be created.** A unique index on `singleton` decides the
   race; the loser gets an IntegrityError and defers to the winner rather than
   surfacing a 500. There is nothing to lock instead -- the conflicting row
   does not exist yet, so `FOR UPDATE` has no target (CLAUDE.md pitfall #27).
2. **Duplicates that already exist do not brick the endpoint.** The reads are
   `.first()`, so a database written before the constraint recovers instead of
   raising. Without this the de-duplicating migration could never reach an
   installation that was already stuck, because the app in front of it would
   still be throwing.

DB mocked; no MySQL.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.exc import IntegrityError, MultipleResultsFound

from app.models.onboarding import OnboardingStatus
from app.services.onboarding import OnboardingService


def _result(rows):
    """A result that behaves as SQLAlchemy's does, including when it raises.

    `scalar_one_or_none()` raises `MultipleResultsFound` on more than one row,
    and emulating that is the whole point: a mock that quietly returned the
    first row would pass against the broken code too, and prove nothing. With
    it faithful, the duplicate-row tests below fail on `scalar_one_or_none()`
    and pass on `.first()` -- which is the change being tested.
    """
    result = MagicMock()

    scalars = MagicMock()
    scalars.first.return_value = rows[0] if rows else None
    result.scalars.return_value = scalars

    def _one_or_none():
        if len(rows) > 1:
            raise MultipleResultsFound(
                "Multiple rows were found when one or none was required"
            )
        return rows[0] if rows else None

    result.scalar_one_or_none.side_effect = _one_or_none
    result.scalar.return_value = rows[0] if rows else None
    return result


def _db(execute_results):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=execute_results)
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.rollback = AsyncMock()
    db.add = MagicMock()
    db.expunge = MagicMock()
    return db


def _nested(db, raises=None):
    """Wire `db.begin_nested()` as an async context manager."""
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=ctx)

    async def _exit(*_args):
        return False

    ctx.__aexit__ = AsyncMock(side_effect=_exit)
    db.begin_nested = MagicMock(return_value=ctx)
    if raises is not None:
        db.flush = AsyncMock(side_effect=raises)
    return ctx


def _integrity_error():
    return IntegrityError("INSERT", {}, Exception("duplicate key"))


class TestTheConstraintIsDeclared:
    def test_singleton_column_is_uniquely_indexed(self):
        """The guarantee is the database's, not the application's.

        A check in Python cannot decide a race between two processes; only the
        index can. If this constraint is ever dropped, the recovery path below
        stops being reachable and the race is live again.
        """
        constraints = {c.name for c in OnboardingStatus.__table__.constraints if c.name}
        assert "uq_onboarding_status_singleton" in constraints
        assert "singleton" in OnboardingStatus.__table__.c


class TestAnAlreadyDuplicatedDatabaseStillAnswers:
    """The half that un-bricks installations the constraint arrives too late for."""

    async def test_two_completed_rows_do_not_raise(self):
        done = MagicMock(spec=OnboardingStatus)
        db = _db([_result([done, done])])
        assert await OnboardingService(db).needs_onboarding() is False

    async def test_two_in_progress_rows_do_not_raise(self):
        pending = MagicMock(spec=OnboardingStatus)
        db = _db([_result([]), _result([pending, pending])])
        assert await OnboardingService(db).needs_onboarding() is True

    async def test_an_empty_table_still_needs_onboarding(self):
        """The ordinary first run, unchanged by any of this."""
        db = _db([_result([]), _result([]), _result([0])])
        assert await OnboardingService(db).needs_onboarding() is True


class TestLosingTheInsertRace:
    async def test_defers_to_the_winner(self):
        """The loser returns the winner's row rather than surfacing a 500."""
        winner = MagicMock(spec=OnboardingStatus)
        winner.is_completed = False
        # 1st execute: the pre-check read (no row yet -- both callers see this).
        # 2nd execute: the re-read after the IntegrityError, which finds the
        #              row the winner committed.
        db = _db([_result([]), _result([winner])])
        _nested(db, raises=_integrity_error())

        got = await OnboardingService(db).start_onboarding()

        assert got is winner

    async def test_reraises_when_there_is_no_winner(self):
        """A concurrent /reset truncates the table between insert and re-read.

        There is then no row to defer to and no duplicate being avoided, so
        swallowing the error would hide a real failure behind a None.

        One read per attempt, plus the final one after the loop gives up.
        """
        reads = [_result([])] * (OnboardingService._START_RACE_ATTEMPTS + 1)
        db = _db(reads)
        _nested(db, raises=_integrity_error())

        with pytest.raises(IntegrityError):
            await OnboardingService(db).start_onboarding()

    async def test_retrying_is_bounded(self):
        """A pathological loser must not spin forever holding the request."""
        reads = [_result([])] * (OnboardingService._START_RACE_ATTEMPTS + 1)
        db = _db(reads)
        _nested(db, raises=_integrity_error())

        with pytest.raises(IntegrityError):
            await OnboardingService(db).start_onboarding()

        assert db.rollback.await_count == OnboardingService._START_RACE_ATTEMPTS

    async def test_an_uncontended_start_is_unaffected(self):
        db = _db([_result([])])
        _nested(db)

        got = await OnboardingService(db).start_onboarding()

        assert isinstance(got, OnboardingStatus)
        db.refresh.assert_awaited_once()


class TestLegacyCompletionRacesTheSameWay:
    async def test_the_loser_stands_down(self):
        """Reached from needs_onboarding, which every first page load calls.

        Losing is harmless here -- the winner wrote the same "legacy,
        completed" fact -- so the loser must not propagate the error.
        """
        db = _db([])
        _nested(db, raises=_integrity_error())

        # Returns rather than raising: that is the whole assertion.
        await OnboardingService(db)._mark_legacy_completed()
