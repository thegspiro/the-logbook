"""
Tests for MessageHistory model and schemas.

Unit tests that do not require a live database connection.
"""

from datetime import datetime, timezone

from app.models.email_template import MessageHistory, MessageHistoryStatus
from app.schemas.email_template import (
    MessageHistoryListResponse,
    MessageHistoryResponse,
    SendTestEmailRequest,
)


class TestMessageHistoryModel:
    """Tests for the MessageHistory SQLAlchemy model."""

    def test_message_history_status_enum_values(self):
        """Verify enum has expected members."""
        assert MessageHistoryStatus.SENT.value == "sent"
        assert MessageHistoryStatus.FAILED.value == "failed"

    def test_message_history_repr(self):
        """Test __repr__ output."""
        msg = MessageHistory()
        msg.id = "abc-123"
        msg.to_email = "user@example.com"
        msg.status = MessageHistoryStatus.SENT
        assert "abc-123" in repr(msg)
        assert "sent" in repr(msg)


class TestMessageHistorySchemas:
    """Tests for the Pydantic schemas."""

    def test_message_history_response_from_dict(self):
        """Validate schema round-trip from a dict."""
        data = {
            "id": "msg-1",
            "organization_id": "org-1",
            "to_email": "test@example.com",
            "cc_emails": None,
            "bcc_emails": None,
            "subject": "Hello",
            "template_type": "welcome",
            "status": "sent",
            "error_message": None,
            "recipient_count": 1,
            "sent_at": datetime.now(timezone.utc).isoformat(),
            "sent_by": "user-1",
        }
        resp = MessageHistoryResponse(**data)
        assert resp.to_email == "test@example.com"
        assert resp.status == "sent"
        assert resp.recipient_count == 1

    def test_message_history_list_response(self):
        """Test paginated list schema."""
        item = MessageHistoryResponse(
            id="m1",
            to_email="a@b.com",
            subject="Sub",
            status="sent",
            recipient_count=1,
            sent_at=datetime.now(timezone.utc),
        )
        resp = MessageHistoryListResponse(
            items=[item], total=1, skip=0, limit=50
        )
        assert resp.total == 1
        assert len(resp.items) == 1

    def test_send_test_email_request_minimal(self):
        """Validate minimal test email request."""
        req = SendTestEmailRequest(to_email="admin@example.com")
        assert req.to_email == "admin@example.com"
        assert req.template_id is None

    def test_send_test_email_request_with_template(self):
        """Validate test email request with template_id."""
        req = SendTestEmailRequest(
            to_email="admin@example.com", template_id="tmpl-123"
        )
        assert req.template_id == "tmpl-123"
