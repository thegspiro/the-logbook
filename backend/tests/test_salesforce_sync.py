"""
Tests for the Salesforce integration:
  - Configurable member matching / de-duplication (email, email+lastname,
    external-id-only) and adopt-on-match behavior.
  - Graceful dropping of custom fields the target org has not created yet.
  - Readiness (field presence) reporting and dry-run preview counts.
  - OAuth connect flow (signed state, credential resolution, authorize URL).
"""

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import jwt
import pytest

from app.core.config import settings
from app.services.integration_services import salesforce_oauth_service as sfoauth
from app.services.integration_services.salesforce_service import SalesforceService
from app.services.integration_services.salesforce_sync_service import (
    SalesforceSyncService,
)


class FakeResponse:
    """Minimal stand-in for an httpx.Response used by SalesforceService."""

    def __init__(self, status_code, json_data=None, text=""):
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}
        self.text = text

    def json(self):
        return self._json


def make_integration(config=None, secrets=None):
    secret_map = secrets or {}
    return SimpleNamespace(
        id="int-1",
        organization_id="org-1",
        config=config or {},
        get_secret=lambda key: secret_map.get(key),
    )


def make_sync_service(*, config=None, sf=None):
    sf = sf or AsyncMock()
    if not hasattr(sf, "skipped_fields") or not isinstance(sf.skipped_fields, set):
        sf.skipped_fields = set()
    integration = make_integration(config=config)
    service = SalesforceSyncService(
        db=AsyncMock(), sf_service=sf, integration=integration
    )
    return service, sf


# ============================================================
# Matching / de-duplication
# ============================================================


async def test_email_match_adopts_existing_contact():
    """A member absent by external ID but present by email is adopted."""

    async def query(soql):
        if "Logbook_Member_ID__c" in soql:
            return []  # not previously synced
        if "Email =" in soql:
            return [{"Id": "003EXISTING"}]  # already in Salesforce
        return []

    sf = AsyncMock()
    sf.query.side_effect = query
    sf.update_record.return_value = True
    service, _ = make_sync_service(config={"match_strategy": "email"}, sf=sf)

    member = {
        "id": "m1",
        "first_name": "Jane",
        "last_name": "Doe",
        "email": "jane@dept.org",
    }
    sf_id, action = await service.upsert_member(member)

    assert sf_id == "003EXISTING"
    assert action == "adopted"
    # The Logbook external ID is stamped onto the adopted record.
    call = sf.update_record.await_args
    assert call.args[0] == "Contact"
    assert call.args[1] == "003EXISTING"
    assert call.args[2].get("Logbook_Member_ID__c") == "m1"
    sf.create_record.assert_not_awaited()


async def test_external_id_match_updates_not_adopts():
    """A record found by our own external ID counts as an update."""

    async def query(soql):
        if "Logbook_Member_ID__c" in soql:
            return [{"Id": "003OWNED"}]
        return []

    sf = AsyncMock()
    sf.query.side_effect = query
    sf.update_record.return_value = True
    service, _ = make_sync_service(config={"match_strategy": "email"}, sf=sf)

    sf_id, action = await service.upsert_member(
        {"id": "m1", "last_name": "Doe", "email": "jane@dept.org"}
    )
    assert sf_id == "003OWNED"
    assert action == "updated"


async def test_external_id_only_strategy_never_queries_email():
    """external_id strategy creates rather than adopting pre-existing data."""
    queried = []

    async def query(soql):
        queried.append(soql)
        return []  # nothing found by external ID

    sf = AsyncMock()
    sf.query.side_effect = query
    sf.create_record.return_value = "003NEW"
    service, _ = make_sync_service(config={"match_strategy": "external_id"}, sf=sf)

    sf_id, action = await service.upsert_member(
        {"id": "m1", "last_name": "Doe", "email": "jane@dept.org"}
    )
    assert action == "created"
    assert sf_id == "003NEW"
    # No email fallback query should have been issued.
    assert all("Email =" not in soql for soql in queried)


