"""Scheduled-task failures reach the Error Monitoring page.

``persist_error_log`` resolves the organization from a request, which a
background task does not have, so a failed reminder run or report reached
Loguru and Sentry only. ``persist_task_error_log`` takes the organization from
the caller, which is already iterating them, and ``_for_each_org`` reports each
organization's failure through it.

DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

import app.core.database as database_module
from app.core.error_reporting import TASK_ERROR_TYPE, persist_task_error_log
from app.services import scheduled_tasks

pytestmark = pytest.mark.unit


class _Session:
    def __init__(self):
        self.added = []
        self.commit = AsyncMock()

    def add(self, obj):
        self.added.append(obj)


def _install_session(monkeypatch):
    session = _Session()

    async def get_session():
        yield session

    monkeypatch.setattr(
        database_module, "database_manager", SimpleNamespace(get_session=get_session)
    )
    return session


def _raised(message):
    try:
        raise RuntimeError(message)
    except RuntimeError as exc:
        return exc


class TestPersistTaskErrorLog:
    async def test_writes_a_row_for_the_named_organization(self, monkeypatch):
        session = _install_session(monkeypatch)

        written = await persist_task_error_log(
            "org-1", "Shift reminders", _raised("smtp timed out")
        )

        assert written is True
        session.commit.assert_awaited_once()
        row = session.added[0]
        assert row.organization_id == "org-1"
        assert row.error_type == TASK_ERROR_TYPE
        assert row.error_message == "Shift reminders: smtp timed out"
        assert row.user_id is None
        assert row.context["source"] == "scheduled_task"
        assert row.context["task"] == "Shift reminders"
        assert "smtp timed out" in row.context["traceback"]

    async def test_needs_an_organization(self, monkeypatch):
        session = _install_session(monkeypatch)

        assert (
            await persist_task_error_log(None, "Shift reminders", _raised("x")) is False
        )
        assert session.added == []

    async def test_never_raises_when_the_database_is_down(self, monkeypatch):
        broken = MagicMock()
        broken.get_session = MagicMock(side_effect=RuntimeError("database is down"))
        monkeypatch.setattr(database_module, "database_manager", broken)

        assert (
            await persist_task_error_log("org-1", "Shift reminders", _raised("x"))
            is False
        )


class TestForEachOrgReportsFailures:
    async def test_a_failing_organization_is_reported_and_the_rest_still_run(
        self, monkeypatch
    ):
        reported = AsyncMock(return_value=True)
        monkeypatch.setattr(scheduled_tasks, "persist_task_error_log", reported)
        orgs = [SimpleNamespace(id="org-1"), SimpleNamespace(id="org-2")]
        result = MagicMock()
        result.scalars.return_value.all.return_value = orgs
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)
        db.rollback = AsyncMock()
        failure = RuntimeError("boom")

        async def callback(_db, org):
            if org.id == "org-1":
                raise failure
            return 3

        summary = await scheduled_tasks._for_each_org(db, "Cert alerts", callback)

        assert summary["total"] == 3
        reported.assert_awaited_once_with("org-1", "Cert alerts", failure)
