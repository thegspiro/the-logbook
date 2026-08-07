"""
Tests for server-side error reporting (app/core/error_reporting.py).

These cover the pure helpers that decide what reaches the Error Monitoring
page: identity resolution (which determines whether an error can be stored at
all), query redaction, and the size limits imposed by the error_logs columns.
No DB.
"""

from datetime import timedelta
from unittest.mock import Mock

import pytest

from app.core.error_reporting import (
    MAX_ERROR_TYPE_LENGTH,
    build_error_type,
    extract_request_identity,
    is_excluded_path,
    persist_error_log,
    sanitize_query_params,
)
from app.core.security import create_access_token


def make_request(cookies=None, headers=None):
    """Minimal stand-in for a Starlette Request: only .cookies and .headers."""
    request = Mock()
    request.cookies = cookies or {}
    request.headers = headers or {}
    return request


class TestExtractRequestIdentity:
    def test_reads_identity_from_the_access_token_cookie(self):
        """Browsers authenticate by cookie only; a header-only lookup finds
        nothing for them, which previously dropped every browser-triggered
        server error before it could be stored."""
        token = create_access_token({"sub": "user-1", "org_id": "org-1"})

        user_id, org_id = extract_request_identity(
            make_request(cookies={"access_token": token})
        )

        assert user_id == "user-1"
        assert org_id == "org-1"

    def test_falls_back_to_the_authorization_header(self):
        token = create_access_token({"sub": "user-2", "org_id": "org-2"})

        user_id, org_id = extract_request_identity(
            make_request(headers={"authorization": f"Bearer {token}"})
        )

        assert user_id == "user-2"
        assert org_id == "org-2"

    def test_cookie_wins_over_header(self):
        cookie_token = create_access_token({"sub": "user-1", "org_id": "org-1"})
        header_token = create_access_token({"sub": "user-2", "org_id": "org-2"})

        user_id, org_id = extract_request_identity(
            make_request(
                cookies={"access_token": cookie_token},
                headers={"authorization": f"Bearer {header_token}"},
            )
        )

        assert (user_id, org_id) == ("user-1", "org-1")

    def test_no_credentials_yields_no_identity(self):
        assert extract_request_identity(make_request()) == (None, None)

    def test_unreadable_token_yields_no_identity(self):
        assert extract_request_identity(
            make_request(cookies={"access_token": "not-a-jwt"})
        ) == (None, None)

    def test_expired_token_yields_no_identity(self):
        token = create_access_token(
            {"sub": "user-1", "org_id": "org-1"}, expires_delta=timedelta(seconds=-30)
        )

        assert extract_request_identity(
            make_request(cookies={"access_token": token})
        ) == (None, None)

    def test_token_without_org_claim_yields_no_org(self):
        token = create_access_token({"sub": "user-1"})

        user_id, org_id = extract_request_identity(
            make_request(cookies={"access_token": token})
        )

        assert user_id == "user-1"
        assert org_id is None


class TestSanitizeQueryParams:
    def test_empty_query_is_empty(self):
        assert sanitize_query_params("") == ""

    def test_ordinary_params_pass_through(self):
        assert sanitize_query_params("page=2&limit=50") == "page=2&limit=50"

    @pytest.mark.parametrize(
        "key", ["token", "password", "api_key", "access_token", "refresh_token"]
    )
    def test_sensitive_params_are_redacted(self, key):
        result = sanitize_query_params(f"{key}=supersecret&page=1")

        assert "supersecret" not in result
        assert "REDACTED" in result
        assert "page=1" in result

    def test_redaction_is_case_insensitive(self):
        assert "supersecret" not in sanitize_query_params("TOKEN=supersecret")


class TestBuildErrorType:
    def test_prefixes_and_uppercases(self):
        assert build_error_type("ValueError") == "BACKEND_VALUEERROR"

    def test_truncates_to_the_column_width(self):
        """error_type is String(50); an over-long value would fail the insert
        and lose the error entirely."""
        result = build_error_type("A" * 200)

        assert len(result) == MAX_ERROR_TYPE_LENGTH

    def test_custom_prefix(self):
        assert build_error_type("HTTP_500") == "BACKEND_HTTP_500"


class TestPersistErrorLog:
    """The three reasons an error legitimately does not reach the table."""

    async def test_returns_false_for_excluded_paths(self):
        request = make_request()
        request.url.path = "/api/v1/errors/log"

        assert (
            await persist_error_log(
                request=request,
                error_type="BACKEND_HTTP_500",
                error_message="boom",
                user_message="boom",
                troubleshooting_steps=[],
            )
            is False
        )

    async def test_returns_false_without_an_organization(self):
        """error_logs.organization_id is NOT NULL and every read is org-scoped,
        so an unattributable error has nowhere to go."""
        request = make_request()
        request.url.path = "/api/v1/events"

        assert (
            await persist_error_log(
                request=request,
                error_type="BACKEND_HTTP_500",
                error_message="boom",
                user_message="boom",
                troubleshooting_steps=[],
            )
            is False
        )

    async def test_returns_false_and_does_not_raise_when_the_database_fails(
        self, monkeypatch
    ):
        """Reporting is best-effort: a failure here must never replace the
        error the caller is already handling."""
        import app.core.database as database_module

        broken = Mock()
        broken.get_session = Mock(side_effect=RuntimeError("database is down"))
        monkeypatch.setattr(database_module, "database_manager", broken)

        token = create_access_token({"sub": "user-1", "org_id": "org-1"})
        request = make_request(cookies={"access_token": token})
        request.url.path = "/api/v1/events"
        request.url.query = ""
        request.method = "GET"

        assert (
            await persist_error_log(
                request=request,
                error_type="BACKEND_HTTP_500",
                error_message="boom",
                user_message="boom",
                troubleshooting_steps=[],
            )
            is False
        )


class TestIsExcludedPath:
    def test_error_endpoints_are_excluded(self):
        """Logging a failure of the error-log writer would recurse."""
        assert is_excluded_path("/api/v1/errors/log")
        assert is_excluded_path("/api/v1/errors")

    def test_other_paths_are_not_excluded(self):
        assert not is_excluded_path("/api/v1/events")
        assert not is_excluded_path("/api/v1/users/errors-report")
