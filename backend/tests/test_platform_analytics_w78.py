"""Platform analytics charts the department's own days and module switches.

Workflow review W78:

- The login and error trends were bucketed by UTC date and laid out from
  ``now - N days``, so the last bar was the previous UTC day. An error logged
  today was counted in "Errors (last 7 days)" and missing from the chart
  under it, and a Chicago evening landed on the next day.
- Every module was badged "Enabled", including one the department had
  switched off.
"""

import uuid
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.platform_analytics import get_platform_analytics
from app.models.error_log import ErrorLog
from app.models.user import Organization, User

pytestmark = pytest.mark.integration

CHICAGO = ZoneInfo("America/Chicago")


async def _setup(db: AsyncSession, modules: dict | None = None):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Analytics VFD",
        slug=f"analytics-{uuid.uuid4().hex[:8]}",
        timezone="America/Chicago",
        settings={"modules": modules} if modules is not None else {},
    )
    db.add(org)
    await db.flush()
    name = f"it-{uuid.uuid4().hex[:8]}"
    user = User(
        organization_id=org.id,
        username=name,
        first_name="Riley",
        last_name="Owner",
        email=f"{name}@example.com",
        last_login_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.flush()
    return org, user


def _error(org_id: str, at: datetime) -> ErrorLog:
    return ErrorLog(
        organization_id=org_id,
        error_type="PROBE",
        error_message="probe",
        created_at=at,
    )


class TestTrends:
    async def test_today_is_the_last_bar_and_the_chart_adds_up(self, db_session):
        org, user = await _setup(db_session)
        now = datetime.now(timezone.utc)
        today_local = now.astimezone(CHICAGO).date()
        # 23:30 yesterday in Chicago is the early hours of today in UTC: the
        # old bucketing filed it under today's UTC date.
        late_yesterday = datetime.combine(
            today_local - timedelta(days=1), time(23, 30), tzinfo=CHICAGO
        ).astimezone(timezone.utc)
        db_session.add_all([_error(org.id, now), _error(org.id, late_yesterday)])
        await db_session.flush()

        result = await get_platform_analytics(db=db_session, current_user=user)

        assert result.error_trend[-1].date == today_local.isoformat()
        assert result.error_trend[-1].count == 1
        assert result.error_trend[-2].count == 1
        assert sum(day.count for day in result.error_trend) == (
            result.errors_last_7_days
        )
        assert result.login_trend[-1].date == today_local.isoformat()
        assert result.login_trend[-1].count == 1
        assert sum(day.count for day in result.login_trend) == result.active_users


class TestModuleSwitches:
    async def test_a_module_switched_off_is_not_badged_enabled(self, db_session):
        org, user = await _setup(
            db_session,
            modules={"elections": False, "training": True, "_user_configured": True},
        )

        result = await get_platform_analytics(db=db_session, current_user=user)

        enabled = {module.name: module.enabled for module in result.modules}
        assert enabled["Elections"] is False
        assert enabled["Training"] is True
        assert enabled["Events"] is True
