"""A converted prospect ends up with a password somebody knows.

Converting a prospect generated a temporary password that only the welcome
email carried, and the Convert dialog said "converted" whether or not that
email went out. Auto-transfer on final-stage approval never sent one at all.
Either way the new member could hold a password nobody knew, with nothing
saying so. Now:

* the coordinator may set the initial password (held to the same checks as
  ``POST /users``);
* a conversion that asks for a welcome email is refused when email cannot
  send, while "set it later with Reset Password" (no email, no password)
  stays allowed;
* auto-transfer sends the welcome email when it can, after its commit, and
  otherwise records that it did not and tells the approver.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import membership_pipeline as pipeline_ep
from app.core.security import verify_password
from app.models.membership_pipeline import ProspectStatus
from app.schemas.membership_pipeline import TransferProspectRequest
from app.services.membership_pipeline_service import MembershipPipelineService

SERVICE = "app.services.membership_pipeline_service.MembershipPipelineService"


# ── The endpoint's three rules ──────────────────────────────────────────────


async def _transfer(data: TransferProspectRequest, *, email_can_send: bool):
    """Drive the endpoint with everything but its password rules stubbed."""
    prospect = SimpleNamespace(status=ProspectStatus.ACTIVE)
    service_transfer = AsyncMock(
        return_value={"success": True, "user_id": "u-new", "message": "ok"}
    )
    email_check = AsyncMock(return_value=email_can_send)
    with patch(f"{SERVICE}.get_prospect", new=AsyncMock(return_value=prospect)), patch(
        f"{SERVICE}.transfer_to_membership", new=service_transfer
    ), patch.object(
        pipeline_ep, "welcome_email_can_send", new=email_check
    ), patch.object(
        pipeline_ep, "_canonical_rank_or_400", new=AsyncMock(return_value=None)
    ), patch.object(
        pipeline_ep, "_enforce_rank_grant_ceiling", new=AsyncMock()
    ), patch.object(
        pipeline_ep, "log_audit_event", new=AsyncMock()
    ), patch(
        "app.core.breached_password.check_password_not_breached",
        new=AsyncMock(return_value=(True, None)),
    ):
        result = await pipeline_ep.transfer_prospect(
            prospect_id=uuid.uuid4(),
            data=data,
            request=MagicMock(),
            db=MagicMock(),
            current_user=SimpleNamespace(
                id="admin-1", organization_id="org-a", username="admin"
            ),
        )
    return result, service_transfer, email_check


@pytest.mark.unit
class TestTransferEndpointPasswordRules:
    async def test_a_welcome_email_that_cannot_send_is_refused(self):
        with pytest.raises(HTTPException) as refused:
            await _transfer(
                TransferProspectRequest(send_welcome_email=True), email_can_send=False
            )

        assert refused.value.status_code == 400
        assert (
            refused.value.detail
            == pipeline_ep.TRANSFER_WELCOME_EMAIL_UNAVAILABLE_DETAIL
        )

    async def test_a_welcome_email_that_can_send_is_allowed(self):
        _, service_transfer, _ = await _transfer(
            TransferProspectRequest(send_welcome_email=True), email_can_send=True
        )

        service_transfer.assert_awaited_once()
        assert service_transfer.await_args.kwargs["send_welcome_email"] is True
        assert service_transfer.await_args.kwargs["initial_password"] is None

    async def test_a_chosen_password_is_passed_through_without_needing_email(self):
        _, service_transfer, email_check = await _transfer(
            TransferProspectRequest(password="Hydrant$Blue947"), email_can_send=False
        )

        assert (
            service_transfer.await_args.kwargs["initial_password"] == "Hydrant$Blue947"
        )
        email_check.assert_not_awaited()

    async def test_a_weak_password_is_refused(self):
        with pytest.raises(HTTPException) as refused:
            await _transfer(
                TransferProspectRequest(password="aaaaaaaaaaaa"), email_can_send=True
            )

        assert refused.value.status_code == 400

    async def test_set_it_later_stays_allowed_without_email(self):
        # No password, no welcome email: the Reset Password route, as bulk
        # import with its welcome toggle off.
        _, service_transfer, email_check = await _transfer(
            TransferProspectRequest(send_welcome_email=False), email_can_send=False
        )

        service_transfer.assert_awaited_once()
        email_check.assert_not_awaited()


# ── The auto-transfer welcome email ─────────────────────────────────────────


def _svc() -> MembershipPipelineService:
    db = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return MembershipPipelineService(db)


_PROSPECT = SimpleNamespace(
    id="p1", organization_id="org-a", first_name="Devon", last_name="Marsh"
)


async def _deliver(transfer, approved_by="approver-1"):
    svc = _svc()
    notify = AsyncMock(return_value=(None, None))
    with patch.object(svc, "_log_activity", new=AsyncMock()) as log_activity, patch(
        "app.services.notifications_service.NotificationsService.log_notification",
        new=notify,
    ):
        await svc._deliver_auto_transfer_welcome(_PROSPECT, transfer, approved_by)
    return log_activity, notify


@pytest.mark.unit
class TestAutoTransferWelcomeEmail:
    async def test_a_sent_email_needs_no_notice(self):
        send = AsyncMock(return_value=True)
        log_activity, notify = await _deliver(
            {"user_id": "u-new", "_send_welcome_email": send}
        )

        send.assert_awaited_once()
        log_activity.assert_not_awaited()
        notify.assert_not_awaited()

    async def test_email_off_is_recorded_and_the_approver_told(self):
        log_activity, notify = await _deliver({"user_id": "u-new"})

        entry = log_activity.await_args.kwargs
        assert entry["action"] == "welcome_email_not_sent"
        assert "not set up" in entry["details"]["reason"]
        assert "Reset Password" in entry["details"]["reason"]

        notice = notify.await_args.kwargs["log_data"]
        assert notice["recipient_id"] == "approver-1"
        assert notice["subject"] == "Set a password for Devon Marsh"
        assert notice["action_url"] == "/members/u-new"

    async def test_a_failed_send_says_it_failed(self):
        log_activity, _ = await _deliver(
            {"user_id": "u-new", "_send_welcome_email": AsyncMock(return_value=False)}
        )

        assert (
            "could not be sent" in log_activity.await_args.kwargs["details"]["reason"]
        )

    async def test_an_automated_conversion_is_recorded_without_a_notice(self):
        log_activity, notify = await _deliver({"user_id": "u-new"}, approved_by=None)

        log_activity.assert_awaited_once()
        notify.assert_not_awaited()

    async def test_a_failure_here_never_undoes_the_approval(self):
        # The approval has already committed; reporting on it must not raise,
        # and must leave the session usable for complete_step's final read.
        svc = _svc()
        send = AsyncMock(side_effect=RuntimeError("smtp down"))
        await svc._deliver_auto_transfer_welcome(
            _PROSPECT, {"user_id": "u-new", "_send_welcome_email": send}, "approver-1"
        )

        svc.db.rollback.assert_awaited_once()


# ── The stored password ─────────────────────────────────────────────────────


async def _make_prospect(svc: MembershipPipelineService, org_id: str):
    return await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Devon",
            "last_name": "Marsh",
            "email": f"devon-{uuid.uuid4().hex[:8]}@example.org",
        },
    )


async def _password_hash(db: AsyncSession, user_id: str) -> str:
    return (
        await db.execute(
            text("SELECT password_hash FROM users WHERE id = :id"), {"id": user_id}
        )
    ).scalar_one()


@pytest.mark.integration
class TestTransferStoresTheChosenPassword:
    async def test_the_coordinators_password_is_the_members_password(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        prospect = await _make_prospect(svc, org_id)

        result = await svc.transfer_to_membership(
            str(prospect.id), org_id, admin_id, initial_password="Hydrant$Blue947"
        )

        assert result is not None
        assert result["success"] is True
        stored = await _password_hash(db_session, result["user_id"])
        assert verify_password("Hydrant$Blue947", stored)[0] is True

    async def test_a_deferred_welcome_email_is_handed_back_not_sent(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        prospect = await _make_prospect(svc, org_id)

        with patch.object(
            svc, "_send_transfer_welcome_email", new=AsyncMock(return_value=True)
        ) as send:
            result = await svc._do_transfer(
                prospect, admin_id, send_welcome_email=True, defer_welcome_email=True
            )
            send.assert_not_awaited()
            assert await result["_send_welcome_email"]() is True

        send.assert_awaited_once()
        assert result["welcome_email_sent"] is False

    async def test_a_manual_transfer_never_carries_the_sender(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        # The endpoint returns this dict; it must not hold a closure over the
        # plaintext password.
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        prospect = await _make_prospect(svc, org_id)

        with patch.object(
            svc, "_send_transfer_welcome_email", new=AsyncMock(return_value=True)
        ):
            result = await svc.transfer_to_membership(
                str(prospect.id), org_id, admin_id, send_welcome_email=True
            )

        assert result is not None
        assert "_send_welcome_email" not in result
        assert result["welcome_email_sent"] is True
