"""Tests for audit-log retention archival (export-and-purge).

Covers the safety properties of ``AuditLogger.archive_expired_logs``:
checkpoint-aligned purging, JSONL export, attested chain-head hand-off so
the surviving chain verifies, and rejection of unsanctioned head deletions.
"""

import gzip

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
