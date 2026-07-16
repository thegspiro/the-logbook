"""
Tests for the messaging service (app/services/messaging_service.py).

Focus on the message-visibility gate _is_targeted (the security-relevant
rule deciding which members see a message: all / by role / by status / by
explicit member id) and the unread-count flow that builds on it. DB mocked;
no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.messaging_service import MessagingService


def _msg(
    mid="m1",
    target_type="all",
    roles=None,
    statuses=None,
    members=None,
    requires_acknowledgment=False,
):
    return SimpleNamespace(
        id=mid,
        target_type=target_type,
        target_roles=roles,
        target_statuses=statuses,
        target_member_ids=members,
        requires_acknowledgment=requires_acknowledgment,
        deleted_at=None,
    )


def _svc():
    return MessagingService(MagicMock())


def _targeted(message, user_id="u1", role_ids=None, roles=None, status="active"):
    return _svc()._is_targeted(message, user_id, role_ids or [], roles or [], status)


class TestIsTargeted:
    def test_all_reaches_everyone(self):
        assert _targeted(_msg(target_type="all")) is True

    def test_roles_match_by_id(self):
        # Primary path: target_roles holds role ids.
        msg = _msg(target_type="roles", roles=["role-officer", "role-chief"])
        assert _targeted(msg, role_ids=["role-ff", "role-officer"]) is True

    def test_roles_match_by_name_fallback(self):
        # Legacy/un-backfillable entries stored as names still match.
        msg = _msg(target_type="roles", roles=["officer", "chief"])
        assert _targeted(msg, roles=["firefighter", "officer"]) is True

    def test_roles_no_match(self):
        msg = _msg(target_type="roles", roles=["role-chief"])
        assert _targeted(msg, role_ids=["role-ff"], roles=["firefighter"]) is False

    def test_roles_empty_target_denies(self):
        assert (
            _targeted(_msg(target_type="roles", roles=[]), role_ids=["role-chief"])
            is False
        )

    def test_statuses_match(self):
        msg = _msg(target_type="statuses", statuses=["active", "probationary"])
        assert _targeted(msg, status="probationary") is True

    def test_statuses_no_match(self):
        msg = _msg(target_type="statuses", statuses=["retired"])
        assert _targeted(msg, status="active") is False

    def test_members_match(self):
        msg = _msg(target_type="members", members=["u1", "u2"])
        assert _targeted(msg, user_id="u2") is True

    def test_members_no_match(self):
        msg = _msg(target_type="members", members=["u3"])
        assert _targeted(msg, user_id="u1") is False

    def test_unknown_target_denies(self):
        assert _targeted(_msg(target_type="mystery")) is False

    def test_enum_target_type_is_handled(self):
        msg = _msg(target_type=SimpleNamespace(value="roles"), roles=["chief"])
        assert _targeted(msg, roles=["chief"]) is True


class TestUnreadCount:
    def _user(self, roles=("officer",), status="active"):
        return SimpleNamespace(
            roles=[SimpleNamespace(id=r, name=r) for r in roles],
            status=SimpleNamespace(value=status),
        )

    def _read(self, message_id, acknowledged_at=None):
        # Mirrors the (message_id, acknowledged_at) row the lightweight unread
        # query now selects.
        return SimpleNamespace(message_id=message_id, acknowledged_at=acknowledged_at)

    def _db(self, user, messages, reads):
        db = MagicMock()
        user_res = MagicMock(scalar_one_or_none=MagicMock(return_value=user))
        # get_unread_count now selects columns (not full ORM objects) and reads
        # them via result.all().
        msg_res = MagicMock(all=MagicMock(return_value=messages))
        # The reads result is iterated directly (for r in result).
        db.execute = AsyncMock(side_effect=[user_res, msg_res, list(reads)])
        return db

    async def test_returns_zero_when_user_missing(self):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None))
        )
        assert await MessagingService(db).get_unread_count("org-1", "u1") == 0

    async def test_counts_visible_minus_read(self):
        messages = [
            _msg("m1", "all"),
            _msg("m2", "roles", roles=["officer"]),
            _msg("m3", "roles", roles=["chief"]),  # not visible to officer
        ]
        # m1 has a read record -> resolved. m2 unread -> pending.
        db = self._db(
            self._user(roles=("officer",)), messages, reads=[self._read("m1")]
        )
        assert await MessagingService(db).get_unread_count("org-1", "u1") == 1

    async def test_ack_required_message_stays_pending_until_acknowledged(self):
        # A read-but-not-acknowledged ack-required message is still pending.
        messages = [_msg("m1", "all", requires_acknowledgment=True)]
        db = self._db(
            self._user(), messages, reads=[self._read("m1", acknowledged_at=None)]
        )
        assert await MessagingService(db).get_unread_count("org-1", "u1") == 1

    async def test_ack_required_message_clears_once_acknowledged(self):
        messages = [_msg("m1", "all", requires_acknowledgment=True)]
        db = self._db(
            self._user(),
            messages,
            reads=[self._read("m1", acknowledged_at=datetime.now(timezone.utc))],
        )
        assert await MessagingService(db).get_unread_count("org-1", "u1") == 0

    async def test_zero_when_nothing_visible(self):
        messages = [_msg("m1", "roles", roles=["chief"])]
        db = MagicMock()
        user_res = MagicMock(
            scalar_one_or_none=MagicMock(return_value=self._user(roles=("officer",)))
        )
        msg_res = MagicMock(all=MagicMock(return_value=messages))
        # No read query should run when nothing is visible.
        db.execute = AsyncMock(side_effect=[user_res, msg_res])
        assert await MessagingService(db).get_unread_count("org-1", "u1") == 0


class TestReadAckVisibilityGate:
    """mark_as_read / acknowledge_message must only record against a message
    the user can actually see (in-org and targeted), or a user could pollute
    another org's stats / fake a compliance acknowledgment by POSTing an id."""

    def _user(self, roles=(), status="active"):
        return SimpleNamespace(
            roles=[SimpleNamespace(id=r, name=r) for r in roles],
            status=SimpleNamespace(value=status),
        )

    async def test_mark_as_read_rejects_unknown_or_foreign_message(self):
        db = MagicMock()
        # get_message_by_id is org-scoped; a foreign/unknown id resolves to None.
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None))
        )
        db.add = MagicMock()
        ok, err = await MessagingService(db).mark_as_read("m1", "u1", "org-1")
        assert ok is False
        assert err == "Message not found"
        db.add.assert_not_called()

    async def test_mark_as_read_rejects_untargeted_message(self):
        message = _msg("m1", "roles", roles=["chief"])
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                MagicMock(scalar_one_or_none=MagicMock(return_value=message)),
                MagicMock(
                    scalar_one_or_none=MagicMock(
                        return_value=self._user(roles=("officer",))
                    )
                ),
            ]
        )
        db.add = MagicMock()
        ok, err = await MessagingService(db).mark_as_read("m1", "u1", "org-1")
        assert ok is False
        db.add.assert_not_called()

    async def test_mark_as_read_records_visible_message(self):
        message = _msg("m1", "all")
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                MagicMock(scalar_one_or_none=MagicMock(return_value=message)),
                MagicMock(scalar_one_or_none=MagicMock(return_value=self._user())),
                MagicMock(scalar_one_or_none=MagicMock(return_value=None)),
            ]
        )
        db.add = MagicMock()
        db.commit = AsyncMock()
        ok, err = await MessagingService(db).mark_as_read("m1", "u1", "org-1")
        assert ok is True
        assert err is None
        db.add.assert_called_once()

    async def test_acknowledge_rejects_untargeted_message(self):
        message = _msg("m1", "members", members=["someone-else"])
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                MagicMock(scalar_one_or_none=MagicMock(return_value=message)),
                MagicMock(scalar_one_or_none=MagicMock(return_value=self._user())),
            ]
        )
        db.add = MagicMock()
        ok, _ = await MessagingService(db).acknowledge_message("m1", "u1", "org-1")
        assert ok is False
        db.add.assert_not_called()


