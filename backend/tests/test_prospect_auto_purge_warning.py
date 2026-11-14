"""Coordinators are emailed 7 days before auto-purge deletes an application.

Owner decision (2026-10-08): the department's prospect coordinators are told
seven days ahead, so an application worth keeping can be reactivated. The
warning reads the same clamped grace period and the same ``inactive_since``
clock the purge does, lists each application once per inactive spell, and
marks nothing as warned unless the email was accepted.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from app.models.membership_pipeline import (
    MembershipPipeline,
    ProspectActivityLog,
    ProspectiveMember,
    ProspectStatus,
)
from app.models.user import Organization
from app.services import scheduled_tasks
from app.services.membership_pipeline_service import (
    AUTO_PURGE_WARNING_ACTION,
    MembershipPipelineService,
)

NOW = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)
SERVICE = "app.services.membership_pipeline_service"


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Purge Warning FD",
        slug=f"purgewarn-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _pipeline(db_session, org, config):
    pipeline = MembershipPipeline(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Recruits",
        inactivity_config=config,
    )
    db_session.add(pipeline)
    await db_session.flush()
    return pipeline


async def _prospect(db_session, org, pipeline, first, days_inactive, status=None):
    prospect = ProspectiveMember(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        pipeline_id=pipeline.id,
        first_name=first,
        last_name="Applicant",
        email=f"{uuid.uuid4().hex[:8]}@applicant.test",
        status=status or ProspectStatus.INACTIVE,
        inactive_since=(
            None if days_inactive is None else NOW - timedelta(days=days_inactive)
        ),
    )
    db_session.add(prospect)
    await db_session.flush()
    return prospect


def _log(db_session, prospect, created_at):
    db_session.add(
        ProspectActivityLog(
            id=str(uuid.uuid4()),
            prospect_id=prospect.id,
            action=AUTO_PURGE_WARNING_ACTION,
            details={},
            created_at=created_at,
        )
    )


def _mail(success=True):
    sender = MagicMock()
    sender.send_email = AsyncMock(return_value=(success, None))
    return sender


async def _warn(db_session, org, sender, recipients=("coord@fd.test",)):
    users = [
        SimpleNamespace(id=f"coord-{i}", email=e) for i, e in enumerate(recipients)
    ]
    with (
        patch.object(
            MembershipPipelineService,
            "_withdrawal_notice_recipients",
            AsyncMock(return_value=users),
        ),
        # The bell copy is covered in test_officer_alert_copies; these stand-ins
        # are not rows a notification could point at.
        patch("app.services.officer_alert_copies.add_in_app_copies", AsyncMock()),
        patch(f"{SERVICE}.recipients_for", lambda users, *_a: users),
        patch("app.services.email_service.EmailService", return_value=sender),
    ):
        return await MembershipPipelineService(db_session).warn_upcoming_auto_purges(
            org.id, now=NOW
        )


async def _warned_ids(db_session, org):
    """Applications this run warned: its entries carry the purge date."""
    rows = await db_session.execute(
        select(ProspectActivityLog.prospect_id, ProspectActivityLog.details)
        .join(
            ProspectiveMember, ProspectiveMember.id == ProspectActivityLog.prospect_id
        )
        .where(
            ProspectiveMember.organization_id == org.id,
            ProspectActivityLog.action == AUTO_PURGE_WARNING_ACTION,
        )
    )
    return {str(pid) for pid, details in rows.all() if (details or {}).get("purge_on")}


@pytest.mark.integration
class TestWarnUpcomingAutoPurges:
    async def test_lists_exactly_the_applications_due_within_seven_days(
        self, db_session
    ):
        org = await _org(db_session)
        pipeline = await _pipeline(
            db_session,
            org,
            {"auto_purge_enabled": True, "purge_days_after_inactive": 30},
        )
        due = await _prospect(db_session, org, pipeline, "Due", 25)
        edge = await _prospect(db_session, org, pipeline, "Edge", 23)
        await _prospect(db_session, org, pipeline, "Later", 20)
        await _prospect(db_session, org, pipeline, "Overdue", 31)
        await _prospect(db_session, org, pipeline, "Undated", None)
        await _prospect(
            db_session, org, pipeline, "Active", 25, status=ProspectStatus.ACTIVE
        )
        warned = await _prospect(db_session, org, pipeline, "Warned", 25)
        _log(db_session, warned, NOW - timedelta(days=1))
        # Warned in an earlier inactive spell, before the current one began.
        again = await _prospect(db_session, org, pipeline, "Again", 26)
        _log(db_session, again, NOW - timedelta(days=60))
        await db_session.flush()

        sender = _mail()
        count = await _warn(db_session, org, sender)

        assert count == 3
        kwargs = sender.send_email.await_args.kwargs
        assert kwargs["to_emails"] == ["coord@fd.test"]
        assert kwargs["subject"] == (
            "3 inactive applications will be deleted in 7 days"
        )
        body = kwargs["text_body"]
        for name in ("Due Applicant", "Edge Applicant", "Again Applicant"):
            assert name in body
        for name in ("Later", "Overdue", "Undated", "Active", "Warned"):
            assert f"{name} Applicant" not in body
        # The date in the email is the date the purge acts on.
        assert "Due Applicant (Recruits) — deleted on October 16, 2026" in body
        assert await _warned_ids(db_session, org) == {due.id, edge.id, again.id}

    async def test_a_second_run_does_not_repeat_the_warning(self, db_session):
        org = await _org(db_session)
        pipeline = await _pipeline(
            db_session,
            org,
            {"auto_purge_enabled": True, "purge_days_after_inactive": 30},
        )
        await _prospect(db_session, org, pipeline, "Due", 25)

        assert await _warn(db_session, org, _mail()) == 1
        second = _mail()
        assert await _warn(db_session, org, second) == 0
        second.send_email.assert_not_awaited()

    async def test_a_failed_send_marks_nothing_and_is_retried(self, db_session):
        org = await _org(db_session)
        pipeline = await _pipeline(
            db_session,
            org,
            {"auto_purge_enabled": True, "purge_days_after_inactive": 30},
        )
        await _prospect(db_session, org, pipeline, "Due", 25)

        assert await _warn(db_session, org, _mail(success=False)) == 0
        assert await _warned_ids(db_session, org) == set()
        assert await _warn(db_session, org, _mail()) == 1

    async def test_coordinators_who_turned_email_off_are_still_warned(self, db_session):
        """With nobody to email, the bell entries are the warning, so the
        application counts as warned and the email is not attempted."""
        org = await _org(db_session)
        pipeline = await _pipeline(
            db_session,
            org,
            {"auto_purge_enabled": True, "purge_days_after_inactive": 30},
        )
        due = await _prospect(db_session, org, pipeline, "Due", 25)
        sender = _mail()
        bell = AsyncMock(return_value=1)

        with (
            patch.object(
                MembershipPipelineService,
                "_withdrawal_notice_recipients",
                AsyncMock(return_value=[SimpleNamespace(id="coord-0", email="c@x")]),
            ),
            patch(f"{SERVICE}.recipients_for", return_value=[]),
            patch("app.services.officer_alert_copies.add_in_app_copies", bell),
            patch("app.services.email_service.EmailService", return_value=sender),
        ):
            warned = await MembershipPipelineService(
                db_session
            ).warn_upcoming_auto_purges(org.id, now=NOW)

        assert warned == 1
        sender.send_email.assert_not_awaited()
        assert bell.await_args.kwargs["recipient_ids"] == ["coord-0"]
        assert await _warned_ids(db_session, org) == {str(due.id)}

    async def test_no_coordinator_means_no_email(self, db_session):
        org = await _org(db_session)
        pipeline = await _pipeline(
            db_session,
            org,
            {"auto_purge_enabled": True, "purge_days_after_inactive": 30},
        )
        await _prospect(db_session, org, pipeline, "Due", 25)
        sender = _mail()

        assert await _warn(db_session, org, sender, recipients=()) == 0
        sender.send_email.assert_not_awaited()

    async def test_a_pipeline_without_auto_purge_is_never_warned(self, db_session):
        org = await _org(db_session)
        pipeline = await _pipeline(
            db_session,
            org,
            {"auto_purge_enabled": False, "purge_days_after_inactive": 30},
        )
        await _prospect(db_session, org, pipeline, "Due", 25)
        sender = _mail()

        assert await _warn(db_session, org, sender) == 0
        sender.send_email.assert_not_awaited()


@pytest.mark.unit
class TestScheduledTaskWarnsBeforePurging:
    def _db(self):
        result = MagicMock()
        result.scalars.return_value.all.return_value = [SimpleNamespace(id="org-1")]
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)
        db.commit = AsyncMock()
        db.rollback = AsyncMock()
        db.refresh = AsyncMock()
        return db

    async def test_warns_then_purges(self):
        calls = []
        service = SimpleNamespace(
            warn_upcoming_auto_purges=AsyncMock(
                side_effect=lambda org: calls.append(("warn", org))
            ),
            auto_purge_inactive_prospects=AsyncMock(
                side_effect=lambda org: calls.append(("purge", org))
                or {"purged": 2, "pipelines_purged": 1, "errors": []}
            ),
        )
        with patch(f"{SERVICE}.MembershipPipelineService", return_value=service):
            out = await scheduled_tasks.run_membership_auto_purge(self._db())

        assert calls == [("warn", "org-1"), ("purge", "org-1")]
        assert out["total"] == 2

    async def test_a_failed_warning_still_purges_and_is_reported(self):
        service = SimpleNamespace(
            warn_upcoming_auto_purges=AsyncMock(side_effect=RuntimeError("smtp down")),
            auto_purge_inactive_prospects=AsyncMock(
                return_value={"purged": 1, "pipelines_purged": 1, "errors": []}
            ),
        )
        db = self._db()
        with (
            patch(f"{SERVICE}.MembershipPipelineService", return_value=service),
            patch.object(scheduled_tasks, "persist_task_error_log", AsyncMock()),
        ):
            out = await scheduled_tasks.run_membership_auto_purge(db)

        service.auto_purge_inactive_prospects.assert_awaited_once_with("org-1")
        assert "smtp down" in out["errors"][0]["error"]
        assert db.rollback.await_count >= 1