async def test_email_lastname_strategy_constrains_query():
    seen = []

    async def query(soql):
        seen.append(soql)
        if "Logbook_Member_ID__c" in soql:
            return []
        return [{"Id": "003X"}]

    sf = AsyncMock()
    sf.query.side_effect = query
    sf.update_record.return_value = True
    service, _ = make_sync_service(
        config={"match_strategy": "email_lastname"}, sf=sf
    )

    _sf_id, action = await service.upsert_member(
        {"id": "m1", "last_name": "Doe", "email": "jane@dept.org"}
    )
    assert action == "adopted"
    email_query = next(s for s in seen if "Email =" in s)
    assert "LastName = 'Doe'" in email_query


async def test_member_without_lastname_is_skipped():
    sf = AsyncMock()
    service, _ = make_sync_service(config={}, sf=sf)

    sf_id, action = await service.upsert_member(
        {"id": "m1", "email": "jane@dept.org"}
    )
    assert sf_id is None
    assert action == "skipped"
    sf.create_record.assert_not_awaited()
    sf.update_record.assert_not_awaited()


async def test_invalid_match_strategy_falls_back_to_default():
    service, _ = make_sync_service(config={"match_strategy": "bogus"})
    assert service._match_strategy == "email"


async def test_sync_all_members_tallies_actions():
    async def query(soql):
        if "Logbook_Member_ID__c" in soql:
            return []
        if "adopt@dept.org" in soql:
            return [{"Id": "003ADOPT"}]
        return []

    sf = AsyncMock()
    sf.query.side_effect = query
    sf.update_record.return_value = True
    sf.create_record.return_value = "003NEW"
    sf.skipped_fields = {"Membership_Type__c"}
    service, _ = make_sync_service(config={"match_strategy": "email"}, sf=sf)

    members = [
        {"id": "m1", "last_name": "Doe", "email": "adopt@dept.org"},
        {"id": "m2", "last_name": "Roe", "email": "new@dept.org"},
        {"id": "m3", "email": "nolast@dept.org"},  # skipped
    ]
    counts = await service.sync_all_members_to_salesforce(members)
    assert counts["adopted"] == 1
    assert counts["created"] == 1
    assert counts["skipped"] == 1
    assert counts["skipped_fields"] == ["Membership_Type__c"]


# ============================================================
# Graceful missing-field handling
# ============================================================


async def test_create_record_drops_unknown_custom_field(monkeypatch):
    sf = SalesforceService(
        {"instance_url": "https://x.salesforce.com", "access_token": "t"}
    )
    payloads = []

    async def fake_request(method, url, *, json=None, params=None):
        payloads.append(dict(json or {}))
        if "Logbook_Member_ID__c" in (json or {}):
            return FakeResponse(
                400,
                [
                    {
                        "errorCode": "INVALID_FIELD",
                        "message": (
                            "No such column 'Logbook_Member_ID__c' on "
                            "sobject of type Contact"
                        ),
                    }
                ],
            )
        return FakeResponse(201, {"id": "003CREATED"})

    monkeypatch.setattr(sf, "_request", fake_request)

    record_id = await sf.create_record(
        "Contact", {"LastName": "Doe", "Logbook_Member_ID__c": "m1"}
    )
    assert record_id == "003CREATED"
    assert "Logbook_Member_ID__c" in sf.skipped_fields
    # The retry payload no longer includes the unknown field.
    assert "Logbook_Member_ID__c" not in payloads[1]
    assert payloads[1]["LastName"] == "Doe"


