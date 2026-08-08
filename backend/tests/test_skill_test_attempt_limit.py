"""
Tests for honoring a requirement's ``max_attempts`` cap in skills testing.

A passing skills test completes its linked pipeline requirement, so the cap has
to hold here as well as on the officer-entered knowledge-test path. Previously
it did not: a candidate capped at two attempts could be tested a third time and
have the pass credited.

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services.skills_testing_service import (
    AttemptLimitReached,
    assert_attempts_remaining,
)


def _scalar(value):
    r = MagicMock()
    r.scalar.return_value = value
    return r


def _scalar_one(value):
    r = MagicMock()
    r.scalar_one_or_none.return_value = value
    return r


class QueuedSession:
    """AsyncSession stand-in returning queued results in call order.

    assert_attempts_remaining issues up to three queries in a fixed order:
    the requirement, the satisfied-progress count, then the spent-attempt
    count. Short-circuits mean later ones may never run.
    """

    def __init__(self, results):
        self._results = list(results)
        self.calls = 0

    async def execute(self, *args, **kwargs):
        self.calls += 1
        return self._results.pop(0) if self._results else MagicMock()


def _requirement(max_attempts):
    return SimpleNamespace(id="req-1", max_attempts=max_attempts)


async def _run(db):
    await assert_attempts_remaining(
        db=db,
        candidate_id="cand-1",
        requirement_id="req-1",
        organization_id=uuid4(),
    )


class TestAttemptLimit:
    async def test_blocks_once_the_cap_is_spent(self):
        db = QueuedSession(
            [_scalar_one(_requirement(2)), _scalar(0), _scalar(2)]  # 2 of 2 used
        )

        with pytest.raises(AttemptLimitReached) as exc:
            await _run(db)

        assert "Maximum attempts (2)" in str(exc.value)

    async def test_allows_while_attempts_remain(self):
        db = QueuedSession(
            [_scalar_one(_requirement(3)), _scalar(0), _scalar(2)]  # 2 of 3 used
        )
        await _run(db)

    async def test_blocks_when_attempts_exceed_the_cap(self):
        """Defensive: data predating enforcement can already be over the cap."""
        db = QueuedSession([_scalar_one(_requirement(2)), _scalar(0), _scalar(5)])

        with pytest.raises(AttemptLimitReached):
            await _run(db)

    async def test_no_cap_configured_is_unlimited(self):
        db = QueuedSession([_scalar_one(_requirement(None))])
        await _run(db)
        # Short-circuits before counting anything.
        assert db.calls == 1

    async def test_zero_cap_is_treated_as_unlimited(self):
        """0 means "not configured" here, matching the knowledge-test path's
        `if max_attempts and ...` — not "no attempts allowed"."""
        db = QueuedSession([_scalar_one(_requirement(0))])
        await _run(db)
        assert db.calls == 1

    async def test_unlinked_test_is_never_capped(self):
        """A test with no requirement credits nothing, so nothing rations it."""
        db = QueuedSession([])
        await assert_attempts_remaining(
            db=db,
            candidate_id="cand-1",
            requirement_id=None,
            organization_id=uuid4(),
        )
        assert db.calls == 0

    async def test_missing_requirement_does_not_block(self):
        """A dangling requirement_id (SET NULL race, deleted requirement) must
        not lock an examiner out of testing."""
        db = QueuedSession([_scalar_one(None)])
        await _run(db)
        assert db.calls == 1

    # Mirrors update_requirement_progress: a satisfied requirement is not
    # rationed, so recertification testing stays possible.
    async def test_satisfied_requirement_is_exempt(self):
        db = QueuedSession(
            [_scalar_one(_requirement(1)), _scalar(1)]  # already completed
        )
        await _run(db)
        # Stops before counting spent attempts.
        assert db.calls == 2