class TestSoftDelete:
    """delete_message must preserve read/acknowledgment rows (compliance
    evidence) by soft-deleting instead of issuing a hard DELETE."""

    async def test_delete_soft_deletes_and_deactivates(self):
        message = SimpleNamespace(deleted_at=None, is_active=True)
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=message))
        )
        db.commit = AsyncMock()
        db.delete = MagicMock()

        ok, err = await MessagingService(db).delete_message("m1", "org-1")

        assert ok is True
        assert err is None
        assert message.deleted_at is not None
        assert message.is_active is False
        # No hard delete — the row (and its cascade of reads) stays.
        db.delete.assert_not_called()

    async def test_delete_already_deleted_is_not_found(self):
        message = SimpleNamespace(
            deleted_at=datetime.now(timezone.utc), is_active=False
        )
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=message))
        )
        db.commit = AsyncMock()

        ok, err = await MessagingService(db).delete_message("m1", "org-1")

        assert ok is False
        assert err == "Message not found"


class TestAcknowledgmentReport:
    """get_acknowledgment_report answers "who has (not) acknowledged" for the
    targeted audience, with pending recipients surfaced first."""

    def _user(self, uid, first, roles=(), status="active"):
        return SimpleNamespace(
            id=uid,
            first_name=first,
            last_name="",
            username=first.lower(),
            roles=[SimpleNamespace(id=r, name=r) for r in roles],
            status=SimpleNamespace(value=status),
        )

    async def test_reports_targeted_read_and_ack_state(self):
        message = _msg("m1", "all", requires_acknowledgment=True)
        users = [self._user("u1", "Ann"), self._user("u2", "Ben")]
        now = datetime.now(timezone.utc)
        read_u1 = SimpleNamespace(user_id="u1", read_at=now, acknowledged_at=now)

        db = MagicMock()
        msg_res = MagicMock(scalar_one_or_none=MagicMock(return_value=message))
        users_res = MagicMock()
        users_res.scalars.return_value.all.return_value = users
        reads_res = MagicMock()
        reads_res.scalars.return_value.all.return_value = [read_u1]
        db.execute = AsyncMock(side_effect=[msg_res, users_res, reads_res])

        report = await MessagingService(db).get_acknowledgment_report("m1", "org-1")

        assert report is not None
        assert report["total_targeted"] == 2
        assert report["total_read"] == 1
        assert report["total_acknowledged"] == 1
        # Pending recipient (u2) is surfaced before the acknowledged one (u1).
        assert [r["user_id"] for r in report["recipients"]] == ["u2", "u1"]
        assert report["recipients"][0]["is_acknowledged"] is False
        assert report["recipients"][1]["is_acknowledged"] is True

    async def test_missing_message_returns_none(self):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None))
        )
        report = await MessagingService(db).get_acknowledgment_report(
            "missing", "org-1"
        )
        assert report is None


