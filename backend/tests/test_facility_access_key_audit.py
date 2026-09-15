"""Audit-trail guarantees for facility access-key (door code / fob) mutations.

`FacilityAccessKey` rows are physical security credentials — key numbers,
fob IDs, alarm/door codes — and who they're assigned to (see the model's own
docstring in `app/models/facilities.py`). Before this fix, creating,
updating or deleting one of these records left no audit trail at all: of
the 98 routes on this router, only `create_facility_type` and
`update_facility_type` called `log_audit_event`. Mirrors the pattern already
established for a comparable physical credential in `nfc_tags.py`
(`nfc_tag_issued`/`nfc_tag_status_changed`/`nfc_tag_deleted`) and for the
mock-service style already used in `test_training_program_delete_endpoint.py`.

Mocked service/session — no DB — so this runs in the sandbox.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.api.v1.endpoints import facilities
from app.schemas.facilities import (
    FacilityAccessKeyCreate,
    FacilityAccessKeyUpdate,
    KeyTypeEnum,
)


def _user():
    return SimpleNamespace(
        id="user-1",
        username="chief",
        organization_id="org-1",
    )


def _key(**overrides):
    defaults = dict(
        id=str(uuid4()),
        facility_id=str(uuid4()),
        key_type=KeyTypeEnum.ACCESS_CODE,
        key_identifier="1234",
        assigned_to_user_id=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


async def test_create_access_key_records_audit_event(monkeypatch):
    key = _key()
    service = MagicMock()
    service.create_access_key = AsyncMock(return_value=key)
    monkeypatch.setattr(facilities, "FacilitiesService", lambda _db: service)
    audit = AsyncMock()
    monkeypatch.setattr(facilities, "log_audit_event", audit)
    db = MagicMock()

    payload = FacilityAccessKeyCreate(
        facility_id=key.facility_id,
        key_type=KeyTypeEnum.ACCESS_CODE,
        key_identifier="1234",
    )

    result = await facilities.create_facility_access_key(payload, db, _user())

    assert result is key
    audit.assert_awaited_once_with(
        db=db,
        event_type="facilities.access_key_created",
        event_category="security",
        severity="info",
        event_data={
            "key_id": key.id,
            "facility_id": key.facility_id,
            "key_type": "access_code",
            "assigned_to_user_id": None,
        },
        user_id="user-1",
        username="chief",
    )
    # The audit event never carries key_identifier — that field can hold the
    # literal credential value, and the audit log is read by a broader set
    # of admins than facilities.view_sensitive/.edit/.manage.
    logged_data = audit.await_args.kwargs["event_data"]
    assert "key_identifier" not in logged_data


async def test_update_access_key_records_audit_event_with_field_names_only(
    monkeypatch,
):
    key = _key()
    service = MagicMock()
    service.update_access_key = AsyncMock(return_value=key)
    monkeypatch.setattr(facilities, "FacilitiesService", lambda _db: service)
    audit = AsyncMock()
    monkeypatch.setattr(facilities, "log_audit_event", audit)
    db = MagicMock()

    payload = FacilityAccessKeyUpdate(key_identifier="5678", is_active=False)

    result = await facilities.update_facility_access_key(key.id, payload, db, _user())

    assert result is key
    audit.assert_awaited_once_with(
        db=db,
        event_type="facilities.access_key_updated",
        event_category="security",
        severity="warning",
        event_data={
            "key_id": key.id,
            "facility_id": key.facility_id,
            "fields_changed": ["key_identifier", "is_active"],
        },
        user_id="user-1",
        username="chief",
    )


async def test_update_missing_access_key_is_not_audited(monkeypatch):
    service = MagicMock()
    service.update_access_key = AsyncMock(return_value=None)
    monkeypatch.setattr(facilities, "FacilitiesService", lambda _db: service)
    audit = AsyncMock()
    monkeypatch.setattr(facilities, "log_audit_event", audit)
    db = MagicMock()

    payload = FacilityAccessKeyUpdate(is_active=False)

    with pytest.raises(facilities.HTTPException) as exc:
        await facilities.update_facility_access_key(str(uuid4()), payload, db, _user())

    assert exc.value.status_code == 404
    audit.assert_not_awaited()


async def test_delete_access_key_records_audit_event(monkeypatch):
    key = _key()
    service = MagicMock()
    service.get_access_key = AsyncMock(return_value=key)
    service.delete_access_key = AsyncMock(return_value=True)
    monkeypatch.setattr(facilities, "FacilitiesService", lambda _db: service)
    audit = AsyncMock()
    monkeypatch.setattr(facilities, "log_audit_event", audit)
    db = MagicMock()

    await facilities.delete_facility_access_key(key.id, db, _user())

    audit.assert_awaited_once_with(
        db=db,
        event_type="facilities.access_key_deleted",
        event_category="security",
        severity="warning",
        event_data={"key_id": key.id, "facility_id": key.facility_id},
        user_id="user-1",
        username="chief",
    )


async def test_delete_missing_access_key_is_not_audited(monkeypatch):
    service = MagicMock()
    service.get_access_key = AsyncMock(return_value=None)
    service.delete_access_key = AsyncMock(return_value=False)
    monkeypatch.setattr(facilities, "FacilitiesService", lambda _db: service)
    audit = AsyncMock()
    monkeypatch.setattr(facilities, "log_audit_event", audit)
    db = MagicMock()

    with pytest.raises(facilities.HTTPException) as exc:
        await facilities.delete_facility_access_key(str(uuid4()), db, _user())

    assert exc.value.status_code == 404
    audit.assert_not_awaited()
    service.delete_access_key.assert_not_awaited()
