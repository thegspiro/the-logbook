"""Saving a connected Zeffy integration's Settings keeps what was left blank.

The Settings form on a connected Zeffy card sends only the boxes that were
filled in. The API key is required to connect and is never sent back to the
browser, so a save that changes only the signing secret must leave the stored
key exactly as it was, and the reverse. The handler is called directly against
MySQL with a stand-in user.
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
from app.services.integration_services.zeffy_service import (
    api_key_from_integration,
    webhook_secret_from_integration,
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
            "(:id, :org, :un, 'Zeffy', 'Admin', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"zeffy-{user_id[:8]}",
            "em": f"zeffy-{user_id[:8]}@test.com",
        },
    )
    return SimpleNamespace(
        id=user_id, organization_id=org_id, username=f"zeffy-{user_id[:8]}"
    )


async def _connected_zeffy(
    db: AsyncSession, org_id: str, admin: SimpleNamespace
) -> Integration:
    row = Integration(
        organization_id=org_id,
        integration_type="zeffy",
        name="Zeffy",
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
                config={"api_key": "zk_original", "webhook_secret": "whsec_original"}
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


class TestZeffySettings:
    async def test_new_signing_secret_keeps_the_stored_key(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_zeffy(db_session, org_id, admin)

        await _save_settings(db_session, row, admin, {"webhook_secret": "whsec_new"})

        assert api_key_from_integration(row) == "zk_original"
        assert webhook_secret_from_integration(row) == "whsec_new"
        assert row.status == "connected"

    async def test_new_key_keeps_the_stored_signing_secret(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_zeffy(db_session, org_id, admin)

        await _save_settings(db_session, row, admin, {"api_key": "zk_new"})

        assert api_key_from_integration(row) == "zk_new"
        assert webhook_secret_from_integration(row) == "whsec_original"

    async def test_a_save_with_every_box_blank_changes_nothing(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_zeffy(db_session, org_id, admin)

        await _save_settings(db_session, row, admin, {})

        assert api_key_from_integration(row) == "zk_original"
        assert webhook_secret_from_integration(row) == "whsec_original"

    async def test_no_secret_reaches_the_response_or_the_public_config(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connected_zeffy(db_session, org_id, admin)

        response = await _save_settings(
            db_session, row, admin, {"webhook_secret": "whsec_new"}
        )

        assert "whsec_new" not in str(response)
        assert "zk_original" not in str(response)
        assert "webhook_secret" not in (row.config or {})
        assert "api_key" not in (row.config or {})
