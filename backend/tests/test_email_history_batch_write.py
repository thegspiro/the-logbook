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

        added_before_savepoint = []

        class _Savepoint:
            async def __aenter__(self):
                entered["opened"] = True

            async def __aexit__(self, *exc):
                entered["closed"] = True
                return False

        db = MagicMock()
        # Records whether the row was added before the savepoint opened.
        # Entering begin_nested() flushes whatever is already pending, so an
        # add above it has its INSERT rejected outside the savepoint — the
        # exact failure the savepoint exists to contain.
        db.add = MagicMock(
            side_effect=lambda _row: added_before_savepoint.append(
                entered.get("opened", False)
            )
        )
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
        assert added_before_savepoint == [True], (
            "the history row must be added inside the savepoint; entering it "
            "flushes anything already pending, so an add above it is not "
            "protected at all"
        )
        written = db.add.call_args.args[0]
        assert len(written.to_email) <= 320
        assert written.recipient_count == 50


class TestPerRecipientResultsStayAligned:
    """``results_out`` promises one answer per address, in the order given.

    ``MessageDeliveryService._send_email`` indexes it against the recipients it
    claimed, so alignment is not cosmetic: an answer list that closes up over a
    dropped address files that member's outcome under their neighbour — marking
    an address that was never sent as delivered, which also marks its delivery
    attempt complete and stops it being retried — and leaves the last member of
    the batch with no answer at all.

    A message can fail to build for one address while the rest are fine: the
    MIME assembly runs per recipient, and only the built ones reach the batch
    the SMTP send answers for.
    """

    @pytest.mark.asyncio
    async def test_an_address_whose_message_fails_to_build_keeps_its_place(self):
        service = EmailService(
            organization=SimpleNamespace(
                id="org-1",
                name="FD",
                settings={"email_service": {"enabled": True}},
            )
        )
        service._cloudflare_config = None
        service._smtp_config = {
            "host": "smtp.test",
            "port": 587,
            "from_email": "no-reply@fd.co",
            "from_name": "Falls Church FD",
            "username": "",
            "password": "",
            "use_tls": False,
        }
        # Raises for the second recipient only. Any per-recipient step could;
        # this is the one with no side effects of its own.
        service._make_message_id = MagicMock(
            side_effect=["<1@fd.co>", RuntimeError("bad header"), "<3@fd.co>"]
        )
        service._smtp_send_batch = MagicMock(
            side_effect=lambda batch: [True] * len(batch)
        )

        outcomes: list = []
        success, failure = await service.send_email(
            to_emails=["first@fd.co", "second@fd.co", "third@fd.co"],
            subject="Roof collapse drill",
            html_body="<p>0700</p>",
            results_out=outcomes,
        )

        assert outcomes == [True, False, True], (
            "the address whose message never built must hold its own slot; "
            "closing up over it hands its outcome to the next member"
        )
        assert (success, failure) == (2, 1)
