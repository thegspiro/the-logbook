"""Audit-log stats list every category; check-in activity is bucketed by the
department's clock.

Workflow review W75:

- ``GET /audit-logs/stats`` kept only the ten busiest categories, and the
  audit page builds its category filter from those keys, so a quieter
  category (integrations, documents, minutes) could not be filtered to.
- ``GET /analytics/metrics`` grouped check-ins by the UTC hour, so a 7:30 PM
  check-in in Chicago was charted at hour 0.
"""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.analytics import get_metrics
from app.api.v1.endpoints.audit_logs import audit_log_stats
from app.core.audit import log_audit_event
from app.models.analytics import AnalyticsEvent
from app.models.user import Organization

pytestmark = pytest.mark.integration


async def _org(db: AsyncSession, tz: str = "America/Chicago") -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Monitor VFD",
        slug=f"monitor-{uuid.uuid4().hex[:8]}",
        timezone=tz,
    )
    db.add(org)
    await db.flush()
    return org


async def test_stats_list_every_category(db_session: AsyncSession):
    org = await _org(db_session)
    categories = [f"category_{n:02d}" for n in range(12)]
    for category in categories:
        await log_audit_event(
            db_session,
            "probe",
            category,
            "info",
            {},
            organization_id=org.id,
        )
    await db_session.flush()

    stats = await audit_log_stats(
        db=db_session, current_user=SimpleNamespace(organization_id=org.id)
    )

    assert sorted(stats["by_category"]) == categories


async def test_activity_is_charted_by_the_local_hour(db_session: AsyncSession):
    org = await _org(db_session)
    db_session.add(
        AnalyticsEvent(
            organization_id=org.id,
            event_type="check_in_success",
            # 7:30 PM CDT on 15 October.
            created_at=datetime(2026, 10, 16, 0, 30, tzinfo=timezone.utc),
        )
    )
    await db_session.flush()

    metrics = await get_metrics(
        event_id=None,
        db=db_session,
        current_user=SimpleNamespace(organization_id=org.id),
    )

    busy = [row["hour"] for row in metrics["hourly_activity"] if row["count"]]
    assert busy == [19]
