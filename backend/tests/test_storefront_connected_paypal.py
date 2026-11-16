"""The store's PayPal button using the connected PayPal integration's account.

The PayPal.Me link and email are entered on the PayPal integration. A store
set to use the connected account sends members there; when the integration is
disconnected, or has neither, the store's own link and email are the fallback.
The handlers and service are called directly against MySQL with stand-in users.
"""

import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.api.v1.endpoints import integrations as int_ep
from app.api.v1.endpoints import storefront as store_ep
from app.models.integration import Integration
from app.schemas.integration import IntegrationConnectRequest
from app.services.storefront_service import StorefrontService
from tests.test_zeffy_sync_service import _org

pytestmark = [pytest.mark.integration]

LINK = "https://paypal.me/oakvillefd"
EMAIL = "treasurer@oakvillefd.org"


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
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
            "(:id, :org, :un, 'Store', 'Admin', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"store-{user_id[:8]}",
            "em": f"store-{user_id[:8]}@test.com",
        },
    )
    return SimpleNamespace(
        id=user_id, organization_id=org_id, username=f"store-{user_id[:8]}"
    )


async def _connect_paypal(
    db: AsyncSession, org_id: str, admin: SimpleNamespace, **extra
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
                    **extra,
                }
            ),
            db=db,
            current_user=admin,
        )
    await db.refresh(row)
    return row


async def _store(
    db: AsyncSession, org_id: str, *, use_connected: bool
) -> StorefrontService:
    service = StorefrontService(db)
    await service.update_settings(
        org_id,
        {
            "accepted_payment_methods": ["paypal"],
            "paypal_me_url": "https://paypal.me/auxiliary",
            "paypal_use_connected": use_connected,
        },
    )
    return service


async def _paypal_button(service: StorefrontService, org_id: str) -> dict:
    settings = await service.get_settings(org_id)
    options = service.build_payment_options(settings, Decimal("25.00"), "ORD-1")
    return next(o for o in options if o["method"] == "paypal")


class TestConnectedPayPalForTheStore:
    async def test_the_integration_stores_and_normalizes_the_link(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connect_paypal(
            db_session,
            org_id,
            admin,
            paypal_me_url="oakvillefd",
            account_email=EMAIL,
        )

        assert row.config["paypal_me_url"] == LINK
        assert row.config["account_email"] == EMAIL

    async def test_the_button_uses_the_connected_account_when_chosen(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        await _connect_paypal(
            db_session, org_id, admin, paypal_me_url=LINK, account_email=EMAIL
        )
        service = await _store(db_session, org_id, use_connected=True)

        button = await _paypal_button(service, org_id)

        assert button["payment_url"] == f"{LINK}/25.00"

    async def test_the_settings_response_reports_the_connected_account(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        await _connect_paypal(
            db_session, org_id, admin, paypal_me_url=LINK, account_email=EMAIL
        )
        service = await _store(db_session, org_id, use_connected=True)

        settings = await service.get_settings(org_id)
        response = store_ep._settings_response(service, settings)

        assert response.paypal_use_connected is True
        assert response.connected_paypal is not None
        assert response.connected_paypal.paypal_me_url == LINK
        assert response.connected_paypal.account_email == EMAIL

    async def test_disconnecting_falls_back_to_the_stores_own_link(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        admin = await _admin(db_session, org_id)
        row = await _connect_paypal(
            db_session, org_id, admin, paypal_me_url=LINK, account_email=EMAIL
        )
        with patch.object(int_ep, "log_audit_event", new=AsyncMock()):
            await int_ep.disconnect_integration(
                row.id, _request(), db=db_session, current_user=admin
            )
        service = await _store(db_session, org_id, use_connected=True)

        button = await _paypal_button(service, org_id)
        settings = await service.get_settings(org_id)

        assert button["payment_url"] == "https://paypal.me/auxiliary/25.00"
        assert store_ep._settings_response(service, settings).connected_paypal is None

    async def test_another_departments_paypal_is_never_used(
        self, db_session: AsyncSession
    ):
        other_org = await _org(db_session)
        other_admin = await _admin(db_session, other_org)
        await _connect_paypal(
            db_session,
            other_org,
            other_admin,
            paypal_me_url="https://paypal.me/otherdept",
        )
        org_id = await _org(db_session)
        service = await _store(db_session, org_id, use_connected=True)

        button = await _paypal_button(service, org_id)

        assert button["payment_url"] == "https://paypal.me/auxiliary/25.00"
