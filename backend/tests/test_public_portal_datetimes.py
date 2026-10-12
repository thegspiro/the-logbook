"""Public portal DateTime columns hold datetimes, not ISO strings.

Migration ``20260805_0004`` turned ``expires_at``, ``last_used_at``,
``created_at`` and ``updated_at`` on the portal tables from ``String(26)`` into
``DateTime(timezone=True)``; the code reading and writing them was not
updated. Two defects followed, both exercised here against the real database
because the bug lives in the round trip — what goes into the column and what
comes back out of it after a refresh or in the next request's session:

- ``POST /public-portal/api-keys`` committed the key, refreshed it, and then
  passed the refreshed ``created_at`` — a ``datetime`` — to
  ``datetime.fromisoformat``. The TypeError became a 500 after the key row was
  already committed, so the admin never saw the plaintext key, and an
  orphaned, unusable key was left behind for every attempt.
- ``_last_used_is_stale`` parsed the stored ``last_used_at`` with
  ``datetime.fromisoformat``, swallowed the TypeError a datetime raises, and
  answered "stale" — so the PP-7 write throttle never throttled, and every
  authenticated public request wrote and committed the key row.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.public_portal_admin import create_api_key, update_api_key
from app.core.public_portal_security import (
    _LAST_USED_THROTTLE_SECONDS,
    authenticate_api_key,
    generate_api_key,
    hash_api_key,
    rate_limit_cache,
)
from app.models.public_portal import PublicPortalAPIKey, PublicPortalConfig
from app.schemas.public_portal import (
    PublicPortalAPIKeyCreate,
    PublicPortalAPIKeyCreatedResponse,
    PublicPortalAPIKeyUpdate,
)

pytestmark = [pytest.mark.integration]


def _as_utc(value: datetime) -> datetime:
    """MySQL hands DATETIME back naive; the codebase reads naive as UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


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


def _admin(org_id: str, admin_id: str) -> SimpleNamespace:
    return SimpleNamespace(organization_id=org_id, id=admin_id)


