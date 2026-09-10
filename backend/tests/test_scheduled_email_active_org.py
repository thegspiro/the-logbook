"""A decommissioned department must stop mailing its members.

`_run_scheduled_emails_inner` selected every `PENDING` `ScheduledEmail` whose
time had come, across all organizations, with no `Organization.active` filter.
Its only org check is `if not org`, which catches a *deleted* organization row
and not a deactivated one — so a department that had been switched off kept
sending whatever was still queued against it.

This is the CRON2-31-11 / CRON-31-5 shape. The sibling
`run_publish_scheduled_messages` had the identical gap and was closed as
CRON3-31-1; this runner was missed because that pass was scoped to its own
diff, and scheduled *email* lives in a different function from scheduled
*messages*.

Latent today in the same sense the sibling was — nothing in the product sets
`Organization.active = False` yet — but this task fans mail out to members, the
column exists, and every other org-spanning loop in `scheduled_tasks.py`
already filters on it.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.email_template import (
    EmailTemplateType,
    ScheduledEmail,
    ScheduledEmailStatus,
)
from app.models.user import Organization
from app.services import scheduled_tasks

pytestmark = [pytest.mark.integration]


async def _org(db, *, active):
    org = Organization(
        name="Scheduled Mail FD",
        slug=f"schedmail-{uuid.uuid4().hex[:8]}",
        active=active,
    )
    db.add(org)
    await db.flush()
    return org


async def _due_email(db, org):
    item = ScheduledEmail(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        template_type=EmailTemplateType.CUSTOM,
        to_emails=[f"{uuid.uuid4().hex[:8]}@example.test"],
        context={},
        # Comfortably in the past so the `scheduled_at <= now` filter cannot be
        # the reason a row is skipped — the org filter has to be.
        scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        status=ScheduledEmailStatus.PENDING,
    )
    db.add(item)
    await db.flush()
    return item


class TestScheduledEmailsSkipDeactivatedOrgs:
    async def test_a_deactivated_orgs_due_email_is_not_picked_up(self, db_session):
        org = await _org(db_session, active=False)
        item = await _due_email(db_session, org)
        await db_session.commit()

        result = await scheduled_tasks._run_scheduled_emails_inner(db_session)

        assert result["sent"] == 0, (
            "a deactivated organization's queued email was sent; the runner is "
            "missing the Organization.active filter every other org-spanning "
            "loop in this file carries"
        )
        await db_session.refresh(item)
        # Left strictly alone: not sent, and not marked FAILED either. A
        # department that is switched back on keeps what it had queued, rather
        # than this task having quietly destroyed it on the way past.
        assert item.status == ScheduledEmailStatus.PENDING

    async def test_an_active_orgs_due_email_is_still_picked_up(self, db_session):
        """The guard against 'fixed' by filtering everything out.

        Without this, dropping the whole `pending` list on the floor would pass
        the test above — so this asserts the runner still *reaches* a live
        organization's row. It is left at whatever terminal state the send
        attempt produces (FAILED here, since email is disabled in the test
        environment); the point is that it was processed at all, not that it
        was delivered.
        """
        org = await _org(db_session, active=True)
        item = await _due_email(db_session, org)
        await db_session.commit()

        await scheduled_tasks._run_scheduled_emails_inner(db_session)

        await db_session.refresh(item)
        assert item.status != ScheduledEmailStatus.PENDING, (
            "an active organization's due email was not processed at all — the "
            "org filter is excluding rows it should let through"
        )
