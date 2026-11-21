"""The orphaned member-file sweep (owner decision 2026-11-21, item (c)).

Files a member-owned area holds that no row names any more: certificates
whose rows were deleted before D11 removed files with them, and those that
still accrue (historical-import undo, the onboarding reset, a process killed
between a commit and its file delete). The sweep is a dry run unless told to
apply, reports counts and never paths, leaves young files alone, refuses
while a relocation or remote migration is unfinished, and treats a file as
orphaned only when no collected reference names it.
"""

import json
import os
import shutil
import time
import uuid
from datetime import date
from unittest.mock import AsyncMock

import pytest

from app.models.training import SubmissionStatus, TrainingSubmission
from app.models.user import Organization
from app.services import file_storage_service, orphaned_member_files
from app.services.file_storage_service import StorageArea
from app.services.orphaned_member_files import (
    AREAS,
    UnfinalisedManifestError,
    is_old_enough,
    sweep,
    unfinalised_manifests,
)

DAY = 86400


def _later(days: int) -> float:
    """A clock this many days ahead: a test cannot backdate a file's ctime."""
    return time.time() + days * DAY


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    monkeypatch.setattr(
        file_storage_service, "_load_settings", AsyncMock(return_value={})
    )
    monkeypatch.setattr(orphaned_member_files, "log_audit_event", AsyncMock())
    return tmp_path


def _file(directory, name=None) -> str:
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(str(directory), name or f"{uuid.uuid4().hex}.pdf")
    with open(path, "wb") as handle:
        handle.write(b"%PDF-1.4 orphan")
    return path


class TestPureRules:
    pytestmark = pytest.mark.unit

    def test_the_member_owned_areas(self):
        assert AREAS == (
            StorageArea.SELF_REPORTS,
            StorageArea.TRAINING_RECORDS,
            StorageArea.ATTENDANCE_WAIVERS,
        )

    def test_age_counts_from_the_later_of_mtime_and_ctime(self, tmp_path):
        source = _file(tmp_path / "src")
        old = time.time() - 90 * DAY
        os.utime(source, (old, old))
        # A relocation copies with copy2, which keeps the source's mtime; the
        # copy is new all the same, and its ctime says so.
        copy = str(tmp_path / "dst.pdf")
        shutil.copy2(source, copy)
        assert os.stat(copy).st_mtime == pytest.approx(old, abs=2)
        assert not is_old_enough(copy, min_age_days=30, now=time.time())
        assert is_old_enough(copy, min_age_days=30, now=_later(31))

    def test_an_unfinalised_manifest_of_either_kind_is_found(self, tmp_path):
        relocation = tmp_path / ".relocation"
        migration = tmp_path / ".s3-migration"
        relocation.mkdir()
        migration.mkdir()
        (relocation / "done.json").write_text(json.dumps({"finalized": True}))
        assert unfinalised_manifests(str(tmp_path)) == []

        (relocation / "open.json").write_text(json.dumps({"finalized": False}))
        (migration / "open.json").write_text(json.dumps({"kind": "s3-migration"}))
        found = unfinalised_manifests(str(tmp_path))
        assert sorted(os.path.basename(os.path.dirname(p)) for p in found) == [
            ".relocation",
            ".s3-migration",
        ]

    def test_an_unreadable_manifest_counts_as_unfinalised(self, tmp_path):
        relocation = tmp_path / ".relocation"
        relocation.mkdir()
        (relocation / "broken.json").write_text("{not json")
        assert len(unfinalised_manifests(str(tmp_path))) == 1


@pytest.fixture
async def org(db_session):
    organization = Organization(name="Orphan FD", slug=f"orphan-{uuid.uuid4().hex[:8]}")
    db_session.add(organization)
    await db_session.flush()
    return str(organization.id)


async def _named(db, org_id: str, path: str) -> None:
    """A submission row naming *path*, so the file is referenced."""
    from sqlalchemy import select

    from app.models.user import User

    member = (
        await db.execute(select(User.id).where(User.organization_id == org_id))
    ).scalar_one_or_none()
    if member is None:
        suffix = uuid.uuid4().hex[:8]
        user = User(
            organization_id=org_id,
            username=f"orphan-{suffix}",
            email=f"orphan-{suffix}@example.org",
            first_name="O",
            last_name="Member",
            password_hash="x",
        )
        db.add(user)
        await db.flush()
        member = user.id
    db.add(
        TrainingSubmission(
            organization_id=org_id,
            submitted_by=member,
            course_name="CPR",
            training_type="certification",
            completion_date=date(2026, 1, 5),
            hours_completed=1.0,
            status=SubmissionStatus.APPROVED,
            attachments=[
                {"id": str(uuid.uuid4()), "file_name": "c.pdf", "file_path": path}
            ],
        )
    )
    await db.flush()


