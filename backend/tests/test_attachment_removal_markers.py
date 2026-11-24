"""A removed certificate file says why (owner decision 2026-11-23).

When certificate retention, or the malware rescan, deletes a stored file, the
entry that named it on a training submission or record is replaced by a
removal marker (its id and name, ``removed_reason`` and ``removed_at``, no
path) instead of vanishing silently or becoming a broken link. Every reader
of those attachment lists has to tolerate one.
"""

import os
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.api.v1.endpoints import training_enhancements, training_submissions
from app.core.config import settings
from app.models.training import (
    SelfReportConfig,
    SubmissionStatus,
    TrainingRecord,
    TrainingStatus,
    TrainingSubmission,
)
from app.schemas.training_submission import (
    SubmissionAttachment,
    sanitize_attachments,
)
from app.services import file_storage_service, malware_scan_service, upload_relocation
from app.services.file_storage_service import StorageArea
from app.services.malware_scan_service import ScanResult
from app.services.member_anonymization_service import _strip_entries
from app.services.self_report_attachment_retention import (
    SelfReportAttachmentRetention,
)
from app.services.stored_file_rescan import StoredFileRescan
from app.utils.training_attachments import (
    REMOVED_MALWARE,
    REMOVED_RETENTION,
    is_removal_marker,
    removal_marker,
    removal_notices,
)
from tests.clock_support import reread_each_test


def _clock() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    return {"NOW": now}


(NOW,) = _clock().values()
_reread_clock = reread_each_test(__name__, _clock)

ENTRY_ID = "6f1d2c3b-0a9e-4b8c-9d7e-1f2a3b4c5d6e"


@pytest.mark.unit
class TestTheMarker:
    def test_keeps_the_id_and_name_and_drops_the_file(self):
        entry = {
            "id": ENTRY_ID,
            "file_name": "cert.pdf",
            "file_path": "/uploads/org/self-reports/s/cert.pdf",
            "file_type": "application/pdf",
            "file_size": 10,
        }
        when = datetime(2026, 11, 23, 12, tzinfo=timezone.utc)

        marker = removal_marker(entry, REMOVED_RETENTION, when)

        assert marker == {
            "id": ENTRY_ID,
            "file_name": "cert.pdf",
            "removed_reason": "retention",
            "removed_at": "2026-11-23T12:00:00+00:00",
        }
        assert is_removal_marker(marker)
        assert not is_removal_marker(entry)
        assert removal_notices([entry, marker, "legacy.pdf"]) == [
            {"removed_at": "2026-11-23T12:00:00+00:00", "removed_reason": "retention"}
        ]

    def test_an_unknown_reason_is_refused(self):
        with pytest.raises(ValueError, match="Unknown removal reason"):
            removal_marker({"file_name": "x"}, "tidy", NOW)

    def test_the_submission_list_exposes_the_reason_and_never_a_path(self):
        marker = removal_marker(
            {"id": ENTRY_ID, "file_name": "cert.pdf"}, REMOVED_MALWARE, NOW
        )

        (item,) = sanitize_attachments([marker])

        assert item["removed_reason"] == "malware"
        assert item["removed_at"] == NOW.isoformat()
        assert "file_path" not in SubmissionAttachment(**item).model_dump()

    def test_a_record_marker_cannot_be_removed(self):
        marker = removal_marker(
            {"id": ENTRY_ID, "file_name": "cert.pdf"}, REMOVED_RETENTION, NOW
        )
        record = SimpleNamespace(attachments=[marker], user_id="u-1")
        officer = SimpleNamespace(id="u-2", roles=[], positions=[])

        (item,) = training_enhancements._sanitize_attachments(record, officer)

        assert item["can_remove"] is False
        assert item["removed_reason"] == "retention"

    def test_anonymisation_relabels_a_marker_and_keeps_why(self):
        marker = removal_marker(
            {"id": ENTRY_ID, "file_name": "Pat Firefighter CPR.pdf"},
            REMOVED_RETENTION,
            NOW,
        )
        # A transient row: _strip_entries flags the JSON column modified.
        row = TrainingSubmission(attachments=[marker])

        _strip_entries(row, "org-1", set(), set(), (StorageArea.SELF_REPORTS,))

        assert row.attachments == [
            {
                "id": ENTRY_ID,
                "file_name": "certificate.pdf",
                "removed_reason": "retention",
                "removed_at": NOW.isoformat(),
            }
        ]


