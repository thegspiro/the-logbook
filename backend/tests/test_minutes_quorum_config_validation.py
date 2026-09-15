"""MM-15: `PATCH /minutes/{id}/quorum-config` took `quorum_threshold` as a raw
`float` query parameter with only a `<= 0` check. `inf`/`-inf`/`nan` all pass
that check (NaN compares False against everything, including `<= 0`), and a
non-finite value reaching `MeetingMinutes.quorum_threshold` on commit hits
pymysql's float encoder (`ProgrammingError: inf can not be used with MySQL`)
as an unhandled 500 — confirmed directly against the FLOAT column, not
inferred. Even where a write succeeded, `QuorumService.calculate_quorum`'s
`int(q_threshold)` for the "count" branch raises OverflowError on inf. A
percentage above 100 can never be met, permanently blocking quorum with no
error explaining why. DB-free: every case here is rejected before the
endpoint's first `db.execute()` call.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.minutes import set_meeting_quorum_config


def _unused_db() -> AsyncMock:
    """A db that must not be touched — these inputs are rejected before any
    query, so a call to db.execute would itself be a regression."""
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=AssertionError("db.execute must not be called"))
    return db


async def _call(quorum_type: str, quorum_threshold: float):
    user = SimpleNamespace(organization_id="org-1")
    return await set_meeting_quorum_config(
        minutes_id="min-1",
        quorum_type=quorum_type,
        quorum_threshold=quorum_threshold,
        db=_unused_db(),
        current_user=user,
    )


class TestNonFiniteThresholdRejected:
    async def test_positive_infinity_count(self):
        with pytest.raises(HTTPException) as exc:
            await _call("count", float("inf"))
        assert exc.value.status_code == 400
        assert "finite" in exc.value.detail

    async def test_negative_infinity_percentage(self):
        with pytest.raises(HTTPException) as exc:
            await _call("percentage", float("-inf"))
        assert exc.value.status_code == 400

    async def test_nan_slips_past_a_bare_positivity_check(self):
        # float('nan') <= 0 is False, same as float('nan') > 100 — an ordinary
        # comparison chain lets NaN straight through. isfinite() is what
        # actually catches it.
        with pytest.raises(HTTPException) as exc:
            await _call("count", float("nan"))
        assert exc.value.status_code == 400
        assert "finite" in exc.value.detail


class TestBoundsStillEnforced:
    async def test_zero_rejected(self):
        with pytest.raises(HTTPException) as exc:
            await _call("count", 0.0)
        assert exc.value.status_code == 400

    async def test_negative_rejected(self):
        with pytest.raises(HTTPException) as exc:
            await _call("percentage", -5.0)
        assert exc.value.status_code == 400

    async def test_percentage_over_100_rejected(self):
        with pytest.raises(HTTPException) as exc:
            await _call("percentage", 150.0)
        assert exc.value.status_code == 400
        assert "100" in exc.value.detail

    async def test_percentage_at_100_not_rejected_by_bounds_check(self):
        # Passes validation and proceeds to the (mocked, empty-result) lookup
        # rather than raising on the bounds check itself.
        db = AsyncMock()
        db.execute = AsyncMock(
            return_value=SimpleNamespace(scalar_one_or_none=lambda: None)
        )
        user = SimpleNamespace(organization_id="org-1")
        with pytest.raises(HTTPException) as exc:
            await set_meeting_quorum_config(
                minutes_id="min-1",
                quorum_type="percentage",
                quorum_threshold=100.0,
                db=db,
                current_user=user,
            )
        assert exc.value.status_code == 404  # "Meeting not found", not a 400

    async def test_huge_but_finite_count_rejected(self):
        # Comfortably finite and positive, but far larger than any real
        # department — and close enough to MySQL FLOAT's representable range
        # that it isn't worth trusting to strict-mode enforcement either.
        with pytest.raises(HTTPException) as exc:
            await _call("count", 1e30)
        assert exc.value.status_code == 400
        assert "100000" in exc.value.detail

    async def test_ordinary_count_value_not_rejected_by_bounds_check(self):
        db = AsyncMock()
        db.execute = AsyncMock(
            return_value=SimpleNamespace(scalar_one_or_none=lambda: None)
        )
        user = SimpleNamespace(organization_id="org-1")
        with pytest.raises(HTTPException) as exc:
            await set_meeting_quorum_config(
                minutes_id="min-1",
                quorum_type="count",
                quorum_threshold=10.0,
                db=db,
                current_user=user,
            )
        assert exc.value.status_code == 404