@pytest.mark.integration
class TestTheSweep:
    async def test_a_dry_run_counts_and_deletes_nothing(self, db_session, root, org):
        orphan = _file(root / org / "self-reports" / "s1")
        kept = _file(root / org / "self-reports" / "s2")
        await _named(db_session, org, kept)

        report = await sweep(db_session, apply=False, now=_later(31))

        assert os.path.exists(orphan)
        assert os.path.exists(kept)
        mine = report.organizations[org]
        assert mine.areas["self-reports"].files == 2
        assert mine.areas["self-reports"].orphaned == 1
        assert mine.areas["self-reports"].referenced == 1
        assert mine.deleted == 0
        orphaned_member_files.log_audit_event.assert_not_awaited()

    async def test_apply_deletes_old_orphans_only(self, db_session, root, org):
        old_orphan = _file(root / org / "attendance-waivers" / "w1")
        referenced = _file(root / org / "self-reports" / "s1")
        await _named(db_session, org, referenced)
        legacy = _file(root / "training_attachments" / org)
        hidden = _file(root / org / "training-records" / "r1", ".upload.partial")

        report = await sweep(db_session, apply=True, now=_later(31))

        assert not os.path.exists(old_orphan)
        assert not os.path.exists(legacy)
        assert os.path.exists(referenced)
        assert os.path.exists(hidden)
        assert report.organizations[org].deleted == 2
        event = orphaned_member_files.log_audit_event.await_args.kwargs
        assert event["event_type"] == "orphaned_member_files_removed"
        assert event["organization_id"] == org
        for value in event["event_data"].values():
            assert isinstance(value, int)
        assert event["event_data"]["files_deleted"] == 2

    async def test_a_young_file_is_left_alone(self, db_session, root, org):
        young = _file(root / org / "self-reports" / "s1")

        report = await sweep(db_session, apply=True, now=_later(10))

        assert os.path.exists(young)
        assert report.organizations[org].areas["self-reports"].young == 1
        assert report.organizations[org].deleted == 0

    async def test_the_minimum_age_can_be_lowered_to_one_day_and_no_further(
        self, db_session, root, org
    ):
        file = _file(root / org / "self-reports" / "s1")
        with pytest.raises(ValueError, match="at least 1"):
            await sweep(db_session, apply=True, min_age_days=0, now=_later(2))

        await sweep(db_session, apply=True, min_age_days=1, now=_later(2))

        assert not os.path.exists(file)

    async def test_an_unfinished_relocation_refuses_the_run(
        self, db_session, root, org
    ):
        orphan = _file(root / org / "self-reports" / "s1")
        manifests = root / ".relocation"
        manifests.mkdir()
        (manifests / "relocation-1.json").write_text(json.dumps({"finalized": False}))

        with pytest.raises(UnfinalisedManifestError):
            await sweep(db_session, apply=True, now=_later(31))
        with pytest.raises(UnfinalisedManifestError):
            await sweep(db_session, apply=False, now=_later(31))

        assert os.path.exists(orphan)

    async def test_a_failed_reference_recheck_deletes_nothing(
        self, db_session, root, org, monkeypatch
    ):
        orphan = _file(root / org / "self-reports" / "s1")
        calls = {"n": 0}
        original = orphaned_member_files.upload_relocation.collect_references

        async def flaky(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] > 1:
                raise RuntimeError("database went away")
            return await original(*args, **kwargs)

        monkeypatch.setattr(
            orphaned_member_files.upload_relocation, "collect_references", flaky
        )

        report = await sweep(db_session, apply=True, now=_later(31))

        assert os.path.exists(orphan)
        assert report.organizations[org].deleted == 0
        assert report.organizations[org].errors == 1

    async def test_a_directory_with_no_department_is_reported_not_swept(
        self, db_session, root, org
    ):
        stray_org = str(uuid.uuid4())
        stray = _file(root / stray_org / "self-reports" / "s1")

        report = await sweep(db_session, apply=True, now=_later(31))

        assert os.path.exists(stray)
        assert report.unknown_organization_directories == 1

    async def test_the_report_carries_no_path(self, db_session, root, org):
        orphan = _file(root / org / "self-reports" / "s1")

        report = await sweep(db_session, apply=True, now=_later(31))

        text = json.dumps(report.as_dict())
        assert os.path.basename(orphan) not in text
        assert str(root) not in text

    async def test_another_departments_reference_does_not_save_a_file(
        self, db_session, root, org
    ):
        """References are read per department: a row in another department
        that happens to name this path does not count."""
        orphan = _file(root / org / "self-reports" / "s1")
        other = Organization(name="Other FD", slug=f"other-{uuid.uuid4().hex[:8]}")
        db_session.add(other)
        await db_session.flush()
        await _named(db_session, str(other.id), orphan)

        await sweep(db_session, apply=True, org_id=org, now=_later(31))

        assert not os.path.exists(orphan)


class TestTheCommand:
    pytestmark = pytest.mark.unit

    def test_a_minimum_age_under_one_day_is_refused_before_anything_runs(self):
        import importlib.util
        from pathlib import Path

        script = Path(__file__).resolve().parents[1] / "scripts"
        spec = importlib.util.spec_from_file_location(
            "sweep_orphaned_member_files", script / "sweep_orphaned_member_files.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        with pytest.raises(SystemExit) as exc:
            module.main(["--min-age-days", "0"])

        assert exc.value.code == 2
