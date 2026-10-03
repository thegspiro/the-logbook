"""W50-68: the ballot email's wording.

An election with no meeting mailed a "Meeting Date:" label followed by
nothing; the open and close times carried no timezone, so a member reading
on a phone in another zone had to guess whose 5 PM it was; and both bodies
said the link "signs you in" when it only opens a token-keyed ballot page and
creates no session. The non-voter reminder quotes the close time in prose,
so it has to carry the same zoned format or the two disagree again (W50-27).
"""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.services.email_service import EmailService

pytestmark = pytest.mark.unit

# 22:00 UTC on a late-September evening is 5:00 PM Central Daylight Time.
CLOSE_UTC = datetime(2026, 9, 30, 22, 0, tzinfo=timezone.utc)
OPEN_UTC = datetime(2026, 9, 27, 13, 0, tzinfo=timezone.utc)
MEETING_UTC = datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc)


def _service(tz: str = "America/Chicago") -> EmailService:
    service = EmailService.__new__(EmailService)
    service.organization = SimpleNamespace(
        id="org-1",
        name="Oakville FD",
        timezone=tz,
        logo=None,
        phone=None,
        email=None,
        mailing_address=None,
        physical_address=None,
    )
    return service


async def _render(meeting_date):
    return await _service().render_ballot_notification(
        recipient_name="Pat Member",
        election_title="Officer Election 2026",
        ballot_url="https://fd.example/ballot#token=abc",
        meeting_date=meeting_date,
        start_date=OPEN_UTC,
        end_date=CLOSE_UTC,
        ballot_items_html="<ul><li>Captain</li></ul>",
        ballot_items_text="  - Captain",
        admin_contact_name="Chief Adams",
        admin_contact_email="chief@fd.example",
    )


class TestBallotMailWording:
    async def test_no_meeting_leaves_no_meeting_date_line(self):
        _subject, html, text = await _render(meeting_date=None)
        assert "Meeting Date:" not in text, text
        assert "Meeting date" not in html
        # The schedule block stays a single block: no blank line where the
        # label used to be.
        assert (
            "Voting Closes: September 30, 2026 at 05:00 PM CDT\n\nYour Ballot Items:"
            in text
        )

    async def test_a_meeting_is_listed_in_both_bodies(self):
        _subject, html, text = await _render(meeting_date=MEETING_UTC)
        assert (
            "Voting Closes: September 30, 2026 at 05:00 PM CDT\n"
            "Meeting Date: September 30, 2026 at 07:00 PM CDT\n\nYour Ballot Items:"
        ) in text, text
        assert "Meeting date" in html
        assert "September 30, 2026 at 07:00 PM CDT" in html
        assert "&lt;" not in html.split("Meeting date")[1][:200]

    async def test_times_carry_the_departments_zone(self):
        _subject, html, text = await _render(meeting_date=None)
        assert "Voting Opens: September 27, 2026 at 08:00 AM CDT" in text
        assert "Voting Closes: September 30, 2026 at 05:00 PM CDT" in text
        assert "September 30, 2026 at 05:00 PM CDT" in html

    async def test_the_link_opens_a_ballot_rather_than_signing_in(self):
        _subject, html, text = await _render(meeting_date=None)
        assert "(This link opens your ballot.)" in text
        assert "automatically log you in" not in text
        assert "It opens your ballot." in html
        assert "signs you in" not in html
        assert "automatically" not in html
