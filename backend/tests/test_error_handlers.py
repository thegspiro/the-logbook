"""
Tests for the application's global exception handlers (main.py).

The handlers are what put a server-side failure on the Error Monitoring page,
so what matters here is which failures get persisted — not just what the
client receives.
"""

import json
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError
from pydantic import field_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

import main
from app.schemas.email_template import (
    EmailTemplatePreviewRequest,
    EmailTemplateUpdate,
)
from app.services.email_theme import ACCENT_INDIGO, LAYOUTS


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
        """Logging must not alter what the client receives — the detail is
        passed through verbatim, plus the automatic LB-API-<status> code."""
        exc = StarletteHTTPException(status_code=404, detail="Event not found")

        response = await main.http_exception_handler_with_logging(request_stub, exc)

        assert json.loads(response.body) == {
            "detail": "Event not found",
            "code": "LB-API-404",
        }


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

        assert json.loads(response.body) == {
            "detail": "Internal server error",
            "code": "LB-SYS-001",
        }


class TestValidationErrorHandler:
    """A 422 has to say what the field would have accepted.

    The handler rewrites Pydantic's verbose errors into one short line per
    field. For the built-in constraints that is a clear improvement — nobody
    needs the schema path — but it also flattened every ``value_error``, and a
    ``value_error`` is one of *our own* validators, whose message was written
    for the person on the screen and names the legal values.

    The email template editor is what surfaced it: a template with no stored
    colourway posted a blank accent and layout, and the reply was
    "header_accent: Invalid value. layout: Invalid value." — two fields
    rejected, nothing anywhere saying which values were legal, and a preview
    pane that rendered nothing.
    """

    @staticmethod
    async def _messages(request_stub, model, payload):
        """Run a real model failure through the handler, as a field -> message map."""
        try:
            model(**payload)
        except PydanticValidationError as exc:
            wrapped = RequestValidationError(exc.errors())
        else:  # pragma: no cover - the payload is meant to fail
            raise AssertionError("payload was expected to fail validation")
        response = await main._validation_error_handler(request_stub, wrapped)
        body = json.loads(response.body)
        assert body["code"] == "LB-VAL-001"
        return {entry["field"]: entry["message"] for entry in body["detail"]}

    async def test_a_rejected_accent_names_the_accents_it_would_have_taken(
        self, request_stub
    ):
        messages = await self._messages(
            request_stub, EmailTemplatePreviewRequest, {"header_accent": "#123456"}
        )

        assert "Invalid value." not in messages["header_accent"]
        assert "available accents" in messages["header_accent"]
        # The seven are the whole point of the message; one is enough to prove
        # the list survived.
        assert ACCENT_INDIGO in messages["header_accent"]

    async def test_a_rejected_layout_names_the_layouts_it_would_have_taken(
        self, request_stub
    ):
        messages = await self._messages(
            request_stub, EmailTemplatePreviewRequest, {"layout": "newsletter"}
        )

        for layout in LAYOUTS:
            assert layout in messages["layout"]

    async def test_the_field_name_still_comes_through(self, request_stub):
        messages = await self._messages(
            request_stub, EmailTemplateUpdate, {"header_accent": "#123456"}
        )

        assert set(messages) == {"header_accent"}

    async def test_pydantics_own_prefix_is_not_shown_to_the_reader(self, request_stub):
        # Pydantic reports a validator's text as "Value error, <text>". That
        # prefix is an implementation detail of the library and reads as noise
        # in a toast.
        messages = await self._messages(
            request_stub, EmailTemplatePreviewRequest, {"layout": "newsletter"}
        )

        assert not messages["layout"].startswith("Value error")

    async def test_an_unsafe_validator_message_degrades_to_the_old_wording(
        self, request_stub
    ):
        """A validator is free to raise a ValueError carrying library internals.

        Those must not reach the client — but they must not read as a server
        fault either, which is what the generic system message would imply for
        what is really a bad field.
        """

        class Leaky(BaseModel):
            token: str

            @field_validator("token")
            @classmethod
            def _reject(cls, value: str) -> str:
                raise ValueError("SELECT secret FROM users WHERE id = 1")

        messages = await self._messages(request_stub, Leaky, {"token": "x"})

        assert messages["token"] == "Invalid value."

    async def test_the_built_in_constraints_keep_their_short_rewrites(
        self, request_stub
    ):
        # Only value_error changed. The schema-path noise the handler exists to
        # strip is still stripped.
        class Required(BaseModel):
            required_thing: str

        messages = await self._messages(request_stub, Required, {})

        assert messages["required_thing"] == "This field is required."
