"""The weekly email of folders only full administrators can open (decision 30)."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.models.document import DocumentFolder
from app.models.user import Organization, Position, user_roles
from app.services.admin_only_folder_digest import (
    DOCUMENTS_SETTINGS_KEY,
    LAST_DIGEST_KEY,
    send_admin_only_folder_digest,
)
from app.services.email_service import EmailService
from app.utils.org_timezone import org_today

pytestmark = pytest.mark.integration


async def _member(db_session, org, *permissions, preferences=None, status="active"):
    position = Position(
        organization_id=org.id,
        name=f"Holder {uuid4().hex[:6]}",
        slug=f"holder-{uuid4().hex[:8]}",
        permissions=list(permissions),
    )
    db_session.add(position)
    await db_session.flush()
    user_id = str(uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, notification_preferences) "
            "VALUES (:id, :org, :un, 'Test', 'Member', :em, 'hashed', :status, :prefs)"
        ),
        {
            "id": user_id,
            "org": str(org.id),
            "un": f"m-{user_id[:8]}",
            "em": f"m-{user_id[:8]}@example.org",
            "status": status,
            "prefs": preferences,
        },
    )
    await db_session.execute(
        user_roles.insert().values(user_id=user_id, position_id=position.id)
    )
    await db_session.flush()
    return user_id


@pytest.fixture
async def org(db_session):
    org = Organization(name="Digest FD", slug=f"dig-{uuid4().hex[:8]}", settings={})
    db_session.add(org)
    await db_session.flush()
    return org


@pytest.fixture
def send_email():
    mock = AsyncMock(return_value=(1, 0))
    # One patch, entered once, outside any concurrent section (pitfall #22).
    with patch.object(EmailService, "send_email", mock):
        yield mock


async def _shut_folder(db_session, org, name="Quartermaster files"):
    folder = DocumentFolder(
        organization_id=org.id, name=name, required_permissions=["training.manage"]
    )
    db_session.add(folder)
    await db_session.flush()
    return folder


class TestTheWeeklyDigest:
    async def test_it_emails_each_full_administrator_the_list(
        self, db_session, org, send_email
    ):
        await _member(db_session, org, "documents.view")
        await _member(db_session, org, "*")
        await _member(db_session, org, "*")
        await _shut_folder(db_session, org)

        assert await send_admin_only_folder_digest(db_session, org) == 2
        assert send_email.await_count == 2
        body = send_email.await_args.kwargs["html_body"]
        assert "Quartermaster files" in body
        assert send_email.await_args.kwargs["template_type"] == (
            "documents_admin_only_digest"
        )
        stored = org.settings[DOCUMENTS_SETTINGS_KEY][LAST_DIGEST_KEY]
        assert stored == org_today(org).isoformat()

    async def test_nothing_is_sent_while_no_folder_is_listed(
        self, db_session, org, send_email
    ):
        await _member(db_session, org, "documents.view", "training.manage")
        await _member(db_session, org, "*")
        await _shut_folder(db_session, org)

        assert await send_admin_only_folder_digest(db_session, org) == 0
        send_email.assert_not_awaited()

    async def test_it_is_sent_at_most_once_a_week(self, db_session, org, send_email):
        await _member(db_session, org, "documents.view")
        await _member(db_session, org, "*")
        await _shut_folder(db_session, org)

        assert await send_admin_only_folder_digest(db_session, org) == 1
        assert await send_admin_only_folder_digest(db_session, org) == 0

        # A week on, the folder is still listed, so it is sent again.
        week_ago = org_today(org) - timedelta(days=7)
        org.settings = {DOCUMENTS_SETTINGS_KEY: {LAST_DIGEST_KEY: week_ago.isoformat()}}
        await db_session.flush()
        assert await send_admin_only_folder_digest(db_session, org) == 1
        assert send_email.await_count == 2

    async def test_a_kept_folder_is_not_emailed(self, db_session, org, send_email):
        await _member(db_session, org, "documents.view")
        admin_id = await _member(db_session, org, "*")
        folder = await _shut_folder(db_session, org)
        folder.admin_only_confirmed_by = admin_id
        folder.admin_only_confirmed_at = datetime.now(timezone.utc)
        await db_session.flush()

        assert await send_admin_only_folder_digest(db_session, org) == 0
        send_email.assert_not_awaited()

    async def test_an_administrator_who_opted_out_is_not_emailed(
        self, db_session, org, send_email
    ):
        await _member(db_session, org, "documents.view")
        await _member(
            db_session,
            org,
            "*",
            preferences='{"email_kinds": {"document_duties": false}}',
        )
        await _shut_folder(db_session, org)

        assert await send_admin_only_folder_digest(db_session, org) == 0
        send_email.assert_not_awaited()
        assert DOCUMENTS_SETTINGS_KEY not in (org.settings or {})

    async def test_an_archived_administrator_is_not_emailed(
        self, db_session, org, send_email
    ):
        await _member(db_session, org, "documents.view")
        await _member(db_session, org, "*", status="archived")
        await _shut_folder(db_session, org)

        assert await send_admin_only_folder_digest(db_session, org) == 0
        send_email.assert_not_awaited()

    async def test_a_failed_send_is_tried_again_the_next_day(
        self, db_session, org, send_email
    ):
        await _member(db_session, org, "documents.view")
        await _member(db_session, org, "*")
        await _shut_folder(db_session, org)
        send_email.return_value = (0, 1)

        assert await send_admin_only_folder_digest(db_session, org) == 0
        assert DOCUMENTS_SETTINGS_KEY not in (org.settings or {})

    async def test_the_scheduled_task_runs_it_for_each_department(
        self, db_session, org, send_email
    ):
        from app.services.scheduled_tasks import (
            TASK_INTERVALS_SECONDS,
            TASK_RUNNERS,
            run_admin_only_folder_digest,
        )

        assert TASK_RUNNERS["admin_only_folder_digest"] is run_admin_only_folder_digest
        assert TASK_INTERVALS_SECONDS["admin_only_folder_digest"] == 86400

        await _member(db_session, org, "documents.view")
        await _member(db_session, org, "*")
        await _shut_folder(db_session, org)
        result = await run_admin_only_folder_digest(db_session)
        assert result["errors"] == []
        assert result["total"] >= 1
