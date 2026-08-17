"""Tests for audit-log retention archival (export-and-purge).

Covers the safety properties of ``AuditLogger.archive_expired_logs``:
checkpoint-aligned purging, JSONL export, attested chain-head hand-off so
the surviving chain verifies, and rejection of unsanctioned head deletions.
"""

import gzip
import os
import stat
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import delete, func, select

from app.core import audit as audit_module
from app.core.audit import AuditLogger, audit_logger
from app.models.audit import AuditLog, AuditLogCheckpoint

# Negative retention puts the cutoff in the future, so every row written by
# the test is deterministically "past retention" (a 0-day cutoff would race
# the second-truncated row timestamps).
_PURGE_ALL = -1


async def _write_logs(db, count: int, tag: str) -> list[AuditLog]:
    rows = []
    for i in range(count):
        row = await audit_logger.create_log_entry(
            db,
            event_type=f"retention_test_{tag}_{i}",
            event_category="security",
            severity="info",
            event_data={"i": i, "tag": tag},
        )
        assert row is not None
        rows.append(row)
    return rows


async def _count_logs(db) -> int:
    return (await db.execute(select(func.count()).select_from(AuditLog))).scalar()


class TestArchiveAttestation:
    """Pure unit tests — no DB required."""

    def test_attestation_is_keyed(self, monkeypatch):
        monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-A")
        a = AuditLogger.compute_archive_attestation(1, 10, "ab" * 32)
        monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-B")
        b = AuditLogger.compute_archive_attestation(1, 10, "ab" * 32)
        assert a != b
        assert len(a) == 64

    def test_attestation_binds_range_and_hash(self, monkeypatch):
        monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-A")
        base = AuditLogger.compute_archive_attestation(1, 10, "ab" * 32)
        assert AuditLogger.compute_archive_attestation(2, 10, "ab" * 32) != base
        assert AuditLogger.compute_archive_attestation(1, 11, "ab" * 32) != base
        assert AuditLogger.compute_archive_attestation(1, 10, "cd" * 32) != base


class TestArchiveFileHardening:
    """Pure unit test — no DB. The 0o600 mode passed to ``os.open`` is
    filtered by the process umask, so a hostile umask could leave the only
    remaining copy of the purged rows unreadable (PR #1436 review); the
    explicit fchmod/chmod calls must win regardless of the umask."""

    @staticmethod
    def _row(i: int, ts: datetime) -> SimpleNamespace:
        return SimpleNamespace(
            id=i,
            timestamp=ts,
            timestamp_nanos=0,
            event_type="unit_test",
            event_category="security",
            severity="info",
            user_id=None,
            organization_id=None,
            ip_address=None,
            user_agent=None,
            event_data={"i": i},
            previous_hash="00" * 32,
            current_hash=f"{i:02x}" * 32,
            hash_version=3,
        )

    async def test_archive_modes_survive_hostile_umask(self, tmp_path, monkeypatch):
        monkeypatch.setattr(audit_module.settings, "AUDIT_LOG_SIGNING_KEY", "key-A")
        old_ts = datetime.now(UTC) - timedelta(days=3650)
        rows = [self._row(1, old_ts), self._row(2, old_ts)]
        checkpoint = SimpleNamespace(
            first_log_id=1,
            last_log_id=2,
            archived_at=None,
            last_log_hash=None,
            archive_attestation=None,
        )

        def _scalars_result(items):
            return MagicMock(
                scalars=MagicMock(
                    return_value=MagicMock(all=MagicMock(return_value=items))
                )
            )

        db = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[
                    MagicMock(scalar_one_or_none=MagicMock(return_value=rows[0])),
                    _scalars_result([checkpoint]),
                    MagicMock(scalar=MagicMock(return_value=old_ts)),
                    _scalars_result(rows),
                    MagicMock(),  # DELETE
                ]
            ),
            flush=AsyncMock(),
        )
        service = AuditLogger()
        service.verify_integrity = AsyncMock(return_value={"verified": True})

        archive_dir = tmp_path / "archives"
        prev_umask = os.umask(0o777)  # hostile: filters every mode bit away
        try:
            result = await service.archive_expired_logs(
                db, retention_days=_PURGE_ALL, archive_dir=str(archive_dir)
            )
        finally:
            os.umask(prev_umask)

        assert result["purged_entries"] == 2
        assert stat.S_IMODE(os.stat(archive_dir).st_mode) == 0o700
        assert stat.S_IMODE(os.stat(result["archive_file"]).st_mode) == 0o600
        # The archive is readable and complete despite the umask.
        with gzip.open(result["archive_file"], "rt", encoding="utf-8") as fh:
            assert len(fh.read().splitlines()) == 2


