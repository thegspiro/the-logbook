"""A batch send must not overflow ``MessageHistory.to_email``.

The column is ``String(320)`` — one address' worth — and a batch send joined
every recipient into it. Under a strict ``sql_mode`` the insert is rejected,
and the caller swallows that (history is best-effort) while the shared session
is left unusable. Everything the delivery path does *after* the send then
fails: the per-member delivery-status writes, and the urgent-SMS escalation
query behind them. The email goes out; the follow-on work silently does not.

Two guards, and both matter. The summary keeps the row insertable in the first
place, and the SAVEPOINT means any *other* rejection still cannot take the
caller's session with it.
"""

from app.services.email_service import _TO_EMAIL_MAX, _summarize_recipients


def _address(n: int) -> str:
    return f"{'firefighter' * 5}{n}@a-long-volunteer-department-domain.example.org"


class TestRecipientSummary:
    def test_a_short_batch_is_recorded_in_full(self):
        addresses = ["a@b.org", "c@d.org"]
        assert _summarize_recipients(addresses) == "a@b.org, c@d.org"

    def test_a_batch_that_would_overflow_is_summarized_instead(self):
        addresses = [_address(i) for i in range(5)]
        assert len(", ".join(addresses)) > _TO_EMAIL_MAX

        summary = _summarize_recipients(addresses)

        assert len(summary) <= _TO_EMAIL_MAX
        assert summary.endswith("(+4 more)")
        assert summary.startswith(_address(0)[:40])

    def test_the_summary_fits_even_when_one_address_fills_the_column(self):
        addresses = ["x" * 400 + "@example.org", "second@example.org"]

        summary = _summarize_recipients(addresses)

        assert len(summary) <= _TO_EMAIL_MAX
        assert summary.endswith("(+1 more)")

    def test_an_empty_batch_is_an_empty_string(self):
        assert _summarize_recipients([]) == ""

    def test_a_batch_exactly_at_the_limit_is_kept_whole(self):
        addresses = ["a" * (_TO_EMAIL_MAX - len("@b.org")) + "@b.org"]
        joined = ", ".join(addresses)
        assert len(joined) == _TO_EMAIL_MAX

        assert _summarize_recipients(addresses) == joined
