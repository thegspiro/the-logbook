"""Saving a connected PayPal integration's Settings.

The Settings form sends only the boxes that were filled in. The Client ID and
Client Secret are both stored encrypted and never sent back to the browser, so
a save that changes only the Webhook ID or the auto-apply switch must leave the
stored pair exactly as it was.

Sandbox and live credentials belong to different PayPal REST apps. A save that
switches the environment must bring that environment's pair: keeping the old
pair under the new environment would make PayPal's webhook verification fail
for every payment. The handlers are called directly against MySQL with a
stand-in user.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
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
            "(:id, :org, :un, 'PayPal', 'Admin', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"paypal-{user_id[:8]}",
            "em": f"paypal-{user_id[:8]}@test.com",
        },
    )
    return SimpleNamespace(
        id=user_id, organization_id=org_id, username=f"paypal-{user_id[:8]}"
    )


async def _connected_paypal(
    db: AsyncSession, org_id: str, admin: SimpleNamespace
) -> Integration:
    row = Integration(
        organization_id=org_id,
        integration_type="paypal",
        name="PayPal",
        category="Payments",
        status="available",
        enabled=False,
        config={},
    )
    db.add(row)
    await db.flush()
    with patch.object(int_ep, "log_audit_event", new=AsyncMock()):
        await int_ep.connect_integration(
            row.id,
            _request(),
            body=IntegrationConnectRequest(
                config={
                    "environment": "sandbox",
                    "client_id": "sb-client-id",
                    "client_secret": "sb-client-secret",
                    "webhook_id": "WH-SANDBOX",
                    "auto_apply_payments": True,
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
    with patch.object(int_ep, "log_audit_event", new=AsyncMock()):
        response: dict = await int_ep.update_integration(
            row.id,
            _request(),
            body=IntegrationUpdateRequest(config=config),
            db=db,
            current_user=admin,
        )
    await db.refresh(row)
    return response


class TestPayPalSettings:
    async def test_a_new_webhook_id_keeps_the_stored_credentials(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_paypal(db_session, org_id, admin)

        await _save_settings(
            db_session,
            row,
            admin,
            {
                "environment": "sandbox",
                "webhook_id": "WH-NEW",
                "auto_apply_payments": False,
            },
        )

        assert row.get_secret("client_id") == "sb-client-id"
        assert row.get_secret("client_secret") == "sb-client-secret"
        assert row.config["webhook_id"] == "WH-NEW"
        assert row.config["auto_apply_payments"] is False
        assert row.status == "connected"

    async def test_switching_environment_without_both_credentials_is_refused(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_paypal(db_session, org_id, admin)

        for partial in ({}, {"client_id": "live-client-id"}):
            with pytest.raises(HTTPException) as exc:
                await _save_settings(
                    db_session, row, admin, {"environment": "live", **partial}
                )
            assert exc.value.status_code == 422
            assert "sandbox and live" in exc.value.detail

        assert row.config["environment"] == "sandbox"
        assert row.get_secret("client_id") == "sb-client-id"
        assert row.get_secret("client_secret") == "sb-client-secret"

    async def test_switching_environment_with_both_credentials_is_saved(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_paypal(db_session, org_id, admin)

        await _save_settings(
            db_session,
            row,
            admin,
            {
                "environment": "live",
                "client_id": "live-client-id",
                "client_secret": "live-client-secret",
            },
        )

        assert row.config["environment"] == "live"
        assert row.get_secret("client_id") == "live-client-id"
        assert row.get_secret("client_secret") == "live-client-secret"

    async def test_reconnecting_in_the_other_environment_needs_both_credentials(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_paypal(db_session, org_id, admin)
        with patch.object(int_ep, "log_audit_event", new=AsyncMock()):
            await int_ep.disconnect_integration(
                row.id, _request(), db=db_session, current_user=admin
            )

            with pytest.raises(HTTPException) as exc:
                await int_ep.connect_integration(
                    row.id,
                    _request(),
                    body=IntegrationConnectRequest(config={"environment": "live"}),
                    db=db_session,
                    current_user=admin,
                )
        assert exc.value.status_code == 422

    async def test_no_credential_reaches_the_response_or_the_public_config(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_paypal(db_session, org_id, admin)

        response = await _save_settings(
            db_session, row, admin, {"webhook_id": "WH-NEW"}
        )

        assert "sb-client-id" not in str(response)
        assert "sb-client-secret" not in str(response)
        assert "client_id" not in (row.config or {})
        assert "client_secret" not in (row.config or {})
