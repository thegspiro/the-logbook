"""Service keys: minting, rotation, revocation and authentication.

Runs against the real database (``db_session``): the authentication path
joins the key to the organization's integration row, and that join is the
switch the whole feature hangs on.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.core.permissions import get_all_permissions
from app.mcp.constants import KEY_PREFIX, MCP_INTEGRATION_TYPE
from app.mcp.keys import (
    McpAuthError,
    McpKeyService,
    generate_key,
    hash_key,
    looks_like_key,
    parse_config,
)
from app.models.integration import Integration

# Every test here needs the database: CI's unit job runs without one and
# deselects this marker; the integration job selects it.
pytestmark = [pytest.mark.integration]


async def _integration(db, org_id, *, enabled=True, status="connected", config=None):
    row = Integration(
        organization_id=org_id,
        integration_type=MCP_INTEGRATION_TYPE,
        name="Claude (MCP)",
        category="AI Assistants",
        status=status,
        config=config or {},
        enabled=enabled,
    )
    db.add(row)
    await db.flush()
    return row


class TestKeyMaterial:
    def test_generate_key_has_prefix_and_display_prefix(self):
        plaintext, prefix = generate_key()
        assert plaintext.startswith(KEY_PREFIX)
        assert plaintext.startswith(prefix)
        assert len(prefix) == 20
        assert looks_like_key(plaintext)

    def test_two_keys_differ(self):
        assert generate_key()[0] != generate_key()[0]

    def test_hash_is_sha256_hex(self):
        digest = hash_key("logbook_mcp_abc")
        assert len(digest) == 64
        assert digest == hash_key("logbook_mcp_abc")

    @pytest.mark.parametrize(
        "bad",
        ["", "logbook_abc", KEY_PREFIX, KEY_PREFIX + "short", KEY_PREFIX + "x" * 100],
    )
    def test_rejects_junk_before_the_database(self, bad):
        assert not looks_like_key(bad)

    def test_parse_config_degrades_to_defaults(self):
        assert parse_config(None).access_mode == "read_only"
        assert parse_config({"access_mode": "nonsense"}).access_mode == "read_only"
        assert parse_config({"unknown": 1}).expose_finance is False
        cfg = parse_config({"access_mode": "read_write", "expose_finance": True})
        assert cfg.access_mode == "read_write"
        assert cfg.expose_finance is True


class TestPermission:
    def test_mcp_keys_permission_is_registered(self):
        assert "integrations.mcp_keys" in get_all_permissions()


class TestMintAndRevoke:
    async def test_mint_returns_plaintext_once_and_stores_only_the_hash(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _integration(db_session, org_id)
        svc = McpKeyService(db_session)
        minted = await svc.mint(
            org_id, name="Claude Code", expires_in_days=90, created_by=admin_id
        )
        assert minted.plaintext.startswith(KEY_PREFIX)
        assert minted.key.key_hash == hash_key(minted.plaintext)
        assert minted.plaintext not in (minted.key.key_hash, minted.key.key_prefix)
        assert minted.key.expires_at is not None
        assert minted.revoked == []

    async def test_lifetime_key_has_no_expiry(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        await _integration(db_session, org_id)
        minted = await McpKeyService(db_session).mint(
            org_id, name="Forever", expires_in_days=None, created_by=admin_id
        )
        assert minted.key.expires_at is None

    async def test_minting_again_revokes_the_previous_key(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _integration(db_session, org_id)
        svc = McpKeyService(db_session)
        first = await svc.mint(
            org_id, name="one", expires_in_days=None, created_by=admin_id
        )
        second = await svc.mint(
            org_id, name="two", expires_in_days=None, created_by=admin_id
        )
        assert [k.id for k in second.revoked] == [first.key.id]
        active = await svc.active_keys(org_id)
        assert [k.id for k in active] == [second.key.id]

    async def test_bad_expiry_and_blank_name_refuse(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = McpKeyService(db_session)
        with pytest.raises(ValueError, match="needs a name"):
            await svc.mint(org_id, name="  ", expires_in_days=None, created_by=admin_id)
        with pytest.raises(ValueError, match="Expiry must be"):
            await svc.mint(org_id, name="x", expires_in_days=0, created_by=admin_id)

    async def test_revoke_is_org_scoped_and_idempotent(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _integration(db_session, org_id)
        svc = McpKeyService(db_session)
        minted = await svc.mint(
            org_id, name="k", expires_in_days=None, created_by=admin_id
        )
        assert (
            await svc.revoke(str(uuid.uuid4()), minted.key.id, revoked_by=admin_id)
            is None
        )
        revoked = await svc.revoke(org_id, minted.key.id, revoked_by=admin_id)
        assert revoked is not None
        assert revoked.revoked_at is not None
        first_stamp = revoked.revoked_at
        again = await svc.revoke(org_id, minted.key.id, revoked_by=admin_id)
        assert again is not None
        assert again.revoked_at == first_stamp


class TestAuthenticate:
    async def test_valid_key_yields_principal_with_config(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _integration(
            db_session,
            org_id,
            config={"access_mode": "read_write", "expose_finance": True},
        )
        svc = McpKeyService(db_session)
        minted = await svc.mint(
            org_id, name="k", expires_in_days=30, created_by=admin_id
        )
        principal = await svc.authenticate(minted.plaintext, client_ip="10.0.0.1")
        assert principal.organization_id == org_id
        assert principal.key_id == minted.key.id
        assert principal.issued_by_user_id == admin_id
        assert principal.can_write is True
        assert principal.expose_finance is True
        assert principal.expose_medical_screening is False
        assert principal.client_ip == "10.0.0.1"
        assert minted.key.last_used_at is not None

    async def test_unknown_key_is_401(self, db_session, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        await _integration(db_session, org_id)
        with pytest.raises(McpAuthError) as excinfo:
            await McpKeyService(db_session).authenticate(generate_key()[0])
        assert excinfo.value.status == 401

    async def test_revoked_and_expired_keys_refuse(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _integration(db_session, org_id)
        svc = McpKeyService(db_session)
        minted = await svc.mint(
            org_id, name="k", expires_in_days=None, created_by=admin_id
        )
        await svc.revoke(org_id, minted.key.id, revoked_by=admin_id)
        with pytest.raises(McpAuthError, match="revoked"):
            await svc.authenticate(minted.plaintext)

        fresh = await svc.mint(
            org_id, name="k2", expires_in_days=5, created_by=admin_id
        )
        fresh.key.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        await db_session.flush()
        with pytest.raises(McpAuthError, match="expired"):
            await svc.authenticate(fresh.plaintext)

    @pytest.mark.parametrize(
        ("enabled", "status"),
        [(False, "connected"), (True, "available"), (True, "error")],
    )
    async def test_integration_off_is_403_even_with_a_good_key(
        self, db_session, setup_org_and_admin, enabled, status
    ):
        """Disconnecting leaves the row with enabled=False/status=available;
        both halves have to say on, or a key issued earlier keeps working
        after the department turned the feature off."""
        org_id, admin_id = setup_org_and_admin
        row = await _integration(db_session, org_id)
        svc = McpKeyService(db_session)
        minted = await svc.mint(
            org_id, name="k", expires_in_days=None, created_by=admin_id
        )
        row.enabled = enabled
        row.status = status
        await db_session.flush()
        with pytest.raises(McpAuthError) as excinfo:
            await svc.authenticate(minted.plaintext)
        assert excinfo.value.status == 403

    async def test_principal_carries_the_enabled_modules(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _integration(db_session, org_id)
        svc = McpKeyService(db_session)
        minted = await svc.mint(
            org_id, name="k", expires_in_days=None, created_by=admin_id
        )
        principal = await svc.authenticate(minted.plaintext)
        assert principal.enabled_modules is not None
        assert {"members", "events", "integrations"} <= principal.enabled_modules
        assert principal.module_enabled("members")

    async def test_integrations_module_off_is_403(
        self, db_session, setup_org_and_admin
    ):
        """Switching the Integrations module off must switch this off too,
        the way the integrations routers answer 403 — a key issued earlier
        does not outlive the department's decision."""
        from uuid import UUID

        from app.services.organization_service import OrganizationService

        org_id, admin_id = setup_org_and_admin
        await _integration(db_session, org_id)
        svc = McpKeyService(db_session)
        minted = await svc.mint(
            org_id, name="k", expires_in_days=None, created_by=admin_id
        )
        await OrganizationService(db_session).update_module_settings(
            UUID(org_id), {"integrations": False}
        )
        with pytest.raises(McpAuthError) as excinfo:
            await svc.authenticate(minted.plaintext)
        assert excinfo.value.status == 403
        assert "Integrations module" in str(excinfo.value)

    async def test_inactive_organization_is_403(self, db_session, setup_org_and_admin):
        """A deactivated department is refused the way its members are at
        sign-in: a lifetime key must not outlive the tenant."""
        from sqlalchemy import text

        org_id, admin_id = setup_org_and_admin
        await _integration(db_session, org_id)
        svc = McpKeyService(db_session)
        minted = await svc.mint(
            org_id, name="k", expires_in_days=None, created_by=admin_id
        )
        assert (await svc.authenticate(minted.plaintext)).organization_id == org_id
        await db_session.execute(
            text("UPDATE organizations SET active = 0 WHERE id = :id"), {"id": org_id}
        )
        await db_session.flush()
        with pytest.raises(McpAuthError) as excinfo:
            await svc.authenticate(minted.plaintext)
        assert excinfo.value.status == 403
        assert "not active" in str(excinfo.value)

    async def test_missing_integration_row_is_403(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        row = await _integration(db_session, org_id)
        svc = McpKeyService(db_session)
        minted = await svc.mint(
            org_id, name="k", expires_in_days=None, created_by=admin_id
        )
        await db_session.delete(row)
        await db_session.flush()
        with pytest.raises(McpAuthError) as excinfo:
            await svc.authenticate(minted.plaintext)
        assert excinfo.value.status == 403

    async def test_cascade_on_organization_delete(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _integration(db_session, org_id)
        svc = McpKeyService(db_session)
        minted = await svc.mint(
            org_id, name="k", expires_in_days=None, created_by=admin_id
        )
        await db_session.execute(
            text("DELETE FROM users WHERE id = :id"), {"id": admin_id}
        )
        await db_session.flush()
        await db_session.refresh(minted.key)
        assert minted.key.created_by is None


class TestActiveMeansUsable:
    async def test_an_expired_key_is_not_active(self, db_session, setup_org_and_admin):
        """What /status shows as the current key must be a key the endpoint
        would accept; an expired one is refused, so it is not active."""
        org_id, admin_id = setup_org_and_admin
        await _integration(db_session, org_id)
        svc = McpKeyService(db_session)
        minted = await svc.mint(
            org_id, name="k", expires_in_days=5, created_by=admin_id
        )
        assert minted.key.is_active is True
        minted.key.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        await db_session.flush()
        assert minted.key.is_active is False
        assert await svc.active_keys(org_id) == []

    async def test_rotation_retires_an_expired_key_too(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _integration(db_session, org_id)
        svc = McpKeyService(db_session)
        stale = await svc.mint(
            org_id, name="old", expires_in_days=5, created_by=admin_id
        )
        stale.key.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        await db_session.flush()
        fresh = await svc.mint(
            org_id, name="new", expires_in_days=None, created_by=admin_id
        )
        assert [k.id for k in fresh.revoked] == [stale.key.id]

    def test_rotation_locks_the_integration_row_and_reads_keys_for_update(self):
        """Two administrators issuing at once must not both keep a live key
        (CLAUDE.md pitfall 27): the decision is serialized on the org's
        integration row, and the read of the keys to retire is a locking
        read so it sees the other transaction's commit."""
        import inspect

        source = inspect.getsource(McpKeyService.mint)
        assert "await self._lock_integration(organization_id)" in source
        assert "_unrevoked_keys(organization_id, for_update=True)" in source
        lock = inspect.getsource(McpKeyService._lock_integration)
        assert "Integration.integration_type == MCP_INTEGRATION_TYPE" in lock
        assert ".with_for_update()" in lock
        helper = inspect.getsource(McpKeyService._unrevoked_keys)
        assert "query.with_for_update()" in helper
        # A disconnect contends on the same row, so a rotation in flight
        # either finishes first or refuses on the disconnected row.
        assert "await self._lock_integration(organization_id)" in inspect.getsource(
            McpKeyService.revoke_all
        )

    async def test_mint_refuses_on_a_row_that_is_no_longer_connected(
        self, db_session, setup_org_and_admin
    ):
        """The endpoint's check reads a snapshot; the service re-reads the
        row under lock, and a disconnect that landed in between wins."""
        from sqlalchemy import update

        from app.mcp.keys import IntegrationNotConnected
        from app.models.integration import Integration

        org_id, admin_id = setup_org_and_admin
        await _integration(db_session, org_id)
        service = McpKeyService(db_session)
        await service.mint(
            org_id, name="first", expires_in_days=30, created_by=admin_id
        )
        await db_session.execute(
            update(Integration)
            .where(
                Integration.organization_id == org_id,
                Integration.integration_type == MCP_INTEGRATION_TYPE,
            )
            .values(status="available", enabled=False)
        )
        with pytest.raises(IntegrationNotConnected):
            await service.mint(
                org_id, name="second", expires_in_days=30, created_by=admin_id
            )