class TestGetMessages:
    async def test_returns_page_and_total_with_search_and_priority(self):
        db = MagicMock()
        count_res = MagicMock(scalar=MagicMock(return_value=3))
        page_res = MagicMock()
        page_res.scalars.return_value.all.return_value = [_msg("m1")]
        db.execute = AsyncMock(side_effect=[count_res, page_res])

        messages, total = await MessagingService(db).get_messages(
            "org-1", search="drill", priority="urgent", skip=0, limit=25
        )

        assert total == 3
        assert [m.id for m in messages] == ["m1"]
        # A count query and a page query were both issued.
        assert db.execute.await_count == 2


class TestCreateScheduling:
    """create_message only defers on a *future* scheduled_at; a past or absent
    value means publish-now (stored as NULL)."""

    def _db(self):
        db = MagicMock()
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        return db

    async def test_future_scheduled_at_is_stored(self):
        future = datetime.now(timezone.utc) + timedelta(hours=2)
        message, err = await MessagingService(self._db()).create_message(
            "org-1", "author", "Drill", "Body", scheduled_at=future
        )
        assert err is None
        assert message.scheduled_at == future

    async def test_past_scheduled_at_becomes_immediate(self):
        past = datetime.now(timezone.utc) - timedelta(hours=2)
        message, _ = await MessagingService(self._db()).create_message(
            "org-1", "author", "Drill", "Body", scheduled_at=past
        )
        assert message.scheduled_at is None

    async def test_no_schedule_is_immediate(self):
        message, _ = await MessagingService(self._db()).create_message(
            "org-1", "author", "Drill", "Body"
        )
        assert message.scheduled_at is None


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
