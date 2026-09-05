"""Who the notification Send Log answers with.

``GET /notifications/logs`` filtered on ``organization_id`` alone, so the
screen behind it listed the ``subject``, ``message`` and ``recipient_email``
of every notification the department had sent anyone — to any holder of
``notifications.view``, a grant that was seeded to every member until
migration ``a1f7c34e9b02``.

Both log routes now take a ``scope``. It defaults to ``mine``, which needs no
permission because it is the caller's own delivery history, and the
organization-wide view is an explicit request gated on
``notifications.manage`` — the same gate as the org-wide read-all write it
sits beside, rather than the read-only ``notifications.view`` that let the
leak happen.

The service half is exercised against a real database because the filter is a
SQL predicate: a test that asserts the endpoint passed ``recipient_id`` along
proves the argument, not the rows.
"""

import inspect
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.notifications import (
    _resolve_log_scope,
    list_logs,
    mark_all_logs_read,
    router,
)
from app.models.notification import NotificationLog
from app.models.user import Organization, User
from app.schemas.notifications import NotificationLogScope
from app.services.notifications_service import NotificationsService

pytestmark = pytest.mark.integration


async def _make_org(db):
    org = Organization(name="Send Log FD", slug=f"slog-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_user(db, org, label: str):
    user = User(
        organization_id=org.id,
        username=f"{label}-{uuid.uuid4().hex[:8]}",
        email=f"{label}-{uuid.uuid4().hex[:8]}@example.org",
        first_name=label.title(),
        last_name="Member",
    )
    db.add(user)
    await db.flush()
    return user


async def _log(db, org, recipient, *, channel="in_app", subject="Drill", read=False):
    entry = NotificationLog(
        organization_id=org.id,
        recipient_id=recipient.id,
        recipient_email=recipient.email,
        channel=channel,
        subject=subject,
        message="Bring turnout gear.",
        read=read,
    )
    db.add(entry)
    await db.flush()
    return entry


def _user_with(*permissions: str, user_id="user-1", organization_id="org-1"):
    return SimpleNamespace(
        id=user_id,
        organization_id=organization_id,
        rank=None,
        positions=[SimpleNamespace(permissions=list(permissions))],
    )


class _Pagination:
    skip = 0
    limit = 100


class TestGetLogsRecipientFilter:
    async def test_mine_scope_excludes_another_member_s_notifications(self, db_session):
        org = await _make_org(db_session)
        me = await _make_user(db_session, org, "me")
        colleague = await _make_user(db_session, org, "colleague")
        await _log(db_session, org, me, subject="Mine")
        await _log(db_session, org, colleague, subject="Theirs")

        service = NotificationsService(db_session)
        logs, total = await service.get_logs(org.id, recipient_id=me.id)

        assert total == 1
        assert [entry.subject for entry in logs] == ["Mine"]

    async def test_omitting_the_recipient_keeps_the_organization_wide_view(
        self, db_session
    ):
        org = await _make_org(db_session)
        me = await _make_user(db_session, org, "me")
        colleague = await _make_user(db_session, org, "colleague")
        await _log(db_session, org, me, subject="Mine")
        await _log(db_session, org, colleague, subject="Theirs")

        service = NotificationsService(db_session)
        logs, total = await service.get_logs(org.id)

        assert total == 2
        assert {entry.subject for entry in logs} == {"Mine", "Theirs"}

    async def test_the_recipient_filter_survives_the_channel_filter(self, db_session):
        # The two predicates are applied in separate branches; combining them
        # is what the tab does on every request but the "All" one.
        org = await _make_org(db_session)
        me = await _make_user(db_session, org, "me")
        colleague = await _make_user(db_session, org, "colleague")
        await _log(db_session, org, me, channel="email", subject="Mine")
        await _log(db_session, org, colleague, channel="email", subject="Theirs")

        service = NotificationsService(db_session)
        logs, total = await service.get_logs(
            org.id, channel="email", recipient_id=me.id
        )

        assert total == 1
        assert [entry.subject for entry in logs] == ["Mine"]

    async def test_the_recipient_filter_is_org_scoped_as_well(self, db_session):
        # recipient_id is a UUID a caller never supplies, but the org filter is
        # what stops a row surviving a user record that outlived its tenancy.
        org = await _make_org(db_session)
        other_org = await _make_org(db_session)
        me = await _make_user(db_session, org, "me")
        await _log(db_session, org, me, subject="Mine")

        service = NotificationsService(db_session)
        _, total = await service.get_logs(other_org.id, recipient_id=me.id)

        assert total == 0


class TestMarkAllLogsRead:
    async def test_mine_scope_leaves_another_member_s_logs_unread(self, db_session):
        org = await _make_org(db_session)
        me = await _make_user(db_session, org, "me")
        colleague = await _make_user(db_session, org, "colleague")
        mine = await _log(db_session, org, me, subject="Mine")
        theirs = await _log(db_session, org, colleague, subject="Theirs")

        service = NotificationsService(db_session)
        marked = await service.mark_all_logs_read(org.id, recipient_id=me.id)

        assert marked == 1
        await db_session.refresh(mine)
        await db_session.refresh(theirs)
        assert mine.read is True
        assert theirs.read is False

    async def test_it_clears_email_rows_too_not_only_in_app(self, db_session):
        # The Send Log lists both channels, so a button on it that cleared only
        # the in-app rows would leave itself on screen with nothing to do.
        org = await _make_org(db_session)
        me = await _make_user(db_session, org, "me")
        email_entry = await _log(db_session, org, me, channel="email")
        in_app_entry = await _log(db_session, org, me, channel="in_app")

        service = NotificationsService(db_session)
        marked = await service.mark_all_logs_read(org.id, recipient_id=me.id)

        assert marked == 2
        await db_session.refresh(email_entry)
        await db_session.refresh(in_app_entry)
        assert email_entry.read is True
        assert in_app_entry.read is True

    async def test_omitting_the_recipient_keeps_the_organization_wide_sweep(
        self, db_session
    ):
        org = await _make_org(db_session)
        me = await _make_user(db_session, org, "me")
        colleague = await _make_user(db_session, org, "colleague")
        await _log(db_session, org, me)
        await _log(db_session, org, colleague)

        service = NotificationsService(db_session)

        assert await service.mark_all_logs_read(org.id) == 2


class TestScopeGate:
    def test_the_default_scope_filters_to_the_caller(self):
        user = _user_with(user_id="user-9")

        assert _resolve_log_scope(NotificationLogScope.MINE, user) == "user-9"

    def test_notifications_view_does_not_open_the_organization_scope(self):
        # The gap that made this a leak: view is the read-only grant, and the
        # log body is not a read-only concern.
        with pytest.raises(HTTPException) as excinfo:
            _resolve_log_scope(
                NotificationLogScope.ORGANIZATION, _user_with("notifications.view")
            )

        assert excinfo.value.status_code == 403

    def test_an_unprivileged_member_cannot_ask_for_the_organization_scope(self):
        with pytest.raises(HTTPException) as excinfo:
            _resolve_log_scope(NotificationLogScope.ORGANIZATION, _user_with())

        assert excinfo.value.status_code == 403

    def test_notifications_manage_opens_the_organization_scope(self):
        resolved = _resolve_log_scope(
            NotificationLogScope.ORGANIZATION, _user_with("notifications.manage")
        )

        assert resolved is None

    def test_a_wildcard_holder_opens_the_organization_scope(self):
        # Wildcards are how the chief's position is seeded; the gate has to
        # honour them or the audit view is unreachable in practice.
        resolved = _resolve_log_scope(
            NotificationLogScope.ORGANIZATION, _user_with("*")
        )

        assert resolved is None


class TestEndpointDefaults:
    async def test_list_logs_defaults_to_the_caller_scope(self, db_session):
        org = await _make_org(db_session)
        me = await _make_user(db_session, org, "me")
        colleague = await _make_user(db_session, org, "colleague")
        await _log(db_session, org, me, subject="Mine")
        await _log(db_session, org, colleague, subject="Theirs")
        caller = SimpleNamespace(
            id=me.id, organization_id=org.id, rank=None, positions=[]
        )

        result = await list_logs(
            channel=None,
            scope=NotificationLogScope.MINE,
            pagination=_Pagination(),
            db=db_session,
            current_user=caller,
        )

        assert result["total"] == 1
        assert [entry.subject for entry in result["logs"]] == ["Mine"]

    async def test_read_all_defaults_to_the_caller_scope(self, db_session):
        org = await _make_org(db_session)
        me = await _make_user(db_session, org, "me")
        colleague = await _make_user(db_session, org, "colleague")
        await _log(db_session, org, me)
        theirs = await _log(db_session, org, colleague)
        caller = SimpleNamespace(
            id=me.id, organization_id=org.id, rank=None, positions=[]
        )

        result = await mark_all_logs_read(
            scope=NotificationLogScope.MINE,
            db=db_session,
            current_user=caller,
        )

        assert result["marked_read"] == 1
        await db_session.refresh(theirs)
        assert theirs.read is False


class TestRouteWiring:
    """The safe scope has to be the *declared* default, not a caller habit.

    A route that defaults to ``organization`` and relies on the frontend
    passing ``mine`` is the same leak with an extra step: every other client,
    and every hand-rolled request, gets the org-wide view back.
    """

    @pytest.mark.parametrize("endpoint", [list_logs, mark_all_logs_read])
    def test_the_declared_scope_default_is_mine(self, endpoint):
        default = inspect.signature(endpoint).parameters["scope"].default

        assert getattr(default, "default", default) == NotificationLogScope.MINE

    @pytest.mark.parametrize(
        ("path", "method"),
        [("/logs", "GET"), ("/logs/read-all", "POST")],
    )
    def test_the_log_routes_carry_no_permission_dependency(self, path, method):
        # The gate moved inside the handler because it depends on the
        # requested scope. A leftover route-level require_permission would
        # lock a member out of their own log.
        for route in router.routes:
            if route.path == path and method in route.methods:
                assert not [
                    dependency
                    for dependency in route.dependant.dependencies
                    if getattr(dependency.call, "required_permissions", None)
                ]
                return
        pytest.fail(f"Route not found for {method} {path}")
