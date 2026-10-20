"""
Printed-ballot details a voter relies on: the date, what to do after a
mistake, and whether the ballot continues past the page in hand.

A two-page ballot used to give no sign of its second page, so a voter could
fold it after the first and leave races unmarked.
"""

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pypdf import PdfReader
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService
from app.utils.election_ballot_pdf import render_printable_ballot_pdf

CONTINUES = "Ballot continues on the next page"


def _pages(data) -> list:
    buf = render_printable_ballot_pdf(data, {"org_name": "Test FD"})
    return [
        " ".join(page.extract_text().split())
        for page in PdfReader(BytesIO(buf.getvalue())).pages
    ]


def _ballot(races: int, date_display=None) -> dict:
    return {
        "election": {
            "title": "Annual Election",
            "voting_method": "simple_majority",
            "allow_write_ins": True,
            "date_display": date_display,
        },
        "positions": [
            {"name": f"Race {n}", "candidates": ["Alex", "Blair", "Casey"]}
            for n in range(1, races + 1)
        ],
    }


@pytest.mark.unit
class TestBallotPage:
    def test_the_ballot_names_its_date(self):
        (page,) = _pages(_ballot(1, date_display="October 21, 2026"))
        assert "October 21, 2026" in page

    def test_no_date_line_when_none_is_known(self):
        (page,) = _pages(_ballot(1))
        assert "Annual Election" in page

    def test_the_instructions_say_what_to_do_after_a_mistake(self):
        (page,) = _pages(_ballot(1))
        assert "If you make a mistake, ask an election official for a new ballot" in (
            page
        )

    def test_a_one_page_ballot_says_so_and_does_not_promise_more(self):
        (page,) = _pages(_ballot(1))
        assert "Official Ballot · Annual Election · Page 1 of 1" in page
        assert CONTINUES not in page

    def test_every_page_but_the_last_says_the_ballot_continues(self):
        pages = _pages(_ballot(6))
        assert len(pages) > 1
        total = len(pages)
        for number, page in enumerate(pages, start=1):
            assert f"Page {number} of {total}" in page
            assert (CONTINUES in page) == (number < total)


@pytest.mark.unit
class TestOrgLocalDate:
    def test_the_date_is_the_organizations_calendar_day(self):
        # 03:00 UTC on the 22nd is still the evening of the 21st in New York.
        svc = ElectionService(MagicMock())
        org = SimpleNamespace(timezone="America/New_York")
        when = datetime(2026, 10, 22, 3, 0, tzinfo=timezone.utc)
        assert svc._org_local_date(org, when) == "October 21, 2026"

    def test_an_unknown_zone_falls_back_to_utc(self):
        svc = ElectionService(MagicMock())
        org = SimpleNamespace(timezone="Not/AZone")
        when = datetime(2026, 10, 22, 3, 0, tzinfo=timezone.utc)
        assert svc._org_local_date(org, when) == "October 22, 2026"


@pytest.mark.integration
class TestServicePrintsTheBallotDate:
    @pytest.fixture
    async def election_ids(self, db_session: AsyncSession):
        org_id, user_id, election_id = (str(uuid.uuid4()) for _ in range(3))
        await db_session.execute(
            text(
                "INSERT INTO organizations "
                "(id, name, organization_type, slug, timezone, settings) "
                "VALUES (:id, 'Date FD', 'fire_department', :slug, "
                "'America/New_York', '{}')"
            ),
            {"id": org_id, "slug": f"bpd-{org_id[:8]}"},
        )
        await db_session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) "
                "VALUES (:id, :org, :un, 'Sec', 'Retary', :em, 'hashed', 'active')"
            ),
            {
                "id": user_id,
                "org": org_id,
                "un": f"bpd-{user_id[:8]}",
                "em": f"bpd-{user_id[:8]}@test.com",
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "ballot_items, start_date, end_date, status, anonymous_voting, "
                "allow_write_ins, max_votes_per_position, voting_method, "
                "victory_condition, voter_anonymity_salt, quorum_type, "
                "created_by, email_sent, results_visible_immediately, "
                "enable_runoffs, runoff_type, max_runoff_rounds, "
                "is_runoff, runoff_round, tie_policy, created_at, updated_at) "
                "VALUES (:id, :org, 'Date Election', 'officer', :positions, "
                "'[]', :start, :end, 'open', 1, 0, 1, 'simple_majority', "
                "'most_votes', :salt, 'none', :creator, 0, 0, 0, 'top_two', 3, "
                "0, 0, 'co_winners', NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "positions": json.dumps(["Chief"]),
                "start": datetime(2026, 10, 1, 16, 0),
                "end": datetime.now(timezone.utc) + timedelta(days=30),
                "salt": secrets.token_hex(32),
                "creator": user_id,
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, created_at, updated_at) "
                "VALUES (:id, :eid, 'Casey Cole', 'Chief', 1, 0, 0, NOW(), NOW())"
            ),
            {"id": str(uuid.uuid4()), "eid": election_id},
        )
        await db_session.flush()
        return org_id, election_id

    async def _first_page(self, db, org_id, election_id) -> str:
        buf, err, _ = await ElectionService(db).build_printable_ballot_pdf(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err
        page = PdfReader(BytesIO(buf.getvalue())).pages[0]
        return " ".join(page.extract_text().split())

    async def test_without_a_meeting_the_ballot_carries_the_opening_day(
        self, db_session: AsyncSession, election_ids
    ):
        org_id, election_id = election_ids
        assert "October 1, 2026" in await self._first_page(
            db_session, org_id, election_id
        )

    async def test_a_meeting_date_takes_precedence(
        self, db_session: AsyncSession, election_ids
    ):
        org_id, election_id = election_ids
        # 02:30 UTC on the 22nd is the evening of the 21st in New York.
        await db_session.execute(
            text("UPDATE elections SET meeting_date = :d WHERE id = :id"),
            {"d": datetime(2026, 10, 22, 2, 30), "id": election_id},
        )
        await db_session.flush()
        page = await self._first_page(db_session, org_id, election_id)
        assert "October 21, 2026" in page
        assert "October 1, 2026" not in page
