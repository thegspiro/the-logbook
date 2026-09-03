"""The key-management endpoints under /integrations/claude-mcp.

Handlers are called directly with the real test session, the way the
Cal.com endpoint tests do, so the permission dependency is not exercised
here — ``test_mcp_keys`` covers the registry side of that — but the
integration-must-be-connected rule, the one-time plaintext and the audit
entries are.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from starlette.requests import Request

from app.api.v1.endpoints.mcp_keys import (
    McpKeyCreateRequest,
    create_mcp_key,
    get_mcp_status,
    list_mcp_keys,
    revoke_mcp_key,
)
from app.mcp.constants import MCP_INTEGRATION_TYPE, MCP_MOUNT_PATH
from app.models.audit import AuditLog
from app.models.integration import Integration

# Every test here needs the database: CI's unit job runs without one and
# deselects this marker; the integration job selects it.
pytestmark = [pytest.mark.integration]


def _user(org_id, user_id):
    return SimpleNamespace(organization_id=org_id, id=user_id)


def _request(ip="203.0.113.7"):
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/integrations/claude-mcp/keys",
            "headers": [],
            "client": (ip, 40000),
            "query_string": b"",
        }
    )


async def _connect(db, org_id, config=None):
    row = Integration(
        organization_id=org_id,
        integration_type=MCP_INTEGRATION_TYPE,
        name="Claude (MCP)",
        category="AI Assistants",
        status="connected",
        config=config or {},
        enabled=True,
    )
    db.add(row)
    await db.flush()
    return row


class TestInstants:
    def test_naive_datetimes_are_serialized_as_utc(self):
        from datetime import datetime, timedelta, timezone

        from app.api.v1.endpoints.mcp_keys import _instant

        assert _instant(None) is None
        assert _instant(datetime(2026, 9, 3, 10, 0, 0)) == "2026-09-03T10:00:00+00:00"
        aware = datetime(2026, 9, 3, 6, 0, 0, tzinfo=timezone(timedelta(hours=-4)))
        assert _instant(aware) == "2026-09-03T10:00:00+00:00"


class TestStatus:
    async def test_status_off_before_connecting(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        body = await get_mcp_status(db=db_session, current_user=_user(org_id, admin_id))
        assert body["enabled"] is False
        assert body["active_key"] is None
        assert body["endpoint_path"] == MCP_MOUNT_PATH
        assert body["access_mode"] == "read_only"

    async def test_status_reflects_config_and_active_key(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _connect(
            db_session, org_id, {"access_mode": "read_write", "expose_finance": True}
        )
        user = _user(org_id, admin_id)
        await create_mcp_key(
            McpKeyCreateRequest(name="Claude Code", expires_in_days=30),
            request=None,
            db=db_session,
            current_user=user,
        )
        body = await get_mcp_status(db=db_session, current_user=user)
        assert body["enabled"] is True
        assert body["access_mode"] == "read_write"
        assert body["expose_finance"] is True
        assert body["active_key"]["name"] == "Claude Code"
        assert "plaintext" not in body["active_key"]


class TestCreate:
    async def test_refuses_until_the_integration_is_connected(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        with pytest.raises(HTTPException) as excinfo:
            await create_mcp_key(
                McpKeyCreateRequest(name="k"),
                request=None,
                db=db_session,
                current_user=_user(org_id, admin_id),
            )
        assert excinfo.value.status_code == 409

    async def test_connecting_the_integration_is_attributed_to_the_tenant(
        self, db_session, setup_org_and_admin
    ):
        """The audit endpoints filter on the organization column, so an
        entry stamped only inside event_data never shows in the trail."""
        from sqlalchemy import select

        from app.api.v1.endpoints.integrations import connect_integration
        from app.schemas.integration import IntegrationConnectRequest

        org_id, admin_id = setup_org_and_admin
        row = Integration(
            organization_id=org_id,
            integration_type=MCP_INTEGRATION_TYPE,
            name="Claude (MCP)",
            category="AI Assistants",
            status="available",
            config={},
            enabled=False,
        )
        db_session.add(row)
        await db_session.flush()
        await connect_integration(
            row.id,
            request=_request(),
            body=IntegrationConnectRequest(config={"access_mode": "read_only"}),
            db=db_session,
            current_user=_user(org_id, admin_id),
        )
        entry = (
            await db_session.execute(
                select(AuditLog).where(AuditLog.event_type == "integration.connected")
            )
        ).scalar_one()
        assert entry.organization_id == org_id
        assert entry.user_id == admin_id

    async def test_rotation_rolls_back_when_the_audit_entry_fails(
        self, db_session, setup_org_and_admin
    ):
        """The previous key stays live if the audit write fails: a rotation
        the administrator never received a plaintext for must not happen."""
        from unittest.mock import AsyncMock, patch

        org_id, admin_id = setup_org_and_admin
        await _connect(db_session, org_id)
        user = _user(org_id, admin_id)
        await create_mcp_key(
            McpKeyCreateRequest(name="first"),
            request=None,
            db=db_session,
            current_user=user,
        )
        with (
            patch(
                "app.api.v1.endpoints.mcp_keys.log_audit_event",
                AsyncMock(side_effect=RuntimeError("audit store down")),
            ),
            pytest.raises(RuntimeError, match="audit store down"),
        ):
            await create_mcp_key(
                McpKeyCreateRequest(name="second"),
                request=None,
                db=db_session,
                current_user=user,
            )
        await db_session.rollback()
        listed = await list_mcp_keys(db=db_session, current_user=user)
        assert [(k["name"], k["is_active"]) for k in listed["keys"]] == [
            ("first", True)
        ]

    async def test_revocation_rolls_back_when_the_audit_entry_fails(
        self, db_session, setup_org_and_admin
    ):
        from unittest.mock import AsyncMock, patch

        org_id, admin_id = setup_org_and_admin
        await _connect(db_session, org_id)
        user = _user(org_id, admin_id)
        created = await create_mcp_key(
            McpKeyCreateRequest(name="only"),
            request=None,
            db=db_session,
            current_user=user,
        )
        with (
            patch(
                "app.api.v1.endpoints.mcp_keys.log_audit_event",
                AsyncMock(side_effect=RuntimeError("audit store down")),
            ),
            pytest.raises(RuntimeError, match="audit store down"),
        ):
            await revoke_mcp_key(
                created["key"]["id"], request=None, db=db_session, current_user=user
            )
        await db_session.rollback()
        listed = await list_mcp_keys(db=db_session, current_user=user)
        assert [k["is_active"] for k in listed["keys"]] == [True]

    async def test_rotation_is_refused_when_the_audit_entry_is_not_written(
        self, db_session, setup_org_and_admin
    ):
        """``log_audit_event`` swallows its own failure and returns ``None``;
        a key change must not be acknowledged on that return."""
        from unittest.mock import AsyncMock, patch

        org_id, admin_id = setup_org_and_admin
        await _connect(db_session, org_id)
        user = _user(org_id, admin_id)
        await create_mcp_key(
            McpKeyCreateRequest(name="first"),
            request=None,
            db=db_session,
            current_user=user,
        )
        with (
            patch(
                "app.api.v1.endpoints.mcp_keys.log_audit_event",
                AsyncMock(return_value=None),
            ),
            pytest.raises(HTTPException) as excinfo,
        ):
            await create_mcp_key(
                McpKeyCreateRequest(name="second"),
                request=None,
                db=db_session,
                current_user=user,
            )
        assert excinfo.value.status_code == 503
        assert "audit log is unavailable" in excinfo.value.detail
        listed = await list_mcp_keys(db=db_session, current_user=user)
        assert [(k["name"], k["is_active"]) for k in listed["keys"]] == [
            ("first", True)
        ]

    async def test_revocation_is_refused_when_the_audit_entry_is_not_written(
        self, db_session, setup_org_and_admin
    ):
        from unittest.mock import AsyncMock, patch

        org_id, admin_id = setup_org_and_admin
        await _connect(db_session, org_id)
        user = _user(org_id, admin_id)
        created = await create_mcp_key(
            McpKeyCreateRequest(name="only"),
            request=None,
            db=db_session,
            current_user=user,
        )
        with (
            patch(
                "app.api.v1.endpoints.mcp_keys.log_audit_event",
                AsyncMock(return_value=None),
            ),
            pytest.raises(HTTPException) as excinfo,
        ):
            await revoke_mcp_key(
                created["key"]["id"], request=None, db=db_session, current_user=user
            )
        assert excinfo.value.status_code == 503
        listed = await list_mcp_keys(db=db_session, current_user=user)
        assert [k["is_active"] for k in listed["keys"]] == [True]

    async def test_returns_plaintext_once_and_rotates(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _connect(db_session, org_id)
        user = _user(org_id, admin_id)
        first = await create_mcp_key(
            McpKeyCreateRequest(name="first"),
            request=None,
            db=db_session,
            current_user=user,
        )
        assert first["plaintext"].startswith("logbook_mcp_")
        assert first["key"]["is_active"] is True
        assert first["revoked"] == []

        second = await create_mcp_key(
            McpKeyCreateRequest(name="second", expires_in_days=None),
            request=None,
            db=db_session,
            current_user=user,
        )
        assert [k["id"] for k in second["revoked"]] == [first["key"]["id"]]

        listed = await list_mcp_keys(db=db_session, current_user=user)
        by_id = {k["id"]: k for k in listed["keys"]}
        assert by_id[first["key"]["id"]]["is_active"] is False
        assert by_id[second["key"]["id"]]["is_active"] is True
        assert all("plaintext" not in k and "key_hash" not in k for k in listed["keys"])

        audit = (
            (
                await db_session.execute(
                    select(AuditLog.event_type).where(
                        AuditLog.organization_id == org_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert audit.count("mcp.key_created") == 2

    def test_request_schema_bounds(self):
        with pytest.raises(ValueError, match="name"):
            McpKeyCreateRequest(name="", expires_in_days=None)
        with pytest.raises(ValueError, match="expires_in_days"):
            McpKeyCreateRequest(name="k", expires_in_days=0)
        with pytest.raises(ValueError, match="extra"):
            McpKeyCreateRequest(name="k", expires_in_days=30, extra="no")


class TestRevoke:
    async def test_revoke_then_404_for_other_org(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        await _connect(db_session, org_id)
        user = _user(org_id, admin_id)
        created = await create_mcp_key(
            McpKeyCreateRequest(name="k"),
            request=None,
            db=db_session,
            current_user=user,
        )
        revoked = await revoke_mcp_key(
            created["key"]["id"], request=None, db=db_session, current_user=user
        )
        assert revoked["key"]["is_active"] is False

        other = _user("00000000-0000-0000-0000-000000000000", admin_id)
        with pytest.raises(HTTPException) as excinfo:
            await revoke_mcp_key(
                created["key"]["id"], request=None, db=db_session, current_user=other
            )
        assert excinfo.value.status_code == 404
