"""The anonymous side of the suggestion box is never logged as a request.

SuggestionService rounds anonymous submissions to noon so a row cannot be lined
up against a member's sign-in. An access-log line carrying the exact second and
the client address would undo that, so neither uvicorn's access log nor
IPLoggingMiddleware may write one for these paths.
"""

import logging

import pytest
from loguru import logger

from app.core import logging as logging_config
from app.core.logging import is_unlogged_path

pytestmark = pytest.mark.unit

SUBMIT = "/api/v1/suggestions/boxes/6f1c2d3e-0000-4000-8000-000000000001/submissions"
FOLLOW_UP = "/api/v1/suggestions/follow-up/lookup"
CLIENT_IP = "203.0.113.9"


class TestIsUnloggedPath:
    @pytest.mark.parametrize(
        "path",
        [
            SUBMIT,
            FOLLOW_UP,
            "/api/v1/suggestions/follow-up/messages",
            "/api/v1/suggestions/follow-up/attachments/abc",
        ],
    )
    def test_anonymous_side_is_unlogged(self, path):
        assert is_unlogged_path(path)

    @pytest.mark.parametrize(
        "path",
        [
            # Named and reviewer traffic is ordinary and stays logged.
            "/api/v1/suggestions/boxes",
            "/api/v1/suggestions/mine",
            "/api/v1/suggestions/mine/abc/messages",
            "/api/v1/suggestions/review/abc",
            "/api/v1/suggestions/admin/boxes/abc",
            "/api/v1/suggestions/boxes/abc/submissions/extra",
            "/api/v1/suggestions/boxes/abc/submissionsx",
            "/api/v1/events",
        ],
    )
    def test_other_paths_are_logged(self, path):
        assert not is_unlogged_path(path)


def _uvicorn_record(path_with_query: str) -> logging.LogRecord:
    # The exact call uvicorn's h11 and httptools protocols make.
    return logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=0,
        msg='%s - "%s %s HTTP/%s" %d',
        args=(f"{CLIENT_IP}:51234", "POST", path_with_query, "1.1", 201),
        exc_info=None,
    )


class TestUvicornAccessFilter:
    def test_drops_the_submission_line(self):
        f = logging_config._DropUnloggedAccessFilter()
        assert f.filter(_uvicorn_record(SUBMIT)) is False
        assert f.filter(_uvicorn_record(FOLLOW_UP + "?x=1")) is False

    def test_keeps_every_other_line(self):
        f = logging_config._DropUnloggedAccessFilter()
        assert f.filter(_uvicorn_record("/api/v1/suggestions/mine")) is True

    def test_keeps_records_not_shaped_like_an_access_line(self):
        record = logging.LogRecord(
            "uvicorn.access", logging.INFO, __file__, 0, "plain", None, None
        )
        assert logging_config._DropUnloggedAccessFilter().filter(record) is True

    def test_installed_once_on_the_uvicorn_access_logger(self):
        logging_config._intercept_stdlib_logging()
        logging_config._intercept_stdlib_logging()
        filters = [
            f
            for f in logging.getLogger("uvicorn.access").filters
            if isinstance(f, logging_config._DropUnloggedAccessFilter)
        ]
        assert len(filters) == 1


class TestIPLoggingMiddlewareSkipsUnloggedPaths:
    @staticmethod
    async def _run(monkeypatch, path: str) -> tuple[list[str], dict]:
        from app.core.security_middleware import IPLoggingMiddleware

        monkeypatch.setattr("app.core.geoip.get_geoip_service", lambda: None)

        async def inner_app(scope, receive, send):
            await send({"type": "http.response.start", "status": 201, "headers": []})
            await send({"type": "http.response.body", "body": b""})

        scope = {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [],
            "client": (CLIENT_IP, 51234),
            "query_string": b"",
        }

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        sent: list[dict] = []

        async def send(message):
            sent.append(message)

        lines: list[str] = []
        sink_id = logger.add(lambda m: lines.append(str(m)), level="DEBUG")
        try:
            await IPLoggingMiddleware(inner_app)(scope, receive, send)
        finally:
            logger.remove(sink_id)
        start = next(m for m in sent if m["type"] == "http.response.start")
        return lines, start

    async def test_writes_nothing_for_a_submission(self, monkeypatch):
        lines, start = await self._run(monkeypatch, SUBMIT)

        assert not [line for line in lines if "suggestions" in line]
        assert not [line for line in lines if CLIENT_IP in line]
        # The request is still served and still correlatable by its own id.
        assert start["status"] == 201
        assert any(k == b"x-request-id" for k, _ in start["headers"])

    async def test_still_logs_other_requests(self, monkeypatch):
        lines, _ = await self._run(monkeypatch, "/api/v1/suggestions/mine")

        assert any(CLIENT_IP in line for line in lines)
        assert any("POST /api/v1/suggestions/mine" in line for line in lines)
