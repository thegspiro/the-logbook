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

import pytest

from app.api.v1.endpoints import messages as messages_endpoint
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


class TestTargetedUsers:
    async def test_only_queries_active_non_deleted_users(self):
        db = MagicMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = []
        db.execute = AsyncMock(return_value=result)

        assert await MessagingService(db)._targeted_users(_msg(), "org-1") == []

        query = db.execute.await_args.args[0]
        sql = str(query)
        assert "users.organization_id = :organization_id_1" in sql
        assert "users.status = :status_1" in sql
        assert "users.deleted_at IS NULL" in sql


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


class TestInboxQuery:
    async def _queries(self):
        user = SimpleNamespace(roles=[], status=SimpleNamespace(value="active"))
        user_result = MagicMock(scalar_one_or_none=MagicMock(return_value=user))
        messages_result = MagicMock()
        messages_result.scalars.return_value.all.return_value = []
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[user_result, messages_result])

        await MessagingService(db).get_inbox("org-1", "u1", limit=10)

        return [call.args[0] for call in db.execute.await_args_list]

    async def test_scopes_user_lookup_to_the_requested_organization(self):
        user_query, _ = await self._queries()

        sql = str(user_query)
        assert "users.id = :id_1" in sql
        assert "users.organization_id = :organization_id_1" in sql

    async def test_uses_stable_persistent_first_ordering(self):
        _, messages_query = await self._queries()

        assert (
            "department_messages.is_pinned DESC, "
            "department_messages.is_persistent DESC, "
            "department_messages.created_at DESC, "
            "department_messages.id DESC"
        ) in str(messages_query)

    async def test_paginates_before_loading_org_scoped_author_names(self):
        user = SimpleNamespace(roles=[], status=SimpleNamespace(value="active"))
        messages = [
            SimpleNamespace(
                id=f"m-{number}",
                title=f"Message {number}",
                body="Body",
                priority="normal",
                target_type="all",
                target_roles=None,
                target_statuses=None,
                target_member_ids=None,
                is_pinned=False,
                is_persistent=False,
                requires_acknowledgment=False,
                posted_by=f"author-{number}",
                created_at=None,
                expires_at=None,
            )
            for number in range(2)
        ]
        user_result = MagicMock(scalar_one_or_none=MagicMock(return_value=user))
        messages_result = MagicMock()
        messages_result.scalars.return_value.all.return_value = messages
        reads_result = MagicMock()
        reads_result.scalars.return_value.all.return_value = []
        authors_result = MagicMock(
            all=MagicMock(
                return_value=[
                    SimpleNamespace(id="author-0", first_name=None, last_name=None)
                ]
            )
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[user_result, messages_result, reads_result, authors_result]
        )

        inbox = await MessagingService(db).get_inbox("org-1", "u1", limit=1)

        assert [message["id"] for message in inbox] == ["m-0"]
        assert inbox[0]["author_name"] == "Unknown"
        author_query = db.execute.await_args_list[3].args[0]
        assert author_query.compile().params["id_1"] == ["author-0"]
        assert "users.organization_id = :organization_id_1" in str(author_query)


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

    async def test_visibility_query_rejects_non_live_messages(self):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None))
        )

        message = await MessagingService(db)._visible_message_or_none(
            "m1", "u1", "org-1"
        )

        assert message is None
        query = db.execute.await_args.args[0]
        sql = str(query)
        assert "department_messages.is_active IS true" in sql
        assert "department_messages.deleted_at IS NULL" in sql
        assert "department_messages.expires_at >" in sql
        assert "department_messages.scheduled_at <=" in sql

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
        ok, _, _ = await MessagingService(db).acknowledge_message("m1", "u1", "org-1")
        assert ok is False
        db.add.assert_not_called()

    async def test_acknowledge_rejects_message_that_does_not_require_it(self):
        message = _msg("m1", "all", requires_acknowledgment=False)
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                MagicMock(scalar_one_or_none=MagicMock(return_value=message)),
                MagicMock(scalar_one_or_none=MagicMock(return_value=self._user())),
            ]
        )
        db.add = MagicMock()

        ok, error, changed = await MessagingService(db).acknowledge_message(
            "m1", "u1", "org-1"
        )

        assert ok is False
        assert error == "Message does not require acknowledgment"
        assert changed is False
        db.add.assert_not_called()

    async def test_repeated_acknowledgment_reports_no_state_change(self):
        message = _msg("m1", "all", requires_acknowledgment=True)
        acknowledged_at = datetime.now(timezone.utc)
        read_record = SimpleNamespace(acknowledged_at=acknowledged_at)
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                MagicMock(scalar_one_or_none=MagicMock(return_value=message)),
                MagicMock(scalar_one_or_none=MagicMock(return_value=self._user())),
                MagicMock(scalar_one_or_none=MagicMock(return_value=read_record)),
            ]
        )
        db.commit = AsyncMock()

        ok, error, changed = await MessagingService(db).acknowledge_message(
            "m1", "u1", "org-1"
        )

        assert ok is True
        assert error is None
        assert changed is False
        assert read_record.acknowledged_at == acknowledged_at
        db.commit.assert_not_awaited()


