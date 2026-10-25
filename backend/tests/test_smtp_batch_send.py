"""``EmailService._smtp_send_batch`` under provider rate limits and quotas.

Each fake connection replays a script of outcomes for successive ``sendmail``
calls; ``_smtp_connect`` hands out connections in order, so a test reads as
"what the server said to each attempt".
"""

import smtplib
from typing import Any, List, Optional
from unittest.mock import patch

import pytest

from app.services.email_service import (
    EmailService,
    _is_sending_quota_reply,
    _smtp_replies,
)

pytestmark = pytest.mark.unit

OK = None
GMAIL_QUOTA = smtplib.SMTPDataError(
    550, b"5.4.5 Daily user sending limit exceeded. Learn more at ..."
)


def rate_limited() -> smtplib.SMTPDataError:
    return smtplib.SMTPDataError(421, b"4.7.0 Try again later, closing connection.")


class FakeServer:
    def __init__(self, script: List[Optional[BaseException]]):
        self.script = list(script)
        self.sent: List[str] = []
        self.closed = False
        self.attempts = 0

    def sendmail(self, from_addr: str, to_addrs: Any, msg: str) -> dict:
        self.attempts += 1
        if self.closed:
            raise smtplib.SMTPServerDisconnected("please run connect() first")
        outcome = self.script.pop(0)
        if outcome is not None:
            # smtplib.sendmail closes the connection itself before raising a
            # 421, so the next call on it raises SMTPServerDisconnected.
            if getattr(outcome, "smtp_code", None) == 421:
                self.closed = True
            raise outcome
        self.sent.append(msg)
        return {}

    def rset(self) -> None:
        pass

    def quit(self) -> None:
        pass


def make_service() -> EmailService:
    service = EmailService()
    service._smtp_config = {
        "host": "smtp.gmail.com",
        "port": 587,
        "user": "dept@example.com",
        "password": "app-password",
        "from_email": "dept@example.com",
        "encryption": "tls",
    }
    return service


def run_batch(connections: List[Any], count: int) -> List[bool]:
    service = make_service()
    messages = [([f"m{i}@example.com"], f"msg-{i}") for i in range(count)]
    with (
        patch.object(service, "_smtp_connect", side_effect=connections),
        patch("app.services.email_service.time.sleep"),
    ):
        return service._smtp_send_batch(messages)


class TestRateLimitRetry:
    def test_rate_limited_message_is_resent_after_reconnect(self):
        first = FakeServer([OK, rate_limited()])
        second = FakeServer([OK, OK])

        assert run_batch([first, second], 3) == [True, True, True]
        assert first.sent == ["msg-0"]
        assert second.sent == ["msg-1", "msg-2"]

    def test_second_rate_limit_fails_that_message_and_batch_continues(self):
        first = FakeServer([rate_limited()])
        second = FakeServer([rate_limited()])
        third = FakeServer([OK])

        assert run_batch([first, second, third], 2) == [False, True]
        assert third.sent == ["msg-1"]

    def test_permanent_rejection_is_not_retried(self):
        server = FakeServer([smtplib.SMTPDataError(550, b"5.1.1 No such user"), OK])

        # A second connection would be a retry; side_effect has none to give.
        assert run_batch([server], 2) == [False, True]
        assert server.sent == ["msg-1"]

    def test_disconnect_still_reconnects_and_resends(self):
        first = FakeServer([smtplib.SMTPServerDisconnected("gone")])
        second = FakeServer([OK])

        assert run_batch([first, second], 1) == [True]
        assert second.sent == ["msg-0"]


class TestSendingQuota:
    def test_quota_reply_stops_the_batch(self):
        server = FakeServer([OK, GMAIL_QUOTA])

        assert run_batch([server], 4) == [True, False, False, False]
        # Messages after the quota reply are never handed to the server.
        assert server.attempts == 2

    def test_quota_reply_at_rcpt_stops_the_batch(self):
        refused = smtplib.SMTPRecipientsRefused(
            {"m0@example.com": (550, b"5.4.5 Daily user sending limit exceeded")}
        )
        server = FakeServer([refused])

        assert run_batch([server], 3) == [False, False, False]
        assert server.attempts == 1


class TestReconnectFailure:
    def test_failed_reconnect_keeps_results_already_delivered(self):
        server = FakeServer([OK, rate_limited()])

        results = run_batch(
            [server, smtplib.SMTPAuthenticationError(535, b"5.7.8 Bad creds")], 3
        )

        assert results == [True, False, False]


class TestReplyHelpers:
    def test_recipients_refused_replies_omit_addresses(self):
        refused = smtplib.SMTPRecipientsRefused(
            {"secret@example.com": (550, b"5.4.5 Daily user sending limit")}
        )

        assert _smtp_replies(refused) == [(550, "5.4.5 Daily user sending limit")]

    @pytest.mark.parametrize(
        ("code", "text", "expected"),
        [
            (550, "5.4.5 Daily user sending limit exceeded", True),
            (550, "5.1.1 The email account does not exist", False),
            (421, "4.4.5 Server busy", False),
        ],
    )
    def test_quota_detection(self, code, text, expected):
        assert _is_sending_quota_reply(code, text) is expected
