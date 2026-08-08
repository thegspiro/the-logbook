"""
Tests for the application's global exception handlers (main.py).

The handlers are what put a server-side failure on the Error Monitoring page,
so what matters here is which failures get persisted — not just what the
client receives.
"""

import json
from unittest.mock import AsyncMock, Mock

import pytest
from starlette.exceptions import HTTPException as StarletteHTTPException

import main


@pytest.fixture
def request_stub():
    request = Mock()
    request.method = "POST"
    request.url.path = "/api/v1/events"
    request.url.query = ""
    request.headers = {}
    request.cookies = {}
    return request


@pytest.fixture
def captured_logs(monkeypatch):
    """Replace the persistence call so the handlers can be exercised without a DB."""
    persist = AsyncMock(return_value=True)
    monkeypatch.setattr(main, "persist_error_log", persist)
    return persist


class TestHttpExceptionHandler:
    async def test_server_error_is_persisted(self, request_stub, captured_logs):
        """The common endpoint pattern converts an internal failure into
        HTTPException(500), which the unhandled-exception handler never sees —
        without this handler those 500s reach only the affected member."""
        exc = StarletteHTTPException(status_code=500, detail="Database write failed")

        response = await main.http_exception_handler_with_logging(request_stub, exc)

        captured_logs.assert_awaited_once()
        kwargs = captured_logs.await_args.kwargs
        assert kwargs["error_type"] == "BACKEND_HTTP_500"
        assert kwargs["error_message"] == "Database write failed"
        assert response.status_code == 500

    async def test_503_is_persisted(self, request_stub, captured_logs):
        exc = StarletteHTTPException(status_code=503, detail="Service unavailable")

        await main.http_exception_handler_with_logging(request_stub, exc)

        assert captured_logs.await_args.kwargs["error_type"] == "BACKEND_HTTP_503"

    @pytest.mark.parametrize("status_code", [400, 401, 403, 404, 409, 422])
    async def test_client_errors_are_not_persisted(
        self, request_stub, captured_logs, status_code
    ):
        """4xx is routine traffic; logging it would bury real failures."""
        exc = StarletteHTTPException(status_code=status_code, detail="Nope")

        response = await main.http_exception_handler_with_logging(request_stub, exc)

        captured_logs.assert_not_awaited()
        assert response.status_code == status_code

    async def test_response_body_is_unchanged(self, request_stub, captured_logs):
        """Logging must not alter what the client receives."""
        exc = StarletteHTTPException(status_code=404, detail="Event not found")

        response = await main.http_exception_handler_with_logging(request_stub, exc)

        assert json.loads(response.body) == {"detail": "Event not found"}


class TestUnhandledExceptionHandler:
    async def test_exception_is_persisted_with_its_type(
        self, request_stub, captured_logs
    ):
        response = await main.unhandled_exception_handler(
            request_stub, ValueError("bad input")
        )

        kwargs = captured_logs.await_args.kwargs
        assert kwargs["error_type"] == "BACKEND_VALUEERROR"
        assert kwargs["error_message"] == "bad input"
        assert response.status_code == 500

    async def test_client_still_receives_a_generic_message(
        self, request_stub, captured_logs
    ):
        """Details go to the error log, never to the client."""
        response = await main.unhandled_exception_handler(
            request_stub, ValueError("SELECT * FROM users")
        )

        assert json.loads(response.body) == {"detail": "Internal server error"}
