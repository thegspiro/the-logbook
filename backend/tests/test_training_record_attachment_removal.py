"""Removing a file from a training record (owner decision 2026-11-21, item (d)).

A file uploaded to a training record could be added but never removed; it
left only with retention, anonymisation or a permanent delete. The rule:

* ``training.manage`` may remove any file uploaded to the record;
* the record's member may remove only a file they uploaded themselves;
* a certificate an approval copied onto the record is the evidence the
  approval rests on, and cannot be removed here;
* a voided record keeps its files.

The entry is named by its stable id, so a repeat is a no-op (pitfall #36),
and the file goes through ``remove_unreferenced_files`` after the commit, so
a file another row still names is kept.
"""

import os
import uuid
from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints import training_enhancements
from app.models.training import TrainingRecord, TrainingStatus
from app.models.user import Organization, User
from app.services import file_storage_service

pytestmark = pytest.mark.integration


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    monkeypatch.setattr(
        file_storage_service, "_load_settings", AsyncMock(return_value={})
    )
    monkeypatch.setattr(training_enhancements, "log_audit_event", AsyncMock())
    return tmp_path


@pytest.fixture
async def dept(db_session):
    org = Organization(name="Removal FD", slug=f"removal-{uuid.uuid4().hex[:8]}")
    db_session.add(org)
    await db_session.flush()
    users = {}
    for name in ("member", "officer", "other"):
        suffix = uuid.uuid4().hex[:8]
        user = User(
            organization_id=org.id,
            username=f"{name}-{suffix}",
            email=f"{name}-{suffix}@example.org",
            first_name=name.title(),
            last_name="Removal",
            password_hash="x",
        )
        db_session.add(user)
        users[name] = user
    await db_session.flush()
    return SimpleNamespace(org=str(org.id), **{k: str(v.id) for k, v in users.items()})


def _caller(dept, who: str, *permissions: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=getattr(dept, who),
        organization_id=dept.org,
        username=who,
        rank=None,
        positions=[SimpleNamespace(permissions=list(permissions))],
    )


def _entry(root, org_id: str, area: str, uploaded_by: str | None) -> dict:
    directory = os.path.join(str(root), org_id, area, uuid.uuid4().hex)
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"{uuid.uuid4().hex}.pdf")
    with open(path, "wb") as handle:
        handle.write(b"%PDF-1.4")
    entry = {
        "id": str(uuid.uuid4()),
        "file_name": "evidence.pdf",
        "file_path": path,
        "file_type": "application/pdf",
    }
    if uploaded_by:
        entry["uploaded_by"] = uploaded_by
    return entry


async def _record(db, dept, entries, **overrides) -> TrainingRecord:
    fields = {
        "organization_id": dept.org,
        "user_id": dept.member,
        "course_name": "Pump Ops",
        "training_type": "continuing_education",
        "completion_date": date(2026, 1, 5),
        "hours_completed": 2.0,
        "status": TrainingStatus.COMPLETED,
        "attachments": entries,
    }
    fields.update(overrides)
    record = TrainingRecord(**fields)
    db.add(record)
    await db.flush()
    return record


async def _remove(db, record, entry_id, caller):
    return await training_enhancements.delete_record_attachment(
        str(record.id),
        entry_id,
        expected_id=None,
        db=db,
        current_user=caller,
    )


async def _attachments(db, record) -> list:
    await db.refresh(record)
    return list(record.attachments or [])


