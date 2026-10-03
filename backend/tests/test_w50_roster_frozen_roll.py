"""W50-55: the eligibility roster reads the frozen roll, and the send's
summary sentence states the reasons it recorded.

Before the fix ``get_eligibility_roster`` evaluated every active member
live, so a member created after the election opened showed
``will_receive_ballot: true`` — while ``send_ballot_emails`` and the
reminder skipped that member at the frozen roll. And the endpoint's summary
said "1 skipped (did not meet ballot item requirements …)" for a skip whose
recorded reason was "Not on the voter roll frozen when the election
opened". The roster now applies the same frozen-roll gate as the send, with
the same reason string, reports who already holds a ballot, and both the
send and the reminder build their skipped clause from ``skipped_details``.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import send_ballot_emails as send_ballot_endpoint
from app.schemas.election import EmailBallot
from app.services.election_service import ElectionService

SEND_BATCH = "app.services.email_service.EmailService.send_batch"
ITEM_RULE_SENTENCE = "did not meet ballot item requirements"


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.mark.unit
class TestSummarizeSkipped:
    def test_nothing_skipped_is_empty(self):
        assert ElectionService.summarize_skipped([]) == ""

    def test_one_reason_is_named_verbatim(self):
        details = [{"user_id": _uid(), "name": "Nick New", "reason": "Not on the roll"}]
        assert ElectionService.summarize_skipped(details) == (
            "1 skipped (Not on the roll)"
        )

    def test_several_reasons_are_counted_most_common_first(self):
        details = [
            {"user_id": _uid(), "name": "A", "reason": "Not checked in for meeting"},
            {"user_id": _uid(), "name": "B", "reason": "Not on the roll"},
            {"user_id": _uid(), "name": "C", "reason": "Not on the roll"},
        ]
        assert ElectionService.summarize_skipped(details) == (
            "3 skipped (2: Not on the roll; 1: Not checked in for meeting)"
        )

    def test_a_detail_without_a_reason_is_not_dropped(self):
        details = [{"user_id": _uid(), "name": "A", "reason": None}]
        assert ElectionService.summarize_skipped(details) == (
            "1 skipped (No reason recorded)"
        )


async def _insert_user(db_session: AsyncSession, org_id: str, tag: str) -> str:
    uid = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, :fn, :ln, :em, 'hashed', 'active')"
        ),
        {
            "id": uid,
            "org": org_id,
            "un": f"w5055-{tag}-{uid[:8]}",
            "fn": tag.capitalize(),
            "ln": "Member",
            "em": f"w5055-{tag}-{uid[:8]}@test.com",
        },
    )
    return uid


@pytest.fixture
async def frozen_election(db_session: AsyncSession):
    """An OPEN Chief election whose roll was frozen with one member on it,
    plus a member created after the freeze."""
    org_id = _uid()
    election_id = _uid()
    now = datetime.now(timezone.utc)

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone) VALUES (:id, 'W50-55 FD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"w5055-{org_id[:8]}"},
    )
    on_roll = await _insert_user(db_session, org_id, "onroll")
    newcomer = await _insert_user(db_session, org_id, "newcomer")
    await db_session.execute(
        text(
            "INSERT INTO elections (id, organization_id, title, election_type, "
            "positions, start_date, end_date, status, anonymous_voting, "
            "allow_write_ins, max_votes_per_position, voting_method, "
            "victory_condition, voter_anonymity_salt, quorum_type, created_by, "
            "email_sent, results_visible_immediately, enable_runoffs, "
            "runoff_type, max_runoff_rounds, is_runoff, runoff_round, "
            "eligible_roster_snapshot, created_at, updated_at) VALUES "
            "(:id, :org, 'Chief 2026', 'officer', '[\"Chief\"]', :start, :end, "
            "'open', 1, 0, 1, 'simple_majority', 'most_votes', :salt, 'none', "
            ":creator, 0, 0, 0, 'top_two', 3, 0, 0, :snapshot, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "start": now - timedelta(days=1),
            "end": now + timedelta(days=1),
            "salt": secrets.token_hex(32),
            "creator": on_roll,
            "snapshot": f'["{on_roll}"]',
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO candidates (id, election_id, name, position, accepted, "
            "is_write_in, display_order, nomination_date, created_at, "
            "updated_at) VALUES (:id, :eid, 'Casey Chief', 'Chief', 1, 0, 0, "
            "NOW(), NOW(), NOW())"
        ),
        {"id": _uid(), "eid": election_id},
    )
    await db_session.flush()
    return {
        "org_id": org_id,
        "election_id": election_id,
        "on_roll": on_roll,
        "newcomer": newcomer,
    }


async def _roster(db_session: AsyncSession, data: dict) -> dict:
    return await ElectionService(db_session).get_eligibility_roster(
        uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
    )


@pytest.mark.integration
class TestRosterReadsFrozenRoll:
    async def test_newcomer_is_not_promised_a_ballot(
        self, db_session: AsyncSession, frozen_election
    ):
        roster = await _roster(db_session, frozen_election)
        by_id = {r["user_id"]: r for r in roster["roster"]}

        newcomer = by_id[frozen_election["newcomer"]]
        assert newcomer["will_receive_ballot"] is False
        assert newcomer["eligible_item_count"] == 0
        assert newcomer["ineligibility_reason"] == ElectionService.NOT_ON_FROZEN_ROLL

        assert by_id[frozen_election["on_roll"]]["will_receive_ballot"] is True
        assert roster["total_eligible"] == 1
        assert roster["total_ineligible"] == 1

    async def test_an_override_still_adds_a_voter_after_the_freeze(
        self, db_session: AsyncSession, frozen_election
    ):
        await db_session.execute(
            text("UPDATE elections SET voter_overrides = :ov WHERE id = :id"),
            {
                "ov": f'[{{"user_id": "{frozen_election["newcomer"]}", '
                '"reason": "joined at the meeting"}]',
                "id": frozen_election["election_id"],
            },
        )
        roster = await _roster(db_session, frozen_election)
        by_id = {r["user_id"]: r for r in roster["roster"]}
        assert by_id[frozen_election["newcomer"]]["will_receive_ballot"] is True
        assert by_id[frozen_election["newcomer"]]["ineligibility_reason"] is None

    async def test_an_unfrozen_election_is_still_evaluated_live(
        self, db_session: AsyncSession, frozen_election
    ):
        await db_session.execute(
            text("UPDATE elections SET eligible_roster_snapshot = NULL WHERE id = :id"),
            {"id": frozen_election["election_id"]},
        )
        roster = await _roster(db_session, frozen_election)
        by_id = {r["user_id"]: r for r in roster["roster"]}
        assert by_id[frozen_election["newcomer"]]["will_receive_ballot"] is True
        assert roster["total_eligible"] == 2

    async def test_roster_reports_who_already_holds_a_ballot(
        self, db_session: AsyncSession, frozen_election
    ):
        sent_at = datetime(2026, 9, 30, 14, 0, tzinfo=timezone.utc)
        await db_session.execute(
            text(
                "UPDATE elections SET email_sent = 1, email_sent_at = :at, "
                "email_recipients = :rec WHERE id = :id"
            ),
            {
                "at": sent_at,
                "rec": f'["{frozen_election["on_roll"]}"]',
                "id": frozen_election["election_id"],
            },
        )
        roster = await _roster(db_session, frozen_election)
        by_id = {r["user_id"]: r for r in roster["roster"]}
        assert by_id[frozen_election["on_roll"]]["ballot_sent"] is True
        assert by_id[frozen_election["newcomer"]]["ballot_sent"] is False
        assert roster["total_ballots_sent"] == 1
        assert roster["email_sent_at"] is not None
        assert roster["email_sent_at"].replace(tzinfo=timezone.utc) == sent_at

    async def test_reopening_freezes_from_the_live_roster(
        self, db_session: AsyncSession, frozen_election
    ):
        # A stale snapshot left by a rolled-back open must not narrow the
        # next freeze to the members it happened to hold.
        await db_session.execute(
            text("UPDATE elections SET status = 'draft' WHERE id = :id"),
            {"id": frozen_election["election_id"]},
        )
        db_session.expire_all()
        election, err = await ElectionService(db_session).open_election(
            uuid.UUID(frozen_election["election_id"]),
            uuid.UUID(frozen_election["org_id"]),
        )
        assert err is None, err
        assert election is not None
        assert set(election.eligible_roster_snapshot) == {
            frozen_election["on_roll"],
            frozen_election["newcomer"],
        }

    async def test_rollback_to_draft_drops_the_frozen_roll(
        self, db_session: AsyncSession, frozen_election
    ):
        # Between a rollback and the re-open the election is a draft, and a
        # draft has no frozen roll: the roster must evaluate live again
        # instead of reporting the newcomer as off the earlier open's roll.
        election, _, err = await ElectionService(db_session).rollback_election(
            uuid.UUID(frozen_election["election_id"]),
            uuid.UUID(frozen_election["org_id"]),
            uuid.UUID(frozen_election["on_roll"]),
            "reopen the nominations",
        )
        assert err is None, err
        assert election is not None
        assert election.status.value == "draft"
        assert election.eligible_roster_snapshot is None

        roster = await _roster(db_session, frozen_election)
        by_id = {r["user_id"]: r for r in roster["roster"]}
        assert by_id[frozen_election["newcomer"]]["will_receive_ballot"] is True
        assert by_id[frozen_election["newcomer"]]["ineligibility_reason"] is None
        assert roster["total_eligible"] == 2


@pytest.mark.integration
class TestSendSummaryNamesTheRecordedReason:
    async def test_send_ballot_message_comes_from_skipped_details(
        self, db_session: AsyncSession, frozen_election
    ):
        send_batch = AsyncMock(side_effect=lambda b: [True] * len(b))
        with patch(SEND_BATCH, new=send_batch):
            response = await send_ballot_endpoint(
                election_id=uuid.UUID(frozen_election["election_id"]),
                email_data=EmailBallot(),
                request=SimpleNamespace(),
                db=db_session,
                current_user=SimpleNamespace(
                    id=frozen_election["on_roll"],
                    organization_id=frozen_election["org_id"],
                ),
            )

        assert response.recipients_count == 1
        assert response.skipped_count == 1
        assert [d.reason for d in response.skipped_details] == [
            ElectionService.NOT_ON_FROZEN_ROLL
        ]
        assert ITEM_RULE_SENTENCE not in response.message
        assert f"1 skipped ({ElectionService.NOT_ON_FROZEN_ROLL})" in response.message

    async def test_reminder_message_reports_its_skips(
        self, db_session: AsyncSession, frozen_election
    ):
        from app.api.v1.endpoints.elections import remind_non_voters as remind_endpoint

        send_batch = AsyncMock(side_effect=lambda b: [True] * len(b))
        with patch(SEND_BATCH, new=send_batch):
            response = await remind_endpoint(
                election_id=uuid.UUID(frozen_election["election_id"]),
                payload=None,
                db=db_session,
                current_user=SimpleNamespace(
                    id=frozen_election["on_roll"],
                    organization_id=frozen_election["org_id"],
                ),
            )

        assert response["recipients_count"] == 1
        assert response["skipped_count"] == 1
        assert f"1 skipped ({ElectionService.NOT_ON_FROZEN_ROLL})" in (
            response["message"]
        )
