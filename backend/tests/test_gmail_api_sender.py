"""``GmailApiSender``: the Gmail API transport for service-account departments.

Requests go through httpx's mock transport, so what the sender would put on
the wire — URL, headers, body — is what the tests read.
"""

from datetime import datetime, timedelta, timezone
from typing import Callable, List
from unittest.mock import patch

import httpx
import pytest

import app.services.gmail_api_sender as sender_module
from app.services.gmail_api_sender import (
    GMAIL_SEND_URL,
    GmailApiSender,
    _retry_wait_seconds,
    with_bcc_header,
)
from app.utils.google_oauth import GoogleOAuthError

pytestmark = pytest.mark.unit

SENDER = "notifications@example.org"
_REAL_ASYNC_CLIENT = httpx.AsyncClient


def mime(to: str, cc: str = "") -> str:
    lines = [f"From: Test FD <{SENDER}>", f"To: {to}"]
    if cc:
        lines.append(f"Cc: {cc}")
    lines += ["Subject: Drill", "", "Drill tonight"]
    return "\n".join(lines)


def error(status: int, reason: str = "", message: str = "", headers=None):
    body = {"error": {"code": status, "message": message, "errors": []}}
    if reason:
        body["error"]["errors"].append({"reason": reason})
    return httpx.Response(status, json=body, headers=headers or {})


OK = httpx.Response(200, json={"id": "m1"})


class Script:
    """Answers requests from a list, recording each one."""

    def __init__(self, answers: List[object]):
        self.answers = list(answers)
        self.requests: List[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


async def run(
    answers: List[object],
    messages,
    token: Callable = lambda key, subject: "tok",
) -> tuple[List[bool], Script]:
    script = Script(answers)

    def client(**kwargs):
        return _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(script), **kwargs)

    with (
        patch.object(sender_module, "acquire_gmail_send_token", side_effect=token),
        patch.object(sender_module, "GMAIL_SEND_PACE_SECONDS", 0),
        patch.object(sender_module, "_DEFAULT_RETRY_WAIT_SECONDS", 0),
        patch("httpx.AsyncClient", side_effect=client),
    ):
        results = await GmailApiSender("{key}", SENDER).send(messages)
    return results, script


def batch(n: int):
    return [([f"m{i}@example.org"], mime(f"m{i}@example.org")) for i in range(n)]


class TestBccHeader:
    def test_recipients_in_to_and_cc_are_not_repeated(self):
        message = mime("a@example.org", cc="b@example.org")
        assert with_bcc_header(["a@example.org", "B@example.org"], message) == message

    def test_envelope_only_recipients_become_bcc(self):
        message = mime("a@example.org")
        out = with_bcc_header(["a@example.org", "hidden@example.org"], message)
        assert out.startswith("Bcc: hidden@example.org\n")
        assert out.endswith(message)

    def test_a_line_break_cannot_inject_a_header(self):
        out = with_bcc_header(
            ["a@example.org", "x@example.org\nX-Evil: 1"], mime("a@example.org")
        )
        assert "\nX-Evil" not in out
        assert out.startswith("Bcc: x@example.orgX-Evil: 1\n")


class TestRequest:
    async def test_posts_raw_mime_with_the_delegated_token(self):
        results, script = await run([OK, OK], batch(2))

        assert results == [True, True]
        request = script.requests[0]
        assert str(request.url) == GMAIL_SEND_URL
        assert request.headers["Authorization"] == "Bearer tok"
        assert request.headers["Content-Type"] == "message/rfc822"
        assert request.content.decode() == mime("m0@example.org")

    async def test_bcc_recipient_reaches_the_api(self):
        messages = [(["a@example.org", "records@example.org"], mime("a@example.org"))]
        _, script = await run([OK], messages)

        assert (
            script.requests[0].content.decode().startswith("Bcc: records@example.org\n")
        )

    async def test_empty_batch_sends_nothing(self):
        results, script = await run([], [])
        assert results == []
        assert script.requests == []


class TestTransientFailures:
    async def test_a_throttled_message_is_resent(self):
        results, script = await run([error(429), OK], batch(1))
        assert results == [True]
        assert len(script.requests) == 2

    async def test_a_403_rate_limit_is_a_throttle(self):
        results, _ = await run([error(403, "userRateLimitExceeded"), OK], batch(1))
        assert results == [True]

    async def test_a_second_throttle_fails_that_message_and_the_batch_goes_on(self):
        results, _ = await run([error(429), error(429), OK], batch(2))
        assert results == [False, True]

    async def test_a_server_error_is_retried(self):
        results, _ = await run([error(503), OK], batch(1))
        assert results == [True]

    async def test_a_transport_error_is_retried(self):
        results, _ = await run([httpx.ConnectError("reset"), OK], batch(1))
        assert results == [True]


class TestTheBatchStops:
    async def test_at_a_daily_sending_limit(self):
        limit = error(
            429, "rateLimitExceeded", message="Daily user sending limit exceeded."
        )
        results, script = await run([OK, limit], batch(4))

        assert results == [True, False, False, False]
        assert len(script.requests) == 2

    async def test_when_google_asks_for_a_long_wait(self):
        later = (datetime.now(timezone.utc) + timedelta(hours=3)).strftime(
            "%Y-%m-%dT%H:%M:%S.000Z"
        )
        limit = error(
            429,
            "rateLimitExceeded",
            message=f"User-rate limit exceeded.  Retry after {later}",
        )
        results, script = await run([limit], batch(3))

        assert results == [False, False, False]
        assert len(script.requests) == 1

    async def test_when_the_token_is_refused(self):
        results, script = await run([error(401)], batch(3))
        assert results == [False, False, False]
        assert len(script.requests) == 1

    async def test_when_the_account_may_not_send(self):
        results, _ = await run([OK, error(403, "forbidden")], batch(3))
        assert results == [True, False, False]

    async def test_when_no_token_can_be_obtained(self):
        def refuse(key, subject):
            raise GoogleOAuthError("delegation not authorized")

        results, script = await run([], batch(2), token=refuse)

        assert results == [False, False]
        assert script.requests == []

    async def test_an_unexpected_error_keeps_what_was_sent(self):
        results, _ = await run([OK, RuntimeError("boom")], batch(3))
        assert results == [True, False, False]


class TestOneMessageOnly:
    async def test_a_message_gmail_rejects_does_not_stop_the_batch(self):
        results, _ = await run([error(400, "invalidArgument"), OK], batch(2))
        assert results == [False, True]

    async def test_a_message_too_large_does_not_stop_the_batch(self):
        results, _ = await run([error(413), OK], batch(2))
        assert results == [False, True]


class TestRetryWait:
    def test_retry_after_seconds(self):
        assert (
            _retry_wait_seconds(httpx.Response(429, headers={"Retry-After": "7"}), "")
            == 7
        )

    def test_retry_after_in_the_message(self):
        later = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        wait = _retry_wait_seconds(httpx.Response(429), f"Retry after {later}")
        assert 590 < wait <= 600

    def test_unreadable_means_a_short_default(self):
        assert _retry_wait_seconds(httpx.Response(429), "Retry after soon") == (
            sender_module._DEFAULT_RETRY_WAIT_SECONDS
        )

    def test_logged_reasons_never_include_googles_message(self):
        # Google's message can quote the sending address; the log reason is
        # built from status and error codes only.
        response = error(403, "forbidden", message=f"Delegation denied for {SENDER}")
        _, _, reason = sender_module._classify(response)
        assert SENDER not in reason
        assert reason == "refused (403 forbidden)"