@pytest.mark.parametrize(("changed", "expected_audits"), [(True, 1), (False, 0)])
async def test_acknowledgment_audit_only_records_state_change(
    monkeypatch, changed, expected_audits
):
    service = MagicMock()
    service.acknowledge_message = AsyncMock(return_value=(True, None, changed))
    monkeypatch.setattr(
        messages_endpoint, "MessagingService", MagicMock(return_value=service)
    )
    audit = AsyncMock()
    monkeypatch.setattr(messages_endpoint, "log_audit_event", audit)
    user = SimpleNamespace(id="u1", organization_id="org-1", username="firefighter")

    result = await messages_endpoint.acknowledge_message("m1", MagicMock(), user)

    assert result == {"status": "ok"}
    assert audit.await_count == expected_audits


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


class TestRescheduleGuard:
    """A published message (scheduled_at NULL) can't be moved to a future time,
    which would make the publish task escalate it a second time."""

    def _db_with(self, message):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=message))
        )
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        return db

    async def test_cannot_reschedule_already_published_message(self):
        published = SimpleNamespace(scheduled_at=None)
        db = self._db_with(published)
        future = datetime.now(timezone.utc) + timedelta(hours=1)
        message, err = await MessagingService(db).update_message(
            "m1", "org-1", {"scheduled_at": future}
        )
        assert message is None
        assert "already been published" in err

    async def test_can_reschedule_a_still_pending_message(self):
        pending = SimpleNamespace(
            scheduled_at=datetime.now(timezone.utc) + timedelta(hours=5)
        )
        db = self._db_with(pending)
        new_time = datetime.now(timezone.utc) + timedelta(hours=1)
        message, err = await MessagingService(db).update_message(
            "m1", "org-1", {"scheduled_at": new_time}
        )
        assert err is None
        assert pending.scheduled_at == new_time

    async def test_clearing_schedule_on_published_message_is_allowed(self):
        published = SimpleNamespace(scheduled_at=None, is_active=True)
        db = self._db_with(published)
        message, err = await MessagingService(db).update_message(
            "m1", "org-1", {"scheduled_at": None, "is_active": False}
        )
        assert err is None

    async def test_unrelated_edit_does_not_revalidate_legacy_audience(self):
        published = SimpleNamespace(scheduled_at=None, title="Old title")
        db = self._db_with(published)
        service = MessagingService(db)
        service._validate_targeting = AsyncMock()

        message, err = await service.update_message(
            "m1", "org-1", {"title": "New title"}
        )

        assert err is None
        assert message.title == "New title"
        service._validate_targeting.assert_not_awaited()


class TestValidateTargeting:
    """MSG-2: create/update reject target member/role ids not in the caller's
    org (data hygiene — delivery is already org-safe via _is_targeted)."""

    def _svc(self, execute_results):
        db = MagicMock()
        db.execute = AsyncMock(side_effect=execute_results)
        return MessagingService(db), db

    def _members_result(self, ids):
        return MagicMock(
            scalars=MagicMock(
                return_value=MagicMock(all=MagicMock(return_value=list(ids)))
            )
        )

    def _roles_result(self, rows):
        return MagicMock(all=MagicMock(return_value=list(rows)))

    async def test_empty_lists_issue_no_query(self):
        svc, db = self._svc([])
        await svc._validate_targeting("org1", "all", None, None, None)
        await svc._validate_targeting("org1", "all", [], [], [])
        db.execute.assert_not_called()

    def test_normalizes_irrelevant_audience_lists(self):
        assert MessagingService._audience_for_type(
            "roles", ["r1"], ["active"], ["u1"]
        ) == (["r1"], None, None)
        assert MessagingService._audience_for_type(
            "all", ["r1"], ["active"], ["u1"]
        ) == (None, None, None)

    async def test_in_org_member_ids_pass(self):
        svc, _ = self._svc([self._members_result(["u1", "u2"])])
        await svc._validate_targeting("org1", "members", ["u1", "u2"], None, None)

    async def test_foreign_member_id_rejected(self):
        # Only u1 is in-org; the foreign id is not returned by the query.
        svc, _ = self._svc([self._members_result(["u1"])])
        with pytest.raises(ValueError, match="target members"):
            await svc._validate_targeting(
                "org1", "members", ["u1", "u2-foreign"], None, None
            )

    async def test_role_id_and_name_both_pass(self):
        row = SimpleNamespace(id="r1", name="Officer")
        svc, _ = self._svc([self._roles_result([row])])
        await svc._validate_targeting("org1", "roles", None, ["r1"], None)  # by id
        svc2, _ = self._svc([self._roles_result([row])])
        await svc2._validate_targeting(
            "org1", "roles", None, ["Officer"], None
        )  # rename-safe

    async def test_foreign_role_rejected(self):
        row = SimpleNamespace(id="r1", name="Officer")
        svc, _ = self._svc([self._roles_result([row])])
        with pytest.raises(ValueError, match="target roles"):
            await svc._validate_targeting("org1", "roles", None, ["r2-foreign"], None)

    async def test_targeted_audience_cannot_be_empty(self):
        svc, db = self._svc([])

        with pytest.raises(ValueError, match="At least one target role is required"):
            await svc._validate_targeting("org1", "roles", None, [], None)

        db.execute.assert_not_called()

    async def test_irrelevant_stale_audience_values_are_ignored(self):
        svc, db = self._svc([])

        await svc._validate_targeting(
            "org1",
            "all",
            ["foreign-member"],
            ["deleted-role"],
            ["invalid-status"],
        )

        db.execute.assert_not_called()

    async def test_invalid_status_rejected_without_query(self):
        svc, db = self._svc([])

        with pytest.raises(ValueError, match="target statuses"):
            await svc._validate_targeting(
                "org1", "statuses", None, None, ["not-a-real-status"]
            )

        db.execute.assert_not_called()


