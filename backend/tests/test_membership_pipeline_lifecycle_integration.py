"""Membership pipeline lifecycle rules the service broke (app-review B9 pass 6).

Each test drove the real service against the database and showed the wrong
behaviour on the code before this change; the docstrings say what happened.
"""

import re
import uuid

import pytest
from sqlalchemy import text

from app.models.membership_pipeline import ProspectStatus
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org(db_session):
    org_id, admin_id = _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, 'A', 'U', :em, 'hashed', 'active')"
        ),
        {
            "id": admin_id,
            "org": org_id,
            "un": f"a-{admin_id[:8]}",
            "em": f"a-{admin_id[:8]}@t.example",
        },
    )
    await db_session.flush()
    return org_id, admin_id


async def _applicant(service, org_id, pipeline_id):
    return await service.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Pat",
            "last_name": "X" + _uid()[:4],
            "email": f"p-{_uid()[:8]}@example.com",
            "pipeline_id": pipeline_id,
        },
    )


class TestConversionNeedsAnActiveApplication:
    """MP2-13: conversion refused only an applicant already transferred, so a
    rejected (or withdrawn, or inactive) applicant could be made a member by
    calling /transfer. Every other forward path refuses them."""

    async def test_a_rejected_applicant_is_not_converted(self, db_session, org):
        org_id, admin = org
        service = MembershipPipelineService(db_session)
        pipeline = await service.create_pipeline(organization_id=org_id, name="P")
        await service.add_step(
            pipeline.id,
            org_id,
            {"name": "Review", "step_type": "manual_approval", "required": False},
        )
        applicant = await _applicant(service, org_id, pipeline.id)
        await service.set_prospect_status(
            applicant.id, org_id, "rejected", admin, "Not eligible"
        )

        with pytest.raises(ValueError, match="rejected"):
            await service.transfer_to_membership(applicant.id, org_id, admin)


class TestInactivityAfterReactivation:
    """MP2-15: the sweep skipped anyone it had ever marked inactive, so an
    applicant reactivated and then left idle again was never marked inactive a
    second time — and, counted as past warning, got no warning email either."""

    async def test_an_applicant_idle_again_after_reactivation_is_marked_again(
        self, db_session, org
    ):
        org_id, admin = org
        service = MembershipPipelineService(db_session)
        pipeline = await service.create_pipeline(
            organization_id=org_id,
            name="P",
            inactivity_config={"timeout_preset": "custom", "custom_timeout_days": 10},
        )
        await service.add_step(
            pipeline.id, org_id, {"name": "Review", "step_type": "manual_approval"}
        )
        applicant = await _applicant(service, org_id, pipeline.id)

        async def age():
            await db_session.execute(
                text(
                    "UPDATE prospective_members "
                    "SET updated_at = NOW() - INTERVAL 20 DAY WHERE id = :id"
                ),
                {"id": applicant.id},
            )
            await db_session.flush()
            db_session.expire_all()

        await age()
        first = await service.process_inactivity_warnings(org_id)
        assert first["marked_inactive"] == 1
        await service.set_prospect_status(applicant.id, org_id, "active", admin)
        await age()

        second = await service.process_inactivity_warnings(org_id)

        after = await service.get_prospect(applicant.id, org_id)
        assert second["marked_inactive"] == 1
        assert after.status == ProspectStatus.INACTIVE


class TestChecklistIsMatchedNotCounted:
    """MP2-16: the checklist gate counted the ticks the client sent, so
    ["x", "x", "x"] passed a three-item checklist."""

    async def test_three_copies_of_one_unknown_tick_do_not_pass(self, db_session, org):
        org_id, admin = org
        service = MembershipPipelineService(db_session)
        pipeline = await service.create_pipeline(organization_id=org_id, name="P")
        await service.add_step(
            pipeline.id,
            org_id,
            {
                "name": "Checklist",
                "step_type": "checklist",
                "config": {"items": ["Badge photo", "Uniform sizing", "Locker"]},
            },
        )
        await service.add_step(
            pipeline.id, org_id, {"name": "Next", "step_type": "manual_approval"}
        )
        applicant = await _applicant(service, org_id, pipeline.id)

        with pytest.raises(ValueError, match="only 0 done"):
            await service.advance_prospect(
                applicant.id, org_id, admin, completed_items=["x", "x", "x"]
            )

    async def test_every_configured_item_ticked_passes(self, db_session, org):
        org_id, admin = org
        service = MembershipPipelineService(db_session)
        pipeline = await service.create_pipeline(organization_id=org_id, name="P")
        checklist = await service.add_step(
            pipeline.id,
            org_id,
            {
                "name": "Checklist",
                "step_type": "checklist",
                "config": {"items": ["Badge photo", "Uniform sizing", "Locker"]},
            },
        )
        await service.add_step(
            pipeline.id, org_id, {"name": "Next", "step_type": "manual_approval"}
        )
        applicant = await _applicant(service, org_id, pipeline.id)

        after = await service.advance_prospect(
            applicant.id,
            org_id,
            admin,
            completed_items=["Badge photo", "Uniform sizing", "Locker"],
        )

        assert str(after.current_step_id) != str(checklist.id)


class TestStageEmailLinkIsFresh:
    """MP2-17: a stage email's "track your application" link used the token's
    existing timestamp, so for an applicant whose link was over 30 days old the
    emailed link was already dead. The status-page stage refreshes it for this
    reason; the email now does too."""

    async def test_the_emailed_link_opens(self, db_session, org, monkeypatch):
        from app.services import email_service

        org_id, admin = org
        sent: list[str] = []

        async def fake_send(self, to_emails, subject, html_body, text_body=None, **kw):
            sent.append(text_body or html_body)
            return (1, 0)

        monkeypatch.setattr(email_service.EmailService, "send_email", fake_send)
        service = MembershipPipelineService(db_session)
        pipeline = await service.create_pipeline(organization_id=org_id, name="P")
        pipeline.public_status_enabled = True
        await db_session.flush()
        await service.add_step(
            pipeline.id, org_id, {"name": "Review", "step_type": "manual_approval"}
        )
        await service.add_step(
            pipeline.id,
            org_id,
            {
                "name": "Update email",
                "step_type": "automated_email",
                "config": {
                    "include_status_tracker": True,
                    "section_order": ["status_tracker"],
                },
            },
        )
        await service.add_step(
            pipeline.id, org_id, {"name": "Interview", "step_type": "manual_approval"}
        )
        applicant = await _applicant(service, org_id, pipeline.id)
        applicant_id = str(applicant.id)
        await db_session.execute(
            text(
                "UPDATE prospective_members "
                "SET status_token_created_at = NOW() - INTERVAL 40 DAY WHERE id = :id"
            ),
            {"id": applicant_id},
        )
        await db_session.flush()
        db_session.expire_all()

        await service.advance_prospect(applicant_id, org_id, admin)

        match = re.search(r"application-status/([A-Za-z0-9_-]+)", sent[0])
        assert match is not None
        assert await service.get_prospect_by_token(match.group(1)) is not None
