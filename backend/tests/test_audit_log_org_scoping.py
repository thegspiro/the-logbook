"""
SEC-10 (pass 2): the security-monitoring audit-log endpoints must scope by the
AuditLog.organization_id column (the write-time org stamp), matching the
canonical audit_logs.py endpoint — not by a user-id-membership subquery, which
dropped org-stamped system rows (NULL user_id) and resolved membership from the
user's current org rather than the row's stamp. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.dialects import mysql

from app.api.v1.endpoints.security_monitoring import (
    export_audit_logs,
    get_audit_log_entries,
)


def _capturing_db():
    captured = []

    async def cap(stmt, *a, **k):
        captured.append(stmt)
        result = MagicMock()
        result.scalar.return_value = 0
        result.scalars.return_value.all.return_value = []
        return result

    db = MagicMock()
    db.execute = AsyncMock(side_effect=cap)
    db.flush = AsyncMock()
    return db, captured


def _sqls(captured):
    return [str(s.compile(dialect=mysql.dialect())).lower() for s in captured]


def _user():
    return SimpleNamespace(id="u1", organization_id="org-1", username="admin")


class TestAuditLogOrgScoping:
    async def test_entries_scopes_by_org_column_not_user_subquery(self):
        db, captured = _capturing_db()
        with patch(
            "app.api.v1.endpoints.security_monitoring.log_audit_event",
            new=AsyncMock(),
        ):
            await get_audit_log_entries(
                MagicMock(), None, None, None, None, 0, 100, db, _user()
            )
        sqls = _sqls(captured)
        assert sqls, "no queries captured"
        assert all("audit_logs.organization_id" in s for s in sqls)
        # Must not resolve the org via a users-membership subquery.
        assert not any("from users" in s for s in sqls)

    async def test_export_scopes_by_org_column_not_user_subquery(self):
        db, captured = _capturing_db()
        with patch(
            "app.api.v1.endpoints.security_monitoring.log_audit_event",
            new=AsyncMock(),
        ):
            await export_audit_logs(
                MagicMock(), None, None, None, None, None, 1000, db, _user()
            )
        sqls = _sqls(captured)
        assert sqls, "no queries captured"
        assert any("audit_logs.organization_id" in s for s in sqls)
        assert not any("from users" in s for s in sqls)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
