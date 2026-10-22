"""Public portal API key changes leave an audit record, and revocation sticks.

Creating, editing and revoking a public portal key changed who could read the
department's published data, and the only trace was a ``logger.info`` line.
Each of the three endpoints now writes an audit entry in the same transaction
as the change, recording the key's id, prefix and name but never the key
itself or its hash.

A PATCH could also send ``is_active: true`` on a revoked key and switch it
back on, although the keys screen tells the admin a revocation cannot be
undone. The model has no separate "disabled" state to tell a revocation from,
so any inactive-to-active transition is refused.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.api.v1.public_portal_admin import (
    create_api_key,
    revoke_api_key,
    update_api_key,
)
from app.models.audit import AuditLog
from app.models.public_portal import PublicPortalAPIKey, PublicPortalConfig
from app.schemas.public_portal import (
    PublicPortalAPIKeyCreate,
    PublicPortalAPIKeyUpdate,
)

pytestmark = [pytest.mark.integration]

CLIENT_IP = "192.0.2.44"


async def _make_config(db: AsyncSession, org_id: str) -> None:
    db.add(
        PublicPortalConfig(
            organization_id=org_id,
            enabled=True,
            allowed_origins=[],
            default_rate_limit=1000,
            cache_ttl_seconds=300,
            settings={},
        )
    )
    await db.flush()


def _admin(org_id: str, admin_id: str) -> SimpleNamespace:
    return SimpleNamespace(organization_id=org_id, id=admin_id)


def _request() -> Request:
    return Request({"type": "http", "headers": [], "client": (CLIENT_IP, 443)})


async def _audit_rows(db: AsyncSession, org_id: str) -> list[AuditLog]:
    result = await db.execute(
        select(AuditLog)
        .where(
            AuditLog.organization_id == org_id,
            AuditLog.event_type.like("public_portal.api_key_%"),
        )
        .order_by(AuditLog.id)
    )
    return list(result.scalars().all())


async def _key_hash(db: AsyncSession, key_id: str) -> str:
    value = await db.scalar(
        select(PublicPortalAPIKey.key_hash).where(PublicPortalAPIKey.id == key_id)
    )
    assert isinstance(value, str)
    return value


def _assert_no_secret(row: AuditLog, plaintext: str, key_hash: str) -> None:
    serialized = repr(row.event_data)
    assert plaintext not in serialized
    assert key_hash not in serialized
    assert "api_key" not in row.event_data
    assert "key_hash" not in row.event_data


class TestApiKeyAudit:
    async def test_create_patch_and_revoke_each_write_an_audit_row(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _make_config(db_session, org_id)
        admin = _admin(org_id, admin_id)

        created = await create_api_key(
            key_data=PublicPortalAPIKeyCreate(name="website"),
            request=_request(),
            current_user=admin,
            db=db_session,
        )
        key_id = str(created.id)
        await update_api_key(
            key_id=key_id,
            key_update=PublicPortalAPIKeyUpdate(name="public site"),
            request=_request(),
            current_user=admin,
            db=db_session,
        )
        await revoke_api_key(
            key_id=key_id,
            request=_request(),
            current_user=admin,
            db=db_session,
        )

        rows = await _audit_rows(db_session, org_id)
        assert [r.event_type for r in rows] == [
            "public_portal.api_key_created",
            "public_portal.api_key_updated",
            "public_portal.api_key_revoked",
        ]
        key_hash = await _key_hash(db_session, key_id)
        for row in rows:
            assert row.user_id == admin_id
            assert row.ip_address == CLIENT_IP
            assert row.event_data["key_id"] == key_id
            assert row.event_data["key_prefix"] == created.key_prefix
            _assert_no_secret(row, created.api_key, key_hash)

        assert rows[0].event_data["name"] == "website"
        assert rows[1].event_data["changes"] == {
            "name": {"old": "website", "new": "public site"}
        }
        assert rows[2].event_data["was_active"] is True

    async def test_revoking_through_patch_is_audited_as_a_revocation(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _make_config(db_session, org_id)
        admin = _admin(org_id, admin_id)
        created = await create_api_key(
            key_data=PublicPortalAPIKeyCreate(name="kiosk"),
            request=_request(),
            current_user=admin,
            db=db_session,
        )

        await update_api_key(
            key_id=str(created.id),
            key_update=PublicPortalAPIKeyUpdate(is_active=False),
            request=_request(),
            current_user=admin,
            db=db_session,
        )

        rows = await _audit_rows(db_session, org_id)
        assert rows[-1].event_type == "public_portal.api_key_revoked"
        assert rows[-1].event_data["changes"] == {
            "is_active": {"old": True, "new": False}
        }


class TestRevocationIsFinal:
    async def test_patch_refuses_to_reactivate_a_revoked_key(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _make_config(db_session, org_id)
        admin = _admin(org_id, admin_id)
        created = await create_api_key(
            key_data=PublicPortalAPIKeyCreate(name="website"),
            request=_request(),
            current_user=admin,
            db=db_session,
        )
        key_id = str(created.id)
        await revoke_api_key(
            key_id=key_id, request=_request(), current_user=admin, db=db_session
        )

        with pytest.raises(HTTPException) as exc:
            await update_api_key(
                key_id=key_id,
                key_update=PublicPortalAPIKeyUpdate(is_active=True),
                request=_request(),
                current_user=admin,
                db=db_session,
            )

        assert exc.value.status_code == 409
        db_session.expire_all()
        still_active = await db_session.scalar(
            select(PublicPortalAPIKey.is_active).where(PublicPortalAPIKey.id == key_id)
        )
        assert still_active is False

    async def test_is_active_true_on_an_active_key_is_accepted(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        await _make_config(db_session, org_id)
        admin = _admin(org_id, admin_id)
        created = await create_api_key(
            key_data=PublicPortalAPIKeyCreate(name="website"),
            request=_request(),
            current_user=admin,
            db=db_session,
        )

        updated = await update_api_key(
            key_id=str(created.id),
            key_update=PublicPortalAPIKeyUpdate(is_active=True),
            request=_request(),
            current_user=admin,
            db=db_session,
        )

        assert updated.is_active is True
