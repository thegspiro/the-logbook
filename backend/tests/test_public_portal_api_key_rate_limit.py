"""The rate limit an API key actually runs under, as the admin screen shows it.

The API Keys tab printed ``{key.rate_limit || key.effective_rate_limit}/hour``
and the endpoint served neither name, so every row read "/hour" with no
number. ``rate_limit_override`` alone cannot fill that cell: a key without one
runs at the organization's ``default_rate_limit``, and that resolution already
lives in ``PublicPortalAPIKey.effective_rate_limit`` — the same property
``authenticate_api_key`` enforces. Serving that property means the screen shows
the number the limiter uses, rather than re-deriving it (CLAUDE.md #29).

The property reads ``self.config``. A lazy load is synchronous IO, which an
AsyncSession refuses, so each test expunges the session before calling the
endpoint: a key left in the identity map with its config already attached would
pass without the eager load the endpoints now carry.
"""

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.public_portal_admin import list_api_keys, update_api_key
from app.core.public_portal_security import generate_api_key, hash_api_key
from app.models.public_portal import PublicPortalAPIKey, PublicPortalConfig
from app.schemas.public_portal import (
    PublicPortalAPIKeyResponse,
    PublicPortalAPIKeyUpdate,
)

pytestmark = [pytest.mark.integration]


async def _make_config(db: AsyncSession, org_id: str, default_rate_limit: int) -> str:
    config = PublicPortalConfig(
        organization_id=org_id,
        enabled=True,
        allowed_origins=[],
        default_rate_limit=default_rate_limit,
        cache_ttl_seconds=300,
        settings={},
    )
    db.add(config)
    await db.flush()
    return str(config.id)


async def _make_key(
    db: AsyncSession, org_id: str, config_id: str, name: str, override: int | None
) -> str:
    raw, prefix = generate_api_key()
    key = PublicPortalAPIKey(
        organization_id=org_id,
        config_id=config_id,
        key_hash=hash_api_key(raw),
        key_prefix=prefix,
        name=name,
        rate_limit_override=override,
        is_active=True,
    )
    db.add(key)
    await db.flush()
    return str(key.id)


async def _make_other_org(db: AsyncSession) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Other Dept",
            "otype": "fire_department",
            "slug": f"other-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    return org_id


def _serialize(key: object) -> dict:
    """What FastAPI does with the endpoint's return under ``response_model``."""
    return PublicPortalAPIKeyResponse.model_validate(key).model_dump()


class TestTheListedRateLimit:
    async def test_a_key_without_an_override_reports_the_org_default(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id, default_rate_limit=250)
        await _make_key(db_session, org_id, config_id, "Website", override=None)
        db_session.expunge_all()

        keys = await list_api_keys(
            current_user=SimpleNamespace(organization_id=org_id),
            db=db_session,
            include_inactive=False,
        )

        [row] = [_serialize(k) for k in keys]
        assert row["rate_limit_override"] is None
        assert row["effective_rate_limit"] == 250

    async def test_a_key_with_an_override_reports_the_override(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id, default_rate_limit=250)
        await _make_key(db_session, org_id, config_id, "Kiosk", override=40)
        db_session.expunge_all()

        keys = await list_api_keys(
            current_user=SimpleNamespace(organization_id=org_id),
            db=db_session,
            include_inactive=False,
        )

        [row] = [_serialize(k) for k in keys]
        assert row["rate_limit_override"] == 40
        assert row["effective_rate_limit"] == 40

    async def test_each_org_sees_only_its_keys_at_its_own_default(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other_org = await _make_other_org(db_session)
        mine = await _make_config(db_session, org_id, default_rate_limit=250)
        theirs = await _make_config(db_session, other_org, default_rate_limit=9000)
        mine_key = await _make_key(db_session, org_id, mine, "Mine", override=None)
        await _make_key(db_session, other_org, theirs, "Theirs", override=None)
        db_session.expunge_all()

        keys = await list_api_keys(
            current_user=SimpleNamespace(organization_id=org_id),
            db=db_session,
            include_inactive=False,
        )

        rows = [_serialize(k) for k in keys]
        assert [(str(r["id"]), r["effective_rate_limit"]) for r in rows] == [
            (mine_key, 250)
        ]


class TestTheUpdatedRateLimit:
    """PATCH shares the response schema, so it must load the config too."""

    async def test_patch_returns_the_effective_limit(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id, default_rate_limit=250)
        key_id = await _make_key(db_session, org_id, config_id, "Site", override=None)
        db_session.expunge_all()

        updated = await update_api_key(
            key_id=key_id,
            key_update=PublicPortalAPIKeyUpdate(name="Renamed"),
            current_user=SimpleNamespace(organization_id=org_id),
            db=db_session,
        )

        row = _serialize(updated)
        assert row["name"] == "Renamed"
        assert row["rate_limit_override"] is None
        assert row["effective_rate_limit"] == 250
