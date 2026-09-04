"""Migration 20260904_0530 backfills stale due_date on non-fixed_date
training requirements.

The upgrade() SQL is exercised against a real database (MySQL 8.0/MariaDB
10.11 in the CI matrix) via db_session, since it's a single UPDATE with an
expanding IN-list bindparam -- the thing actually worth proving works, not
just that a mock was called with the right string. The table-missing guard
(CI runs `alembic upgrade head` on an empty database before create_all) is
covered separately against a fake bind, in the manner of
test_settle_legacy_email_settings_migration.py.
"""

import importlib.util
import uuid
from datetime import date, datetime, timezone
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
    / "20260904_0530_bbdaca0844df_backfill_stale_due_date_non_fixed.py"
)


def _load():
    spec = importlib.util.spec_from_file_location(
        "_due_date_backfill_probe", MIGRATION_PATH
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


async def _insert_requirement(
    db_session: AsyncSession, org_id: str, *, due_date_type: str, due_date
) -> str:
    req_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO training_requirements "
            "(id, organization_id, name, requirement_type, source, "
            "required_hours, frequency, due_date_type, due_date, "
            "applies_to_all, active, created_at, updated_at) "
            "VALUES (:id, :org_id, :name, 'hours', 'department', "
            ":hours, 'annual', :ddt, :due_date, "
            "1, 1, :now, :now)"
        ),
        {
            "id": req_id,
            "org_id": org_id,
            "name": f"Requirement ({due_date_type})",
            "hours": 24.0,
            "ddt": due_date_type,
            "due_date": due_date,
            "now": _NOW,
        },
    )
    await db_session.flush()
    return req_id


class TestBackfillAgainstARealDatabase:
    async def test_clears_stale_due_date_for_all_three_non_fixed_date_types(
        self, db_session: AsyncSession
    ):
        org_id = await _insert_org(db_session)
        req_ids = {
            ddt: await _insert_requirement(
                db_session, org_id, due_date_type=ddt, due_date=date(2020, 1, 1)
            )
            for ddt in ("calendar_period", "rolling", "certification_period")
        }
        fixed_id = await _insert_requirement(
            db_session, org_id, due_date_type="fixed_date", due_date=date(2027, 1, 1)
        )
        legacy_id = await _insert_requirement(
            db_session, org_id, due_date_type=None, due_date=date(2027, 6, 1)
        )

        # upgrade() calls bind.execute(stmt, ...) synchronously; db_session's
        # execute is a coroutine, so this runs the exact statement upgrade()
        # builds and awaits it -- proving the SQL itself (the expanding
        # IN-list bindparam) rather than upgrade()'s sync/async plumbing,
        # which alembic's real runtime supplies.
        module = _load()
        await db_session.execute(
            module._backfill_statement(), {"types": list(module._NON_FIXED_DATE_TYPES)}
        )

        result = await db_session.execute(
            text(
                "SELECT id, due_date FROM training_requirements WHERE organization_id = :org"
            ),
            {"org": org_id},
        )
        by_id = {row.id: row.due_date for row in result.fetchall()}

        for ddt, req_id in req_ids.items():
            assert by_id[req_id] is None, f"{ddt} due_date should have been cleared"
        assert by_id[fixed_id] == date(2027, 1, 1)
        assert by_id[legacy_id] == date(2027, 6, 1)


class TestBackfillSkipsAMissingTable:
    def test_missing_table_is_skipped(self):
        # CI runs `alembic upgrade head` on an empty database before create_all.
        module = _load()
        bind = MagicMock()
        inspector = MagicMock()
        inspector.get_table_names.return_value = []

        with (
            patch.object(module.op, "get_bind", return_value=bind),
            patch.object(module.sa, "inspect", return_value=inspector),
        ):
            module.upgrade()

        bind.execute.assert_not_called()
