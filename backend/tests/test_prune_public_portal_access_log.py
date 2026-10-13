"""Public-portal access-log rows are deleted 90 days after they were written.

Every public API request is logged, and since PUB-8 every refused
authentication is too, yet nothing pruned ``public_portal_access_log``: each
row kept a requester's IP address forever and the table grew with failed
traffic. The owner chose a daily task that deletes rows older than 90 days,
successful and refused alike, including the platform-level rows that carry no
organization (decision 2026-10-12).
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.public_portal import PublicPortalAccessLog, PublicPortalConfig
from app.models.user import Organization
from app.services.scheduled_tasks import (
    PUBLIC_PORTAL_ACCESS_LOG_RETENTION_DAYS,
    SCHEDULE,
    TASK_INTERVALS_SECONDS,
    TASK_RUNNERS,
    run_prune_public_portal_access_log,
)

pytestmark = pytest.mark.integration


async def _org_and_config(db):
    org = Organization(name="Portal FD", slug=f"portal-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    config = PublicPortalConfig(
        organization_id=org.id,
        enabled=True,
        allowed_origins=[],
        default_rate_limit=1000,
        cache_ttl_seconds=300,
        settings={},
    )
    db.add(config)
    await db.flush()
    return str(org.id), str(config.id)


async def _row(db, days_ago, status_code, org_id=None, config_id=None):
    row = PublicPortalAccessLog(
        organization_id=org_id,
        config_id=config_id,
        ip_address="198.51.100.9",
        endpoint="/organization/info",
        method="GET",
        status_code=status_code,
        timestamp=datetime.now(timezone.utc) - timedelta(days=days_ago),
    )
    db.add(row)
    await db.flush()
    return row.id


async def _left(db, ids):
    result = await db.execute(
        select(PublicPortalAccessLog.id).where(PublicPortalAccessLog.id.in_(ids))
    )
    return set(result.scalars().all())


async def test_deletes_old_rows_of_every_kind_and_keeps_recent_ones(db_session):
    org_id, config_id = await _org_and_config(db_session)
    old_days = PUBLIC_PORTAL_ACCESS_LOG_RETENTION_DAYS + 1
    recent_days = PUBLIC_PORTAL_ACCESS_LOG_RETENTION_DAYS - 1

    old = [
        await _row(db_session, old_days, 200, org_id, config_id),
        await _row(db_session, old_days, 401, org_id, config_id),
        # A key that matched nothing: platform-level, no organization.
        await _row(db_session, old_days, 401),
    ]
    recent = [
        await _row(db_session, recent_days, 200, org_id, config_id),
        await _row(db_session, recent_days, 401, org_id, config_id),
        await _row(db_session, recent_days, 401),
        await _row(db_session, 0, 200, org_id, config_id),
    ]

    result = await run_prune_public_portal_access_log(db_session)

    assert await _left(db_session, old + recent) == set(recent)
    assert result["task"] == "prune_public_portal_access_log"
    assert result["deleted"] >= len(old)


async def test_works_through_more_rows_than_one_batch(db_session):
    org_id, config_id = await _org_and_config(db_session)
    old_days = PUBLIC_PORTAL_ACCESS_LOG_RETENTION_DAYS + 5
    ids = [await _row(db_session, old_days, 200, org_id, config_id) for _ in range(5)]
    ids.append(await _row(db_session, old_days, 401))

    result = await run_prune_public_portal_access_log(db_session, batch_size=2)

    assert await _left(db_session, ids) == set()
    assert result["deleted"] >= len(ids)


def test_the_scheduler_runs_it_daily():
    assert (
        TASK_RUNNERS["prune_public_portal_access_log"]
        is run_prune_public_portal_access_log
    )
    assert TASK_INTERVALS_SECONDS["prune_public_portal_access_log"] == 86400
    assert SCHEDULE["prune_public_portal_access_log"]["frequency"] == "daily"


def test_retention_outlasts_every_window_the_readers_use():
    # The detector looks back five minutes, the rate-limit backstop one hour,
    # and the usage statistics at most 30 days (the "30d" and "this month"
    # figures). A retention shorter than that would undercount them.
    assert PUBLIC_PORTAL_ACCESS_LOG_RETENTION_DAYS == 90
    assert PUBLIC_PORTAL_ACCESS_LOG_RETENTION_DAYS > 31