class TestDownloadsAnswerGone:
    async def test_a_submission_marker_downloads_as_410(self, monkeypatch):
        marker = removal_marker(
            {"id": ENTRY_ID, "file_name": "cert.pdf"}, REMOVED_RETENTION, NOW
        )
        submission = SimpleNamespace(attachments=[marker], organization_id="org-1")
        monkeypatch.setattr(
            training_submissions,
            "_load_submission_for_attachment",
            AsyncMock(return_value=submission),
        )

        with pytest.raises(HTTPException) as caught:
            await training_submissions.download_submission_attachment(
                "sub-1", ENTRY_ID, db=None, current_user=SimpleNamespace(id="u")
            )

        assert caught.value.status_code == 410
        assert "retention policy" in caught.value.detail

    async def test_a_record_marker_downloads_as_410(self, monkeypatch):
        marker = removal_marker(
            {"id": ENTRY_ID, "file_name": "cert.pdf"}, REMOVED_MALWARE, NOW
        )
        record = SimpleNamespace(attachments=[marker], organization_id="org-1")
        monkeypatch.setattr(
            training_enhancements,
            "_load_record_for_attachment",
            AsyncMock(return_value=record),
        )

        with pytest.raises(HTTPException) as caught:
            await training_enhancements.download_record_attachment(
                "rec-1", ENTRY_ID, db=None, current_user=SimpleNamespace(id="u")
            )

        assert caught.value.status_code == 410
        assert "malware scan" in caught.value.detail


# --- against the database ---------------------------------------------------


@pytest.fixture
def upload_root(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    monkeypatch.setattr(
        file_storage_service, "_load_settings", AsyncMock(return_value={})
    )
    return tmp_path


async def _org_and_member(db) -> tuple[str, str]:
    org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Markers VFD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"mark-{org_id[:8]}"},
    )
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Pat', 'Member', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"m-{user_id[:8]}",
            "em": f"m-{user_id[:8]}@test.com",
        },
    )
    return org_id, user_id


def _stored(root, org_id, content=b"%PDF-1.4 certificate") -> dict:
    directory = root / org_id / "self-reports" / uuid.uuid4().hex
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{uuid.uuid4().hex}.pdf"
    path.write_bytes(content)
    return {
        "id": str(uuid.uuid4()),
        "file_name": "cert.pdf",
        "file_path": str(path),
        "file_type": "application/pdf",
    }


def _submission(org_id, user_id, attachments, decided_days_ago=400):
    return TrainingSubmission(
        organization_id=org_id,
        submitted_by=user_id,
        course_name="CPR",
        training_type="certification",
        completion_date=date(2024, 1, 1),
        hours_completed=4.0,
        status=SubmissionStatus.APPROVED,
        reviewed_at=NOW - timedelta(days=decided_days_ago),
        attachments=attachments,
    )


def _record(org_id, user_id, attachments):
    return TrainingRecord(
        organization_id=org_id,
        user_id=user_id,
        course_name="CPR",
        training_type="certification",
        completion_date=date(2024, 1, 1),
        hours_completed=4.0,
        status=TrainingStatus.COMPLETED,
        attachments=attachments,
    )


