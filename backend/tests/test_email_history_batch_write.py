"""A batch send's history row must not poison the caller's transaction.

``MessageHistory.to_email`` is ``VARCHAR(320)`` and the history writer joined
every recipient address into it. That fits a one-off notice and overflows the
moment a send has more than a handful of recipients — which is now the normal
case, because a department message claims the whole roster and sends once.

Under strict MySQL the insert is rejected (1406). ``send_email`` catches and
warns, so the send still reports success, but the shared session is left needing
an explicit rollback and every later statement on it raises
``PendingRollbackError``: the delivery-status writes and the urgent-SMS
escalation that follow silently abort, so members are emailed and the text
nobody can afford to miss never goes out.

Two halves: the addresses are summarised to fit, and the write is wrapped in a
savepoint so a failure for any other reason still leaves the session usable.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.email_service import EmailService, _summarize_recipients


class TestSummarizeRecipients:
    def test_a_short_batch_is_recorded_verbatim(self):
        assert _summarize_recipients(["a@fd.co", "b@fd.co"]) == "a@fd.co, b@fd.co"

    def test_a_roster_sized_batch_fits_the_column(self):
        addresses = [f"member{i:03d}@fallschurchfire.org" for i in range(300)]
        summary = _summarize_recipients(addresses)
        assert len(summary) <= 320
        assert summary.startswith("member000@fallschurchfire.org")
        assert "more)" in summary

    def test_one_very_long_address_still_fits(self):
        # 254 characters is the maximum a mail server must accept, and one of
        # them alongside four ordinary addresses is enough to overflow.
        long_address = ("x" * 240) + "@fd.co"
        summary = _summarize_recipients(
            [long_address] + [f"m{i}@fd.co" for i in range(4)]
        )
        assert len(summary) <= 320


class TestHistoryWriteIsIsolated:
    @pytest.mark.asyncio
    async def test_a_rejected_history_row_does_not_take_the_session_with_it(self):
        """The savepoint is the point: the caller's transaction survives."""
        entered = {}

        class _Savepoint:
            async def __aenter__(self):
                entered["opened"] = True

            async def __aexit__(self, *exc):
                entered["closed"] = True
                return False

        db = MagicMock()
        db.add = MagicMock()
        db.flush = AsyncMock()
        db.begin_nested = MagicMock(return_value=_Savepoint())

        service = EmailService(
            organization=SimpleNamespace(id="org-1", name="FD", settings=None)
        )
        await service._log_message_history(
            db,
            to_emails=[f"m{i}@fd.co" for i in range(50)],
            subject="Roof collapse drill",
            cc_emails=None,
            bcc_emails=None,
            template_type="department_message",
            sent_by=None,
            success_count=50,
            failure_count=0,
        )

        assert entered == {"opened": True, "closed": True}
        written = db.add.call_args.args[0]
        assert len(written.to_email) <= 320
        assert written.recipient_count == 50
