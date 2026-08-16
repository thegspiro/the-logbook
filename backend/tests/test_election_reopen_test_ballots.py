"""Zero-vote reopen token handling and test-ballot frozen-roll exemptions (no DB).

Reviews of PRs #1437/#1452 flagged that (1) reopening a CLOSED election with
zero votes left the destroyed anonymity salt unset and the already-issued
ballot tokens keyed to the old salt — so every emailed link died against the
frozen-roll check with no way to recover — and (2) the frozen voter roll
blocked test ballots both at send time and at token access, even though test
tokens only ever produce is_test votes that are excluded from results.

These tests lock the fixes: the zero-vote CLOSED→OPEN rollback mints a fresh
salt, expires the issued tokens, and records that ballots must be re-sent;
is_test sends and is_test tokens bypass the frozen-roll gate while live
credentials remain blocked.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.models.election import ElectionStatus
from app.services import election_service as election_service_module
from app.services.election_service import ElectionService


def _result(scalar_one_or_none=None, scalar=None, rowcount=0, scalars_all=None):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=scalar_one_or_none)
    result.scalar = MagicMock(return_value=scalar)
    result.rowcount = rowcount
    result.scalars.return_value.all.return_value = scalars_all or []
    return result


def _db(execute_results):
    return SimpleNamespace(
        execute=AsyncMock(side_effect=list(execute_results)),
        commit=AsyncMock(),
        refresh=AsyncMock(),
        add=MagicMock(),
    )


# ---------------------------------------------------------------------------
# rollback_election: zero-vote CLOSED -> OPEN reopen
# ---------------------------------------------------------------------------


def _closed_election(salt=None, anonymous=True):
    return SimpleNamespace(
        id="election-1",
        organization_id="org-1",
        title="Officer Election",
        status=ElectionStatus.CLOSED,
        anonymous_voting=anonymous,
        voter_anonymity_salt=salt,
        rollback_history=None,
        updated_at=None,
    )


def _rollback_service(db):
    service = ElectionService(db)
    service._audit = AsyncMock()
    service._notify_leadership_of_rollback = AsyncMock(return_value=0)
    return service


class TestZeroVoteReopen:
    async def test_regenerates_salt_and_invalidates_issued_tokens(self):
        election = _closed_election(salt=None, anonymous=True)
        election_id = uuid4()
        db = _db(
            [
                _result(scalar_one_or_none=election),  # election fetch
                _result(scalar=0),  # vote count
                _result(rowcount=4),  # token expiry UPDATE
            ]
        )
        service = _rollback_service(db)

        result, _, error = await service.rollback_election(
            election_id=election_id,
            organization_id=uuid4(),
            performed_by=uuid4(),
            reason="wrong candidate list",
        )

        assert error is None
        assert result is election
        assert election.status == ElectionStatus.OPEN
        # Fresh salt, minted the same way election creation mints it
        assert election.voter_anonymity_salt is not None
        assert len(election.voter_anonymity_salt) == 64
        int(election.voter_anonymity_salt, 16)  # valid hex

        # The third statement expires this election's still-live tokens
        stmt = db.execute.await_args_list[2].args[0]
        assert stmt.table.name == "voting_tokens"
        params = stmt.compile().params
        assert str(election_id) in params.values()
        # Expiry is floored to the second (MySQL DATETIME(0) rounding)
        assert params["expires_at"].microsecond == 0

        record = election.rollback_history[-1]
        assert record["from_status"] == "closed"
        assert record["to_status"] == "open"
        assert record["anonymity_salt_regenerated"] is True
        assert record["voting_tokens_invalidated"] == 4
        assert record["ballots_must_be_resent"] is True

        audit_payload = service._audit.await_args.args[1]
        assert audit_payload["anonymity_salt_regenerated"] is True
        assert audit_payload["voting_tokens_invalidated"] == 4

    async def test_anonymous_reopen_with_votes_still_refused(self):
        election = _closed_election(salt=None, anonymous=True)
        db = _db(
            [
                _result(scalar_one_or_none=election),
                _result(scalar=3),  # votes exist
            ]
        )
        service = _rollback_service(db)

        result, _, error = await service.rollback_election(
            election_id=uuid4(),
            organization_id=uuid4(),
            performed_by=uuid4(),
            reason="oops",
        )

        assert result is None
        assert "Cannot reopen this election" in error
        assert election.voter_anonymity_salt is None
        assert election.status == ElectionStatus.CLOSED
        assert db.execute.await_count == 2  # no token UPDATE issued
        db.commit.assert_not_awaited()

    async def test_reopen_with_salt_intact_leaves_tokens_alone(self):
        election = _closed_election(salt="a" * 64, anonymous=True)
        db = _db([_result(scalar_one_or_none=election)])
        service = _rollback_service(db)

        result, _, error = await service.rollback_election(
            election_id=uuid4(),
            organization_id=uuid4(),
            performed_by=uuid4(),
            reason="reopen",
        )

        assert error is None
        assert result is election
        assert election.voter_anonymity_salt == "a" * 64
        assert db.execute.await_count == 1  # neither vote count nor UPDATE
        record = election.rollback_history[-1]
        assert "anonymity_salt_regenerated" not in record
        payload = service._audit.await_args.args[1]
        assert payload["anonymity_salt_regenerated"] is False
        assert payload["voting_tokens_invalidated"] == 0

    async def test_non_anonymous_zero_vote_reopen_also_regenerates(self):
        # close_election destroys the salt for every election, so the token
        # rescue applies to non-anonymous elections too.
        election = _closed_election(salt=None, anonymous=False)
        db = _db(
            [
                _result(scalar_one_or_none=election),
                _result(scalar=0),
                _result(rowcount=0),
            ]
        )
        service = _rollback_service(db)

        result, _, error = await service.rollback_election(
            election_id=uuid4(),
            organization_id=uuid4(),
            performed_by=uuid4(),
            reason="reopen",
        )

        assert error is None
        assert result is election
        assert election.voter_anonymity_salt is not None
        assert election.rollback_history[-1]["voting_tokens_invalidated"] == 0


# ---------------------------------------------------------------------------
# get_ballot_by_token: is_test tokens bypass the frozen-roll check
# ---------------------------------------------------------------------------


def _voting_token(is_test):
    return SimpleNamespace(
        is_test=is_test,
        used=False,
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        first_accessed_at=None,
        access_count=0,
        election_id="election-1",
        voter_hash="0" * 64,
    )


def _open_election_with_frozen_roll():
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id="election-1",
        title="Officer Election",
        status=ElectionStatus.OPEN,
        start_date=now - timedelta(hours=1),
        end_date=now + timedelta(hours=1),
        # Frozen roll with nobody on it: every hash-keyed credential is
        # off-roll, so only the is_test exemption can let a token through.
        eligible_roster_snapshot=[],
        voter_overrides=None,
        voter_anonymity_salt="b" * 64,
        anonymous_voting=True,
    )


class TestTokenAccessTestExemption:
    async def test_test_token_bypasses_frozen_roll_check(self):
        token = _voting_token(is_test=True)
        election = _open_election_with_frozen_roll()
        db = _db(
            [
                _result(scalar_one_or_none=token),
                _result(scalar_one_or_none=election),
            ]
        )
        service = ElectionService(db)
        service._token_voter_is_on_frozen_roll = MagicMock(return_value=False)

        got_election, got_token, error = await service.get_ballot_by_token("raw")

        assert error is None
        assert got_election is election
        assert got_token is token
        # The roll check is skipped entirely for test tokens
        service._token_voter_is_on_frozen_roll.assert_not_called()

    async def test_live_token_still_blocked_by_frozen_roll(self):
        token = _voting_token(is_test=False)
        election = _open_election_with_frozen_roll()
        db = _db(
            [
                _result(scalar_one_or_none=token),
                _result(scalar_one_or_none=election),
            ]
        )
        service = ElectionService(db)  # real frozen-roll check

        got_election, got_token, error = await service.get_ballot_by_token("raw")

        assert got_election is None
        assert got_token is None
        assert "not on the voter roll" in error


# ---------------------------------------------------------------------------
# send_ballot_emails: is_test sends bypass the frozen-roll skip
# ---------------------------------------------------------------------------


def _send_election():
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id="election-1",
        organization_id="org-1",
        title="Officer Election",
        status=ElectionStatus.OPEN,
        start_date=now - timedelta(hours=1),
        end_date=now + timedelta(days=1),
        meeting_date=None,
        positions=["Chief"],
        position_eligibility=None,
        ballot_items=None,
        eligible_voters=None,
        proxy_authorizations=None,
        created_by=None,
        eligible_roster_snapshot=[],  # frozen roll with nobody on it
        voter_overrides=None,
        voter_anonymity_salt="c" * 64,
        anonymous_voting=True,
        email_sent=False,
        email_sent_at=None,
        email_recipients=None,
    )


def _recipient():
    return SimpleNamespace(
        id="user-1",
        email="member@example.org",
        full_name="Member One",
        username="member1",
    )


def _fake_email_service_cls():
    instance = MagicMock()
    instance.render_ballot_notification = AsyncMock(
        return_value=("subject", "<p>html</p>", "text")
    )
    instance.build_message = MagicMock(return_value=(["member@example.org"], "mime"))
    instance.send_batch = AsyncMock(return_value=[True])
    return MagicMock(return_value=instance), instance


def _send_service(election, monkeypatch):
    organization = SimpleNamespace(name="FCVFD", email="hq@example.org")
    db = _db(
        [
            _result(scalar_one_or_none=election),
            _result(scalar_one_or_none=organization),
            _result(scalars_all=[_recipient()]),
        ]
    )
    service = ElectionService(db)
    service._audit = AsyncMock()
    service._generate_voting_token = AsyncMock(
        return_value=(SimpleNamespace(id="token-1"), "raw-token")
    )

    email_service_cls, email_service = _fake_email_service_cls()
    monkeypatch.setattr(election_service_module, "EmailService", email_service_cls)
    # The template lookup would hit the DB; return "no custom template"
    from app.services.email_template_service import EmailTemplateService

    monkeypatch.setattr(
        EmailTemplateService, "get_template", AsyncMock(return_value=None)
    )
    return service, email_service


class TestSendBallotEmailsTestExemption:
    async def test_test_send_bypasses_frozen_roll(self, monkeypatch):
        election = _send_election()
        service, email_service = _send_service(election, monkeypatch)

        sent, failed, skipped, skipped_details, sent_user_ids = (
            await service.send_ballot_emails(
                election_id=uuid4(),
                organization_id=uuid4(),
                recipient_user_ids=[uuid4()],
                base_ballot_url="https://example.org/ballot",
                is_test=True,
            )
        )

        assert (sent, failed, skipped) == (1, 0, 0)
        assert skipped_details == []
        assert sent_user_ids == ["user-1"]
        token_kwargs = service._generate_voting_token.await_args.kwargs
        assert token_kwargs["is_test"] is True
        email_service.send_batch.assert_awaited_once()

    async def test_live_send_still_blocked_by_frozen_roll(self, monkeypatch):
        election = _send_election()
        service, email_service = _send_service(election, monkeypatch)

        sent, failed, skipped, skipped_details, sent_user_ids = (
            await service.send_ballot_emails(
                election_id=uuid4(),
                organization_id=uuid4(),
                recipient_user_ids=[uuid4()],
                base_ballot_url="https://example.org/ballot",
                is_test=False,
            )
        )

        assert (sent, failed, skipped) == (0, 0, 1)
        assert sent_user_ids == []
        assert skipped_details[0]["reason"] == (
            "Not on the voter roll frozen when the election opened"
        )
        service._generate_voting_token.assert_not_awaited()
        email_service.send_batch.assert_not_awaited()

    async def test_override_still_admits_live_send(self, monkeypatch):
        # Secretary overrides must keep working for live sends after the
        # hoist of the override-id set out of the recipient loop.
        election = _send_election()
        election.voter_overrides = [{"user_id": "user-1"}]
        service, _ = _send_service(election, monkeypatch)

        sent, failed, skipped, _, sent_user_ids = await service.send_ballot_emails(
            election_id=uuid4(),
            organization_id=uuid4(),
            recipient_user_ids=[uuid4()],
            base_ballot_url="https://example.org/ballot",
            is_test=False,
        )

        assert (sent, failed, skipped) == (1, 0, 0)
        assert sent_user_ids == ["user-1"]
        token_kwargs = service._generate_voting_token.await_args.kwargs
        assert token_kwargs["is_test"] is False
