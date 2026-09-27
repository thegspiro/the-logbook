"""Replies to the department's mail reach the department.

The sending address is often unattended, and members reply to notices anyway.
Without a Reply-To those replies go nowhere, so ``EmailService`` defaults the
header to the department's own contact address. No database: the service is
built from a stand-in organization and the transport is patched out.
"""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.services.email_service import EmailService

pytestmark = pytest.mark.unit

_SMTP = {
    "enabled": True,
    "platform": "selfhosted",
    "smtp_host": "mail.dept.example",
    "from_email": "noreply@dept.example",
    "smtp_user": "noreply@dept.example",
    "smtp_password": "secret",
}


def _service(email) -> EmailService:
    return EmailService(
        SimpleNamespace(name="Test FD", email=email, settings={"email_service": _SMTP})
    )


def _reply_to_header(mime: str) -> str:
    for line in mime.splitlines():
        if line.startswith("Reply-To:"):
            return line.split(":", 1)[1].strip()
    return ""


class TestTheDefault:
    def test_a_reply_goes_to_the_department(self):
        built = _service("office@dept.example").build_batch_message(
            to_email="member@dept.example", subject="Drill", html_body="<p>x</p>"
        )
        assert built.reply_to == "office@dept.example"
        assert _reply_to_header(built.mime) == "office@dept.example"

    def test_a_callers_own_reply_to_wins(self):
        # The election ballot names its administrator; that is the person a
        # voter with a question needs, not the front office.
        built = _service("office@dept.example").build_batch_message(
            to_email="member@dept.example",
            subject="Ballot",
            html_body="<p>x</p>",
            reply_to="secretary@dept.example",
        )
        assert _reply_to_header(built.mime) == "secretary@dept.example"

    @pytest.mark.parametrize(
        "email",
        [
            None,
            "",
            "   ",
            "not an address",
            "two@at@dept.example",
            "Office <office@dept.example>",
            "a@dept.example, b@dept.example",
            "office@dept.example\r\nBcc: everyone@elsewhere.example",
            "office@localhost",
        ],
    )
    def test_no_usable_address_leaves_the_message_as_it_was(self, email):
        built = _service(email).build_batch_message(
            to_email="member@dept.example", subject="Drill", html_body="<p>x</p>"
        )
        assert built.reply_to is None
        assert _reply_to_header(built.mime) == ""

    def test_surrounding_whitespace_is_ignored(self):
        assert _service("  office@dept.example ").default_reply_to() == (
            "office@dept.example"
        )

    def test_no_organization_means_no_default(self):
        assert EmailService(None).default_reply_to() is None


class TestEverySendPathCarriesIt:
    async def test_send_email_over_smtp(self):
        service = _service("office@dept.example")
        sent = []

        def fake_send(_self, recipients, mime):
            sent.append(mime)

        with (
            patch("app.services.email_service.settings.EMAIL_ENABLED", True),
            patch.object(EmailService, "_smtp_send", fake_send),
        ):
            ok, failed = await service.send_email(
                ["member@dept.example"], "Drill", "<p>x</p>"
            )

        assert (ok, failed) == (1, 0)
        assert _reply_to_header(sent[0]) == "office@dept.example"

    async def test_send_email_over_cloudflare(self):
        service = _service("office@dept.example")
        seen = {}

        async def fake_cloudflare_send(_self, **kwargs):
            seen.update(kwargs)
            return [True] * len(kwargs["to_emails"])

        with (
            patch.object(EmailService, "_use_cloudflare", property(lambda _self: True)),
            patch.object(EmailService, "_cloudflare_send", fake_cloudflare_send),
        ):
            await service.send_email(["member@dept.example"], "Drill", "<p>x</p>")

        assert seen["reply_to"] == "office@dept.example"
