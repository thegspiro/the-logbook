"""An applicant can withdraw their own application from the public status page.

The withdrawal is authenticated by the same emailed status token as the read,
so it must honour exactly the same conditions (expiry, pipeline opt-in) and
may only close an application that is still open.

DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException, Response

from app.api.public import portal
from app.models.membership_pipeline import ProspectActivityLog, ProspectStatus
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.unit]


def _prospect(status=ProspectStatus.ACTIVE, created_at=None, public_enabled=True):
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id="p1",
        organization_id="org1",
        status=status,
        status_token="tok_original",
        status_token_created_at=created_at if created_at is not None else now,
        pipeline=SimpleNamespace(public_status_enabled=public_enabled),
    )


def _svc_for(prospect):
    db = MagicMock()
    result = MagicMock()
    result.scalars.return_value.first.return_value = prospect
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    svc = MembershipPipelineService(db)
    # Both emails have their own tests below; stubbing them keeps these about
    # the withdrawal itself.
    svc._notify_coordinators_of_withdrawal = AsyncMock()
    svc._confirm_withdrawal_to_applicant = AsyncMock()
    return svc


def _logged_activity(svc):
    return [
        c.args[0]
        for c in svc.db.add.call_args_list
        if isinstance(c.args[0], ProspectActivityLog)
    ]


class TestWithdrawProspectByToken:
    @pytest.mark.parametrize("status", [ProspectStatus.ACTIVE, ProspectStatus.ON_HOLD])
    async def test_open_application_is_withdrawn(self, status):
        prospect = _prospect(status=status)
        svc = _svc_for(prospect)

        result = await svc.withdraw_prospect_by_token("tok_original", "Moving away")

        assert result is prospect
        assert prospect.status == ProspectStatus.WITHDRAWN
        svc.db.commit.assert_awaited_once()

    async def test_activity_log_attributes_it_to_the_applicant(self):
        svc = _svc_for(_prospect())

        await svc.withdraw_prospect_by_token("tok_original", "Moving away")

        [log] = _logged_activity(svc)
        assert log.action == "prospect_status_changed"
        assert log.performed_by is None
        assert log.details == {
            "from": "active",
            "to": "withdrawn",
            "reason": "Moving away",
            "bulk": False,
            "by_applicant": True,
        }

    async def test_lookup_locks_the_row(self):
        svc = _svc_for(_prospect())

        await svc.withdraw_prospect_by_token("tok_original")

        statement = svc.db.execute.await_args_list[0].args[0]
        assert statement._for_update_arg is not None

    async def test_coordinators_are_notified_after_the_commit(self):
        prospect = _prospect()
        svc = _svc_for(prospect)
        order = []
        svc.db.commit.side_effect = lambda: order.append("commit")
        svc._notify_coordinators_of_withdrawal.side_effect = lambda *a: order.append(
            "notify"
        )

        await svc.withdraw_prospect_by_token("tok_original", "Moving away")

        svc._notify_coordinators_of_withdrawal.assert_awaited_once_with(
            prospect, "Moving away"
        )
        assert order == ["commit", "notify"]

    async def test_applicant_is_sent_a_confirmation_after_the_commit(self):
        prospect = _prospect()
        svc = _svc_for(prospect)
        order = []
        svc.db.commit.side_effect = lambda: order.append("commit")
        svc._notify_coordinators_of_withdrawal.side_effect = lambda *a: order.append(
            "notify"
        )
        svc._confirm_withdrawal_to_applicant.side_effect = lambda *a: order.append(
            "confirm"
        )

        await svc.withdraw_prospect_by_token("tok_original")

        svc._confirm_withdrawal_to_applicant.assert_awaited_once_with(prospect)
        assert order == ["commit", "notify", "confirm"]

    @pytest.mark.parametrize(
        "status",
        [
            ProspectStatus.APPROVED,
            ProspectStatus.REJECTED,
            ProspectStatus.WITHDRAWN,
            ProspectStatus.INACTIVE,
            ProspectStatus.TRANSFERRED,
        ],
    )
    async def test_closed_application_cannot_be_withdrawn(self, status):
        prospect = _prospect(status=status)
        svc = _svc_for(prospect)

        with pytest.raises(ValueError, match="no longer open"):
            await svc.withdraw_prospect_by_token("tok_original")

        assert prospect.status == status
        svc.db.commit.assert_not_awaited()
        svc._notify_coordinators_of_withdrawal.assert_not_awaited()
        svc._confirm_withdrawal_to_applicant.assert_not_awaited()

    async def test_unknown_token_returns_none(self):
        svc = _svc_for(None)

        assert await svc.withdraw_prospect_by_token("tok_unknown") is None

    async def test_expired_token_returns_none(self):
        expired = datetime.now(timezone.utc) - timedelta(
            days=MembershipPipelineService._STATUS_TOKEN_TTL_DAYS + 1
        )
        prospect = _prospect(created_at=expired)
        svc = _svc_for(prospect)

        assert await svc.withdraw_prospect_by_token("tok_original") is None
        assert prospect.status == ProspectStatus.ACTIVE
        svc.db.commit.assert_not_awaited()
        svc._notify_coordinators_of_withdrawal.assert_not_awaited()
        svc._confirm_withdrawal_to_applicant.assert_not_awaited()

    async def test_pipeline_not_opted_in_returns_none(self):
        prospect = _prospect(public_enabled=False)
        svc = _svc_for(prospect)

        assert await svc.withdraw_prospect_by_token("tok_original") is None
        assert prospect.status == ProspectStatus.ACTIVE


def _user(email, *positions):
    return SimpleNamespace(
        id=email,
        email=email,
        positions=[
            SimpleNamespace(slug=slug, permissions=perms) for slug, perms in positions
        ],
    )


def _svc_with_users(users):
    db = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = users
    db.execute = AsyncMock(return_value=result)
    return MembershipPipelineService(db)


_MANAGE = ["prospective_members.manage"]


class TestWithdrawalNoticeRecipients:
    async def test_coordinator_and_assistant_both_receive_it(self):
        coordinator = _user("coord@x.org", ("membership_coordinator", _MANAGE))
        assistant = _user("asst@x.org", ("assistant_membership_coordinator", _MANAGE))
        chief = _user("chief@x.org", ("fire_chief", _MANAGE))
        svc = _svc_with_users([coordinator, assistant, chief])

        recipients = await svc._withdrawal_notice_recipients("org1")

        # The chief can manage the pipeline too, but is not who runs it.
        assert recipients == [coordinator, assistant]

    async def test_an_assistant_alone_is_enough(self):
        assistant = _user("asst@x.org", ("assistant_membership_coordinator", _MANAGE))
        chief = _user("chief@x.org", ("fire_chief", _MANAGE))
        svc = _svc_with_users([assistant, chief])

        assert await svc._withdrawal_notice_recipients("org1") == [assistant]

    async def test_falls_back_to_pipeline_managers_when_nobody_holds_either(self):
        chief = _user("chief@x.org", ("fire_chief", _MANAGE))
        it_manager = _user("it@x.org", ("it_manager", ["*"]))
        member = _user("member@x.org", ("member", ["events.view"]))
        svc = _svc_with_users([chief, it_manager, member])

        assert await svc._withdrawal_notice_recipients("org1") == [
            chief,
            it_manager,
        ]

    async def test_members_without_an_address_are_skipped(self):
        coordinator = _user("", ("membership_coordinator", _MANAGE))
        svc = _svc_with_users([coordinator])

        assert await svc._withdrawal_notice_recipients("org1") == []


class TestNotifyCoordinatorsOfWithdrawal:
    def _prospect(self):
        return SimpleNamespace(
            id="p1",
            organization_id="org1",
            first_name="Jane",
            last_name="<b>Doe</b>",
            pipeline=SimpleNamespace(name="Recruit"),
            current_step=SimpleNamespace(name="Interview"),
        )

    def _svc(self, recipients, org=True):
        db = MagicMock()
        org_result = MagicMock()
        org_result.scalar_one_or_none.return_value = (
            SimpleNamespace(id="org1") if org else None
        )
        db.execute = AsyncMock(return_value=org_result)
        db.commit = AsyncMock()
        svc = MembershipPipelineService(db)
        svc._withdrawal_notice_recipients = AsyncMock(return_value=recipients)
        return svc

    async def _notify(self, svc, reason, send=None):
        email_cls = MagicMock()
        email_cls.return_value.send_email = send or AsyncMock(return_value=(1, 0))
        with (
            patch("app.services.email_service.EmailService", email_cls),
            patch("app.services.email_service.build_email_logo_html", return_value=""),
        ):
            await svc._notify_coordinators_of_withdrawal(self._prospect(), reason)
        return email_cls.return_value.send_email

    async def test_emails_every_recipient_with_the_details(self):
        svc = self._svc(
            [_user("coord@x.org"), _user("asst@x.org")],
        )

        send = await self._notify(svc, "Moving <away>")

        send.assert_awaited_once()
        kwargs = send.await_args.kwargs
        assert kwargs["to_emails"] == ["coord@x.org", "asst@x.org"]
        assert kwargs["subject"] == "Application withdrawn: Jane <b>Doe</b>"
        # Applicant-supplied text is escaped in the HTML part.
        assert "Moving &lt;away&gt;" in kwargs["html_body"]
        assert "&lt;b&gt;Doe&lt;/b&gt;" in kwargs["html_body"]
        assert "<b>Doe</b>" not in kwargs["html_body"]
        assert "Recruit" in kwargs["html_body"]
        assert "Interview" in kwargs["html_body"]
        assert "Reason given: Moving <away>" in kwargs["text_body"]

        [log] = _logged_activity(svc)
        assert log.action == "withdrawal_notice_sent"
        assert log.details == {"recipient_count": 2, "delivered": 1}
        svc.db.commit.assert_awaited_once()

    async def test_no_reason_is_stated_as_such(self):
        svc = self._svc([_user("coord@x.org")])

        send = await self._notify(svc, None)

        assert "Reason given: None given" in send.await_args.kwargs["text_body"]

    async def test_nobody_to_tell_sends_nothing(self):
        svc = self._svc([])

        send = await self._notify(svc, None)

        send.assert_not_awaited()
        svc.db.commit.assert_not_awaited()

    async def test_a_mail_failure_does_not_raise(self):
        svc = self._svc([_user("coord@x.org")])

        # The applicant's withdrawal has already committed; a failed send must
        # not surface as an error on their status page.
        await self._notify(
            svc, None, send=AsyncMock(side_effect=RuntimeError("smtp down"))
        )

        svc.db.commit.assert_not_awaited()


class TestConfirmWithdrawalToApplicant:
    def _prospect(self, withdrawn_at):
        return SimpleNamespace(
            id="p1",
            organization_id="org1",
            email="jane@example.com",
            first_name="Jane",
            last_name="Doe",
            withdrawn_at=withdrawn_at,
        )

    def _svc(self, timezone_name="America/New_York", org=True):
        db = MagicMock()
        org_result = MagicMock()
        org_result.scalar_one_or_none.return_value = (
            SimpleNamespace(id="org1", name="Station 7 FD", timezone=timezone_name)
            if org
            else None
        )
        db.execute = AsyncMock(return_value=org_result)
        db.commit = AsyncMock()
        return MembershipPipelineService(db)

    async def _confirm(self, svc, prospect, send=None):
        email_cls = MagicMock()
        email_cls.return_value.send_application_withdrawn_email = send or AsyncMock(
            return_value=True
        )
        with patch("app.services.email_service.EmailService", email_cls):
            await svc._confirm_withdrawal_to_applicant(prospect)
        return email_cls.return_value.send_application_withdrawn_email

    async def test_sends_the_confirmation_to_the_applicant(self):
        svc = self._svc()
        prospect = self._prospect(datetime(2026, 3, 3, 15, 0, tzinfo=timezone.utc))

        send = await self._confirm(svc, prospect)

        send.assert_awaited_once_with(
            to_email="jane@example.com",
            applicant_name="Jane Doe",
            organization_name="Station 7 FD",
            withdrawal_date="March 03, 2026",
            db=svc.db,
            organization_id="org1",
        )
        [log] = _logged_activity(svc)
        assert log.action == "withdrawal_confirmation_sent"
        assert log.details == {"delivered": True}
        svc.db.commit.assert_awaited_once()

    async def test_date_is_in_the_departments_timezone(self):
        # 02:00 UTC on the 4th is still the evening of the 3rd in New York.
        svc = self._svc("America/New_York")
        prospect = self._prospect(datetime(2026, 3, 4, 2, 0, tzinfo=timezone.utc))

        send = await self._confirm(svc, prospect)

        assert send.await_args.kwargs["withdrawal_date"] == "March 03, 2026"

    async def test_unknown_timezone_falls_back_to_utc(self):
        svc = self._svc("Not/AZone")
        prospect = self._prospect(datetime(2026, 3, 4, 2, 0, tzinfo=timezone.utc))

        send = await self._confirm(svc, prospect)

        assert send.await_args.kwargs["withdrawal_date"] == "March 04, 2026"

    async def test_a_mail_failure_does_not_raise(self):
        svc = self._svc()
        prospect = self._prospect(datetime(2026, 3, 3, tzinfo=timezone.utc))

        await self._confirm(
            svc, prospect, send=AsyncMock(side_effect=RuntimeError("smtp down"))
        )

        svc.db.commit.assert_not_awaited()

    async def test_missing_organization_sends_nothing(self):
        svc = self._svc(org=False)

        send = await self._confirm(
            svc, self._prospect(datetime(2026, 3, 3, tzinfo=timezone.utc))
        )

        send.assert_not_awaited()


class TestApplicationWithdrawnEmail:
    """The send method renders the default template and tags the send."""

    async def test_renders_default_and_escapes_the_name(self):
        from app.models.email_template import EmailTemplateType
        from app.models.user import Organization
        from app.services.email_service import EmailService

        svc = EmailService(Organization(id="org1", name="Station 7 FD"))
        svc.send_email = AsyncMock(return_value=(1, 0))

        sent = await svc.send_application_withdrawn_email(
            to_email="jane@example.com",
            applicant_name="Jane <b>Doe</b>",
            organization_name="Station 7 FD",
            withdrawal_date="March 03, 2026",
        )

        assert sent is True
        kwargs = svc.send_email.await_args.kwargs
        assert kwargs["to_emails"] == ["jane@example.com"]
        assert kwargs["template_type"] == EmailTemplateType.APPLICATION_WITHDRAWN.value
        assert "Station 7 FD" in kwargs["subject"]
        assert "March 03, 2026" in kwargs["html_body"]
        assert "Jane &lt;b&gt;Doe&lt;/b&gt;" in kwargs["html_body"]
        assert "<b>Doe</b>" not in kwargs["html_body"]
        assert "{{" not in kwargs["html_body"]
        assert "March 03, 2026" in kwargs["text_body"]


class TestCanWithdrawOnRead:
    def _read_prospect(self, status):
        now = datetime.now(timezone.utc)
        return SimpleNamespace(
            id="p1",
            first_name="Jane",
            last_name="Doe",
            status=status,
            created_at=now,
            status_token="tok_original",
            status_token_created_at=now,
            pipeline=SimpleNamespace(
                name="Recruit",
                public_status_enabled=True,
                public_show_future_stages=True,
                steps=[],
            ),
            current_step=None,
            step_progress=[],
        )

    @pytest.mark.parametrize(
        ("status", "expected"),
        [
            (ProspectStatus.ACTIVE, True),
            (ProspectStatus.ON_HOLD, True),
            (ProspectStatus.APPROVED, False),
            (ProspectStatus.WITHDRAWN, False),
            (ProspectStatus.TRANSFERRED, False),
        ],
    )
    async def test_read_reports_whether_withdrawal_is_offered(self, status, expected):
        svc = _svc_for(self._read_prospect(status))

        result = await svc.get_prospect_by_token("tok_original")

        assert result["can_withdraw"] is expected


class TestWithdrawEndpoint:
    async def _call(self, withdraw_result=None, withdraw_error=None, reason=None):
        db = MagicMock()
        db.commit = AsyncMock()
        request = MagicMock()
        response = Response()
        service = MagicMock()
        service.withdraw_prospect_by_token = AsyncMock(
            return_value=withdraw_result, side_effect=withdraw_error
        )
        audit = AsyncMock()
        with (
            patch.object(portal, "validate_ip_rate_limit", AsyncMock()),
            patch.object(portal, "get_client_ip", return_value="203.0.113.5"),
            patch.object(portal, "log_audit_event", audit),
            patch(
                "app.services.membership_pipeline_service.MembershipPipelineService",
                return_value=service,
            ),
        ):
            result = await portal.withdraw_application(
                request=request,
                response=response,
                body=portal.WithdrawApplicationRequest(reason=reason),
                token="tok_original",
                db=db,
            )
        return result, response, service, audit, db

    async def test_success_audits_and_commits(self):
        result, response, service, audit, db = await self._call(
            withdraw_result=_prospect(status=ProspectStatus.WITHDRAWN),
            reason="  Moving away  ",
        )

        assert result.status == "withdrawn"
        service.withdraw_prospect_by_token.assert_awaited_once_with(
            "tok_original", "Moving away"
        )
        audit.assert_awaited_once()
        assert audit.await_args.kwargs["organization_id"] == "org1"
        assert (
            audit.await_args.kwargs["event_type"]
            == "membership_pipeline.prospect_self_withdrawn"
        )
        db.commit.assert_awaited_once()
        assert response.headers["Cache-Control"] == "no-store, private"

    async def test_blank_reason_is_sent_as_none(self):
        _, _, service, _, _ = await self._call(
            withdraw_result=_prospect(status=ProspectStatus.WITHDRAWN), reason="   "
        )

        service.withdraw_prospect_by_token.assert_awaited_once_with(
            "tok_original", None
        )

    async def test_unusable_token_is_404(self):
        with pytest.raises(HTTPException) as exc:
            await self._call(withdraw_result=None)

        assert exc.value.status_code == 404

    async def test_closed_application_is_409(self):
        with pytest.raises(HTTPException) as exc:
            await self._call(
                withdraw_error=ValueError(
                    "This application is no longer open, so it cannot be withdrawn."
                )
            )

        assert exc.value.status_code == 409
        assert "no longer open" in exc.value.detail
