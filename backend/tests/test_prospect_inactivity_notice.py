"""Coordinators are emailed when the sweep marks an application inactive.

Owner decision (2026-10-27): Pipeline Settings → Inactivity's **Notify
coordinator** box is honoured and the applicant is never emailed. Before this,
both boxes were stored and read by nothing (CLAUDE.md pitfall 19). One digest
per department per run, each application once per inactive spell, only the
sweep's own deactivations, and nothing recorded unless the email was accepted.
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
from app.services.membership_pipeline_service import (
    INACTIVITY_NOTICE_ACTION,
    MembershipPipelineService,
)

NOW = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)
SERVICE = "app.services.membership_pipeline_service"

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Inactivity Notice FD",
        slug=f"inactnotice-{uuid.uuid4().hex[:8]}",
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


async def _inactive(db_session, org, pipeline, first, days_ago=1):
    prospect = ProspectiveMember(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        pipeline_id=pipeline.id,
        first_name=first,
        last_name="Applicant",
        email=f"{uuid.uuid4().hex[:8]}@applicant.test",
        status=ProspectStatus.INACTIVE,
        inactive_since=NOW - timedelta(days=days_ago),
    )
    db_session.add(prospect)
    await db_session.flush()
    return prospect


async def _log(db_session, prospect, action, created_at):
    db_session.add(
        ProspectActivityLog(
            id=str(uuid.uuid4()),
            prospect_id=prospect.id,
            action=action,
            details={},
            created_at=created_at,
        )
    )
    await db_session.flush()


async def _swept(db_session, org, pipeline, first, days_ago=1):
    """An application the sweep marked inactive ``days_ago`` days ago."""
    prospect = await _inactive(db_session, org, pipeline, first, days_ago)
    await _log(
        db_session, prospect, "marked_inactive_by_system", prospect.inactive_since
    )
    return prospect


def _mail(success=True):
    sender = MagicMock()
    sender.send_email = AsyncMock(return_value=(success, None))
    return sender


def _patched(sender, recipients=("coord@fd.test",)):
    users = [SimpleNamespace(email=e) for e in recipients]
    return (
        patch.object(
            MembershipPipelineService,
            "_withdrawal_notice_recipients",
            AsyncMock(return_value=users),
        ),
        patch(f"{SERVICE}.recipients_for", lambda users, *_a: users),
        patch("app.services.email_service.EmailService", return_value=sender),
    )


async def _notify(db_session, org, sender, **kwargs):
    a, b, c = _patched(sender, **kwargs)
    with a, b, c:
        return await MembershipPipelineService(
            db_session
        ).notify_coordinators_of_inactivity(org.id, now=NOW)


async def _notified_ids(db_session, org):
    rows = await db_session.execute(
        select(ProspectActivityLog.prospect_id)
        .join(
            ProspectiveMember, ProspectiveMember.id == ProspectActivityLog.prospect_id
        )
        .where(
            ProspectiveMember.organization_id == org.id,
            ProspectActivityLog.action == INACTIVITY_NOTICE_ACTION,
        )
    )
    return {str(pid) for pid in rows.scalars().all()}


class TestWhoIsListed:
    async def test_the_sweeps_deactivations_go_out_in_one_digest(self, db_session):
        org = await _org(db_session)
        pipeline = await _pipeline(db_session, org, {"timeout_preset": "3_months"})
        first = await _swept(db_session, org, pipeline, "Avery")
        second = await _swept(db_session, org, pipeline, "Blake")
        sender = _mail()

        assert await _notify(db_session, org, sender) == 2

        sender.send_email.assert_awaited_once()
        kwargs = sender.send_email.await_args.kwargs
        assert kwargs["to_emails"] == ["coord@fd.test"]
        assert kwargs["subject"] == "2 applications marked inactive"
        assert "Avery Applicant (Recruits)" in kwargs["text_body"]
        assert "Blake Applicant (Recruits)" in kwargs["text_body"]
        assert await _notified_ids(db_session, org) == {first.id, second.id}

    async def test_switching_notify_coordinator_off_stops_it(self, db_session):
        org = await _org(db_session)
        pipeline = await _pipeline(
            db_session,
            org,
            {"timeout_preset": "3_months", "notify_coordinator": False},
        )
        await _swept(db_session, org, pipeline, "Avery")
        sender = _mail()

        assert await _notify(db_session, org, sender) == 0
        sender.send_email.assert_not_awaited()

    async def test_an_application_marked_inactive_by_hand_is_not_listed(
        self, db_session
    ):
        org = await _org(db_session)
        pipeline = await _pipeline(db_session, org, {"timeout_preset": "3_months"})
        await _inactive(db_session, org, pipeline, "Avery")
        sender = _mail()

        assert await _notify(db_session, org, sender) == 0
        sender.send_email.assert_not_awaited()

    async def test_a_deactivation_older_than_the_lookback_is_not_mailed(
        self, db_session
    ):
        org = await _org(db_session)
        pipeline = await _pipeline(db_session, org, {"timeout_preset": "3_months"})
        await _swept(db_session, org, pipeline, "Avery", days_ago=30)
        sender = _mail()

        assert await _notify(db_session, org, sender) == 0
        sender.send_email.assert_not_awaited()


class TestOncePerSpell:
    async def test_a_second_run_does_not_repeat_the_notice(self, db_session):
        org = await _org(db_session)
        pipeline = await _pipeline(db_session, org, {"timeout_preset": "3_months"})
        await _swept(db_session, org, pipeline, "Avery")

        assert await _notify(db_session, org, _mail()) == 1
        sender = _mail()
        assert await _notify(db_session, org, sender) == 0
        sender.send_email.assert_not_awaited()

    async def test_a_notice_from_an_earlier_spell_does_not_suppress_this_one(
        self, db_session
    ):
        org = await _org(db_session)
        pipeline = await _pipeline(db_session, org, {"timeout_preset": "3_months"})
        prospect = await _swept(db_session, org, pipeline, "Avery", days_ago=1)
        await _log(
            db_session, prospect, INACTIVITY_NOTICE_ACTION, NOW - timedelta(days=60)
        )

        assert await _notify(db_session, org, _mail()) == 1

    async def test_a_failed_send_records_nothing_and_is_retried(self, db_session):
        org = await _org(db_session)
        pipeline = await _pipeline(db_session, org, {"timeout_preset": "3_months"})
        prospect = await _swept(db_session, org, pipeline, "Avery")

        assert await _notify(db_session, org, _mail(success=False)) == 0
        assert await _notified_ids(db_session, org) == set()

        assert await _notify(db_session, org, _mail()) == 1
        assert await _notified_ids(db_session, org) == {prospect.id}


class TestTheSweep:
    async def test_the_sweep_notifies_about_what_it_just_marked(self, db_session):
        """End to end on the real clock: the sweep's own stamp and log entry
        must match each other, whatever MySQL does to a fractional second."""
        from sqlalchemy import text

        org = await _org(db_session)
        pipeline = await _pipeline(db_session, org, {"timeout_preset": "3_months"})
        prospect = ProspectiveMember(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            pipeline_id=pipeline.id,
            first_name="Avery",
            last_name="Applicant",
            email=f"{uuid.uuid4().hex[:8]}@applicant.test",
            status=ProspectStatus.ACTIVE,
        )
        db_session.add(prospect)
        await db_session.flush()
        await db_session.execute(
            text(
                "UPDATE prospective_members SET created_at = created_at - "
                "INTERVAL 200 DAY, updated_at = updated_at - INTERVAL 200 DAY "
                "WHERE id = :id"
            ),
            {"id": prospect.id},
        )
        org_id, prospect_id = org.id, prospect.id
        # The raw UPDATE bypassed the identity map; the sweep must read the row.
        db_session.expire_all()
        sender = _mail()

        a, b, c = _patched(sender)
        with a, b, c:
            result = await MembershipPipelineService(
                db_session
            ).process_inactivity_warnings(org_id)

        assert result["marked_inactive"] == 1
        sender.send_email.assert_awaited_once()
        assert await _notified_ids(db_session, SimpleNamespace(id=org_id)) == {
            prospect_id
        }