async def test_create_record_respects_disabled_graceful(monkeypatch):
    sf = SalesforceService(
        {"instance_url": "https://x.salesforce.com", "access_token": "t"},
        skip_unknown_fields=False,
    )

    async def fake_request(method, url, *, json=None, params=None):
        return FakeResponse(
            400,
            [
                {
                    "errorCode": "INVALID_FIELD",
                    "message": "No such column 'Foo__c' on sobject of type Contact",
                }
            ],
        )

    monkeypatch.setattr(sf, "_request", fake_request)
    with pytest.raises(Exception):
        await sf.create_record("Contact", {"LastName": "Doe", "Foo__c": "x"})


async def test_update_record_drops_unknown_field(monkeypatch):
    sf = SalesforceService(
        {"instance_url": "https://x.salesforce.com", "access_token": "t"}
    )
    attempts = []

    async def fake_request(method, url, *, json=None, params=None):
        attempts.append(dict(json or {}))
        if "Bad__c" in (json or {}):
            return FakeResponse(
                400,
                [
                    {
                        "errorCode": "INVALID_FIELD",
                        "message": "No such column 'Bad__c' on sobject of type Task",
                    }
                ],
            )
        return FakeResponse(204)

    monkeypatch.setattr(sf, "_request", fake_request)
    ok = await sf.update_record("Task", "00TID", {"Subject": "Hi", "Bad__c": "x"})
    assert ok is True
    assert "Bad__c" in sf.skipped_fields
    assert "Bad__c" not in attempts[1]


# ============================================================
# Readiness & preview
# ============================================================


async def test_check_readiness_flags_missing_external_id():
    async def get_field_names(sobject):
        if sobject == "Contact":
            return {"FirstName", "LastName", "Email"}  # no Logbook_Member_ID__c
        if sobject == "Event":
            return {"Logbook_Event_ID__c", "Subject"}
        return {
            "Logbook_Training_ID__c",
            "Logbook_Call_ID__c",
            "Task_Source__c",
            "Subject",
        }

    sf = AsyncMock()
    sf.test_connection.return_value = "ok"
    sf.get_field_names.side_effect = get_field_names
    service, _ = make_sync_service(config={}, sf=sf)

    report = await service.check_readiness()
    assert report["connected"] is True
    assert report["ready"] is False
    assert report["external_id_fields_ready"] is False
    assert (
        "Logbook_Member_ID__c" in report["objects"]["Contact"]["missing_fields"]
    )


async def test_check_readiness_ready_when_external_ids_present():
    async def get_field_names(sobject):
        base = {
            "Contact": {"Logbook_Member_ID__c"},
            "Event": {"Logbook_Event_ID__c"},
            "Task": {
                "Logbook_Training_ID__c",
                "Logbook_Call_ID__c",
                "Task_Source__c",
            },
        }
        # Include every expected custom field so nothing is missing.
        from app.services.integration_services import salesforce_sync_service as s

        expected = {
            "Contact": s._custom_fields(s.MEMBER_TO_CONTACT)
            | {"Logbook_Member_ID__c"},
            "Event": s._custom_fields(s.EVENT_TO_SF_EVENT)
            | {"Logbook_Event_ID__c"},
            "Task": s._custom_fields(s.TRAINING_RECORD_TO_TASK)
            | s._custom_fields(s.INCIDENT_TO_TASK)
            | {"Logbook_Training_ID__c", "Logbook_Call_ID__c", "Task_Source__c"},
        }
        return base[sobject] | expected[sobject]

    sf = AsyncMock()
    sf.test_connection.return_value = "ok"
    sf.get_field_names.side_effect = get_field_names
    service, _ = make_sync_service(config={}, sf=sf)

    report = await service.check_readiness()
    assert report["ready"] is True
    assert report["external_id_fields_ready"] is True


async def test_check_readiness_reports_disconnected():
    sf = AsyncMock()
    sf.test_connection.side_effect = Exception("auth failed")
    service, _ = make_sync_service(config={}, sf=sf)

    report = await service.check_readiness()
    assert report["connected"] is False
    assert report["ready"] is False
    assert "error" in report


