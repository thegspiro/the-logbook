"""Migration 1f3a6c2d9e40: anonymised members' path-less attachment names are
relabelled and their excused meetings re-excused, against tables that already
hold rows (pitfall #35).

Runs against throwaway copies of the four tables under a prefix in the
suite's own database; the real tables are never touched.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "1f3a6c2d9e40"
_USERS = "repairmig_users"
_RECORDS = "repairmig_training_records"
_SUBMISSIONS = "repairmig_training_submissions"
_ATTENDEES = "repairmig_meeting_attendees"
_TABLES = (_USERS, _RECORDS, _SUBMISSIONS, _ATTENDEES)

_STORED = {"id": "e-1", "file_name": "certificate.pdf", "file_path": "/u/o/a.pdf"}
_WAIVER_TEXT = "Excused: approved request"


def _load():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("mig_repair", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _drop(conn) -> None:
    for table in _TABLES:
        conn.execute(text(f"DROP TABLE IF EXISTS {table}"))


_CHARSET = " DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"


@pytest.fixture
def scratch():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        _drop(conn)
        conn.execute(
            text(
                f"CREATE TABLE {_USERS} (id VARCHAR(36) PRIMARY KEY, "
                "anonymized_at DATETIME NULL)" + _CHARSET
            )
        )
        conn.execute(
            text(
                f"CREATE TABLE {_SUBMISSIONS} (id VARCHAR(36) PRIMARY KEY, "
                "submitted_by VARCHAR(36), attachments JSON NULL)" + _CHARSET
            )
        )
        conn.execute(
            text(
                f"CREATE TABLE {_RECORDS} (id VARCHAR(36) PRIMARY KEY, "
                "user_id VARCHAR(36), attachments JSON NULL)" + _CHARSET
            )
        )
        conn.execute(
            text(
                f"CREATE TABLE {_ATTENDEES} (id VARCHAR(36) PRIMARY KEY, "
                "user_id VARCHAR(36), waiver_reason TEXT NULL, "
                "waiver_granted_at DATETIME NULL, "
                "waiver_request_id VARCHAR(36) NULL)" + _CHARSET
            )
        )
        conn.execute(
            text(f"INSERT INTO {_USERS} VALUES (:id, :at)"),
            [
                {"id": "anon", "at": "2026-11-01 00:00:00"},
                {"id": "live", "at": None},
            ],
        )
        conn.execute(
            text(f"INSERT INTO {_SUBMISSIONS} VALUES (:id, :owner, :value)"),
            [
                {
                    "id": "s-anon",
                    "owner": "anon",
                    "value": json.dumps(
                        [_STORED, {"id": "e-2", "file_name": "Pat_CPR.PDF"}, "bare"]
                    ),
                },
                {"id": "s-anon-null", "owner": "anon", "value": None},
                {"id": "s-anon-object", "owner": "anon", "value": '{"a": 1}'},
                {
                    "id": "s-live",
                    "owner": "live",
                    "value": json.dumps([{"file_name": "Sam CPR.pdf"}]),
                },
            ],
        )
        conn.execute(
            text(f"INSERT INTO {_RECORDS} VALUES (:id, :owner, :value)"),
            [
                {
                    "id": "r-anon",
                    "owner": "anon",
                    "value": json.dumps([{"file_name": "Pat notes"}]),
                },
                {
                    "id": "r-live",
                    "owner": "live",
                    "value": json.dumps([{"file_name": "Sam notes.txt"}]),
                },
            ],
        )
        conn.execute(
            text(
                f"INSERT INTO {_ATTENDEES} VALUES "
                "(:id, :user, :reason, :granted, :request)"
            ),
            [
                # Hand-granted, reason cleared by the old anonymisation.
                {
                    "id": "a-granted",
                    "user": "anon",
                    "reason": None,
                    "granted": "2026-03-02 00:00:00",
                    "request": None,
                },
                # From an approved request.
                {
                    "id": "a-request",
                    "user": "anon",
                    "reason": None,
                    "granted": None,
                    "request": "req-1",
                },
                # Plain absence.
                {
                    "id": "a-absent",
                    "user": "anon",
                    "reason": None,
                    "granted": None,
                    "request": None,
                },
                # Already neutral (anonymised after the service fix).
                {
                    "id": "a-neutral",
                    "user": "anon",
                    "reason": "Excused: approved request (Medical)",
                    "granted": "2026-03-02 00:00:00",
                    "request": "req-2",
                },
                # A live member's row is never touched.
                {
                    "id": "a-live",
                    "user": "live",
                    "reason": None,
                    "granted": "2026-03-02 00:00:00",
                    "request": None,
                },
            ],
        )
    yield engine
    with engine.begin() as conn:
        _drop(conn)
    engine.dispose()


def _upgrade(engine, *, batch: int | None = None) -> None:
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load()
    module.USERS_TABLE = _USERS
    module.RECORDS_TABLE = _RECORDS
    module.SUBMISSIONS_TABLE = _SUBMISSIONS
    module.ATTENDEES_TABLE = _ATTENDEES
    if batch is not None:
        module._BATCH = batch
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()


def _attachments(engine, table: str) -> dict:
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT id, attachments FROM {table}")).all()
    return {
        r.id: (None if r.attachments is None else json.loads(r.attachments))
        for r in rows
    }


def _reasons(engine) -> dict:
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT id, waiver_reason FROM {_ATTENDEES}")).all()
    return {r.id: r.waiver_reason for r in rows}


_EXPECTED_SUBMISSIONS = {
    "s-anon": [_STORED, {"id": "e-2", "file_name": "certificate.pdf"}, "bare"],
    "s-anon-null": None,
    "s-anon-object": {"a": 1},
    "s-live": [{"file_name": "Sam CPR.pdf"}],
}
_EXPECTED_RECORDS = {
    "r-anon": [{"file_name": "attachment"}],
    "r-live": [{"file_name": "Sam notes.txt"}],
}
_EXPECTED_REASONS = {
    "a-granted": _WAIVER_TEXT,
    "a-request": _WAIVER_TEXT,
    "a-absent": None,
    "a-neutral": "Excused: approved request (Medical)",
    "a-live": None,
}


@pytest.mark.parametrize("batch", [None, 1])
def test_upgrade_repairs_only_anonymised_members(scratch, batch):
    _upgrade(scratch, batch=batch)

    assert _attachments(scratch, _SUBMISSIONS) == _EXPECTED_SUBMISSIONS
    assert _attachments(scratch, _RECORDS) == _EXPECTED_RECORDS
    assert _reasons(scratch) == _EXPECTED_REASONS


def test_a_second_run_changes_nothing(scratch):
    _upgrade(scratch)
    _upgrade(scratch)

    assert _attachments(scratch, _SUBMISSIONS) == _EXPECTED_SUBMISSIONS
    assert _attachments(scratch, _RECORDS) == _EXPECTED_RECORDS
    assert _reasons(scratch) == _EXPECTED_REASONS


def test_the_frozen_label_matches_the_service():
    from app.services import member_anonymization_service as service

    module = _load()
    for name in ("Pat.PDF", "notes", "x.tar.gz", "a.toolongext", None, 3):
        assert module._neutral_name("certificate", name) == service._neutral_name(
            "certificate", name
        )
