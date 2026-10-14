"""
`POST /whitelist/bulk-update` writes only real booleans to the whitelist.

`updates` is free-form JSON, so `enabled` can be anything. The route used to
assign whatever arrived to a boolean column; it now skips an entry whose
`enabled` is not a boolean, the same as one that omits it.
"""

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.api.v1.public_portal_admin import bulk_update_whitelist
from app.models.public_portal import PublicPortalConfig, PublicPortalDataWhitelist
from app.models.user import Organization
from app.schemas.public_portal import PublicPortalDataWhitelistBulkUpdate


async def _seed(db):
    org = Organization(name="Portal FD", slug=f"portal-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    config = PublicPortalConfig(organization_id=org.id)
    db.add(config)
    await db.flush()
    entries = {}
    for field in ("name", "phone", "email"):
        entry = PublicPortalDataWhitelist(
            organization_id=org.id,
            config_id=config.id,
            data_category="organization",
            field_name=field,
            is_enabled=False,
        )
        db.add(entry)
        entries[field] = entry
    await db.flush()
    return org, entries


def _update(field, enabled):
    return {"category": "organization", "field": field, "enabled": enabled}


@pytest.mark.integration
class TestBulkWhitelistUpdate:
    async def test_boolean_entries_are_written_and_counted(self, db_session):
        org, entries = await _seed(db_session)
        # Read before the route's commit expires the instance.
        org_id = org.id
        caller = SimpleNamespace(organization_id=org_id)

        result = await bulk_update_whitelist(
            bulk_update=PublicPortalDataWhitelistBulkUpdate(
                updates=[_update("name", True), _update("phone", False)]
            ),
            current_user=caller,
            db=db_session,
        )

        assert result["updated_count"] == 2
        db_session.expire_all()
        rows = {
            r.field_name: r.is_enabled
            for r in (
                await db_session.execute(select(PublicPortalDataWhitelist))
            ).scalars()
            if r.organization_id == org_id
        }
        assert rows == {"name": True, "phone": False, "email": False}

    @pytest.mark.parametrize("bad", ["false", "yes", 1, 0, None, [], {}])
    async def test_a_non_boolean_enabled_is_skipped_not_stored(self, db_session, bad):
        org, entries = await _seed(db_session)
        # Read before the route's commit expires the instance.
        org_id = org.id
        caller = SimpleNamespace(organization_id=org_id)

        result = await bulk_update_whitelist(
            bulk_update=PublicPortalDataWhitelistBulkUpdate(
                updates=[_update("name", bad), _update("email", True)]
            ),
            current_user=caller,
            db=db_session,
        )

        assert result["updated_count"] == 1
        db_session.expire_all()
        by_field = {
            r.field_name: r.is_enabled
            for r in (
                await db_session.execute(select(PublicPortalDataWhitelist))
            ).scalars()
            if r.organization_id == org_id
        }
        assert by_field["name"] is False
        assert by_field["email"] is True
