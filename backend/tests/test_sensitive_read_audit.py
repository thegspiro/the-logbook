"""
HIPAA §164.312(b): reading records that can state a member's health or how they
left the department, and reading the audit trail itself, must leave an audit
event. A member reading their own record is not logged.

DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.endpoints import audit_logs, member_leaves, member_service_history

pytestmark = [pytest.mark.unit]


def _user(user_id="officer-1"):
    return SimpleNamespace(
        id=user_id, organization_id="org-1", username="officer", full_name="O"
    )


def _paging():
    return SimpleNamespace(skip=0, limit=50)


class TestLeaveReads:
    async def test_officer_listing_all_leaves_is_audited(self):
        audit = AsyncMock()
        with (
            patch.object(member_leaves, "log_audit_event", audit),
            patch.object(
                member_leaves.MemberLeaveService,
                "list_leaves",
                AsyncMock(return_value=[]),
            ),
        ):
            await member_leaves.list_leaves_of_absence(
                user_id=None,
                active_only=True,
                pagination=_paging(),
                db=MagicMock(),
                current_user=_user(),
            )
        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == "member_leaves_listed"
        assert kwargs["event_data"]["record_count"] == 0
        assert kwargs["user_id"] == "officer-1"

    async def test_officer_reading_another_members_leaves_is_audited(self):
        audit = AsyncMock()
        with (
            patch.object(member_leaves, "log_audit_event", audit),
            patch.object(
                member_leaves, "_collect_user_permissions", return_value=set()
            ),
            patch.object(member_leaves, "_has_permission", return_value=True),
            patch.object(
                member_leaves.MemberLeaveService,
                "list_leaves",
                AsyncMock(return_value=[]),
            ),
        ):
            await member_leaves.get_member_leaves(
                user_id="member-9",
                active_only=True,
                pagination=_paging(),
                db=MagicMock(),
                current_user=_user(),
            )
        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == "member_leaves_viewed"
        assert kwargs["event_data"]["target_user_id"] == "member-9"

    async def test_member_reading_their_own_leaves_is_not_audited(self):
        audit = AsyncMock()
        with (
            patch.object(member_leaves, "log_audit_event", audit),
            patch.object(
                member_leaves.MemberLeaveService,
                "list_leaves",
                AsyncMock(return_value=[]),
            ),
        ):
            await member_leaves.get_member_leaves(
                user_id="officer-1",
                active_only=True,
                pagination=_paging(),
                db=MagicMock(),
                current_user=_user(),
            )
        audit.assert_not_awaited()


class TestServiceHistoryReads:
    async def _read(self, target_id):
        audit = AsyncMock()
        response = SimpleNamespace(periods=[1, 2])
        member = SimpleNamespace(id=target_id, organization_id="org-1")
        with (
            patch.object(member_service_history, "log_audit_event", audit),
            patch.object(
                member_service_history, "user_has_permission", return_value=True
            ),
            patch.object(
                member_service_history, "_load_member", AsyncMock(return_value=member)
            ),
            patch.object(
                member_service_history,
                "_history_response",
                AsyncMock(return_value=response),
            ),
        ):
            await member_service_history.get_service_history(
                user_id=target_id, db=MagicMock(), current_user=_user()
            )
        return audit

    async def test_officer_reading_another_members_history_is_audited(self):
        audit = await self._read("member-9")
        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == "member_service_history_viewed"
        assert kwargs["event_data"] == {
            "target_user_id": "member-9",
            "period_count": 2,
        }

    async def test_member_reading_their_own_history_is_not_audited(self):
        audit = await self._read("officer-1")
        audit.assert_not_awaited()


class TestAuditTrailReads:
    def _db(self):
        result = MagicMock()
        result.scalar.return_value = 0
        result.all.return_value = []
        result.one_or_none.return_value = (
            SimpleNamespace(
                id=7,
                timestamp=None,
                event_type="x",
                event_category="y",
                severity=None,
                user_id=None,
                username="u",
                ip_address=None,
                event_data={},
            ),
            None,
        )
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)
        return db

    async def test_listing_the_audit_trail_is_audited_with_its_filters(self):
        audit = AsyncMock()
        with (
            patch.object(audit_logs, "log_audit_event", audit),
            patch.object(audit_logs, "get_client_ip", return_value="203.0.113.5"),
        ):
            await audit_logs.list_audit_logs(
                request=MagicMock(),
                event_type="login",
                event_category=None,
                severity=None,
                user_id=None,
                search=None,
                start_date=None,
                end_date=None,
                skip=0,
                limit=50,
                db=self._db(),
                current_user=_user(),
            )
        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == "audit_log_queried"
        assert kwargs["event_category"] == "audit"
        assert kwargs["event_data"]["filters"]["event_type"] == "login"
        assert kwargs["ip_address"] == "203.0.113.5"

    async def test_opening_one_audit_entry_is_audited(self):
        audit = AsyncMock()
        with (
            patch.object(audit_logs, "log_audit_event", audit),
            patch.object(audit_logs, "get_client_ip", return_value="203.0.113.5"),
        ):
            await audit_logs.get_audit_log_entry(
                log_id=7,
                request=MagicMock(),
                db=self._db(),
                current_user=_user(),
            )
        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == "audit_log_entry_viewed"
        assert kwargs["event_data"]["log_id"] == 7