async def test_preview_counts_create_update_adopt_skip():
    async def query(soql):
        if "Logbook_Member_ID__c" in soql:
            if "m-owned" in soql:
                return [{"Id": "003OWNED"}]
            return []
        if "adopt@dept.org" in soql:
            return [{"Id": "003ADOPT"}]
        return []

    sf = AsyncMock()
    sf.query.side_effect = query
    service, _ = make_sync_service(config={"match_strategy": "email"}, sf=sf)

    members = [
        {"id": "m-owned", "last_name": "Own", "email": "own@dept.org"},  # update
        {"id": "m2", "last_name": "Doe", "email": "adopt@dept.org"},  # adopt
        {"id": "m3", "last_name": "Roe", "email": "new@dept.org"},  # create
        {"id": "m4", "email": "nolast@dept.org"},  # skipped
    ]
    preview = await service.preview_member_sync(members)
    assert preview["total"] == 4
    assert preview["would_update"] == 1
    assert preview["would_adopt"] == 1
    assert preview["would_create"] == 1
    assert preview["skipped"] == 1


# ============================================================
# OAuth connect flow
# ============================================================


def test_oauth_state_roundtrip():
    token = sfoauth.encode_state(
        organization_id="org-1",
        integration_id="int-1",
        redirect_uri="https://app.example.org/cb",
        nonce="nonce-abc",
    )
    payload = sfoauth.decode_state(token)
    assert payload["org"] == "org-1"
    assert payload["int"] == "int-1"
    assert payload["redirect_uri"] == "https://app.example.org/cb"
    assert payload["nonce"] == "nonce-abc"


def test_oauth_state_rejects_wrong_purpose():
    forged = jwt.encode(
        {"purpose": "not_salesforce", "exp": int(time.time()) + 60},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )
    with pytest.raises(sfoauth.SalesforceOAuthError):
        sfoauth.decode_state(forged)


def test_oauth_state_rejects_tampered_token():
    token = sfoauth.encode_state(
        organization_id="org-1",
        integration_id="int-1",
        redirect_uri="https://app/cb",
        nonce="n",
    )
    with pytest.raises(sfoauth.SalesforceOAuthError):
        sfoauth.decode_state(token + "tamper")


def test_client_credentials_prefer_integration_over_deployment(monkeypatch):
    monkeypatch.setattr(settings, "SALESFORCE_CLIENT_ID", "deploy-id")
    monkeypatch.setattr(settings, "SALESFORCE_CLIENT_SECRET", "deploy-secret")
    integ = make_integration(
        secrets={"client_id": "org-id", "client_secret": "org-secret"}
    )
    client_id, client_secret = sfoauth.get_client_credentials(integ)
    assert client_id == "org-id"
    assert client_secret == "org-secret"


def test_client_credentials_fall_back_to_deployment(monkeypatch):
    monkeypatch.setattr(settings, "SALESFORCE_CLIENT_ID", "deploy-id")
    monkeypatch.setattr(settings, "SALESFORCE_CLIENT_SECRET", "deploy-secret")
    integ = make_integration(secrets={})
    client_id, client_secret = sfoauth.get_client_credentials(integ)
    assert client_id == "deploy-id"
    assert client_secret == "deploy-secret"


def test_build_authorization_url_requires_client_id(monkeypatch):
    monkeypatch.setattr(settings, "SALESFORCE_CLIENT_ID", None)
    integ = make_integration(secrets={})
    with pytest.raises(sfoauth.SalesforceOAuthError):
        sfoauth.build_authorization_url(
            integ, state="s", redirect_uri="https://app/cb"
        )


def test_build_authorization_url_uses_sandbox_and_scopes():
    integ = make_integration(
        config={"environment": "sandbox"}, secrets={"client_id": "cid"}
    )
    url = sfoauth.build_authorization_url(
        integ, state="state-8", redirect_uri="https://app/cb"
    )
    assert url.startswith("https://test.salesforce.com/services/oauth2/authorize")
    assert "state=state-8" in url
    assert "refresh_token" in url  # offline-access scope is requested
    assert "client_id=cid" in url


