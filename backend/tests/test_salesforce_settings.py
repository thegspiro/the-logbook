"""Saving a connected Salesforce integration's Settings.

The Settings form on a connected Salesforce card leaves the instance URL and
environment out of the save (owner decision, 2026-11-16: Settings does not move
the integration to another org), sends the sync settings as shown, and sends a
credential only when one was typed. The API merges the stored config under a
partial save, so the org and every stored credential must survive a save of
the sync settings alone. The handler is called directly against MySQL with a
stand-in user; URL validation is patched so the test does not depend on DNS.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.api.v1.endpoints import integrations as int_ep
from app.models.integration import Integration
from app.schemas.integration import (
    IntegrationConnectRequest,
    IntegrationUpdateRequest,
)
from tests.test_zeffy_sync_service import _org

pytestmark = [pytest.mark.integration]

INSTANCE = "https://oakvillefd.my.salesforce.com"


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "PATCH",
            "path": "/",
            "headers": [],
            "client": ("203.0.113.41", 1234),
            "query_string": b"",
        }
    )


async def _admin(db: AsyncSession, org_id: str) -> SimpleNamespace:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Salesforce', 'Admin', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"salesforce-{user_id[:8]}",
            "em": f"salesforce-{user_id[:8]}@test.com",
        },
    )
    return SimpleNamespace(
        id=user_id, organization_id=org_id, username=f"salesforce-{user_id[:8]}"
    )


def _no_dns():
    return patch.object(
        int_ep, "validate_integration_url", side_effect=lambda url, **_: url
    )


async def _connected_salesforce(
    db: AsyncSession, org_id: str, admin: SimpleNamespace
) -> Integration:
    row = Integration(
        organization_id=org_id,
        integration_type="salesforce",
        name="Salesforce",
        category="CRM",
        status="available",
        enabled=False,
        config={},
    )
    db.add(row)
    await db.flush()
    with patch.object(int_ep, "log_audit_event", new=AsyncMock()), _no_dns():
        await int_ep.connect_integration(
            row.id,
            _request(),
            body=IntegrationConnectRequest(
                config={
                    "instance_url": INSTANCE,
                    "environment": "sandbox",
                    "client_id": "3MVG9original",
                    "client_secret": "secret_original",
                    "refresh_token": "refresh_original",
                    "sync_direction": "both",
                    "match_strategy": "email_lastname",
                    "graceful_fields": False,
                    "auto_sync_enabled": True,
                }
            ),
            db=db,
            current_user=admin,
        )
    await db.refresh(row)
    return row


async def _save_settings(
    db: AsyncSession, row: Integration, admin: SimpleNamespace, config: dict
) -> dict:
    with patch.object(int_ep, "log_audit_event", new=AsyncMock()), _no_dns():
        response: dict = await int_ep.update_integration(
            row.id,
            _request(),
            body=IntegrationUpdateRequest(config=config),
            db=db,
            current_user=admin,
        )
    await db.refresh(row)
    return response


class TestSalesforceSettings:
    async def test_a_sync_settings_save_keeps_the_org_and_credentials(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_salesforce(db_session, org_id, admin)

        await _save_settings(
            db_session,
            row,
            admin,
            {
                "sync_direction": "push",
                "match_strategy": "email_lastname",
                "graceful_fields": False,
                "auto_sync_enabled": False,
            },
        )

        assert row.config["instance_url"] == INSTANCE
        assert row.config["environment"] == "sandbox"
        assert row.config["sync_direction"] == "push"
        assert row.config["auto_sync_enabled"] is False
        assert row.get_secret("client_id") == "3MVG9original"
        assert row.get_secret("client_secret") == "secret_original"
        assert row.get_secret("refresh_token") == "refresh_original"
        assert row.status == "connected"

    async def test_a_new_refresh_token_replaces_only_the_token(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_salesforce(db_session, org_id, admin)

        await _save_settings(db_session, row, admin, {"refresh_token": "refresh_new"})

        assert row.get_secret("refresh_token") == "refresh_new"
        assert row.get_secret("client_secret") == "secret_original"
        assert row.config["instance_url"] == INSTANCE
        assert row.config["sync_direction"] == "both"

    async def test_no_secret_reaches_the_response_or_the_public_config(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_salesforce(db_session, org_id, admin)

        response = await _save_settings(
            db_session, row, admin, {"client_secret": "secret_new"}
        )

        for value in ("secret_new", "secret_original", "refresh_original"):
            assert value not in str(response)
        for key in ("client_id", "client_secret", "refresh_token"):
            assert key not in (row.config or {})
