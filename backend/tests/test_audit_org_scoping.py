"""
Integration tests for audit-log organization scoping:

  - write-time org stamping (explicit param, auto-resolve from the acting
    user, platform-level NULL when neither exists)
  - hash v3 binds organization_id while a backfill-style UPDATE on a
    v2 row never breaks the chain
  - org-filtered reads only see their own organization's rows
"""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import app.core.audit as audit_module
from app.core.audit import audit_logger, log_audit_event
from app.models.audit import AuditLog

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def two_orgs_with_users(db_session: AsyncSession):
    """Two orgs, one active member each."""
    ids = {}
    for label in ("a", "b"):
        org_id = _uid()
        user_id = _uid()
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, "
                "slug, timezone) VALUES (:id, :name, 'fire_department', "
                ":slug, 'UTC')"
            ),
            {
                "id": org_id,
                "name": f"Audit Org {label.upper()}",
                "slug": f"aud-{label}-{org_id[:8]}",
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, "
                "first_name, last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, 'Aud', 'User', :em, 'hashed', "
                "'active')"
            ),
            {
                "id": user_id,
                "org": org_id,
                "un": f"aud-{label}-{user_id[:8]}",
                "em": f"aud-{label}-{user_id[:8]}@test.com",
            },
        )
        ids[label] = (org_id, user_id)
    await db_session.flush()
    return ids


class TestOrgStamping:

    async def test_auto_resolves_org_from_acting_user(
        self, db_session: AsyncSession, two_orgs_with_users
    ):
        org_id, user_id = two_orgs_with_users["a"]
        entry = await log_audit_event(
            db=db_session,
            event_type="test_org_stamp",
            event_category="testing",
            severity="info",
            event_data={"k": "v"},
            user_id=user_id,
        )
        assert entry is not None
        assert entry.organization_id == org_id
        assert entry.hash_version == 3

    async def test_explicit_org_wins_without_user(
        self, db_session: AsyncSession, two_orgs_with_users
    ):
        org_id, _user_id = two_orgs_with_users["b"]
        entry = await log_audit_event(
            db=db_session,
            event_type="test_explicit_org",
            event_category="testing",
            severity="info",
            event_data={},
            organization_id=org_id,
        )
        assert entry is not None
        assert entry.organization_id == org_id

    async def test_platform_event_has_no_org(self, db_session: AsyncSession):
        entry = await log_audit_event(
            db=db_session,
            event_type="test_platform_event",
            event_category="testing",
            severity="info",
            event_data={},
        )
        assert entry is not None
        assert entry.organization_id is None


class TestChainIntegrity:

    async def test_v3_chain_verifies_and_binds_org(
        self, db_session: AsyncSession, two_orgs_with_users
    ):
        org_a, user_a = two_orgs_with_users["a"]
        org_b, user_b = two_orgs_with_users["b"]
        for uid in (user_a, user_b):
            entry = await log_audit_event(
                db=db_session,
                event_type="test_chain",
                event_category="testing",
                severity="info",
                event_data={"who": uid},
                user_id=uid,
            )
            assert entry is not None

        result = await audit_logger.verify_integrity(db_session)
        assert result["verified"] is True, result["errors"]

        # Tampering with a v3 row's org is detectable: flipping it breaks
        # the stored hash.
        first = (
            (await db_session.execute(select(AuditLog).order_by(AuditLog.id)))
            .scalars()
            .first()
        )
        await db_session.execute(
            text("UPDATE audit_logs SET organization_id = :o WHERE id = :id"),
            {"o": org_b, "id": first.id},
        )
        db_session.expire_all()
        result = await audit_logger.verify_integrity(db_session)
        assert result["verified"] is False

    async def test_backfill_on_v2_row_keeps_chain_valid(
        self, db_session: AsyncSession, two_orgs_with_users, monkeypatch
    ):
        """The migration backfills org onto pre-column rows (v1/v2). Their
        hash input never included organization_id, so the UPDATE must not
        break verification."""
        org_id, user_id = two_orgs_with_users["a"]

        # Write a row the way the pre-column code did (v2, org not stamped).
        monkeypatch.setattr(audit_module, "_CURRENT_HASH_VERSION", 2)
        legacy = await log_audit_event(
            db=db_session,
            event_type="test_legacy_row",
            event_category="testing",
            severity="info",
            event_data={},
            user_id=user_id,
        )
        monkeypatch.undo()
        assert legacy is not None
        assert legacy.hash_version == 2

        # Strip the auto-stamped org so the row looks exactly like one
        # written before the column existed (v2 hashes ignore the column,
        # so this cannot affect verification).
        await db_session.execute(
            text("UPDATE audit_logs SET organization_id = NULL WHERE id = :id"),
            {"id": legacy.id},
        )

        # Backfill-style UPDATE, exactly like migration 20260801_0009.
        await db_session.execute(
            text(
                "UPDATE audit_logs a JOIN users u ON a.user_id = u.id "
                "SET a.organization_id = u.organization_id "
                "WHERE a.organization_id IS NULL AND a.id = :id"
            ),
            {"id": legacy.id},
        )
        db_session.expire_all()

        result = await audit_logger.verify_integrity(db_session)
        assert result["verified"] is True, result["errors"]

        refreshed = (
            await db_session.execute(select(AuditLog).where(AuditLog.id == legacy.id))
        ).scalar_one()
        assert refreshed.organization_id == org_id


class TestOrgScopedReads:

    async def test_org_filter_isolates_tenants(
        self, db_session: AsyncSession, two_orgs_with_users
    ):
        org_a, user_a = two_orgs_with_users["a"]
        org_b, user_b = two_orgs_with_users["b"]
        for uid in (user_a, user_b):
            await log_audit_event(
                db=db_session,
                event_type="test_isolation",
                event_category="testing",
                severity="info",
                event_data={},
                user_id=uid,
            )
        # Platform-level row: visible to no org.
        await log_audit_event(
            db=db_session,
            event_type="test_isolation",
            event_category="testing",
            severity="info",
            event_data={},
        )

        # The filter every read path now uses.
        rows_a = (
            (
                await db_session.execute(
                    select(AuditLog).where(AuditLog.organization_id == org_a)
                )
            )
            .scalars()
            .all()
        )
        assert {r.user_id for r in rows_a} == {user_a}

        rows_b = (
            (
                await db_session.execute(
                    select(AuditLog).where(AuditLog.organization_id == org_b)
                )
            )
            .scalars()
            .all()
        )
        assert {r.user_id for r in rows_b} == {user_b}
