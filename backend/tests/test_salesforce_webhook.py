"""
Tests for the public Salesforce inbound webhook
(app/api/public/salesforce_webhook.py).

Covers the record-count cap: a validly-signed request still originates from
an external system, and with no per-record limit, one oversized signed
payload can drive an unbounded number of DB round-trips inside the 30/min
rate-limit budget. DB mocked; no MySQL.
"""

import hashlib
import hmac
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.api.public.salesforce_webhook import (
    MAX_RECORDS_PER_WEBHOOK,
    salesforce_inbound_webhook,
)

_SECRET = "shhh-webhook-secret"


def _signed_request(payload: dict):
    body = json.dumps(payload).encode("utf-8")
    signature = "sha256=" + hmac.new(_SECRET.encode(), body, hashlib.sha256).hexdigest()

    request = MagicMock()
    request.body = AsyncMock(return_value=body)
    request.json = AsyncMock(return_value=payload)
    request.headers = {"X-Salesforce-Signature": signature}
    return request


def _db_with_integration():
    integration = MagicMock()
    integration.id = "int-1"
    integration.organization_id = "org-1"
    integration.get_secret = MagicMock(return_value=_SECRET)

    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=integration)
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    return db, integration


class TestRecordCountCap:
    async def test_rejects_payload_over_the_cap(self):
        db, _ = _db_with_integration()
        payload = {
            "sobject": "Contact",
            "action": "updated",
            "records": [{"Id": str(i)} for i in range(MAX_RECORDS_PER_WEBHOOK + 1)],
        }
        request = _signed_request(payload)

        with pytest.raises(HTTPException) as exc:
            await salesforce_inbound_webhook("int-1", request, db=db, _rl=None)

        assert exc.value.status_code == 422
        assert str(MAX_RECORDS_PER_WEBHOOK) in exc.value.detail

    async def test_at_the_cap_passes_the_check(self, monkeypatch):
        # Exactly at the cap must not be rejected by the cap check itself
        # (it may still fail later for unrelated reasons, which is fine --
        # this test only proves the boundary is inclusive).
        db, _ = _db_with_integration()
        payload = {
            "sobject": "Contact",
            "action": "updated",
            "records": [{"Id": str(i)} for i in range(MAX_RECORDS_PER_WEBHOOK)],
        }
        request = _signed_request(payload)

        monkeypatch.setattr(
            "app.api.public.salesforce_webhook.is_duplicate_webhook",
            AsyncMock(return_value=False),
        )

        sync_service = MagicMock()
        sync_service.inbound_enabled = True
        sync_service.parse_inbound_contact = MagicMock(side_effect=lambda rec: rec)
        sync_service.sync_inbound_contacts = AsyncMock(
            return_value={"updated": 0, "unchanged": 0, "unmatched": 0, "failed": 0}
        )
        monkeypatch.setattr(
            "app.api.public.salesforce_webhook.SalesforceSyncService",
            MagicMock(return_value=sync_service),
        )
        monkeypatch.setattr(
            "app.api.public.salesforce_webhook.SalesforceService", MagicMock()
        )
        monkeypatch.setattr(
            "app.api.public.salesforce_webhook.build_salesforce_credentials",
            MagicMock(),
        )
        monkeypatch.setattr(
            "app.api.public.salesforce_webhook.log_audit_event", AsyncMock()
        )
        db.commit = AsyncMock()

        result = await salesforce_inbound_webhook("int-1", request, db=db, _rl=None)

        assert result["received"] == MAX_RECORDS_PER_WEBHOOK


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
