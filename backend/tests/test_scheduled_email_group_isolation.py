"""
Codex review on PR #1915 (CRON2-31-6's fix): _run_scheduled_emails_inner
commits/rolls back per item on a shared session while iterating a
pre-fetched list of ScheduledEmail rows loaded with a selectin-loaded
``organization`` relationship. await db.rollback() expires *every*
persistent object in the session, not just the failed item's — so once one
item's rollback fires, the next pre-fetched item's ``item.organization``
access would raise MissingGreenlet under a real AsyncSession outside the
greenlet bridge. The fix refreshes the item's own columns and re-fetches
its organization explicitly for every item processed after a rollback,
instead of touching the (expired) relationship attribute directly. DB and
email/template services mocked; no MySQL.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.email_template import (
    EmailTemplateType,
    ScheduledEmail,
    ScheduledEmailStatus,
)
from app.models.user import Organization
from app.services.scheduled_tasks import _run_scheduled_emails_inner


def _item(item_id, org_id, org):
    email = ScheduledEmail(
        id=item_id,
        organization_id=org_id,
        template_id=None,
        template_type=EmailTemplateType.CUSTOM,
        to_emails=["member@example.org"],
        cc_emails=None,
        bcc_emails=None,
        context={},
        scheduled_at=datetime.now(timezone.utc),
        status=ScheduledEmailStatus.PENDING,
    )
    email.organization = org
    return email


def _org(org_id):
    return MagicMock(
        id=org_id,
        settings={"email_service": {"enabled": True}},
    )


def _query_result(rows):
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    return result


class TestScheduledEmailRefreshesAfterRollback:
    async def test_second_items_organization_is_refetched_not_read_off_the_stale_relationship(
        self,
    ):
        org1 = _org("org-1")
        org2 = _org("org-2")
        item1 = _item("email-1", "org-1", org1)
        item2 = _item("email-2", "org-2", org2)

        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_query_result([item1, item2])])
        # item1: both the normal-path commit and the failure-recording
        # commit inside the except block fail, forcing the rollback path.
        # item2's single commit then succeeds.
        db.commit = AsyncMock(
            side_effect=[Exception("flush failed"), Exception("still broken"), None]
        )
        db.rollback = AsyncMock()
        db.refresh = AsyncMock()
        # item2's org, re-fetched by primary key after the refresh branch
        # kicks in (rather than read off the expired relationship).
        db.get = AsyncMock(return_value=org2)

        template = MagicMock(default_cc=[], default_bcc=[])
        template_service = MagicMock()
        template_service.get_template = AsyncMock(return_value=template)
        template_service.render = MagicMock(
            return_value=("Subject", "<p>html</p>", "text")
        )

        email_service = MagicMock()
        email_service.send_email = AsyncMock(return_value=(1, []))

        with (
            patch(
                "app.services.email_template_service.EmailTemplateService",
                return_value=template_service,
            ),
            patch(
                "app.services.email_service.EmailService",
                return_value=email_service,
            ),
        ):
            result = await _run_scheduled_emails_inner(db)

        # item1's failure rolled back and could not even be recorded.
        assert item1.status == ScheduledEmailStatus.FAILED
        db.rollback.assert_awaited_once()

        # item2 must have been refreshed (columns) and had its org
        # re-fetched via a fresh, populate_existing lookup — never read off
        # the pre-fetched, now-expired `organization` relationship.
        db.refresh.assert_awaited_once_with(item2)
        db.get.assert_awaited_once_with(
            Organization, item2.organization_id, populate_existing=True
        )
        assert item2.status == ScheduledEmailStatus.SENT
        assert item2.sent_at is not None

        # item1's send succeeded (sent += 1) before its commit failed and
        # its status was overwritten to FAILED in the except block — the
        # counters reflect what was attempted, not final persisted status.
        assert result["sent"] == 2
        assert result["failed"] == 1
        assert result["total_processed"] == 2


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
