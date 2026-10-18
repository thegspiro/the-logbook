"""
Tests for security-notification dispatch.

Verifies that the in-app notification is recorded synchronously while the email
is deferred to a FastAPI background task (rather than sent inline on the request
path). Uses a stub DB session so no database is required.
"""

from unittest.mock import AsyncMock, patch

from fastapi import BackgroundTasks

from app.utils.security_notifications import _send_security_email, notify_security_event


class _StubDB:
    """Minimal async DB stub: records adds, no-op flush/execute."""

    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        return None

    async def execute(self, *args, **kwargs):  # pragma: no cover - unused here
        raise AssertionError("execute() should not run when email is queued")


def _user(email="member@example.com"):
    return type(
        "StubUser",
        (),
        {"id": "u1", "organization_id": "org1", "email": email},
    )()


class TestSecurityNotifications:
    async def test_records_in_app_and_queues_email(self):
        db = _StubDB()
        bg = BackgroundTasks()

        await notify_security_event(
            db,
            _user(),
            subject="Test subject",
            message="Test body",
            background_tasks=bg,
        )

        # In-app notification recorded synchronously in the request transaction.
        assert len(db.added) == 1
        # Email deferred to the background task runner, not sent inline.
        assert len(bg.tasks) == 1
        task = bg.tasks[0]
        assert task.func is _send_security_email
        assert task.args == ("org1", "member@example.com", "Test subject", "Test body")

    async def test_no_email_queued_when_member_has_no_address(self):
        db = _StubDB()
        bg = BackgroundTasks()

        await notify_security_event(
            db,
            _user(email=None),
            subject="x",
            message="y",
            background_tasks=bg,
        )

        # Still records the in-app notification, but queues no email.
        assert len(db.added) == 1
        assert len(bg.tasks) == 0

    async def test_send_email_false_skips_queue(self):
        db = _StubDB()
        bg = BackgroundTasks()

        await notify_security_event(
            db,
            _user(),
            subject="x",
            message="y",
            background_tasks=bg,
            send_email=False,
        )

        assert len(db.added) == 1
        assert len(bg.tasks) == 0

    async def test_inline_fallback_escapes_message_html(self):
        """AUTH-22: no ``background_tasks`` (the scheduled-task caller's shape)
        sends inline, on the caller's own session. ``wrap_email_body``'s own
        contract requires pre-escaped HTML; a message containing
        attacker-reachable or merely coincidental HTML metacharacters must
        not reach the template unescaped.
        """
        db = _StubDB()
        captured = {}

        def fake_wrap_email_body(organization, title, body_html, **kwargs):
            captured["body_html"] = body_html
            return "<html>stub</html>"

        with (
            patch(
                "app.services.email_service.wrap_email_body",
                side_effect=fake_wrap_email_body,
            ),
            patch("app.services.email_service.EmailService") as mock_email_service,
        ):
            mock_email_service.return_value.send_email = AsyncMock(return_value=(1, 0))

            await notify_security_event(
                db,
                _user(),
                subject="Test subject",
                message="<script>alert(1)</script>",
                background_tasks=None,
                org=object(),  # non-None: skips the db.execute() org lookup
            )

        assert "<script>" not in captured["body_html"]
        assert "&lt;script&gt;" in captured["body_html"]
