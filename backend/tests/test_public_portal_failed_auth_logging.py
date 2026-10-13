"""Every failed public-portal authentication is recorded (PUB-8).

``detect_anomalies`` counts 401 rows per IP, but nothing wrote one: the 401 is
raised from the ``authenticate_api_key`` dependency, and an unknown key could
not be filed under any department while ``organization_id`` / ``config_id``
were NOT NULL. The owner chose to make both nullable and log every 401, with
the unattributable rows visible only platform-side — no department's view.
"""

import importlib.util
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.public_portal_admin import get_access_logs, get_usage_stats
from app.core.database import database_manager
from app.core.public_portal_security import (
    authenticate_api_key,
    generate_api_key,
    hash_api_key,
)
from app.models.public_portal import (
    PublicPortalAccessLog,
    PublicPortalAPIKey,
    PublicPortalConfig,
)

pytestmark = [pytest.mark.integration]


def _request(ip: str):
    request = MagicMock()
    request.client.host = ip
    request.url.path = "/organization/info"
    request.method = "GET"
    request.headers.get.return_value = None
    return request


def _ip() -> str:
    # A fresh documentation-range address per test, so neither the per-IP
    # limiter nor the detector's per-IP counts see another test's rows.
    return f"198.51.100.{uuid.uuid4().int % 250 + 1}"


async def _rows(db: AsyncSession, ip: str) -> list[PublicPortalAccessLog]:
    result = await db.execute(
        select(PublicPortalAccessLog)
        .where(PublicPortalAccessLog.ip_address == ip)
        .order_by(PublicPortalAccessLog.timestamp, PublicPortalAccessLog.id)
    )
    return list(result.scalars().all())


async def _key(db: AsyncSession, org_id: str, **overrides):
    config = PublicPortalConfig(
        organization_id=org_id,
        enabled=True,
        allowed_origins=[],
        default_rate_limit=1000,
        cache_ttl_seconds=300,
        settings={},
    )
    db.add(config)
    await db.flush()
    raw_key, prefix = generate_api_key()
    api_key = PublicPortalAPIKey(
        organization_id=org_id,
        config_id=str(config.id),
        key_hash=hash_api_key(raw_key),
        key_prefix=prefix,
        name="portal",
        is_active=overrides.pop("is_active", True),
        **overrides,
    )
    db.add(api_key)
    await db.flush()
    return raw_key, api_key


async def _refused(db, ip, key):
    with pytest.raises(HTTPException) as exc:
        await authenticate_api_key(_request(ip), api_key=key, db=db)
    assert exc.value.status_code == 401


async def test_an_unknown_key_is_logged_with_no_department(db_session):
    ip = _ip()
    await _refused(db_session, ip, "lb_" + uuid.uuid4().hex)
    # The row is committed: the request's rollback on raise must not lose it.
    await db_session.rollback()

    (row,) = await _rows(db_session, ip)
    assert row.status_code == 401
    assert row.organization_id is None
    assert row.config_id is None
    assert row.api_key_id is None
    assert row.flag_reason == "Invalid API key"


async def test_a_missing_key_is_logged_too(db_session):
    ip = _ip()
    await _refused(db_session, ip, None)

    (row,) = await _rows(db_session, ip)
    assert row.status_code == 401
    assert row.organization_id is None


async def test_a_revoked_key_is_attributed_to_its_own_department(
    db_session, setup_org_and_admin
):
    org_id, _ = setup_org_and_admin
    raw_key, api_key = await _key(db_session, org_id, is_active=False)
    ip = _ip()

    await _refused(db_session, ip, raw_key)

    (row,) = await _rows(db_session, ip)
    assert row.organization_id == org_id
    assert row.api_key_id == str(api_key.id)
    assert row.flag_reason == "Revoked API key"


async def test_the_detector_fires_on_a_run_of_failed_keys(db_session):
    """More than five 401s from one IP in five minutes is flagged."""
    ip = _ip()
    for _ in range(7):
        await _refused(db_session, ip, "lb_" + uuid.uuid4().hex)

    rows = await _rows(db_session, ip)
    assert len(rows) == 7
    # Timestamps share a second, so the flagged row is found by content: only
    # the seventh attempt had more than five failures behind it.
    flagged = [r for r in rows if r.flagged_suspicious]
    assert len(flagged) == 1
    assert "Multiple failed auth attempts: 6" in flagged[0].flag_reason


async def test_no_department_sees_the_unattributable_rows(
    db_session, setup_org_and_admin
):
    org_id, _ = setup_org_and_admin
    ip = _ip()
    await _refused(db_session, ip, "lb_" + uuid.uuid4().hex)
    caller = SimpleNamespace(organization_id=org_id)

    logs = await get_access_logs(
        current_user=caller,
        db=db_session,
        api_key_id=None,
        ip_address=ip,
        endpoint=None,
        status_code=None,
        flagged_suspicious=None,
        start_date=None,
        end_date=None,
        limit=100,
        offset=0,
    )
    stats = await get_usage_stats(current_user=caller, db=db_session)

    assert logs == []
    assert stats.total_requests == 0


# ---------------------------------------------------------------------------
# The migration, against a throwaway copy of the table (not the shared one).
# ---------------------------------------------------------------------------

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MIGRATION = sorted(_VERSIONS.glob("*_e6d21e605d99_*.py"))
assert len(_MIGRATION) == 1, _MIGRATION


def _migration(table: str):
    spec = importlib.util.spec_from_file_location("pub8_migration", _MIGRATION[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.TABLE = table
    return module


def _nullable(connection, table) -> dict:
    return {
        c["name"]: c["nullable"]
        for c in sa.inspect(connection).get_columns(table)
        if c["name"] in ("organization_id", "config_id")
    }


@pytest.mark.usefixtures("_initialize_database")
async def test_the_migration_round_trips_on_a_scratch_table():
    table = f"zz_pub8_{uuid.uuid4().hex[:10]}"
    migration = _migration(table)

    def run(sync_connection, direction):
        with Operations.context(MigrationContext.configure(sync_connection)):
            getattr(migration, direction)()

    async with database_manager.engine.connect() as conn:
        try:
            await conn.execute(
                sa.text(
                    f"CREATE TABLE {table} (id VARCHAR(36) PRIMARY KEY, "
                    "organization_id VARCHAR(36) NOT NULL, "
                    "config_id VARCHAR(36) NOT NULL)"
                )
            )
            await conn.execute(sa.text(f"INSERT INTO {table} VALUES ('a', 'o', 'c')"))
            await conn.commit()

            await conn.run_sync(run, "upgrade")
            assert await conn.run_sync(_nullable, table) == {
                "organization_id": True,
                "config_id": True,
            }
            await conn.run_sync(run, "upgrade")  # idempotent
            await conn.execute(sa.text(f"INSERT INTO {table} VALUES ('b', NULL, NULL)"))
            await conn.commit()

            await conn.run_sync(run, "downgrade")
            assert await conn.run_sync(_nullable, table) == {
                "organization_id": False,
                "config_id": False,
            }
            ids = (await conn.execute(sa.text(f"SELECT id FROM {table}"))).all()
            assert [i for (i,) in ids] == ["a"]
        finally:
            await conn.execute(sa.text(f"DROP TABLE IF EXISTS {table}"))
            await conn.commit()


async def test_the_migration_skips_a_missing_table(db_session):
    migration = _migration(f"zz_absent_{uuid.uuid4().hex[:8]}")

    def run(sync_connection):
        with Operations.context(MigrationContext.configure(sync_connection)):
            migration.upgrade()
            migration.downgrade()

    connection = await db_session.connection()
    await connection.run_sync(run)
