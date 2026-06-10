"""
Tests for the member archive service (app/services/member_archive_service.py).

Covers the auto-archive gate (only dropped members, and only once every piece
of department property is returned and clearances are closed), the archive
transition itself, and reactivation — including the membership-number reclaim
rules. The DB session and side-effect collaborators (audit log, email) are
mocked, so the suite needs no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.user import UserStatus
from app.services import member_archive_service as svc


def _result(scalar_one=None, scalar=None, scalars_all=None):
    r = MagicMock()
    r.scalar_one_or_none.return_value = scalar_one
    r.scalar.return_value = scalar
    r.scalars.return_value.all.return_value = scalars_all or []
    return r


def _db(*results):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=list(results))
    db.commit = AsyncMock()
    return db


def _member(status, **kw):
    return SimpleNamespace(
        id=kw.get("id", str(uuid4())),
        status=status,
        full_name=kw.get("full_name", "Jane Smith"),
        username=kw.get("username", "jsmith"),
        membership_number=kw.get("membership_number"),
        previous_membership_number=kw.get("previous_membership_number"),
        archived_at=None,
        status_changed_at=None,
        status_change_reason=None,
    )


@pytest.fixture(autouse=True)
def _quiet_side_effects(monkeypatch):
    """Neutralise the audit-log and email collaborators for every test."""
    import app.core.audit as audit

    monkeypatch.setattr(audit, "log_audit_event", AsyncMock())

    import app.services.email_service as email_service

    monkeypatch.setattr(email_service, "EmailService", MagicMock())
    monkeypatch.setattr(email_service, "build_email_logo_html", lambda org: "")


class TestAutoArchiveGate:
    async def test_skips_unknown_member(self):
        db = _db(_result(scalar_one=None))
        assert await svc.check_and_auto_archive(db, "u", "o") is None

    async def test_skips_active_member(self):
        db = _db(_result(scalar_one=_member(UserStatus.ACTIVE)))
        assert await svc.check_and_auto_archive(db, "u", "o") is None
        # Only the member lookup ran — no property scans for non-dropped members.
        assert db.execute.await_count == 1

    async def test_skips_when_assignment_remains(self):
        db = _db(
            _result(scalar_one=_member(UserStatus.DROPPED_VOLUNTARY)),
            _result(scalar_one="assignment-id"),
        )
        assert await svc.check_and_auto_archive(db, "u", "o") is None

    async def test_skips_when_checkout_remains(self):
        db = _db(
            _result(scalar_one=_member(UserStatus.DROPPED_VOLUNTARY)),
            _result(scalar_one=None),
            _result(scalar_one="checkout-id"),
        )
        assert await svc.check_and_auto_archive(db, "u", "o") is None

    async def test_skips_when_issuance_remains(self):
        db = _db(
            _result(scalar_one=_member(UserStatus.DROPPED_INVOLUNTARY)),
            _result(scalar_one=None),
            _result(scalar_one=None),
            _result(scalar_one="issuance-id"),
        )
        assert await svc.check_and_auto_archive(db, "u", "o") is None

    async def test_skips_when_clearance_open(self):
        db = _db(
            _result(scalar_one=_member(UserStatus.DROPPED_VOLUNTARY)),
            _result(scalar_one=None),
            _result(scalar_one=None),
            _result(scalar_one=None),
            _result(scalar_one="clearance-id"),
        )
        assert await svc.check_and_auto_archive(db, "u", "o") is None


class TestAutoArchiveTransition:
    async def test_archives_when_everything_is_returned(self):
        member = _member(UserStatus.DROPPED_VOLUNTARY)
        db = _db(
            _result(scalar_one=member),  # member lookup
            _result(scalar_one=None),  # assignments
            _result(scalar_one=None),  # checkouts
            _result(scalar_one=None),  # issuances
            _result(scalar_one=None),  # clearances
            _result(scalar_one=None),  # org lookup (email path)
            _result(scalars_all=[]),  # admins (none → no email)
        )
        info = await svc.check_and_auto_archive(db, member.id, "org")
        assert info is not None
        assert member.status == UserStatus.ARCHIVED
        assert member.archived_at is not None
        assert info["previous_status"] == UserStatus.DROPPED_VOLUNTARY.value
        assert info["new_status"] == UserStatus.ARCHIVED.value
        db.commit.assert_awaited()


class TestReactivate:
    async def test_member_not_found(self):
        db = _db(_result(scalar_one=None))
        with pytest.raises(ValueError, match="not found"):
            await svc.reactivate_member(db, "u", "o", "admin")

    async def test_rejects_non_archived_member(self):
        db = _db(_result(scalar_one=_member(UserStatus.ACTIVE)))
        with pytest.raises(ValueError, match="Only archived members"):
            await svc.reactivate_member(db, "u", "o", "admin")

    async def test_reactivates_and_restores_free_membership_number(self):
        member = _member(
            UserStatus.ARCHIVED,
            membership_number=None,
            previous_membership_number="M-042",
        )
        db = _db(
            _result(scalar_one=member),
            _result(scalar=0),  # no conflict — number is free
            _result(scalar_one=None),  # performer lookup (audit)
        )
        info = await svc.reactivate_member(db, member.id, "org", "admin")
        assert member.status == UserStatus.ACTIVE
        assert member.membership_number == "M-042"
        assert member.previous_membership_number is None
        assert info["new_status"] == UserStatus.ACTIVE.value

    async def test_keeps_previous_number_when_taken(self):
        # The old number now belongs to someone else: nothing is restored, and
        # the previous number is preserved as the record of what it was.
        member = _member(
            UserStatus.ARCHIVED,
            membership_number=None,
            previous_membership_number="M-042",
        )
        db = _db(
            _result(scalar_one=member),
            _result(scalar=1),  # conflict — number is taken
            _result(scalar_one=None),
        )
        await svc.reactivate_member(db, member.id, "org", "admin")
        assert member.status == UserStatus.ACTIVE
        assert member.membership_number is None
        assert member.previous_membership_number == "M-042"

    async def test_keeps_current_number_untouched(self):
        member = _member(UserStatus.ARCHIVED, membership_number="M-007")
        db = _db(
            _result(scalar_one=member),
            _result(scalar_one=None),  # performer lookup
        )
        await svc.reactivate_member(db, member.id, "org", "admin", reason="Returned")
        assert member.membership_number == "M-007"
        assert member.status_change_reason == "Returned"
