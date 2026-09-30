"""W50-33: the close report states recipient facts from one source.

Before the fix the "ballot recipients" heading counted eligible voters while
the list under it printed ``email_recipients``, and the "did not receive
ballots" section diffed every active member against that list and then
re-derived a reason for each at close time — so an itemless election told
the secretary that all 21 members "did not match any item requirements",
and "No ballot emails were sent." sat beside "All active members received
ballots." Now the send records who it skipped and why
(``email_skipped_details``), the report prints that record, and each
heading counts the names beneath it.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Election
from app.services.election_service import ElectionService
from app.services.email_template_service import (
    DEFAULT_ELECTION_REPORT_HTML,
    DEFAULT_ELECTION_REPORT_TEXT,
)

INVENTED = (
    "All active members received ballots",
    "No ballot emails were sent",
    "did not match any item requirements",
)


def _uid() -> str:
    return str(uuid.uuid4())


def _skip(name, reason, user_id=None):
    return {"user_id": user_id or _uid(), "name": name, "reason": reason}


@pytest.mark.unit
class TestMergeSkippedDetails:
    def test_reminder_keeps_the_first_sends_skips(self):
        first = [_skip("Amy", "Not on the voter roll frozen when the election opened")]
        merged = ElectionService._merge_skipped_details(
            first, ["r1"], [_skip("Ben", "Not checked in")]
        )
        assert [d["name"] for d in merged] == ["Amy", "Ben"]

    def test_a_member_who_later_received_a_ballot_leaves_the_list(self):
        amy = _skip("Amy", "Not checked in", user_id="amy")
        merged = ElectionService._merge_skipped_details([amy], ["amy"], [])
        assert merged == []

    def test_a_member_skipped_again_keeps_the_latest_reason(self):
        old = _skip("Amy", "old reason", user_id="amy")
        new = _skip("Amy", "new reason", user_id="amy")
        merged = ElectionService._merge_skipped_details([old], [], [new])
        assert merged == [new]

    def test_no_prior_record_is_the_new_list(self):
        new = [_skip("Amy", "Not checked in")]
        assert ElectionService._merge_skipped_details(None, [], new) == new


@pytest.mark.unit
class TestSkippedSection:
    def _svc(self):
        return ElectionService(MagicMock())

    def test_unsent_election_says_so_instead_of_diffing_the_roster(self):
        election = SimpleNamespace(email_recipients=[], email_skipped_details=None)
        html_out, text_out, count = self._svc()._build_skipped_voter_lists(election)
        assert text_out == ElectionService.BALLOTS_NOT_EMAILED
        assert ElectionService.BALLOTS_NOT_EMAILED in html_out
        assert count == 0

    def test_nobody_skipped_is_not_all_active_members_received(self):
        election = SimpleNamespace(
            email_recipients=["a", "b"], email_skipped_details=[]
        )
        html_out, text_out, count = self._svc()._build_skipped_voter_lists(election)
        assert text_out == "No members were skipped."
        assert count == 0
        for phrase in INVENTED:
            assert phrase not in html_out
            assert phrase not in text_out

    def test_pre_fix_send_has_no_record_and_says_so(self):
        election = SimpleNamespace(email_recipients=["a"], email_skipped_details=None)
        _html, text_out, count = self._svc()._build_skipped_voter_lists(election)
        assert "No record of skipped members" in text_out
        assert count == 0

    def test_recorded_reason_is_printed_verbatim_and_counted(self):
        election = SimpleNamespace(
            email_recipients=["a"],
            email_skipped_details=[
                _skip(
                    "Zed Young", "Not on the voter roll frozen when the election opened"
                ),
                _skip("Amy <Adams>", "Not checked in as present at the meeting"),
            ],
        )
        html_out, text_out, count = self._svc()._build_skipped_voter_lists(election)
        assert count == 2
        assert text_out.index("Amy") < text_out.index("Zed")
        assert "Amy &lt;Adams&gt;" in html_out
        assert "Not on the voter roll frozen when the election opened" in text_out
        for phrase in INVENTED:
            assert phrase not in text_out


@pytest.mark.unit
class TestRecipientSection:
    async def test_unsent_election_uses_the_same_sentence(self):
        svc = ElectionService(MagicMock())
        election = SimpleNamespace(email_recipients=None)
        html_out, text_out, count = await svc._build_ballot_recipient_lists(
            election, "org"
        )
        assert text_out == ElectionService.BALLOTS_NOT_EMAILED
        assert ElectionService.BALLOTS_NOT_EMAILED in html_out
        assert count == 0

    async def test_count_is_the_length_of_the_printed_list(self):
        users = [
            SimpleNamespace(full_name="Ben Baker", username="ben", email="b@x.com"),
            SimpleNamespace(full_name="Amy Adams", username="amy", email="a@x.com"),
        ]
        result = MagicMock()
        result.scalars.return_value.all.return_value = users
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)
        svc = ElectionService(db)
        # Three ids stored, one of them no longer resolves to a member.
        election = SimpleNamespace(email_recipients=["a", "b", "gone"])
        _html, text_out, count = await svc._build_ballot_recipient_lists(
            election, "org"
        )
        assert count == 2
        assert text_out.count("\n") == 1
        assert text_out.index("Amy") < text_out.index("Ben")


@pytest.mark.unit
def test_report_headings_count_the_list_beneath_them():
    assert (
        "BALLOT RECIPIENTS ({{ballot_recipients_count}})"
        in DEFAULT_ELECTION_REPORT_TEXT
    )
    assert "({{skipped_voters_count}})" in DEFAULT_ELECTION_REPORT_TEXT
    assert (
        "Ballot recipients ({{ballot_recipients_count}})"
        in DEFAULT_ELECTION_REPORT_HTML
    )
    assert "({{total_eligible_voters}})" not in DEFAULT_ELECTION_REPORT_TEXT
    assert "({{total_eligible_voters}})" not in DEFAULT_ELECTION_REPORT_HTML


@pytest.mark.integration
class TestCloseReport:
    """The B8 shape: 21 members mailed by a reminder, nobody skipped, no items."""

    async def _closed_election(self, db_session: AsyncSession, member_count: int):
        org_id = _uid()
        users = [(_uid(), f"member{i:02d}") for i in range(member_count)]
        election_id = _uid()
        now = datetime.now(timezone.utc)
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
            ),
            {"id": org_id, "name": "W50-33 FD", "slug": f"w5033-{org_id[:8]}"},
        )
        for uid, uname in users:
            await db_session.execute(
                text(
                    "INSERT INTO users (id, organization_id, username, first_name, "
                    "last_name, email, password_hash, status) "
                    "VALUES (:id, :org, :un, :un, 'Member', :em, 'x', 'active')"
                ),
                {"id": uid, "org": org_id, "un": uname, "em": f"{uname}@test.com"},
            )
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, start_date, "
                "end_date, status, anonymous_voting, allow_write_ins, "
                "max_votes_per_position, voting_method, victory_condition, "
                "voter_anonymity_salt, quorum_type, created_by, email_sent, "
                "results_visible_immediately, enable_runoffs, runoff_type, "
                "max_runoff_rounds, is_runoff, runoff_round, created_at, updated_at) "
                "VALUES (:id, :org, 'Bylaw Vote', 'ballot', '[]', "
                ":start, :end, 'closed', 1, 0, 1, 'simple_majority', 'most_votes', "
                ":salt, 'none', :creator, 1, 1, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "start": now - timedelta(days=2),
                "end": now - timedelta(hours=1),
                "salt": secrets.token_hex(32),
                "creator": users[0][0],
            },
        )
        await db_session.flush()
        return org_id, election_id, users

    async def _report_kwargs(self, db_session, org_id, election_id):
        svc = ElectionService(db_session)
        with patch(
            "app.services.email_service.EmailService.send_election_report",
            new=AsyncMock(return_value=(1, 0)),
        ) as send_report:
            ok, msg = await svc.generate_and_send_election_report(
                uuid.UUID(election_id), uuid.UUID(org_id), requested=True
            )
            assert ok, msg
        return send_report.call_args.kwargs

    async def test_everyone_mailed_nobody_skipped(self, db_session: AsyncSession):
        org_id, election_id, users = await self._closed_election(db_session, 21)
        await db_session.execute(
            update(Election)
            .where(Election.id == election_id)
            .values(
                email_recipients=[uid for uid, _ in users], email_skipped_details=[]
            )
        )
        kwargs = await self._report_kwargs(db_session, org_id, election_id)

        assert kwargs["ballot_recipients_count"] == 21
        assert kwargs["ballot_recipients_text"].count("@test.com") == 21
        assert kwargs["skipped_voters_count"] == 0
        assert kwargs["skipped_voters_text"] == "No members were skipped."
        for key in ("ballot_recipients_text", "skipped_voters_text"):
            for phrase in INVENTED:
                assert phrase not in kwargs[key], (key, phrase)

    async def test_never_mailed_says_so_in_both_sections(
        self, db_session: AsyncSession
    ):
        org_id, election_id, _users = await self._closed_election(db_session, 3)
        kwargs = await self._report_kwargs(db_session, org_id, election_id)

        assert kwargs["ballot_recipients_count"] == 0
        assert kwargs["skipped_voters_count"] == 0
        assert kwargs["ballot_recipients_text"] == ElectionService.BALLOTS_NOT_EMAILED
        assert kwargs["skipped_voters_text"] == ElectionService.BALLOTS_NOT_EMAILED

    async def test_recorded_skip_is_reported_as_recorded(
        self, db_session: AsyncSession
    ):
        org_id, election_id, users = await self._closed_election(db_session, 3)
        newcomer_id, newcomer = users[2]
        reason = "Not on the voter roll frozen when the election opened"
        await db_session.execute(
            update(Election)
            .where(Election.id == election_id)
            .values(
                email_recipients=[users[0][0], users[1][0]],
                email_skipped_details=[
                    _skip(f"{newcomer} Member", reason, user_id=newcomer_id)
                ],
            )
        )
        kwargs = await self._report_kwargs(db_session, org_id, election_id)

        assert kwargs["ballot_recipients_count"] == 2
        assert kwargs["skipped_voters_count"] == 1
        assert f"{newcomer} Member: {reason}" in kwargs["skipped_voters_text"]
        assert "did not match" not in kwargs["skipped_voters_text"]
