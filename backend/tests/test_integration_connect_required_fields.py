"""Connecting an integration needs its required settings, from the request
or from what was stored before.

Workflow review W73: ``_validate_config`` checks only a non-empty body, so
``POST /integrations/{id}/connect`` with no config left Slack "connected"
and enabled with no webhook URL. A reconnect after a disconnect still sends
nothing, since disconnecting keeps the settings, and must keep working.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1.endpoints.integrations import connect_integration
from app.models.integration import Integration
from app.schemas.integration import IntegrationConnectRequest

pytestmark = [pytest.mark.integration]


def _request():
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/integrations/x/connect",
            "headers": [],
            "client": ("203.0.113.7", 40000),
            "query_string": b"",
        }
    )


async def _slack(db, org_id, *, webhook_secret=None):
    row = Integration(
        organization_id=org_id,
        integration_type="slack",
        name="Slack",
        category="Messaging",
        status="available",
        config={},
        enabled=False,
    )
    if webhook_secret:
        row.set_secret("webhook_url", webhook_secret)
    db.add(row)
    await db.flush()
    return row


async def test_connecting_without_the_webhook_is_refused(
    db_session, setup_org_and_admin
):
    org_id, admin_id = setup_org_and_admin
    row = await _slack(db_session, org_id)

    with pytest.raises(HTTPException) as refused:
        await connect_integration(
            row.id,
            request=_request(),
            body=IntegrationConnectRequest(config={}),
            db=db_session,
            current_user=SimpleNamespace(organization_id=org_id, id=admin_id),
        )

    assert refused.value.status_code == 400
    assert "webhook_url" in refused.value.detail
    assert row.status == "available"


async def test_reconnecting_with_the_stored_webhook_still_works(
    db_session, setup_org_and_admin
):
    org_id, admin_id = setup_org_and_admin
    row = await _slack(
        db_session, org_id, webhook_secret="https://hooks.slack.com/services/T/B/X"
    )

    connected = await connect_integration(
        row.id,
        request=_request(),
        body=IntegrationConnectRequest(config={}),
        db=db_session,
        current_user=SimpleNamespace(organization_id=org_id, id=admin_id),
    )

    assert connected["status"] == "connected"