class TestCreateApiKey:
    async def test_create_returns_the_key_and_its_timestamps(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _make_config(db_session, org_id)
        # A non-UTC offset: the stored instant must be the same moment in UTC.
        expires = datetime(2030, 1, 2, 3, 4, 5, tzinfo=timezone(timedelta(hours=-5)))

        created = await create_api_key(
            key_data=PublicPortalAPIKeyCreate(name="website", expires_at=expires),
            current_user=_admin(org_id, admin_id),
            db=db_session,
        )

        assert isinstance(created, PublicPortalAPIKeyCreatedResponse)
        assert created.api_key.startswith(created.key_prefix)
        assert created.name == "website"
        assert created.is_active is True
        assert created.expires_at == expires
        assert isinstance(created.created_at, datetime)
        assert created.created_at.tzinfo is not None

        # The wire shape is unchanged: ISO-8601 strings with a UTC offset.
        body = created.model_dump(mode="json")
        assert set(body) == {
            "id",
            "api_key",
            "key_prefix",
            "name",
            "rate_limit_override",
            "expires_at",
            "is_active",
            "created_at",
        }
        assert body["expires_at"] == "2030-01-02T08:04:05Z"
        assert datetime.fromisoformat(body["created_at"]).tzinfo is not None

        stored = await db_session.scalar(
            select(PublicPortalAPIKey.expires_at).where(
                PublicPortalAPIKey.id == str(created.id)
            )
        )
        assert _as_utc(stored) == expires

    async def test_create_without_expiry(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _make_config(db_session, org_id)

        created = await create_api_key(
            key_data=PublicPortalAPIKeyCreate(name="kiosk"),
            current_user=_admin(org_id, admin_id),
            db=db_session,
        )

        assert created.expires_at is None
        assert isinstance(created.created_at, datetime)

    async def test_update_stores_expiry_as_the_same_instant(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _make_config(db_session, org_id)
        created = await create_api_key(
            key_data=PublicPortalAPIKeyCreate(name="website"),
            current_user=_admin(org_id, admin_id),
            db=db_session,
        )
        expires = datetime(2031, 6, 1, 12, 0, tzinfo=timezone(timedelta(hours=2)))

        await update_api_key(
            key_id=str(created.id),
            key_update=PublicPortalAPIKeyUpdate(expires_at=expires),
            current_user=_admin(org_id, admin_id),
            db=db_session,
        )

        db_session.expire_all()
        stored = await db_session.scalar(
            select(PublicPortalAPIKey.expires_at).where(
                PublicPortalAPIKey.id == str(created.id)
            )
        )
        assert isinstance(stored, datetime)
        assert _as_utc(stored) == expires


class TestKeyWithoutRateLimitOverride:
    async def test_authenticates_in_a_fresh_session(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """The default limit comes from the key's config relationship.

        A lazy load of it from an AsyncSession raises MissingGreenlet, so
        every key created without an override answered 500 on every request.
        A fresh session is what a real request has: nothing in its identity
        map to satisfy the load.
        """
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)
        raw_key, prefix = generate_api_key()
        api_key = PublicPortalAPIKey(
            organization_id=org_id,
            config_id=config_id,
            key_hash=hash_api_key(raw_key),
            key_prefix=prefix,
            name="defaults",
            is_active=True,
        )
        db_session.add(api_key)
        await db_session.commit()

        request = MagicMock()
        request.client.host = "203.0.113.21"
        request.headers.get.return_value = None

        fresh = AsyncSession(
            bind=db_session.bind,
            join_transaction_mode="create_savepoint",
            # As get_db's sessionmaker configures it.
            expire_on_commit=False,
        )
        try:
            resolved = await authenticate_api_key(request, api_key=raw_key, db=fresh)
            assert resolved.effective_rate_limit == 1000
        finally:
            rate_limit_cache.pop(str(api_key.id), None)
            await fresh.close()


class TestLastUsedThrottleAgainstTheDatabase:
    """PP-7: at most one ``last_used_at`` write per key per throttle window."""

    async def test_second_request_in_window_does_not_write(
        self, db_session: AsyncSession, setup_org_and_admin, monkeypatch
    ):
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)
        raw_key, prefix = generate_api_key()
        api_key = PublicPortalAPIKey(
            organization_id=org_id,
            config_id=config_id,
            key_hash=hash_api_key(raw_key),
            key_prefix=prefix,
            name="busy",
            is_active=True,
        )
        db_session.add(api_key)
        await db_session.commit()
        key_id = str(api_key.id)

        commits = 0
        real_commit = db_session.commit

        async def counting_commit():
            nonlocal commits
            commits += 1
            await real_commit()

        monkeypatch.setattr(db_session, "commit", counting_commit)

        request = MagicMock()
        request.client.host = "203.0.113.20"
        request.headers.get.return_value = None

        async def one_request() -> None:
            # Each real request gets its own session, so the key comes back
            # from the database rather than from an identity map still holding
            # whatever Python value the previous request assigned.
            db_session.expire_all()
            await authenticate_api_key(request, api_key=raw_key, db=db_session)

        async def stored_last_used() -> datetime:
            db_session.expire_all()
            value = await db_session.scalar(
                select(PublicPortalAPIKey.last_used_at).where(
                    PublicPortalAPIKey.id == key_id
                )
            )
            assert isinstance(value, datetime)
            return value

        try:
            await one_request()
            assert commits == 1
            first = await stored_last_used()
            assert abs(_as_utc(first) - datetime.now(timezone.utc)) < timedelta(
                seconds=30
            )

            await one_request()
            assert commits == 1, "a request inside the window wrote last_used_at"
            assert await stored_last_used() == first

            # Age the stored value past the window: the next request refreshes.
            aged = first - timedelta(seconds=_LAST_USED_THROTTLE_SECONDS + 5)
            await db_session.execute(
                update(PublicPortalAPIKey)
                .where(PublicPortalAPIKey.id == key_id)
                .values(last_used_at=aged)
            )
            await one_request()
            assert commits == 2
            assert await stored_last_used() > aged
        finally:
            rate_limit_cache.pop(key_id, None)
