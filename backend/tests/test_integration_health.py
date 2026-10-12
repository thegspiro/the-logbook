"""Integration health monitoring (owner decision integrations-health-and-triggers).

An integration records its last error, its consecutive-failure count and a
bounded history of runs; Retry Sync re-runs it under a permission gate, an
IP rate limit and a per-integration cooldown. Every provider call is mocked —
no test touches the network.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.endpoints import integrations as int_ep
from app.models.integration import Integration, IntegrationSyncLog
from app.services.integration_health import (
    MAX_SYNC_HISTORY,
    health_state,
    record_integration_run,
    sanitize_integration_error,
    summarize_counts,
)


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [],
            "client": ("203.0.113.40", 1234),
            "query_string": b"",
        }
    )


async def _org(db) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Health Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"health-{org_id[:8]}"},
    )
    return org_id


async def _admin(db, org_id: str) -> SimpleNamespace:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Int', 'Admin', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"int-{user_id[:8]}",
            "em": f"int-{user_id[:8]}@test.com",
        },
    )
    return SimpleNamespace(
        id=user_id, organization_id=org_id, username=f"int-{user_id[:8]}"
    )


async def _integration(db, org_id: str, itype: str = "slack", **kw) -> Integration:
    row = Integration(
        organization_id=org_id,
        integration_type=itype,
        name=itype.title(),
        category="Messaging",
        status=kw.pop("status", "connected"),
        enabled=kw.pop("enabled", True),
        config={},
        **kw,
    )
    db.add(row)
    await db.flush()
    return row


@pytest.fixture(autouse=True)
def _no_rate_limit():
    with patch.object(int_ep, "check_rate_limit", new=AsyncMock()):
        yield


@pytest.mark.unit
class TestSanitizeIntegrationError:
    def test_infra_exception_never_reaches_storage(self):
        import httpx

        raw = "connect to https://hooks.slack.com/services/T000/B000/XXXX failed"
        message = sanitize_integration_error(httpx.ConnectError(raw))
        assert "hooks.slack.com" not in message
        assert message == "An unexpected error occurred. Please try again."

    def test_hand_written_message_is_kept_but_scrubbed(self):
        message = sanitize_integration_error(
            Exception(
                "Rejected for jane.doe@example.org at https://x.example/hook "
                "token=abc123 Bearer eyJhbGciOiJIUzI1NiJ9 key "
                "AKIAABCDEFGHIJKLMNOPQRSTUV"
            )
        )
        assert "jane.doe" not in message
        assert "x.example" not in message
        assert "abc123" not in message
        assert "eyJhbGci" not in message
        assert "AKIAABCDEFGHIJKLMNOPQRSTUV" not in message
        assert message.startswith("Rejected for [email]")

    def test_long_message_is_capped(self):
        message = sanitize_integration_error("word " * 200)
        assert len(message) <= 300


@pytest.mark.unit
class TestSummarizeCounts:
    def test_keeps_integers_and_drops_records(self):
        summary = summarize_counts(
            {
                "contacts": [{"Email": "jane@example.org"}],
                "count": 3,
                "push": {"members": {"created": 2, "failed": 1}},
                "inbound_enabled": True,
                "name": "Jane Doe",
            }
        )
        assert summary == {
            "count": 3,
            "push_members_created": 2,
            "push_members_failed": 1,
        }


@pytest.mark.unit
class TestHealthState:
    def test_states(self):
        never = SimpleNamespace(
            consecutive_error_count=0, last_success_at=None, last_sync_at=None
        )
        ok = SimpleNamespace(
            consecutive_error_count=0,
            last_success_at=datetime.now(timezone.utc),
            last_sync_at=None,
        )
        blip = SimpleNamespace(
            consecutive_error_count=1, last_success_at=None, last_sync_at=None
        )
        down = SimpleNamespace(
            consecutive_error_count=3, last_success_at=None, last_sync_at=None
        )
        assert health_state(never) == "unknown"
        assert health_state(ok) == "healthy"
        assert health_state(blip) == "degraded"
        assert health_state(down) == "failing"


@pytest.mark.integration
class TestRecordIntegrationRun:
    async def test_failure_then_success_tracks_the_streak(self, db_session):
        org_id = await _org(db_session)
        integ = await _integration(db_session, org_id)

        for _ in range(2):
            await record_integration_run(
                db_session,
                integ,
                operation="chat_notification",
                trigger="event",
                success=False,
                error=Exception("Slack rejected the message"),
            )
        assert integ.consecutive_error_count == 2
        assert integ.last_error == "Slack rejected the message"
        assert integ.last_error_at is not None

        await record_integration_run(
            db_session,
            integ,
            operation="chat_notification",
            trigger="event",
            success=True,
        )
        assert integ.consecutive_error_count == 0
        assert integ.last_success_at is not None
        # The last error stays visible after recovery, with its timestamp.
        assert integ.last_error == "Slack rejected the message"

    async def test_history_is_bounded_per_integration(self, db_session):
        org_id = await _org(db_session)
        integ = await _integration(db_session, org_id)
        other = await _integration(db_session, org_id, itype="discord")
        await record_integration_run(
            db_session,
            other,
            operation="chat_notification",
            trigger="event",
            success=True,
        )
        for _ in range(MAX_SYNC_HISTORY + 5):
            await record_integration_run(
                db_session,
                integ,
                operation="chat_notification",
                trigger="event",
                success=True,
            )
        count = await db_session.scalar(
            select(func.count(IntegrationSyncLog.id)).where(
                IntegrationSyncLog.integration_id == integ.id
            )
        )
        assert count == MAX_SYNC_HISTORY
        other_count = await db_session.scalar(
            select(func.count(IntegrationSyncLog.id)).where(
                IntegrationSyncLog.integration_id == other.id
            )
        )
        assert other_count == 1


@pytest.mark.integration
class TestSyncHistoryEndpoint:
    async def test_lists_runs_newest_first_and_is_org_scoped(self, db_session):
        org_a = await _org(db_session)
        org_b = await _org(db_session)
        admin_a = await _admin(db_session, org_a)
        admin_b = await _admin(db_session, org_b)
        integ = await _integration(db_session, org_a)
        await record_integration_run(
            db_session,
            integ,
            operation="connection_test",
            trigger="manual",
            success=False,
            error=Exception("Slack rejected the webhook"),
        )
        await db_session.flush()

        out = await int_ep.get_integration_sync_history(
            integ.id, limit=20, db=db_session, current_user=admin_a
        )
        assert len(out["runs"]) == 1
        assert out["runs"][0]["status"] == "failure"
        assert out["runs"][0]["error_message"] == "Slack rejected the webhook"

        with pytest.raises(HTTPException) as exc:
            await int_ep.get_integration_sync_history(
                integ.id, limit=20, db=db_session, current_user=admin_b
            )
        assert exc.value.status_code == 404

    async def test_detail_carries_health_fields(self, db_session):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        integ = await _integration(db_session, org_id, itype="salesforce")
        out = await int_ep.get_integration(integ.id, db=db_session, current_user=admin)
        assert out["health"] == "unknown"
        assert out["supports_sync"] is True
        assert out["consecutive_error_count"] == 0
        assert out["last_error"] is None


@pytest.mark.integration
class TestRetrySync:
    async def test_retry_records_a_success(self, db_session):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        integ = await _integration(db_session, org_id, consecutive_error_count=2)

        with patch(
            "app.services.integration_services.test_integration_connection",
            AsyncMock(return_value="Test message sent"),
        ):
            out = await int_ep.retry_integration_sync(
                integ.id, _request(), db=db_session, current_user=admin
            )
        assert out["success"] is True
        assert out["integration"]["consecutive_error_count"] == 0
        run = (
            await db_session.execute(
                select(IntegrationSyncLog).where(
                    IntegrationSyncLog.integration_id == integ.id
                )
            )
        ).scalar_one()
        assert run.trigger_source == "retry"
        assert run.status == "success"
        assert run.triggered_by == admin.id

    async def test_retry_failure_is_sanitized_and_counted(self, db_session):
        import httpx

        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        integ = await _integration(db_session, org_id)

        with patch(
            "app.services.integration_services.test_integration_connection",
            AsyncMock(
                side_effect=httpx.ConnectError("https://hooks.slack.com/T/B/secret")
            ),
        ):
            out = await int_ep.retry_integration_sync(
                integ.id, _request(), db=db_session, current_user=admin
            )
        assert out["success"] is False
        assert "hooks.slack.com" not in out["message"]
        assert out["integration"]["consecutive_error_count"] == 1
        assert "hooks.slack.com" not in (out["integration"]["last_error"] or "")

    async def test_salesforce_retry_runs_the_sync_and_advances_last_sync(
        self, db_session
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        integ = await _integration(db_session, org_id, itype="salesforce")

        with patch(
            "app.services.integration_services.salesforce_sync_service."
            "run_salesforce_sync",
            AsyncMock(return_value={"push": {"members": {"created": 4}}}),
        ) as sync:
            out = await int_ep.retry_integration_sync(
                integ.id, _request(), db=db_session, current_user=admin
            )
        sync.assert_awaited_once()
        assert out["success"] is True
        assert out["integration"]["last_sync_at"] is not None
        run = (
            await db_session.execute(
                select(IntegrationSyncLog).where(
                    IntegrationSyncLog.integration_id == integ.id
                )
            )
        ).scalar_one()
        assert run.summary == {"push_members_created": 4}

    async def test_a_second_retry_inside_the_cooldown_is_refused(self, db_session):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        integ = await _integration(db_session, org_id)

        with patch(
            "app.services.integration_services.test_integration_connection",
            AsyncMock(return_value="ok"),
        ):
            await int_ep.retry_integration_sync(
                integ.id, _request(), db=db_session, current_user=admin
            )
            with pytest.raises(HTTPException) as exc:
                await int_ep.retry_integration_sync(
                    integ.id, _request(), db=db_session, current_user=admin
                )
        assert exc.value.status_code == 429
        assert int(exc.value.headers["Retry-After"]) > 0

    async def test_retry_after_the_cooldown_is_allowed(self, db_session):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        integ = await _integration(db_session, org_id)
        db_session.add(
            IntegrationSyncLog(
                organization_id=org_id,
                integration_id=integ.id,
                operation="connection_test",
                trigger_source="retry",
                status="success",
                started_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            )
        )
        await db_session.flush()
        with patch(
            "app.services.integration_services.test_integration_connection",
            AsyncMock(return_value="ok"),
        ):
            out = await int_ep.retry_integration_sync(
                integ.id, _request(), db=db_session, current_user=admin
            )
        assert out["success"] is True

    async def test_another_departments_integration_is_not_found(self, db_session):
        org_a = await _org(db_session)
        org_b = await _org(db_session)
        admin_b = await _admin(db_session, org_b)
        integ = await _integration(db_session, org_a)
        with pytest.raises(HTTPException) as exc:
            await int_ep.retry_integration_sync(
                integ.id, _request(), db=db_session, current_user=admin_b
            )
        assert exc.value.status_code == 404

    async def test_a_disconnected_integration_cannot_be_retried(self, db_session):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        integ = await _integration(
            db_session, org_id, status="available", enabled=False
        )
        with pytest.raises(HTTPException) as exc:
            await int_ep.retry_integration_sync(
                integ.id, _request(), db=db_session, current_user=admin
            )
        assert exc.value.status_code == 409


@pytest.mark.unit
class TestRetryIsRateLimited:
    async def test_the_ip_limiter_runs_before_anything_else(self):
        limiter = AsyncMock(side_effect=HTTPException(status_code=429))
        with patch.object(int_ep, "check_rate_limit", new=limiter):
            with pytest.raises(HTTPException) as exc:
                await int_ep.retry_integration_sync(
                    "int-1",
                    _request(),
                    db=AsyncMock(),
                    current_user=SimpleNamespace(id="u", organization_id="o"),
                )
        assert exc.value.status_code == 429
        assert limiter.await_args.kwargs["scope"] == "integration_retry_sync"


@pytest.mark.unit
class TestChatDispatchRecordsHealth:
    async def test_each_delivery_is_recorded(self, monkeypatch):
        from app.services.integration_services import notification_dispatch as nd

        integ = SimpleNamespace(integration_type="slack", id="i1")
        monkeypatch.setattr(
            nd, "_enabled_messaging_integrations", AsyncMock(return_value=[integ])
        )
        monkeypatch.setattr(
            nd, "send_integration_notification", AsyncMock(return_value=False)
        )
        recorder = AsyncMock()
        monkeypatch.setattr(nd, "record_integration_run", recorder)

        sent = await nd.dispatch_chat_notifications(AsyncMock(), "org", "event", {})
        assert sent == 0
        kwargs = recorder.await_args.kwargs
        assert kwargs["success"] is False
        assert kwargs["operation"] == "chat_notification"
