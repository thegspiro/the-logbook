"""Migration 20260904_1800 removes pre-existing SkillTestViewer rows naming a
test's own examiner.

SKT3-1 added a write-time check rejecting *new* viewer grants naming the
examiner, but a row created by a direct API caller before that guard existed
sits untouched by it. This is the one-time backfill that cleans those up.

The upgrade() SQL is exercised against a real database (MySQL 8.0/MariaDB
10.11 in the CI matrix) via db_session, since it's a MySQL/MariaDB multi-table
DELETE ... JOIN statement -- the thing actually worth proving works, not just
that a mock was called with the right string. The table-missing guard (CI runs
`alembic upgrade head` on an empty database before create_all) is covered
separately against a fake bind, in the manner of
test_backfill_stale_due_date_migration.py / test_settle_legacy_email_settings_migration.py.
"""

import importlib.util
import uuid
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = [pytest.mark.integration]

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260904_1800_9d2b4492faba_backfill_examiner_self_grant_cleanup.py"
)


def _load():
    spec = importlib.util.spec_from_file_location(
        "_examiner_self_grant_cleanup_probe", MIGRATION_PATH
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _uid() -> str:
    return str(uuid.uuid4())


_NOW = datetime.now(timezone.utc)


async def _insert_org(db_session: AsyncSession) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Test Dept",
            "otype": "fire_department",
            "slug": f"test-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    await db_session.flush()
    return org_id


async def _insert_user(db_session: AsyncSession, org_id: str, *, label: str) -> str:
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{label}-{user_id[:8]}",
            "fn": label,
            "ln": "User",
            "em": f"{label}-{user_id[:8]}@test.com",
            "pw": "hashed",
        },
    )
    await db_session.flush()
    return user_id


async def _insert_template(db_session: AsyncSession, org_id: str) -> str:
    template_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO skill_templates "
            "(id, organization_id, name, sections, status) "
            "VALUES (:id, :org, :name, :sections, 'published')"
        ),
        {"id": template_id, "org": org_id, "name": "SCBA Donning", "sections": "[]"},
    )
    await db_session.flush()
    return template_id


async def _insert_test(
    db_session: AsyncSession,
    org_id: str,
    template_id: str,
    *,
    candidate_id: str,
    examiner_id: str,
) -> str:
    test_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO skill_tests "
            "(id, organization_id, template_id, candidate_id, examiner_id, "
            "status, result, created_at, updated_at) "
            "VALUES (:id, :org, :template, :candidate, :examiner, "
            "'completed', 'pass', :now, :now)"
        ),
        {
            "id": test_id,
            "org": org_id,
            "template": template_id,
            "candidate": candidate_id,
            "examiner": examiner_id,
            "now": _NOW,
        },
    )
    await db_session.flush()
    return test_id


async def _insert_viewer(db_session: AsyncSession, test_id: str, user_id: str) -> str:
    viewer_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO skill_test_viewers "
            "(id, test_id, user_id, granted_at) "
            "VALUES (:id, :test, :user, :now)"
        ),
        {"id": viewer_id, "test": test_id, "user": user_id, "now": _NOW},
    )
    await db_session.flush()
    return viewer_id


class TestCleanupAgainstARealDatabase:
    async def test_removes_a_grant_naming_the_examiner_and_keeps_others(
        self, db_session: AsyncSession
    ):
        org_id = await _insert_org(db_session)
        candidate_id = await _insert_user(db_session, org_id, label="candidate")
        examiner_id = await _insert_user(db_session, org_id, label="examiner")
        preceptor_id = await _insert_user(db_session, org_id, label="preceptor")
        template_id = await _insert_template(db_session, org_id)
        test_id = await _insert_test(
            db_session,
            org_id,
            template_id,
            candidate_id=candidate_id,
            examiner_id=examiner_id,
        )

        # Simulates a row created by a direct API caller before SKT3-1's
        # write-time guard existed -- bypasses the endpoint entirely.
        examiner_grant_id = await _insert_viewer(db_session, test_id, examiner_id)
        # An unrelated, legitimate grant that must survive the cleanup.
        preceptor_grant_id = await _insert_viewer(db_session, test_id, preceptor_id)

        module = _load()
        # upgrade() calls bind.execute(stmt) synchronously; db_session's
        # execute is a coroutine, so this runs the exact statement upgrade()
        # builds and awaits it -- proving the SQL itself (the MySQL/MariaDB
        # multi-table DELETE ... JOIN) rather than upgrade()'s sync/async
        # plumbing, which alembic's real runtime supplies.
        await db_session.execute(module._CLEANUP_STATEMENT)

        result = await db_session.execute(
            text("SELECT id, user_id FROM skill_test_viewers WHERE test_id = :test"),
            {"test": test_id},
        )
        remaining = {row.id: row.user_id for row in result.fetchall()}

        assert examiner_grant_id not in remaining
        assert remaining[preceptor_grant_id] == preceptor_id

    async def test_is_idempotent_when_there_is_nothing_to_clean_up(
        self, db_session: AsyncSession
    ):
        org_id = await _insert_org(db_session)
        candidate_id = await _insert_user(db_session, org_id, label="candidate")
        examiner_id = await _insert_user(db_session, org_id, label="examiner")
        template_id = await _insert_template(db_session, org_id)
        test_id = await _insert_test(
            db_session,
            org_id,
            template_id,
            candidate_id=candidate_id,
            examiner_id=examiner_id,
        )
        candidate_grant_id = await _insert_viewer(db_session, test_id, candidate_id)

        module = _load()
        # Two runs in a row -- the second must no-op rather than error, as a
        # re-run of `alembic upgrade head` (or a second deploy) would trigger.
        await db_session.execute(module._CLEANUP_STATEMENT)
        await db_session.execute(module._CLEANUP_STATEMENT)

        result = await db_session.execute(
            text("SELECT id FROM skill_test_viewers WHERE test_id = :test"),
            {"test": test_id},
        )
        remaining_ids = {row.id for row in result.fetchall()}

        assert remaining_ids == {candidate_grant_id}


class TestCleanupSkipsAMissingTable:
    def test_missing_skill_tests_table_is_skipped(self):
        # CI runs `alembic upgrade head` on an empty database before
        # create_all -- neither skill_tests nor skill_test_viewers exists yet.
        module = _load()
        bind = MagicMock()
        inspector = MagicMock()
        inspector.get_table_names.return_value = ["skill_test_viewers"]

        with (
            patch.object(module.op, "get_bind", return_value=bind),
            patch.object(module.sa, "inspect", return_value=inspector),
        ):
            module.upgrade()

        bind.execute.assert_not_called()

    def test_missing_skill_test_viewers_table_is_skipped(self):
        module = _load()
        bind = MagicMock()
        inspector = MagicMock()
        inspector.get_table_names.return_value = ["skill_tests"]

        with (
            patch.object(module.op, "get_bind", return_value=bind),
            patch.object(module.sa, "inspect", return_value=inspector),
        ):
            module.upgrade()

        bind.execute.assert_not_called()

    def test_runs_the_cleanup_when_both_tables_exist(self):
        module = _load()
        bind = MagicMock()
        inspector = MagicMock()
        inspector.get_table_names.return_value = ["skill_tests", "skill_test_viewers"]

        with (
            patch.object(module.op, "get_bind", return_value=bind),
            patch.object(module.sa, "inspect", return_value=inspector),
        ):
            module.upgrade()

        bind.execute.assert_called_once_with(module._CLEANUP_STATEMENT)