@pytest.mark.integration
class TestArchiveExpiredLogs:
    async def test_purge_is_checkpoint_aligned_and_chain_survives(
        self, db_session, tmp_path
    ):
        old_rows = await _write_logs(db_session, 5, "old")
        await audit_logger.create_checkpoint(
            db_session, old_rows[0].id, old_rows[-1].id
        )
        recent_rows = await _write_logs(db_session, 3, "recent")

        result = await audit_logger.archive_expired_logs(
            db_session, retention_days=_PURGE_ALL, archive_dir=str(tmp_path)
        )

        # Only the checkpoint-covered rows are purged, even though the
        # recent rows are also "past retention" here.
        assert result["purged_entries"] == 5
        assert result["purge_start_id"] == old_rows[0].id
        assert result["purge_end_id"] == old_rows[-1].id
        assert await _count_logs(db_session) == 3

        # Sensitive archives are restricted to the service account.
        assert stat.S_IMODE(tmp_path.stat().st_mode) == 0o700
        assert stat.S_IMODE(os.stat(result["archive_file"]).st_mode) == 0o600

        # Export contains every purged row with its chain hashes.
        with gzip.open(result["archive_file"], "rt", encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        assert len(lines) == 5
        assert old_rows[0].current_hash in lines[0]

        # The surviving chain verifies: its head links to the attested
        # archival boundary instead of the genesis hash.
        integrity = await audit_logger.verify_integrity(db_session)
        assert integrity["verified"] is True
        assert integrity["first_id"] == recent_rows[0].id

    async def test_no_purge_without_checkpoint_coverage(self, db_session, tmp_path):
        await _write_logs(db_session, 3, "uncovered")

        result = await audit_logger.archive_expired_logs(
            db_session, retention_days=_PURGE_ALL, archive_dir=str(tmp_path)
        )

        assert result["purged_entries"] == 0
        assert result["skipped_reason"] == ("no checkpoint-covered rows past retention")
        assert await _count_logs(db_session) == 3

    async def test_rows_within_retention_are_kept(self, db_session, tmp_path):
        rows = await _write_logs(db_session, 3, "fresh")
        await audit_logger.create_checkpoint(db_session, rows[0].id, rows[-1].id)

        # Rows written seconds ago are inside any positive retention window.
        result = await audit_logger.archive_expired_logs(
            db_session, retention_days=365, archive_dir=str(tmp_path)
        )

        assert result["purged_entries"] == 0
        assert await _count_logs(db_session) == 3

    async def test_unsanctioned_head_deletion_fails_verification(self, db_session):
        rows = await _write_logs(db_session, 4, "victim")

        # An attacker with DB write access deletes the oldest rows without
        # going through the attested archival path.
        await db_session.execute(delete(AuditLog).where(AuditLog.id <= rows[1].id))
        await db_session.flush()

        integrity = await audit_logger.verify_integrity(db_session)
        assert integrity["verified"] is False
        assert any("Chain head missing" in e["error"] for e in integrity["errors"])

    async def test_forged_attestation_rejected(self, db_session, tmp_path):
        old_rows = await _write_logs(db_session, 3, "forge")
        await audit_logger.create_checkpoint(
            db_session, old_rows[0].id, old_rows[-1].id
        )
        await _write_logs(db_session, 2, "tail")

        result = await audit_logger.archive_expired_logs(
            db_session, retention_days=_PURGE_ALL, archive_dir=str(tmp_path)
        )
        assert result["purged_entries"] == 3

        # Corrupt the attestation: the boundary is no longer sanctioned, so
        # the surviving chain must fail verification again.
        cp = (
            (
                await db_session.execute(
                    select(AuditLogCheckpoint).where(
                        AuditLogCheckpoint.archived_at.isnot(None)
                    )
                )
            )
            .scalars()
            .first()
        )
        cp.archive_attestation = "0" * 64
        await db_session.flush()

        integrity = await audit_logger.verify_integrity(db_session)
        assert integrity["verified"] is False
