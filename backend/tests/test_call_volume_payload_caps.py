"""SCH-19: a close-out's per-member call credits and call-type tally are bounded.

Owner decision 2026-11-01 ("Cap at 100 / 200"): at most 100 per-member credits,
matching ``responding_members``, and at most 200 call-type keys, matching the
attach/detach id lists beside them. Each entry costs a lookup, so an unbounded
payload was a cost multiplier on one authenticated request. These are request
schemas only: nothing stored is read back through them, so rows written before
the cap are untouched.
"""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.scheduling import (
    MAX_MEMBER_CALL_CREDITS,
    MAX_REPORTED_CALL_TYPES,
    CloseoutCallsRequest,
    ShiftFinalizeRequest,
)

pytestmark = pytest.mark.unit


def _credits(n: int) -> list:
    return [{"user_id": str(uuid4()), "call_count": 0} for _ in range(n)]


def _types(n: int) -> dict:
    return {f"type_{i}": 0 for i in range(n)}


def test_the_caps_are_the_owner_picked_numbers():
    assert MAX_MEMBER_CALL_CREDITS == 100
    assert MAX_REPORTED_CALL_TYPES == 200


class TestShiftFinalizeRequest:
    def test_accepts_exactly_the_cap(self):
        body = ShiftFinalizeRequest(
            reported_call_count=0,
            member_call_counts=_credits(100),
            reported_call_types=_types(200),
        )
        assert len(body.member_call_counts or []) == 100
        assert len(body.reported_call_types or {}) == 200

    def test_refuses_101_member_credits(self):
        with pytest.raises(ValidationError) as exc:
            ShiftFinalizeRequest(
                reported_call_count=0, member_call_counts=_credits(101)
            )
        error = exc.value.errors()[0]
        assert error["loc"] == ("member_call_counts",)
        assert error["type"] == "too_long"
        assert "at most 100" in error["msg"]

    def test_refuses_201_call_types(self):
        with pytest.raises(ValidationError) as exc:
            ShiftFinalizeRequest(reported_call_count=0, reported_call_types=_types(201))
        error = exc.value.errors()[0]
        assert error["loc"] == ("reported_call_types",)
        assert error["type"] == "too_long"
        assert "at most 200" in error["msg"]


class TestCloseoutCallsRequest:
    def test_accepts_exactly_the_cap(self):
        body = CloseoutCallsRequest(
            reported_call_count=0, reported_call_types=_types(200)
        )
        assert len(body.reported_call_types or {}) == 200

    def test_refuses_201_call_types(self):
        with pytest.raises(ValidationError) as exc:
            CloseoutCallsRequest(reported_call_count=0, reported_call_types=_types(201))
        error = exc.value.errors()[0]
        assert error["loc"] == ("reported_call_types",)
        assert "at most 200" in error["msg"]
