"""Saving a connected Documenso integration's Settings.

The Settings form on a connected Documenso card sends the base URL as shown
and only the secret boxes that were filled in. The API token is required to
connect and is never sent back to the browser, so a save that changes only the
webhook secret must keep the stored token. The token belongs to the host it
was entered for, so a save that moves the base URL without a token is refused
and changes nothing. The handler is called directly against MySQL with a stand-in user;
URL validation is patched so the test does not depend on DNS.
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

SELF_HOSTED = "https://sign.oakvillefd.org/api/v1"
CLOUD = "https://app.documenso.com/api/v1"


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
            "(:id, :org, :un, 'Documenso', 'Admin', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"documenso-{user_id[:8]}",
            "em": f"documenso-{user_id[:8]}@test.com",
        },
    )
    return SimpleNamespace(
        id=user_id, organization_id=org_id, username=f"documenso-{user_id[:8]}"
    )


def _no_dns():
    return patch.object(
        int_ep, "validate_integration_url", side_effect=lambda url, **_: url
    )


async def _connected_documenso(
    db: AsyncSession, org_id: str, admin: SimpleNamespace
) -> Integration:
    row = Integration(
        organization_id=org_id,
        integration_type="documenso",
        name="Documenso",
        category="Documents",
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
                    "api_base_url": SELF_HOSTED,
                    "api_token": "api_original",
                    "webhook_secret": "secret_original",
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


class TestDocumensoSettings:
    async def test_new_webhook_secret_keeps_the_stored_token_and_url(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_documenso(db_session, org_id, admin)

        await _save_settings(
            db_session,
            row,
            admin,
            {"api_base_url": SELF_HOSTED, "webhook_secret": "secret_new"},
        )

        assert row.get_secret("api_token") == "api_original"
        assert row.get_secret("webhook_secret") == "secret_new"
        assert row.config["api_base_url"] == SELF_HOSTED
        assert row.status == "connected"

    async def test_moving_the_base_url_without_a_token_is_refused(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_documenso(db_session, org_id, admin)

        with pytest.raises(HTTPException) as exc_info:
            await _save_settings(db_session, row, admin, {"api_base_url": CLOUD})

        assert exc_info.value.status_code == 422
        assert row.config["api_base_url"] == SELF_HOSTED
        assert row.get_secret("api_token") == "api_original"

    async def test_moving_the_base_url_with_a_new_token_is_saved(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_documenso(db_session, org_id, admin)

        await _save_settings(
            db_session, row, admin, {"api_base_url": CLOUD, "api_token": "api_cloud"}
        )

        assert row.config["api_base_url"] == CLOUD
        assert row.get_secret("api_token") == "api_cloud"
        assert row.get_secret("webhook_secret") == "secret_original"

    async def test_no_secret_reaches_the_response_or_the_public_config(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_documenso(db_session, org_id, admin)

        response = await _save_settings(
            db_session, row, admin, {"webhook_secret": "secret_new"}
        )

        assert "secret_new" not in str(response)
        assert "api_original" not in str(response)
        assert "api_token" not in (row.config or {})
        assert "webhook_secret" not in (row.config or {})