async def _fresh(db, model, row_id):
    return (
        await db.execute(
            select(model)
            .where(model.id == row_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


@pytest.mark.integration
class TestRetentionLeavesMarkers:
    async def test_the_submission_and_its_record_say_why(self, db_session, upload_root):
        org_id, user_id = await _org_and_member(db_session)
        db_session.add(
            SelfReportConfig(organization_id=org_id, attachment_retention_days=365)
        )
        entry = _stored(upload_root, org_id)
        submission = _submission(org_id, user_id, [entry])
        record = _record(org_id, user_id, [dict(entry)])
        db_session.add_all([submission, record])
        await db_session.flush()

        await SelfReportAttachmentRetention(db_session).sweep(now=NOW)

        expected = [
            {
                "id": entry["id"],
                "file_name": "cert.pdf",
                "removed_reason": "retention",
                "removed_at": NOW.isoformat(),
            }
        ]
        assert not os.path.exists(entry["file_path"])
        assert (
            await _fresh(db_session, TrainingSubmission, submission.id)
        ).attachments == expected
        assert (
            await _fresh(db_session, TrainingRecord, record.id)
        ).attachments == expected

    async def test_a_swept_submission_is_not_fetched_again(
        self, db_session, upload_root, monkeypatch
    ):
        org_id, user_id = await _org_and_member(db_session)
        db_session.add(
            SelfReportConfig(organization_id=org_id, attachment_retention_days=365)
        )
        db_session.add(_submission(org_id, user_id, [_stored(upload_root, org_id)]))
        await db_session.flush()
        retention = SelfReportAttachmentRetention(db_session)
        await retention.sweep(now=NOW)
        seen: list[str] = []
        original = retention._expire_submission_files

        async def spy(submission, org, now):
            seen.append(str(submission.id))
            return await original(submission, org, now)

        monkeypatch.setattr(retention, "_expire_submission_files", spy)

        await retention.sweep(now=NOW)

        assert seen == []

    async def test_a_marker_is_not_a_file_reference(self, db_session, upload_root):
        org_id, user_id = await _org_and_member(db_session)
        marker = removal_marker(
            {"id": ENTRY_ID, "file_name": "cert.pdf"}, REMOVED_RETENTION, NOW
        )
        submission = _submission(org_id, user_id, [marker])
        db_session.add(submission)
        await db_session.flush()

        refs = await upload_relocation.collect_references(db_session, org_id)

        assert [r for r in refs if r.row_id == str(submission.id)] == []


class _InfectedScanner:
    async def __call__(self, data: bytes, **_kwargs) -> ScanResult:
        if b"EICAR" in data:
            return ScanResult(infected=True, signature="Eicar-Test-Signature")
        return ScanResult(infected=False)


@pytest.mark.integration
class TestTheMalwareScanLeavesMarkers:
    async def test_every_training_row_naming_the_file_says_why(
        self, db_session, upload_root, monkeypatch
    ):
        monkeypatch.setattr(malware_scan_service, "scan_bytes", _InfectedScanner())
        monkeypatch.setattr(settings, "CLAMAV_ENABLED", True)
        org_id, user_id = await _org_and_member(db_session)
        infected = _stored(upload_root, org_id, b"%PDF-1.4 EICAR-TEST")
        clean = _stored(upload_root, org_id)
        submission = _submission(org_id, user_id, [infected, clean], 1)
        record = _record(org_id, user_id, [dict(infected)])
        db_session.add_all([submission, record])
        await db_session.flush()

        result = await StoredFileRescan(db_session).run(organization_id=org_id)

        assert result["infected"] == 1
        assert not os.path.exists(infected["file_path"])
        sub = await _fresh(db_session, TrainingSubmission, submission.id)
        rec = await _fresh(db_session, TrainingRecord, record.id)
        marker, kept = sub.attachments
        assert marker["id"] == infected["id"]
        assert marker["removed_reason"] == "malware"
        assert "file_path" not in marker
        assert kept == clean
        (rec_marker,) = rec.attachments
        assert rec_marker["removed_reason"] == "malware"
        assert rec_marker["id"] == infected["id"]
