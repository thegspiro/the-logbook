"""
Tests for the driver qualification exception service
(app/services/driver_exception_service.py).

These cover a safety control: EVOC enforcement blocks an uncertified member
from the driver seat, and this service is the only sanctioned way around it.
The tests focus on the properties that make the exception trustworthy —
separation of duties, a bounded validity window, approved-only enforcement
matching, and the closed-request guard. DB mocked; no MySQL.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.apparatus import DriverExceptionStatus
from app.services.driver_exception_service import (
    MAX_VALIDITY_DAYS,
    DriverExceptionService,
)
from app.services.separation_of_duties import SeparationOfDutiesError

TODAY = date(2026, 8, 16)


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _exception(
    status=DriverExceptionStatus.PENDING,
    requested_by="officer-1",
    user_id="member-1",
    valid_until=None,
):
    return SimpleNamespace(
        id="exc-1",
        organization_id="org-1",
        user_id=user_id,
        apparatus_id="ap-1",
        status=status,
        requested_by=requested_by,
        reviewed_by=None,
        reviewed_at=None,
        review_notes=None,
        valid_from=TODAY - timedelta(days=1),
        valid_until=valid_until or (TODAY + timedelta(days=30)),
    )


def _payload(**overrides):
    data = {
        "user_id": "member-1",
        "apparatus_id": "ap-1",
        "reason": "parade",
        "justification": "Life member driving the antique in the Labor Day parade.",
        "restrictions": "Parade route only, no emergency response.",
        "valid_from": TODAY,
        "valid_until": TODAY + timedelta(days=1),
    }
    data.update(overrides)
    return data


class TestRequestException:
    async def test_creates_a_pending_request_not_a_grant(self):
        # A request confers nothing on its own — the whole point of the
        # approval step.
        db = _db([_one("member-1"), _one("ap-1")])
        exc = await DriverExceptionService(db).request_exception(
            "org-1", "officer-1", _payload()
        )
        assert exc.status == DriverExceptionStatus.PENDING
        assert exc.requested_by == "officer-1"
        db.commit.assert_awaited()

    async def test_rejects_member_from_another_org(self):
        db = _db([_one(None)])
        with pytest.raises(ValueError, match="Invalid member"):
            await DriverExceptionService(db).request_exception(
                "org-1", "officer-1", _payload()
            )

    async def test_rejects_apparatus_from_another_org(self):
        db = _db([_one("member-1"), _one(None)])
        with pytest.raises(ValueError, match="Invalid apparatus"):
            await DriverExceptionService(db).request_exception(
                "org-1", "officer-1", _payload()
            )

    async def test_allows_a_blanket_exception_with_no_apparatus(self):
        db = _db([_one("member-1")])
        exc = await DriverExceptionService(db).request_exception(
            "org-1", "officer-1", _payload(apparatus_id=None)
        )
        assert exc.apparatus_id is None

    async def test_rejects_inverted_dates(self):
        db = _db([_one("member-1"), _one("ap-1")])
        with pytest.raises(ValueError, match="end date cannot be before"):
            await DriverExceptionService(db).request_exception(
                "org-1",
                "officer-1",
                _payload(valid_from=TODAY, valid_until=TODAY - timedelta(days=1)),
            )

    async def test_rejects_an_unbounded_window(self):
        # There is no permanent waiver of a safety control.
        db = _db([_one("member-1"), _one("ap-1")])
        with pytest.raises(ValueError, match="at most"):
            await DriverExceptionService(db).request_exception(
                "org-1",
                "officer-1",
                _payload(
                    valid_from=TODAY,
                    valid_until=TODAY + timedelta(days=MAX_VALIDITY_DAYS + 1),
                ),
            )

    async def test_requires_a_justification(self):
        db = _db([_one("member-1"), _one("ap-1")])
        with pytest.raises(ValueError, match="justification is required"):
            await DriverExceptionService(db).request_exception(
                "org-1", "officer-1", _payload(justification="   ")
            )


class TestReviewException:
    async def test_approves_a_pending_request(self):
        db = _db([_one(_exception())])
        exc = await DriverExceptionService(db).review_exception(
            "exc-1", "org-1", "chief-1", approve=True, review_notes="Approved."
        )
        assert exc.status == DriverExceptionStatus.APPROVED
        assert exc.reviewed_by == "chief-1"
        assert exc.reviewed_at is not None

    async def test_denies_a_pending_request(self):
        db = _db([_one(_exception())])
        exc = await DriverExceptionService(db).review_exception(
            "exc-1", "org-1", "chief-1", approve=False
        )
        assert exc.status == DriverExceptionStatus.DENIED

    async def test_requester_cannot_approve_their_own_request(self):
        db = _db([_one(_exception(requested_by="chief-1"))])
        with pytest.raises(SeparationOfDutiesError):
            await DriverExceptionService(db).review_exception(
                "exc-1", "org-1", "chief-1", approve=True
            )

    async def test_beneficiary_cannot_approve_their_own_exception(self):
        # However senior. A chief who needs one asks another chief.
        db = _db([_one(_exception(requested_by="officer-1", user_id="chief-1"))])
        with pytest.raises(SeparationOfDutiesError):
            await DriverExceptionService(db).review_exception(
                "exc-1", "org-1", "chief-1", approve=True
            )

    async def test_already_decided_request_cannot_be_re_decided(self):
        db = _db([_one(_exception(status=DriverExceptionStatus.DENIED))])
        with pytest.raises(ValueError, match="already denied"):
            await DriverExceptionService(db).review_exception(
                "exc-1", "org-1", "chief-1", approve=True
            )

    async def test_cannot_approve_a_lapsed_request(self):
        db = _db([_one(_exception(valid_until=TODAY - timedelta(days=365)))])
        with pytest.raises(ValueError, match="lapsed"):
            await DriverExceptionService(db).review_exception(
                "exc-1", "org-1", "chief-1", approve=True
            )

    async def test_missing_request_raises(self):
        db = _db([_one(None)])
        with pytest.raises(ValueError, match="not found"):
            await DriverExceptionService(db).review_exception(
                "exc-1", "org-1", "chief-1", approve=True
            )


class TestRevokeException:
    async def test_revokes_an_approved_exception(self):
        db = _db([_one(_exception(status=DriverExceptionStatus.APPROVED))])
        exc = await DriverExceptionService(db).revoke_exception(
            "exc-1", "org-1", "chief-1", review_notes="Parade cancelled."
        )
        assert exc.status == DriverExceptionStatus.REVOKED

    async def test_revoking_needs_no_second_person(self):
        # Withdrawing permission is always the safe direction; requiring a
        # second signature to take an unsafe driver off a truck would be a
        # hazard, not a control.
        approved = _exception(status=DriverExceptionStatus.APPROVED)
        approved.requested_by = "chief-1"
        db = _db([_one(approved)])
        exc = await DriverExceptionService(db).revoke_exception(
            "exc-1", "org-1", "chief-1"
        )
        assert exc.status == DriverExceptionStatus.REVOKED

    async def test_pending_request_cannot_be_revoked(self):
        db = _db([_one(_exception())])
        with pytest.raises(ValueError, match="Only an approved"):
            await DriverExceptionService(db).revoke_exception(
                "exc-1", "org-1", "chief-1"
            )


class TestFindActiveException:
    """The enforcement lookup — what actually lets a blocked driver through."""

    async def test_returns_the_matching_approved_exception(self):
        match = _exception(status=DriverExceptionStatus.APPROVED)
        db = _db([_one(match)])
        found = await DriverExceptionService(db).find_active_exception(
            "member-1", "org-1", apparatus_id="ap-1", on_date=TODAY
        )
        assert found is match

    async def test_returns_none_when_nothing_covers_the_assignment(self):
        db = _db([_one(None)])
        assert (
            await DriverExceptionService(db).find_active_exception(
                "member-1", "org-1", apparatus_id="ap-1", on_date=TODAY
            )
            is None
        )

    async def test_query_filters_to_approved_only(self):
        # Pending, denied, and revoked must all leave the block in place;
        # asserted on the compiled SQL because the status filter is the whole
        # safety property of this lookup.
        db = _db([_one(None)])
        await DriverExceptionService(db).find_active_exception(
            "member-1", "org-1", apparatus_id="ap-1", on_date=TODAY
        )
        sql = str(db.execute.await_args[0][0])
        assert "status" in sql
        params = db.execute.await_args[0][0].compile().params
        assert DriverExceptionStatus.APPROVED in params.values()

    async def test_query_bounds_the_date_window(self):
        db = _db([_one(None)])
        await DriverExceptionService(db).find_active_exception(
            "member-1", "org-1", apparatus_id="ap-1", on_date=TODAY
        )
        params = db.execute.await_args[0][0].compile().params
        assert TODAY in params.values()

    async def test_blanket_exception_is_considered_for_a_specific_unit(self):
        # A NULL apparatus_id covers every unit, so the query must OR it in.
        db = _db([_one(None)])
        await DriverExceptionService(db).find_active_exception(
            "member-1", "org-1", apparatus_id="ap-1", on_date=TODAY
        )
        sql = str(db.execute.await_args[0][0])
        assert "apparatus_id IS NULL" in sql


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