# ============================================================
# Inbound persistence (Salesforce → Logbook)
# ============================================================


class FakeResult:
    """Stand-in for a SQLAlchemy Result exposing scalar_one_or_none()."""

    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


def make_user(**overrides):
    defaults = dict(
        id="u1",
        organization_id="org-1",
        email="jane@dept.org",
        first_name="Jane",
        last_name="Doe",
        phone=None,
        mobile=None,
        rank=None,
        station=None,
        address_street=None,
        address_city=None,
        address_state=None,
        address_zip=None,
        address_country=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def make_inbound_service(*, config=None, results=None):
    """Build a sync service whose db.execute() returns queued FakeResults."""
    db = AsyncMock()
    if results is not None:
        db.execute = AsyncMock(side_effect=[FakeResult(r) for r in results])
    sf = AsyncMock()
    sf.skipped_fields = set()
    integration = make_integration(config=config or {})
    return SalesforceSyncService(db=db, sf_service=sf, integration=integration)


def test_inbound_enabled_respects_sync_direction():
    assert make_inbound_service(config={"sync_direction": "push"}).inbound_enabled is False
    assert make_inbound_service(config={"sync_direction": "pull"}).inbound_enabled is True
    assert make_inbound_service(config={"sync_direction": "both"}).inbound_enabled is True


async def test_apply_inbound_updates_matched_user_by_external_id():
    user = make_user()
    service = make_inbound_service(config={"sync_direction": "both"}, results=[user])
    lb = {
        "logbook_member_id": "u1",
        "email": "jane@dept.org",
        "phone": "555-1234",
        "first_name": "Janet",
    }
    action = await service.apply_inbound_contact(lb)
    assert action == "updated"
    assert user.phone == "555-1234"
    assert user.first_name == "Janet"


async def test_apply_inbound_matches_by_email_when_no_external_id():
    user = make_user()
    service = make_inbound_service(results=[user])
    action = await service.apply_inbound_contact(
        {"email": "jane@dept.org", "mobile": "555-9999"}
    )
    assert action == "updated"
    assert user.mobile == "555-9999"


async def test_apply_inbound_unmatched_creates_nothing():
    service = make_inbound_service(results=[None])
    action = await service.apply_inbound_contact(
        {"email": "ghost@dept.org", "phone": "555-0000"}
    )
    assert action == "unmatched"


async def test_apply_inbound_ignores_non_whitelisted_and_identity_fields():
    user = make_user(email="old@dept.org")
    service = make_inbound_service(results=[user])
    action = await service.apply_inbound_contact(
        {
            "logbook_member_id": "u1",
            "email": "new@dept.org",  # identity — must not change
            "membership_number": "999",  # not whitelisted
            "status": "inactive",  # not whitelisted
            "phone": "555-7777",  # whitelisted
        }
    )
    assert action == "updated"
    assert user.phone == "555-7777"
    assert user.email == "old@dept.org"
    assert not hasattr(user, "status") or user.status != "inactive"


async def test_apply_inbound_does_not_blank_existing_values():
    user = make_user(phone="555-1234")
    service = make_inbound_service(results=[user])
    action = await service.apply_inbound_contact(
        {"email": "jane@dept.org", "phone": ""}
    )
    assert action == "unchanged"
    assert user.phone == "555-1234"


async def test_sync_inbound_contacts_tallies_actions():
    matched = make_user()
    # First contact matches by email → updated; second matches nobody.
    service = make_inbound_service(results=[matched, None])
    counts = await service.sync_inbound_contacts(
        [
            {"email": "jane@dept.org", "phone": "555-1"},
            {"email": "ghost@dept.org", "phone": "555-2"},
        ]
    )
    assert counts["updated"] == 1
    assert counts["unmatched"] == 1
    assert counts["failed"] == 0