class TestWhoMayRemoveWhat:
    async def test_an_officer_removes_any_file_uploaded_to_the_record(
        self, db_session, dept, root
    ):
        upload = _entry(root, dept.org, "training-records", dept.member)
        kept = _entry(root, dept.org, "training-records", dept.officer)
        record = await _record(db_session, dept, [upload, kept])

        await _remove(
            db_session,
            record,
            upload["id"],
            _caller(dept, "officer", "training.manage"),
        )

        assert [e["id"] for e in await _attachments(db_session, record)] == [kept["id"]]
        assert not os.path.exists(upload["file_path"])
        assert os.path.exists(kept["file_path"])
        event = training_enhancements.log_audit_event.await_args.kwargs
        assert event["event_type"] == "training_record_attachment_removed"
        assert event["event_data"] == {
            "record_id": str(record.id),
            "entry_id": upload["id"],
            "target_user_id": dept.member,
        }

    async def test_a_member_removes_a_file_they_uploaded(self, db_session, dept, root):
        upload = _entry(root, dept.org, "training-records", dept.member)
        record = await _record(db_session, dept, [upload])

        await _remove(db_session, record, upload["id"], _caller(dept, "member"))

        assert await _attachments(db_session, record) == []
        assert not os.path.exists(upload["file_path"])

    async def test_a_member_cannot_remove_an_officers_upload(
        self, db_session, dept, root
    ):
        upload = _entry(root, dept.org, "training-records", dept.officer)
        record = await _record(db_session, dept, [upload])

        with pytest.raises(HTTPException) as exc:
            await _remove(db_session, record, upload["id"], _caller(dept, "member"))

        assert exc.value.status_code == 403
        assert await _attachments(db_session, record) == [upload]
        assert os.path.exists(upload["file_path"])

    async def test_an_entry_with_no_uploader_is_an_officers_to_remove(
        self, db_session, dept, root
    ):
        upload = _entry(root, dept.org, "training-records", None)
        record = await _record(db_session, dept, [upload])

        with pytest.raises(HTTPException) as exc:
            await _remove(db_session, record, upload["id"], _caller(dept, "member"))
        assert exc.value.status_code == 403

        await _remove(
            db_session,
            record,
            upload["id"],
            _caller(dept, "officer", "training.manage"),
        )
        assert await _attachments(db_session, record) == []

    async def test_an_approved_certificate_cannot_be_removed_here(
        self, db_session, dept, root
    ):
        certificate = _entry(root, dept.org, "self-reports", dept.member)
        record = await _record(db_session, dept, [certificate])

        with pytest.raises(HTTPException) as exc:
            await _remove(
                db_session,
                record,
                certificate["id"],
                _caller(dept, "officer", "training.manage"),
            )

        assert exc.value.status_code == 400
        assert await _attachments(db_session, record) == [certificate]
        assert os.path.exists(certificate["file_path"])

    async def test_a_voided_record_keeps_its_files(self, db_session, dept, root):
        upload = _entry(root, dept.org, "training-records", dept.member)
        record = await _record(
            db_session,
            dept,
            [upload],
            status=TrainingStatus.CANCELLED,
            voided_by=dept.officer,
            voided_at=datetime.now(UTC),
        )

        with pytest.raises(HTTPException) as exc:
            await _remove(
                db_session,
                record,
                upload["id"],
                _caller(dept, "officer", "training.manage"),
            )

        assert exc.value.status_code == 400
        assert os.path.exists(upload["file_path"])

    async def test_another_members_record_is_not_reachable(
        self, db_session, dept, root
    ):
        upload = _entry(root, dept.org, "training-records", dept.member)
        record = await _record(db_session, dept, [upload])

        with pytest.raises(HTTPException) as exc:
            await _remove(db_session, record, upload["id"], _caller(dept, "other"))

        assert exc.value.status_code == 403

    async def test_another_departments_record_is_not_found(
        self, db_session, dept, root
    ):
        upload = _entry(root, dept.org, "training-records", dept.member)
        record = await _record(db_session, dept, [upload])
        stranger = _caller(dept, "officer", "training.manage")
        stranger.organization_id = str(uuid.uuid4())

        with pytest.raises(HTTPException) as exc:
            await _remove(db_session, record, upload["id"], stranger)

        assert exc.value.status_code == 404


class TestSafeToRepeat:
    async def test_a_repeated_removal_is_a_no_op(self, db_session, dept, root):
        first = _entry(root, dept.org, "training-records", dept.member)
        second = _entry(root, dept.org, "training-records", dept.member)
        record = await _record(db_session, dept, [first, second])

        for _ in range(2):
            await _remove(db_session, record, first["id"], _caller(dept, "member"))

        assert [e["id"] for e in await _attachments(db_session, record)] == [
            second["id"]
        ]
        assert os.path.exists(second["file_path"])

    async def test_a_file_another_record_names_is_kept(self, db_session, dept, root):
        shared = _entry(root, dept.org, "training-records", dept.member)
        record = await _record(db_session, dept, [shared])
        await _record(db_session, dept, [dict(shared, id=str(uuid.uuid4()))])

        await _remove(db_session, record, shared["id"], _caller(dept, "member"))

        assert await _attachments(db_session, record) == []
        assert os.path.exists(shared["file_path"])


class TestTheListSaysWhatMayGo:
    async def test_can_remove_is_computed_for_the_caller(self, db_session, dept, root):
        mine = _entry(root, dept.org, "training-records", dept.member)
        theirs = _entry(root, dept.org, "training-records", dept.officer)
        certificate = _entry(root, dept.org, "self-reports", dept.member)
        record = await _record(db_session, dept, [mine, theirs, certificate])

        as_member = await training_enhancements.get_record_attachments(
            str(record.id), db=db_session, current_user=_caller(dept, "member")
        )
        as_officer = await training_enhancements.get_record_attachments(
            str(record.id),
            db=db_session,
            current_user=_caller(dept, "officer", "training.manage"),
        )

        assert [a["can_remove"] for a in as_member["attachments"]] == [
            True,
            False,
            False,
        ]
        assert [a["can_remove"] for a in as_officer["attachments"]] == [
            True,
            True,
            False,
        ]
        stored = (
            await db_session.execute(
                select(TrainingRecord.attachments).where(TrainingRecord.id == record.id)
            )
        ).scalar_one()
        assert len(stored) == 3
