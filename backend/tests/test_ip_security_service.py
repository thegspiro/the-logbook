"""
Tests for the IP security approval workflow (app/services/ip_security_service.py).

Focus: the IT-admin actions (approve / reject / revoke) and the exception
audit-log read are scoped to the admin's own organization, so an admin in
org A cannot action or read another org's exception by guessing its ID
(cross-org IDOR regression). DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.ip_security import IPExceptionApprovalStatus
from app.services.ip_security_service import IPSecurityService


def _exception(**kw):
    """A stand-in IPException the service mutates in place."""
    return SimpleNamespace(
        id=kw.get("id", "exc-1"),
        organization_id=kw.get("organization_id", "org-A"),
        user_id="user-1",
        ip_address="203.0.113.7",
        approval_status=kw.get("status", IPExceptionApprovalStatus.PENDING),
        requested_duration_days=kw.get("requested_duration_days", 30),
        approved_by=None,
        approved_at=None,
        approval_notes=None,
        approved_duration_days=None,
        valid_from=None,
        valid_until=None,
        rejected_by=None,
        rejected_at=None,
        rejection_reason=None,
        revoked_by=None,
        revoked_at=None,
        revoke_reason=None,
        days_remaining=lambda: 5,
    )


def _db(found):
    """A mocked AsyncSession whose lookup returns `found` (or None)."""
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = found
    db.execute = AsyncMock(return_value=result)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _executed_sql(db):
    """Compile the SELECT passed to db.execute with literal bind values."""
    stmt = db.execute.call_args.args[0]
    return str(stmt.compile(compile_kwargs={"literal_binds": True}))


@pytest.fixture
def svc():
    return IPSecurityService()


class TestApproveExceptionOrgScoping:
    async def test_approves_own_org_exception(self, svc):
        exc = _exception(organization_id="org-A")
        db = _db(exc)
        out = await svc.approve_exception(
            db=db, exception_id="exc-1", admin_id="admin-A", organization_id="org-A"
        )
        assert out.approval_status == IPExceptionApprovalStatus.APPROVED
        assert out.approved_by == "admin-A"
        db.commit.assert_awaited()

    async def test_lookup_is_org_scoped(self, svc):
        db = _db(_exception(organization_id="org-A"))
        await svc.approve_exception(
            db=db, exception_id="exc-1", admin_id="admin-A", organization_id="org-A"
        )
        sql = _executed_sql(db)
        assert "organization_id" in sql
        assert "org-A" in sql

    async def test_cross_org_lookup_is_rejected(self, svc):
        # Org-scoped query finds nothing for a foreign exception → not found.
        db = _db(None)
        with pytest.raises(ValueError, match="Exception not found"):
            await svc.approve_exception(
                db=db,
                exception_id="exc-1",
                admin_id="admin-B",
                organization_id="org-B",
            )
        db.commit.assert_not_awaited()

    async def test_non_pending_cannot_be_approved(self, svc):
        exc = _exception(status=IPExceptionApprovalStatus.APPROVED)
        with pytest.raises(ValueError, match="not pending"):
            await svc.approve_exception(
                db=_db(exc),
                exception_id="exc-1",
                admin_id="admin-A",
                organization_id="org-A",
            )

    async def test_duration_is_capped(self, svc):
        exc = _exception(requested_duration_days=9999)
        out = await svc.approve_exception(
            db=_db(exc),
            exception_id="exc-1",
            admin_id="admin-A",
            organization_id="org-A",
        )
        assert out.approved_duration_days == 90


class TestRejectExceptionOrgScoping:
    async def test_rejects_own_org_exception(self, svc):
        exc = _exception()
        db = _db(exc)
        out = await svc.reject_exception(
            db=db,
            exception_id="exc-1",
            admin_id="admin-A",
            organization_id="org-A",
            rejection_reason="not justified",
        )
        assert out.approval_status == IPExceptionApprovalStatus.REJECTED
        assert "organization_id" in _executed_sql(db)

    async def test_cross_org_lookup_is_rejected(self, svc):
        with pytest.raises(ValueError, match="Exception not found"):
            await svc.reject_exception(
                db=_db(None),
                exception_id="exc-1",
                admin_id="admin-B",
                organization_id="org-B",
                rejection_reason="x",
            )

    async def test_reason_required(self, svc):
        with pytest.raises(ValueError, match="Rejection reason is required"):
            await svc.reject_exception(
                db=_db(_exception()),
                exception_id="exc-1",
                admin_id="admin-A",
                organization_id="org-A",
                rejection_reason="",
            )


class TestRevokeExceptionOrgScoping:
    async def test_revokes_own_org_exception(self, svc):
        exc = _exception(status=IPExceptionApprovalStatus.APPROVED)
        db = _db(exc)
        out = await svc.revoke_exception(
            db=db,
            exception_id="exc-1",
            admin_id="admin-A",
            organization_id="org-A",
            revoke_reason="travel ended",
        )
        assert out.approval_status == IPExceptionApprovalStatus.REVOKED
        assert "organization_id" in _executed_sql(db)

    async def test_cross_org_lookup_is_rejected(self, svc):
        with pytest.raises(ValueError, match="Exception not found"):
            await svc.revoke_exception(
                db=_db(None),
                exception_id="exc-1",
                admin_id="admin-B",
                organization_id="org-B",
                revoke_reason="x",
            )

    async def test_only_approved_can_be_revoked(self, svc):
        exc = _exception(status=IPExceptionApprovalStatus.PENDING)
        with pytest.raises(ValueError, match="Can only revoke approved"):
            await svc.revoke_exception(
                db=_db(exc),
                exception_id="exc-1",
                admin_id="admin-A",
                organization_id="org-A",
                revoke_reason="x",
            )


class TestAuditLogOrgScoping:
    async def test_audit_log_query_is_org_scoped(self, svc):
        db = MagicMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = []
        db.execute = AsyncMock(return_value=result)
        await svc.get_exception_audit_log(
            db=db, exception_id="exc-1", organization_id="org-A"
        )
        sql = _executed_sql(db)
        # Joins to the parent exception and filters on its org.
        assert "organization_id" in sql
        assert "org-A" in sql
