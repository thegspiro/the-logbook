"""IP exception state changes read the row with a lock.

Approve, reject and revoke are check-then-write: read the exception, require it
to be pending (or approved), then write the new status and who did it. Two
administrators acting on one request at the same moment both pass the check, so
an approval and a rejection can both land and leave the row approved with a
rejection's attribution beside it. On an allowlist that is a security control
whose recorded decision does not match its effect (CLAUDE.md pitfall #27).

The race itself needs two connections, so this asserts the cause: each lookup is
a locking read. The alert workflow already does the same for the same reason.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.ip_security import IPExceptionApprovalStatus
from app.services.ip_security_service import IPSecurityService

pytestmark = [pytest.mark.unit]


def _db_returning(exception):
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=exception)
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _locked(db) -> bool:
    statement = db.execute.await_args_list[0].args[0]
    return statement._for_update_arg is not None


class TestTheExceptionLookupIsALockingRead:
    async def test_approving_locks_the_row(self):
        settled = SimpleNamespace(approval_status=IPExceptionApprovalStatus.REJECTED)
        db = _db_returning(settled)

        with pytest.raises(ValueError, match="not pending"):
            await IPSecurityService().approve_exception(db, "e1", "admin", "org1")

        assert _locked(db)

    async def test_rejecting_locks_the_row(self):
        settled = SimpleNamespace(approval_status=IPExceptionApprovalStatus.APPROVED)
        db = _db_returning(settled)

        with pytest.raises(ValueError, match="not pending"):
            await IPSecurityService().reject_exception(db, "e1", "admin", "org1", "no")

        assert _locked(db)

    async def test_revoking_locks_the_row(self):
        pending = SimpleNamespace(approval_status=IPExceptionApprovalStatus.PENDING)
        db = _db_returning(pending)

        with pytest.raises(ValueError, match="Can only revoke approved"):
            await IPSecurityService().revoke_exception(db, "e1", "admin", "org1", "x")

        assert _locked(db)
