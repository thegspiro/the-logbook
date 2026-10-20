"""The pre-auth onboarding SMTP test answers every unreachable target alike.

ONB-30-3: ``POST /onboarding/test/email`` with a self-hosted platform opens an
SMTP connection to a host and port the caller chooses, before any account
exists. Distinct messages for "connection refused", "timed out", "no such
host" and "something answered but not SMTP" let that caller map what listens
on the internal network. The owner chose to keep on-premises relays working
and remove the oracle: every failure before an SMTP greeting gets one message
and one set of detail keys. Failures after a server has greeted us as SMTP
(authentication, TLS) keep their specific messages, and so does the
authenticated settings-screen test, which is not part of this decision.
"""

import smtplib
import socket
import ssl
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1 import email_test_helper
from app.api.v1.email_test_helper import UNIFORM_SMTP_UNREACHABLE_MESSAGE
from app.api.v1.onboarding import verify_email_configuration

pytestmark = [pytest.mark.unit]

# Referenced through the module: a bare ``test_*`` name imported here would be
# collected by pytest as a test of its own.
_uniform = email_test_helper.test_smtp_connection_uniform

_CONFIG = {
    "smtpHost": "10.0.0.5",
    "smtpPort": 8080,
    "smtpEncryption": "tls",
    "fromEmail": "fd@dept.example",
}

# Each of these used to produce its own message; together they are the
# fingerprinting oracle.
_CONNECTION_STAGE_FAILURES = [
    ConnectionRefusedError(111, "Connection refused"),
    TimeoutError("timed out"),
    socket.gaierror(-2, "Name or service not known"),
    smtplib.SMTPConnectError(554, b"not an smtp server"),
    smtplib.SMTPServerDisconnected("Connection unexpectedly closed"),
    smtplib.SMTPException("Connection refused [Errno 111]"),
    OSError(101, "Network is unreachable"),
    ssl.SSLError("wrong version number"),
]


def _smtp_raising(exc):
    return patch.object(email_test_helper.smtplib, "SMTP", side_effect=exc)


@pytest.mark.parametrize("exc", _CONNECTION_STAGE_FAILURES, ids=repr)
def test_every_connection_stage_failure_reads_the_same(exc):
    with _smtp_raising(exc):
        success, message, details = _uniform(dict(_CONFIG))

    assert success is False
    assert message == UNIFORM_SMTP_UNREACHABLE_MESSAGE
    assert details == {
        "host": "10.0.0.5",
        "port": 8080,
        "encryption": "tls",
        "from_email": "fd@dept.example",
        "error": "connection_failed",
    }


def test_ssl_mode_handshake_failure_reads_the_same():
    config = dict(_CONFIG, smtpEncryption="ssl")
    with patch.object(
        email_test_helper.smtplib,
        "SMTP_SSL",
        side_effect=ssl.SSLError("certificate verify failed"),
    ):
        success, message, details = _uniform(config)

    assert success is False
    assert message == UNIFORM_SMTP_UNREACHABLE_MESSAGE
    assert details["error"] == "connection_failed"


def test_authenticated_settings_test_keeps_its_specific_messages():
    """The settings-screen test sits behind admin auth and is unchanged."""
    messages = set()
    for exc in _CONNECTION_STAGE_FAILURES[:3]:
        with _smtp_raising(exc):
            _, message, _ = email_test_helper.test_smtp_connection(dict(_CONFIG))
        messages.add(message)
    assert len(messages) == 3
    assert UNIFORM_SMTP_UNREACHABLE_MESSAGE not in messages


def test_a_real_smtp_server_still_reports_a_refused_login():
    server = MagicMock()
    server.__enter__.return_value = server
    server.login.side_effect = smtplib.SMTPAuthenticationError(535, b"bad creds")
    config = dict(_CONFIG, smtpUsername="fd", smtpPassword="wrong")
    with patch.object(email_test_helper.smtplib, "SMTP", return_value=server):
        success, message, details = _uniform(config)

    assert success is False
    assert message != UNIFORM_SMTP_UNREACHABLE_MESSAGE
    assert "authentication failed" in message
    assert details["connected"] is True


def test_success_passes_through():
    server = MagicMock()
    server.__enter__.return_value = server
    with patch.object(email_test_helper.smtplib, "SMTP", return_value=server):
        success, message, _ = _uniform(dict(_CONFIG))
    assert success is True
    assert message == "SMTP connection successful"


@pytest.mark.parametrize(
    ("config", "expected"),
    [
        ({"smtpHost": "mail.example"}, "Missing required SMTP configuration fields"),
        (dict(_CONFIG, smtpPort="abc"), "Invalid port number: abc"),
    ],
)
def test_input_checks_keep_their_own_message(config, expected):
    success, message, _ = _uniform(config)
    assert success is False
    assert message == expected


def _setup_in_progress():
    """Onboarding is still open, so the completion guard lets the call through."""
    service = MagicMock()
    service.needs_onboarding = AsyncMock(return_value=True)
    return patch("app.api.v1.onboarding.OnboardingService", return_value=service)


async def test_endpoint_uses_the_uniform_test_for_self_hosted():
    request = SimpleNamespace(platform="selfhosted", config=dict(_CONFIG))
    with (
        patch("app.api.v1.onboarding.validate_session", AsyncMock()),
        _setup_in_progress(),
        _smtp_raising(ConnectionRefusedError(111, "Connection refused")),
    ):
        response = await verify_email_configuration(
            request, MagicMock(), db=MagicMock()
        )

    assert response.success is False
    assert response.message == UNIFORM_SMTP_UNREACHABLE_MESSAGE
    assert "10.0.0.5" not in response.message


async def test_endpoint_outer_timeout_is_uniform_for_self_hosted():
    request = SimpleNamespace(platform="other", config=dict(_CONFIG))

    class _Expired:
        async def __aenter__(self):
            raise TimeoutError

        async def __aexit__(self, *exc):
            return False

    with (
        patch("app.api.v1.onboarding.validate_session", AsyncMock()),
        _setup_in_progress(),
        patch("app.api.v1.onboarding.asyncio.timeout", return_value=_Expired()),
    ):
        response = await verify_email_configuration(
            request, MagicMock(), db=MagicMock()
        )

    assert response.success is False
    assert response.message == UNIFORM_SMTP_UNREACHABLE_MESSAGE
    assert response.details == {"error": "connection_failed"}
