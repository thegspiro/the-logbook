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
    return MembershipPipelineService(db)


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

        statement = svc.db.execute.await_args.args[0]
        assert statement._for_update_arg is not None

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

    async def test_pipeline_not_opted_in_returns_none(self):
        prospect = _prospect(public_enabled=False)
        svc = _svc_for(prospect)

        assert await svc.withdraw_prospect_by_token("tok_original") is None
        assert prospect.status == ProspectStatus.ACTIVE


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
