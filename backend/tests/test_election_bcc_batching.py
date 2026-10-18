"""
BCC batching for all-member election emails.

The nominations-open announcement and the pre-meeting package used to go out
as one message with every member on BCC; a provider that caps recipients per
message refused it whole, so nobody received it. ``_send_in_bcc_batches``
splits the list so each message stays within the cap and a refused batch
does not stop the others.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.election_service import BULK_EMAIL_MAX_RECIPIENTS, ElectionService

pytestmark = [pytest.mark.unit]


def _service(*results):
    svc = MagicMock()
    svc.send_email = AsyncMock(side_effect=list(results))
    return svc


def _addresses(count: int) -> list[str]:
    return [f"member{i}@dept.example" for i in range(count)]


class TestSendInBccBatches:
    async def test_every_message_fits_the_recipient_cap(self):
        bcc = _addresses(150)
        email = _service(*[(1, 0)] * 4)

        any_sent, unreached = await ElectionService._send_in_bcc_batches(
            email, "officer@dept.example", bcc, subject="S", html_body="B"
        )

        calls = [c.kwargs for c in email.send_email.await_args_list]
        assert len(calls) == 4
        for kwargs in calls:
            assert kwargs["to_emails"] == ["officer@dept.example"]
            assert 1 + len(kwargs["bcc_emails"]) <= BULK_EMAIL_MAX_RECIPIENTS
            assert kwargs["subject"] == "S"
            assert kwargs["html_body"] == "B"
        assert [a for c in calls for a in c["bcc_emails"]] == bcc
        assert any_sent is True
        assert unreached == []

    async def test_refused_batch_is_reported_and_the_rest_still_go(self):
        bcc = _addresses(100)
        email = _service((1, 0), (0, 1), (1, 0))

        any_sent, unreached = await ElectionService._send_in_bcc_batches(
            email, "officer@dept.example", bcc
        )

        assert email.send_email.await_count == 3
        assert any_sent is True
        assert unreached == bcc[49:98]

    async def test_a_batch_that_raises_counts_as_unreached(self):
        bcc = _addresses(60)
        email = _service(RuntimeError("smtp down"), (1, 0))

        any_sent, unreached = await ElectionService._send_in_bcc_batches(
            email, "officer@dept.example", bcc
        )

        assert email.send_email.await_count == 2
        assert any_sent is True
        assert unreached == bcc[:49]

    async def test_all_batches_refused(self):
        bcc = _addresses(50)
        email = _service((0, 1), (0, 1))

        any_sent, unreached = await ElectionService._send_in_bcc_batches(
            email, "officer@dept.example", bcc
        )

        assert any_sent is False
        assert unreached == bcc

    async def test_no_bcc_still_sends_to_the_to_address(self):
        email = _service((1, 0))

        any_sent, unreached = await ElectionService._send_in_bcc_batches(
            email, "officer@dept.example", []
        )

        email.send_email.assert_awaited_once()
        assert email.send_email.await_args.kwargs["bcc_emails"] == []
        assert any_sent is True
        assert unreached == []