class TestGetInboxMessage:
    """The member-facing detail fetch runs through the same fail-closed
    visibility gate as read/acknowledge — opening a message by id must not
    reveal one the inbox list would have filtered out."""

    def _live_message(self):
        return SimpleNamespace(
            id="m1",
            title="New Building Code",
            body="Effective September 1.",
            priority="important",
            target_type="all",
            target_roles=None,
            target_statuses=None,
            target_member_ids=None,
            is_pinned=True,
            is_persistent=False,
            requires_acknowledgment=True,
            posted_by="author-1",
            created_at=None,
            expires_at=None,
            deleted_at=None,
        )

    async def test_returns_none_when_message_is_not_visible(self):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None))
        )

        entry = await MessagingService(db).get_inbox_message("org-1", "u1", "m1")

        assert entry is None

    async def test_returns_none_when_message_is_not_targeted_at_caller(self):
        message = self._live_message()
        message.target_type = "roles"
        message.target_roles = ["chief"]
        user = SimpleNamespace(
            roles=[SimpleNamespace(id="officer", name="officer")],
            status=SimpleNamespace(value="active"),
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                MagicMock(scalar_one_or_none=MagicMock(return_value=message)),
                MagicMock(scalar_one_or_none=MagicMock(return_value=user)),
            ]
        )

        entry = await MessagingService(db).get_inbox_message("org-1", "u1", "m1")

        assert entry is None

    async def test_returns_entry_with_read_state_and_author(self):
        message = self._live_message()
        user = SimpleNamespace(roles=[], status=SimpleNamespace(value="active"))
        acknowledged_at = datetime(2026, 8, 21, 18, 0, tzinfo=timezone.utc)
        read = SimpleNamespace(
            message_id="m1",
            read_at=datetime(2026, 8, 21, 17, 0, tzinfo=timezone.utc),
            acknowledged_at=acknowledged_at,
        )
        authors_result = MagicMock(
            all=MagicMock(
                return_value=[
                    SimpleNamespace(
                        id="author-1", first_name="Shelly", last_name="Hernandez"
                    )
                ]
            )
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                MagicMock(scalar_one_or_none=MagicMock(return_value=message)),
                MagicMock(scalar_one_or_none=MagicMock(return_value=user)),
                MagicMock(scalar_one_or_none=MagicMock(return_value=read)),
                authors_result,
            ]
        )

        entry = await MessagingService(db).get_inbox_message("org-1", "u1", "m1")

        assert entry is not None
        assert entry["id"] == "m1"
        assert entry["title"] == "New Building Code"
        assert entry["author_name"] == "Shelly Hernandez"
        assert entry["is_read"] is True
        assert entry["is_acknowledged"] is True
        assert entry["acknowledged_at"] == acknowledged_at.isoformat()

    async def test_author_lookup_is_scoped_to_the_organization(self):
        message = self._live_message()
        user = SimpleNamespace(roles=[], status=SimpleNamespace(value="active"))
        authors_result = MagicMock(all=MagicMock(return_value=[]))
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                MagicMock(scalar_one_or_none=MagicMock(return_value=message)),
                MagicMock(scalar_one_or_none=MagicMock(return_value=user)),
                MagicMock(scalar_one_or_none=MagicMock(return_value=None)),
                authors_result,
            ]
        )

        entry = await MessagingService(db).get_inbox_message("org-1", "u1", "m1")

        assert entry is not None
        assert entry["is_read"] is False
        assert entry["author_name"] == "Unknown"
        author_query = db.execute.await_args_list[3].args[0]
        assert "users.organization_id = :organization_id_1" in str(author_query)


class TestInboxDetailRoute:
    def test_detail_route_is_declared_before_the_admin_by_id_route(self):
        """/inbox/{message_id} must not be shadowed, and the literal
        /inbox/unread-count must still win over it."""
        paths = [
            route.path
            for route in messages_endpoint.router.routes
            if getattr(route, "path", None)
        ]

        assert "/inbox/{message_id}" in paths
        assert paths.index("/inbox/unread-count") < paths.index("/inbox/{message_id}")


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
