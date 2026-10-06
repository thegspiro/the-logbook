"""Rows signed with SECRET_KEY keep verifying once the dedicated key arrives.

Until 2026-10-06 the shipped compose files did not pass AUDIT_LOG_SIGNING_KEY
(or, on the Unraid files, VOTE_SIGNING_KEY) through, so an install that set
either in ``.env`` signed with the SECRET_KEY fallback. The owner's decision:
those rows must keep verifying, but SECRET_KEY must not become a permanent
second key. Each row now records a fingerprint of the key that signed it, and
SECRET_KEY is accepted only for rows before the first one recording the
dedicated key (the cut-over).
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from loguru import logger as loguru_logger
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit as audit_module
from app.core.audit import (
    _CURRENT_HASH_VERSION,
    AuditLogger,
    audit_logger,
    audit_signing_key_id,
)
from app.models.audit import AuditLog
from app.models.election import Vote
from app.services import election_service as election_service_module
from app.services.election_service import ElectionService, vote_signing_key_id
from tests.test_election_voting_flow import TestElectionSetup

_DEDICATED = "dedicated-audit-key-" + "d" * 32
_SECRET = "the-secret-key-" + "s" * 40
_GENESIS = "0" * 64


@pytest.fixture
def warnings_logged():
    messages: list[str] = []
    sink = loguru_logger.add(
        lambda m: messages.append(m.record["message"]), level="WARNING"
    )
    yield messages
    loguru_logger.remove(sink)


def _keys(monkeypatch, dedicated: str) -> None:
    monkeypatch.setattr(audit_module.settings, "SECRET_KEY", _SECRET)
    monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", dedicated)
    monkeypatch.setattr(audit_module.settings, "VOTE_SIGNING_KEY", dedicated)


# --------------------------------------------------------------------------
# Audit log — pure, against an in-memory chain
# --------------------------------------------------------------------------


def _row(log_id: int, key_id: str | None) -> SimpleNamespace:
    return SimpleNamespace(
        id=log_id,
        timestamp="2026-10-01T00:00:00.000000+00:00",
        timestamp_nanos=log_id,
        event_type="user_login",
        event_category="auth",
        severity="info",
        user_id=f"user-{log_id}",
        organization_id="org-1",
        ip_address="203.0.113.9",
        event_data={"n": log_id},
        previous_hash=None,
        current_hash=None,
        hash_version=_CURRENT_HASH_VERSION,
        signing_key_id=key_id,
    )


def _chain(spec: list[tuple[str, str | None]]) -> list[SimpleNamespace]:
    """Build a linked chain; each entry is (signing key, recorded key id)."""
    logger = AuditLogger()
    rows, prev = [], _GENESIS
    for i, (key, key_id) in enumerate(spec, start=1):
        row = _row(i, key_id)
        row.previous_hash = prev
        row.current_hash = logger.calculate_hash(
            logger._build_hash_data(row), prev, row.hash_version, key
        )
        prev = row.current_hash
        rows.append(row)
    return rows


class _ChainDB:
    """Rows on the first execute(), no checkpoint on the second."""

    def __init__(self, rows):
        self._rows = rows
        self._calls = 0

    async def execute(self, _query):
        self._calls += 1
        if self._calls == 1:
            return MagicMock(
                scalars=MagicMock(
                    return_value=MagicMock(all=MagicMock(return_value=self._rows))
                )
            )
        return SimpleNamespace(scalar_one_or_none=lambda: None)

    async def flush(self):
        pass


def _errors(result) -> list[tuple[int, str]]:
    return [(e["log_id"], e["error"]) for e in result["errors"]]


@pytest.mark.unit
class TestAuditKeyCutover:
    def test_key_id_identifies_without_revealing(self):
        key_id = audit_signing_key_id(_DEDICATED)
        assert len(key_id) == 16
        assert key_id != audit_signing_key_id(_SECRET)
        assert key_id not in _DEDICATED
        assert key_id != vote_signing_key_id(_DEDICATED)

    async def test_secret_key_rows_verify_once_dedicated_key_is_set(
        self, monkeypatch, warnings_logged
    ):
        """Pre-upgrade rows: no key id, signed with the SECRET_KEY fallback."""
        _keys(monkeypatch, _DEDICATED)
        rows = _chain([(_SECRET, None)] * 3)

        result = await AuditLogger().verify_integrity(_ChainDB(rows))

        assert _errors(result) == []
        assert result["verified"] is True
        legacy_warnings = [m for m in warnings_logged if "SECRET_KEY" in m]
        assert len(legacy_warnings) == 1  # once per run, not once per row
        assert "3 audit entries" in legacy_warnings[0]

    async def test_chain_spanning_the_cutover_verifies(self, monkeypatch):
        _keys(monkeypatch, _DEDICATED)
        dedicated_id = audit_signing_key_id(_DEDICATED)
        secret_id = audit_signing_key_id(_SECRET)
        rows = _chain(
            [
                (_SECRET, None),  # before key ids were recorded
                (_SECRET, secret_id),  # after, but before the key arrived
                (_DEDICATED, dedicated_id),  # the cut-over
                (_DEDICATED, dedicated_id),
            ]
        )

        result = await AuditLogger().verify_integrity(_ChainDB(rows))

        assert _errors(result) == []
        assert rows[2].previous_hash == rows[1].current_hash

    async def test_row_recording_dedicated_key_but_signed_with_secret_fails(
        self, monkeypatch
    ):
        _keys(monkeypatch, _DEDICATED)
        rows = _chain(
            [
                (_SECRET, None),
                (_SECRET, audit_signing_key_id(_DEDICATED)),
            ]
        )

        result = await AuditLogger().verify_integrity(_ChainDB(rows))

        assert result["verified"] is False
        assert _errors(result) == [
            (2, "Hash mismatch - log entry has been tampered with")
        ]

    async def test_secret_key_row_after_the_cutover_fails(self, monkeypatch):
        """SECRET_KEY is not a permanent second key: a row after the first
        dedicated-key row cannot verify with it, with or without a key id."""
        _keys(monkeypatch, _DEDICATED)
        dedicated_id = audit_signing_key_id(_DEDICATED)
        rows = _chain(
            [
                (_SECRET, None),
                (_DEDICATED, dedicated_id),
                (_SECRET, None),
                (_SECRET, audit_signing_key_id(_SECRET)),
            ]
        )

        result = await AuditLogger().verify_integrity(_ChainDB(rows))

        assert result["verified"] is False
        assert [log_id for log_id, _ in _errors(result)] == [3, 4]
        assert all("after the audit chain moved" in e for _, e in _errors(result))

    async def test_tampered_legacy_row_still_fails(self, monkeypatch):
        _keys(monkeypatch, _DEDICATED)
        rows = _chain([(_SECRET, None), (_SECRET, None)])
        rows[1].event_data = {"n": 999}

        result = await AuditLogger().verify_integrity(_ChainDB(rows))

        assert result["verified"] is False
        assert _errors(result) == [
            (2, "Hash mismatch - log entry has been tampered with")
        ]

    async def test_row_naming_an_unconfigured_key_fails(self, monkeypatch):
        _keys(monkeypatch, _DEDICATED)
        other = "some-other-key"
        rows = _chain([(other, audit_signing_key_id(other))])

        result = await AuditLogger().verify_integrity(_ChainDB(rows))

        assert result["verified"] is False
        assert "Unknown signing key" in result["errors"][0]["error"]

    async def test_no_legacy_key_without_a_dedicated_key(self, monkeypatch):
        """With only SECRET_KEY configured there is one key and no fallback:
        the bound has nothing to bound, and nothing else is accepted."""
        _keys(monkeypatch, "")
        rows = _chain([(_SECRET, None), (_SECRET, audit_signing_key_id(_SECRET))])
        assert (await AuditLogger().verify_integrity(_ChainDB(rows)))["verified"]

        rows = _chain([(_DEDICATED, None)])
        result = await AuditLogger().verify_integrity(_ChainDB(rows))
        assert result["verified"] is False

    async def test_rehash_accepts_legacy_rows_and_refuses_after_cutover(
        self, monkeypatch
    ):
        _keys(monkeypatch, _DEDICATED)
        dedicated_id = audit_signing_key_id(_DEDICATED)
        clean = _chain([(_SECRET, None), (_DEDICATED, dedicated_id)])
        assert await AuditLogger().rehash_chain(_ChainDB(clean)) == 0

        late = _chain([(_SECRET, None), (_DEDICATED, dedicated_id), (_SECRET, None)])
        with pytest.raises(ValueError, match="after the audit chain moved"):
            await AuditLogger().rehash_chain(_ChainDB(late))

    async def test_archive_attestation_with_secret_key_is_bounded(self, monkeypatch):
        """A retention archive attested with SECRET_KEY still sanctions the
        chain head when it ends before the cut-over, and not after it."""
        _keys(monkeypatch, _DEDICATED)
        boundary_hash = "ab" * 32
        attestation = AuditLogger.compute_archive_attestation(
            1, 10, boundary_hash, _SECRET
        )
        checkpoint = SimpleNamespace(
            first_log_id=1,
            last_log_id=10,
            last_log_hash=boundary_hash,
            archive_attestation=attestation,
        )

        def _db():
            return SimpleNamespace(
                execute=AsyncMock(
                    return_value=MagicMock(
                        scalars=MagicMock(
                            return_value=MagicMock(
                                all=MagicMock(return_value=[checkpoint])
                            )
                        )
                    )
                )
            )

        assert await AuditLogger()._is_archived_boundary(
            _db(), 11, boundary_hash, cutover_id=11
        )
        assert await AuditLogger()._is_archived_boundary(
            _db(), 11, boundary_hash, cutover_id=None
        )
        assert not await AuditLogger()._is_archived_boundary(
            _db(), 11, boundary_hash, cutover_id=5
        )


# --------------------------------------------------------------------------
# Audit log — against the database
# --------------------------------------------------------------------------


@pytest.mark.integration
class TestAuditKeyCutoverInDatabase:
    async def _write(self, db, n, tag):
        rows = []
        for i in range(n):
            row = await audit_logger.create_log_entry(
                db,
                event_type=f"key_cutover_{tag}_{i}",
                event_category="security",
                severity="info",
                event_data={"i": i},
            )
            assert row is not None
            rows.append(row)
        return rows

    async def test_upgrade_path_verifies_and_new_rows_record_the_key(
        self, db_session: AsyncSession, monkeypatch
    ):
        # Before the upgrade: the key in .env never arrived, rows were signed
        # with SECRET_KEY and recorded no key id.
        _keys(monkeypatch, "")
        before = await self._write(db_session, 3, "before")
        await db_session.execute(
            update(AuditLog)
            .where(AuditLog.id.in_([r.id for r in before]))
            .values(signing_key_id=None)
        )

        # After: the dedicated key arrives.
        _keys(monkeypatch, _DEDICATED)
        after = await self._write(db_session, 2, "after")
        assert {r.signing_key_id for r in after} == {audit_signing_key_id(_DEDICATED)}
        first_id, last_id = before[0].id, after[-1].id
        db_session.expire_all()

        result = await audit_logger.verify_integrity(
            db_session, start_id=first_id, end_id=last_id
        )
        assert result["errors"] == []
        assert result["total_checked"] == 5

        # A legacy-signed row written after the cut-over is refused.
        last = await db_session.get(AuditLog, last_id)
        forged = audit_logger.calculate_hash(
            audit_logger._build_hash_data(last),
            last.previous_hash,
            last.hash_version,
            _SECRET,
        )
        await db_session.execute(
            update(AuditLog)
            .where(AuditLog.id == last_id)
            .values(signing_key_id=None, current_hash=forged)
        )
        db_session.expire_all()

        result = await audit_logger.verify_integrity(
            db_session, start_id=last_id, end_id=last_id
        )
        assert result["verified"] is False
        assert "after the audit chain moved" in result["errors"][0]["error"]


# --------------------------------------------------------------------------
# Ballots
# --------------------------------------------------------------------------


def _vote(voted_at: datetime) -> SimpleNamespace:
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        election_id="election-1",
        candidate_id="cand-1",
        voter_hash="voter-" + uuid.uuid4().hex,
        voter_id=None,
        position="Chief",
        vote_rank=None,
        is_proxy_vote=False,
        proxy_delegating_user_id=None,
        voted_at=voted_at,
        is_manual=False,
        is_test=False,
        manual_batch_id=None,
        vote_signature=None,
        signing_key_id=None,
        chain_hash=None,
    )


def _seal(service, votes, keys):
    """Sign each vote with its (key, recorded id) and chain them."""
    prev = None
    for vote, (key, key_id) in zip(votes, keys, strict=True):
        vote.vote_signature = service._sign_vote(vote, key)
        vote.signing_key_id = key_id
        vote.chain_hash = service._compute_chain_hash(prev, vote.vote_signature)
        prev = vote.chain_hash


def _vote_service(votes, cutover):
    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[
            MagicMock(scalar_one_or_none=MagicMock(return_value=SimpleNamespace())),
            MagicMock(
                scalars=MagicMock(
                    return_value=MagicMock(all=MagicMock(return_value=votes))
                )
            ),
            MagicMock(scalar=MagicMock(return_value=cutover)),
        ]
    )
    return ElectionService(db)


async def _verify(service):
    return await service.verify_vote_integrity(uuid.uuid4(), uuid.uuid4(), audit=False)


_T0 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


@pytest.mark.unit
class TestVoteKeyCutover:
    @pytest.fixture(autouse=True)
    def _vote_keys(self, monkeypatch):
        monkeypatch.setattr(election_service_module.settings, "SECRET_KEY", _SECRET)
        monkeypatch.setattr(
            election_service_module.settings, "VOTE_SIGNING_KEY", _DEDICATED
        )

    async def test_secret_key_ballots_verify_once_dedicated_key_is_set(
        self, warnings_logged
    ):
        votes = [_vote(_T0), _vote(_T0 + timedelta(minutes=1))]
        service = _vote_service(votes, cutover=None)
        _seal(service, votes, [(_SECRET, None), (_SECRET, None)])

        result = await _verify(service)

        assert result["integrity_status"] == "PASS"
        assert result["valid_signatures"] == 2
        assert len([m for m in warnings_logged if "SECRET_KEY" in m]) == 1

    async def test_election_spanning_the_cutover_verifies(self):
        dedicated_id = vote_signing_key_id(_DEDICATED)
        votes = [_vote(_T0), _vote(_T0 + timedelta(hours=1))]
        service = _vote_service(votes, cutover=votes[1].voted_at)
        _seal(service, votes, [(_SECRET, None), (_DEDICATED, dedicated_id)])

        result = await _verify(service)

        assert result["integrity_status"] == "PASS"
        assert result["valid_signatures"] == 2
        assert result["chain_verified"] is True

    async def test_ballot_recording_dedicated_key_but_signed_with_secret_fails(
        self,
    ):
        votes = [_vote(_T0)]
        service = _vote_service(votes, cutover=_T0)
        _seal(service, votes, [(_SECRET, vote_signing_key_id(_DEDICATED))])

        result = await _verify(service)

        assert result["integrity_status"] == "FAIL"
        assert result["tampered_vote_ids"] == [votes[0].id]

    async def test_secret_key_ballot_after_the_cutover_fails(self):
        votes = [_vote(_T0 + timedelta(hours=2))]
        service = _vote_service(votes, cutover=_T0)
        _seal(service, votes, [(_SECRET, None)])

        result = await _verify(service)

        assert result["integrity_status"] == "FAIL"
        assert result["tampered_vote_ids"] == [votes[0].id]

    async def test_tampered_legacy_ballot_still_fails(self):
        votes = [_vote(_T0)]
        service = _vote_service(votes, cutover=None)
        _seal(service, votes, [(_SECRET, None)])
        votes[0].candidate_id = "cand-2"

        result = await _verify(service)

        assert result["integrity_status"] == "FAIL"
        assert result["tampered_vote_ids"] == [votes[0].id]


@pytest.mark.integration
class TestVoteKeyCutoverInDatabase(TestElectionSetup):
    async def test_cast_ballots_record_the_key_and_span_the_cutover(
        self, db_session: AsyncSession, setup_election, monkeypatch
    ):
        data = setup_election
        svc = ElectionService(db_session)
        monkeypatch.setattr(election_service_module.settings, "SECRET_KEY", _SECRET)

        async def cast(user_key):
            _, err = await svc.cast_vote(
                user_id=uuid.UUID(data[user_key]),
                election_id=uuid.UUID(data["election_id"]),
                candidate_id=uuid.UUID(data["candidate_a_id"]),
                position="Chief",
                organization_id=uuid.UUID(data["org_id"]),
            )
            assert err is None, err

        # Before: the key in .env never arrived.
        monkeypatch.setattr(election_service_module.settings, "VOTE_SIGNING_KEY", "")
        await cast("user1_id")
        await db_session.execute(
            update(Vote)
            .where(Vote.election_id == data["election_id"])
            .values(signing_key_id=None)
        )

        # After: it arrives.
        monkeypatch.setattr(
            election_service_module.settings, "VOTE_SIGNING_KEY", _DEDICATED
        )
        await cast("user2_id")
        db_session.expire_all()

        integrity = await svc.verify_vote_integrity(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"]), audit=False
        )
        assert integrity["integrity_status"] == "PASS"
        assert integrity["valid_signatures"] == 2

        recorded = (
            (
                await db_session.execute(
                    Vote.__table__.select().where(
                        Vote.election_id == data["election_id"]
                    )
                )
            )
            .mappings()
            .all()
        )
        assert sorted(r["signing_key_id"] or "" for r in recorded) == sorted(
            ["", vote_signing_key_id(_DEDICATED)]
        )
