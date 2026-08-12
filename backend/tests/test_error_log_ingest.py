"""
Tests for the error-log ingest endpoint's abuse protection.

The Error Monitoring table is the one place an administrator looks when
members report trouble, so a client that floods it — a stale build stuck in a
retry loop, or a member posting directly — degrades the very visibility the
feature exists to provide. No DB.
"""

from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.error_logs import (
    ERROR_LOG_RATE_LIMIT,
    ERROR_LOG_RATE_WINDOW_SECONDS,
    ErrorLogCreate,
    log_error,
)
from app.services.retention_service import RECORD_CLASSES


@pytest.fixture
def current_user():
    user = Mock()
    user.id = "user-1"
    user.organization_id = "org-1"
    return user


@pytest.fixture
def db():
    session = AsyncMock()
    session.add = Mock()
    return session


class TestIngestRateLimit:
    def test_tokenized_context_paths_are_redacted_at_ingest(self):
        token = "FINTOK_0123456789abcdefghijklmnopqrstuvwxyz"

        data = ErrorLogCreate(context={"path": f"/finance/approvals/{token}/approve"})

        assert token not in data.context["path"]
        assert data.context["path"] == "/finance/approvals/[REDACTED]/approve"

    async def test_a_report_is_stored_when_under_the_limit(self, db, current_user):
        with patch(
            "app.api.v1.endpoints.error_logs.is_rate_limited",
            AsyncMock(return_value=False),
        ):
            result = await log_error(
                ErrorLogCreate(error_type="API_SERVER_ERROR", error_message="boom"),
                db=db,
                current_user=current_user,
            )

        assert result["status"] == "logged"
        db.add.assert_called_once()
        db.commit.assert_awaited_once()

    async def test_over_the_limit_returns_429_and_stores_nothing(
        self, db, current_user
    ):
        with patch(
            "app.api.v1.endpoints.error_logs.is_rate_limited",
            AsyncMock(return_value=True),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await log_error(
                    ErrorLogCreate(error_type="API_SERVER_ERROR", error_message="boom"),
                    db=db,
                    current_user=current_user,
                )

        assert exc_info.value.status_code == 429
        assert exc_info.value.headers["Retry-After"] == str(
            ERROR_LOG_RATE_WINDOW_SECONDS
        )
        db.add.assert_not_called()

    async def test_the_bucket_is_per_user_not_per_ip(self, db, current_user):
        """A department's members share one public address, so an IP bucket
        would let one member's failing tab silence the whole station."""
        limiter = AsyncMock(return_value=False)
        with patch("app.api.v1.endpoints.error_logs.is_rate_limited", limiter):
            await log_error(
                ErrorLogCreate(error_type="API_SERVER_ERROR", error_message="boom"),
                db=db,
                current_user=current_user,
            )

        assert limiter.await_args.kwargs["key"] == "error_log:user-1"
        assert limiter.await_args.kwargs["limit"] == ERROR_LOG_RATE_LIMIT

    async def test_reporting_survives_redis_being_down(self, db, current_user):
        """Losing the limiter must not also lose error visibility."""
        limiter = AsyncMock(return_value=False)
        with patch("app.api.v1.endpoints.error_logs.is_rate_limited", limiter):
            await log_error(
                ErrorLogCreate(error_type="API_SERVER_ERROR", error_message="boom"),
                db=db,
                current_user=current_user,
            )

        assert limiter.await_args.kwargs["fail_closed"] is False

    async def test_the_client_throttle_leaves_headroom(self):
        """The server cap only engages for a client ignoring its own throttle
        (20/minute); setting it near that would drop legitimate bursts."""
        assert ERROR_LOG_RATE_LIMIT > 20


class TestErrorLogRetention:
    def test_error_logs_are_registered_for_retention(self):
        """Every failed request writes a row, so without a default retention
        the table grows without bound until an admin clicks Clear All."""
        rc = next((r for r in RECORD_CLASSES if r.key == "error_logs"), None)

        assert rc is not None
        assert rc.default_days == 180
        assert rc.timestamp_attr == "created_at"

    def test_the_floor_prevents_a_typo_wiping_recent_errors(self):
        rc = next(r for r in RECORD_CLASSES if r.key == "error_logs")

        assert rc.min_days >= 30
