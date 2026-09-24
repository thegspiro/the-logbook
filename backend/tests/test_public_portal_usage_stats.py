"""The public-portal usage dashboard, and the alert that could not fire.

`UsageStatsTab` reads twenty-two field names. The endpoint declared nine. The
thirteen it did not send were not a cosmetic gap: every tile in the Request
Volume row rendered `0`, the response-time tile printed the literal string
`undefinedms`, and the "Attention Required" banner was unreachable. Its three
conditions read `error_rate_percentage`, `flagged_suspicious_24h` and
`rate_limit_hits_24h`, each coalesced with `?? 0`, so all three compared
`0 > threshold` no matter what the traffic did. An operator watching an
unauthenticated API surface was watching a dashboard that could not tell them
anything was wrong.

One of those three had a second, deeper reason to stay at zero, and it is the
part worth keeping a test on: the 429 is raised by `authenticate_api_key`,
which is a FastAPI *dependency*. `log_access` is called from the handler
bodies in `portal.py`, and a handler body does not run when a dependency
raises — so no 429 row had ever been written to `public_portal_access_log`.
Adding the field without that would have shipped a tile that is structurally
stuck at zero, which is the same defect in a new coat.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.public_portal_admin import get_usage_stats
from app.core.public_portal_security import (
    authenticate_api_key,
    generate_api_key,
    hash_api_key,
    rate_limit_cache,
)
from app.models.public_portal import (
    PublicPortalAccessLog,
    PublicPortalAPIKey,
    PublicPortalConfig,
)

pytestmark = [pytest.mark.integration]

NOW = datetime.now(timezone.utc)


async def _make_config(db: AsyncSession, org_id: str) -> str:
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
    return str(config.id)


async def _log(
    db: AsyncSession,
    org_id: str,
    config_id: str,
    *,
    hours_ago: float = 1,
    status_code: int = 200,
    ip: str = "10.0.0.1",
    endpoint: str = "/organization/info",
    flagged: bool = False,
    response_time_ms: int | None = 100,
) -> None:
    db.add(
        PublicPortalAccessLog(
            organization_id=org_id,
            config_id=config_id,
            api_key_id=None,
            ip_address=ip,
            endpoint=endpoint,
            method="GET",
            status_code=status_code,
            response_time_ms=response_time_ms,
            timestamp=NOW - timedelta(hours=hours_ago),
            flagged_suspicious=flagged,
        )
    )
    await db.flush()


async def _stats(db: AsyncSession, org_id: str):
    return await get_usage_stats(
        current_user=SimpleNamespace(organization_id=org_id), db=db
    )


class TestTheRollingWindows:
    """The three Request Volume tiles, which read 0 for every department."""

    async def test_each_window_counts_only_what_falls_inside_it(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)

        await _log(db_session, org_id, config_id, hours_ago=1)
        await _log(db_session, org_id, config_id, hours_ago=5)
        await _log(db_session, org_id, config_id, hours_ago=30)  # 7d, not 24h
        await _log(db_session, org_id, config_id, hours_ago=24 * 8)  # 30d only
        await _log(db_session, org_id, config_id, hours_ago=24 * 40)  # all-time

        stats = await _stats(db_session, org_id)

        assert stats.total_requests_24h == 2
        assert stats.total_requests_7d == 3
        assert stats.total_requests_30d == 4
        assert stats.total_requests == 5

    async def test_windows_roll_rather_than_reset_at_midnight(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """A request 20 hours ago is in the last 24h whatever the clock says.

        The endpoint already computed `requests_today` from midnight; the
        dashboard's tile says "Last 24 Hours", which is a different question
        and the one an operator asking "what happened overnight" means.
        """
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)
        await _log(db_session, org_id, config_id, hours_ago=20)

        stats = await _stats(db_session, org_id)

        assert stats.total_requests_24h == 1

    async def test_another_organizations_traffic_is_not_counted(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO organizations "
                "(id, name, organization_type, slug, timezone) "
                "VALUES (:id, 'Other', 'fire_department', :slug, 'UTC')"
            ),
            {"id": other, "slug": f"other-{other[:8]}"},
        )
        other_config = await _make_config(db_session, other)
        await _log(db_session, other, other_config, hours_ago=1)

        stats = await _stats(db_session, org_id)

        assert stats.total_requests == 0
        assert stats.total_requests_24h == 0


class TestTheAlertCanFire:
    """The three conditions behind "Attention Required", one test each."""

    async def test_error_rate_counts_4xx_and_5xx_over_24h(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)
        for _ in range(8):
            await _log(db_session, org_id, config_id, status_code=200)
        await _log(db_session, org_id, config_id, status_code=404)
        await _log(db_session, org_id, config_id, status_code=500)
        # Outside the window, so it must not move the rate.
        await _log(db_session, org_id, config_id, status_code=500, hours_ago=48)

        stats = await _stats(db_session, org_id)

        assert stats.status_2xx_24h == 8
        assert stats.status_4xx_24h == 1
        assert stats.status_5xx_24h == 1
        assert stats.error_rate_percentage == pytest.approx(20.0)
        # Above the banner's threshold, which is the whole point.
        assert stats.error_rate_percentage > 5

    async def test_no_traffic_reports_unmeasurable_rather_than_zero(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """A denominator of nothing is not a clean bill of health.

        0.00% in green is indistinguishable from a quiet, healthy day; the
        screen renders the null as "—" instead (CLAUDE.md #29).
        """
        org_id, _ = setup_org_and_admin
        await _make_config(db_session, org_id)

        stats = await _stats(db_session, org_id)

        assert stats.error_rate_percentage is None

    async def test_suspicious_requests_are_counted_within_24h(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)
        for _ in range(3):
            await _log(db_session, org_id, config_id, flagged=True)
        await _log(db_session, org_id, config_id, flagged=True, hours_ago=48)

        stats = await _stats(db_session, org_id)

        assert stats.flagged_suspicious_24h == 3
        assert stats.flagged_requests == 4

    async def test_rate_limit_refusals_are_counted_within_24h(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)
        await _log(db_session, org_id, config_id, status_code=429)
        await _log(db_session, org_id, config_id, status_code=429)
        await _log(db_session, org_id, config_id, status_code=429, hours_ago=48)

        stats = await _stats(db_session, org_id)

        assert stats.rate_limit_hits_24h == 2
        # A 429 is a client error, so it is in the 4xx tally too.
        assert stats.status_4xx_24h == 2


class TestTheOtherKeyMetrics:
    async def test_unique_ips_are_distinct_per_window(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)
        await _log(db_session, org_id, config_id, ip="10.0.0.1")
        await _log(db_session, org_id, config_id, ip="10.0.0.1")
        await _log(db_session, org_id, config_id, ip="10.0.0.2")
        await _log(db_session, org_id, config_id, ip="10.0.0.9", hours_ago=48)

        stats = await _stats(db_session, org_id)

        assert stats.unique_ips_24h == 2
        assert stats.unique_ips == 3

    async def test_active_api_keys_excludes_disabled_and_expired(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)
        for name, is_active, expires in (
            ("live", True, None),
            ("live-until-next-year", True, NOW + timedelta(days=365)),
            ("revoked", False, None),
            ("expired", True, NOW - timedelta(days=1)),
        ):
            db_session.add(
                PublicPortalAPIKey(
                    organization_id=org_id,
                    config_id=config_id,
                    key_hash=f"hash-{name}-{uuid.uuid4()}",
                    key_prefix="logbook_",
                    name=name,
                    is_active=is_active,
                    expires_at=expires,
                )
            )
        await db_session.flush()

        stats = await _stats(db_session, org_id)

        assert stats.active_api_keys == 2

    async def test_top_endpoints_is_ranked_and_capped(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)
        for _ in range(3):
            await _log(db_session, org_id, config_id, endpoint="/events/public")
        await _log(db_session, org_id, config_id, endpoint="/organization/info")

        stats = await _stats(db_session, org_id)

        assert stats.top_endpoints[0] == {"endpoint": "/events/public", "count": 3}
        assert len(stats.top_endpoints) == 2

    async def test_average_response_time_ignores_rows_without_one(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)
        await _log(db_session, org_id, config_id, response_time_ms=100)
        await _log(db_session, org_id, config_id, response_time_ms=300)
        await _log(db_session, org_id, config_id, response_time_ms=None)

        stats = await _stats(db_session, org_id)

        assert stats.average_response_time_ms == pytest.approx(200.0)


class TestTheRefusalIsRecorded:
    """Without this, `rate_limit_hits_24h` is a tile that cannot leave zero.

    The 429 comes out of `authenticate_api_key`, a dependency; the handler
    bodies that call `log_access` never run when a dependency raises. This is
    the attributable half of PUB-8's flagged 401 problem — a rate-limited key
    has just been resolved, so `organization_id` and `config_id` are in hand
    and no nullability migration is needed.
    """

    async def test_a_rate_limited_request_writes_a_429_row(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)

        raw_key, prefix = generate_api_key()
        api_key = PublicPortalAPIKey(
            organization_id=org_id,
            config_id=config_id,
            key_hash=hash_api_key(raw_key),
            key_prefix=prefix,
            name="exhausted",
            is_active=True,
            rate_limit_override=1,
        )
        db_session.add(api_key)
        await db_session.flush()

        request = MagicMock()
        request.client.host = "203.0.113.7"
        request.url.path = "/organization/info"
        request.method = "GET"
        request.headers.get.return_value = None

        # Spend the key's single hourly request, so the next one is refused.
        from app.core.public_portal_security import get_current_hour_timestamp

        bucket = await get_current_hour_timestamp()
        key_id = str(api_key.id)
        rate_limit_cache[key_id][bucket] = 1
        try:
            with pytest.raises(HTTPException) as refused:
                await authenticate_api_key(request, api_key=raw_key, db=db_session)
        finally:
            rate_limit_cache.pop(key_id, None)

        assert refused.value.status_code == 429

        stats = await _stats(db_session, org_id)
        assert stats.rate_limit_hits_24h == 1

    async def test_the_row_survives_the_rollback_the_raise_causes(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """PUB-8's mechanism, from the other end.

        `log_access` only flushes, and `get_db` rolls the request transaction
        back whenever the handler or a dependency raises — so a flushed-only
        row is discarded exactly when it matters. `_log_refusal` commits for
        that reason, and this asserts the row is still there after a rollback
        stands in for the request teardown.
        """
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)

        raw_key, prefix = generate_api_key()
        api_key = PublicPortalAPIKey(
            organization_id=org_id,
            config_id=config_id,
            key_hash=hash_api_key(raw_key),
            key_prefix=prefix,
            name="exhausted",
            is_active=True,
            rate_limit_override=1,
        )
        db_session.add(api_key)
        await db_session.commit()

        request = MagicMock()
        request.client.host = "203.0.113.8"
        request.url.path = "/organization/info"
        request.method = "GET"
        request.headers.get.return_value = None

        from app.core.public_portal_security import get_current_hour_timestamp

        bucket = await get_current_hour_timestamp()
        key_id = str(api_key.id)
        rate_limit_cache[key_id][bucket] = 1
        try:
            with pytest.raises(HTTPException):
                await authenticate_api_key(request, api_key=raw_key, db=db_session)
        finally:
            rate_limit_cache.pop(key_id, None)

        await db_session.rollback()

        stats = await _stats(db_session, org_id)
        assert stats.rate_limit_hits_24h == 1
