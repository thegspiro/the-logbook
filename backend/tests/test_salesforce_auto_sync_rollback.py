"""Salesforce auto-sync keeps going after one integration's sync fails.

The failure path rolls the session back, which expires every instance the
session holds. A runner that iterated rows loaded before the loop then read an
expired attribute on the next one, and an expired attribute on an
AsyncSession triggers a lazy load outside the greenlet (MissingGreenlet) —
so one department's Salesforce outage silently skipped every department
after it. This drives the real session through that rollback.
"""

import uuid

import pytest
from sqlalchemy import select, text

import app.services.integration_services.salesforce_sync_service as svcmod
from app.models.integration import (
    INTEGRATION_RUN_FAILURE,
    INTEGRATION_RUN_SUCCESS,
    Integration,
    IntegrationSyncLog,
)
from app.services import scheduled_tasks as st

pytestmark = pytest.mark.integration


async def _make_org_with_salesforce(db_session) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": f"Dept {org_id[:8]}", "slug": f"sf-{org_id[:8]}"},
    )
    db_session.add(
        Integration(
            organization_id=org_id,
            integration_type="salesforce",
            name="Salesforce",
            category="Data",
            status="connected",
            enabled=True,
            config={"auto_sync_enabled": True, "sync_direction": "push"},
        )
    )
    await db_session.flush()
    return org_id


async def test_one_failing_integration_does_not_skip_the_rest(db_session, monkeypatch):
    org_ids = {
        await _make_org_with_salesforce(db_session),
        await _make_org_with_salesforce(db_session),
    }
    # Released as a savepoint by the fixture, so the runner's rollback cannot
    # take the setup rows with it.
    await db_session.commit()

    # Whichever of the two the runner reaches first fails; the query has no
    # ORDER BY, and the hazard is the rollback *before* the second one.
    attempted: list[str] = []
    pushed: list[str] = []

    async def fake_get(_db, org_id):
        if org_id in org_ids:
            attempted.append(org_id)
            if len(attempted) == 1:
                raise RuntimeError("Salesforce unreachable")
        return object()

    async def fake_push(_db, _svc, org_id, _sync_types):
        if org_id in org_ids:
            pushed.append(org_id)
        return {"members": 0}

    monkeypatch.setattr(svcmod, "get_salesforce_sync_service", fake_get)
    monkeypatch.setattr(svcmod, "push_org_to_salesforce", fake_push)

    result = await st.run_salesforce_auto_sync(db_session)

    assert len(attempted) == 2, "the second integration was never attempted"
    failed_org, synced_org = attempted
    assert pushed == [synced_org]
    assert result["failed"] >= 1
    assert result["synced"] >= 1

    rows = {
        i.organization_id: i
        for i in (
            await db_session.execute(
                select(Integration).where(Integration.organization_id.in_(org_ids))
            )
        ).scalars()
    }
    await db_session.refresh(rows[synced_org])
    await db_session.refresh(rows[failed_org])
    assert rows[synced_org].last_sync_at is not None
    assert rows[failed_org].last_sync_at is None
    assert rows[failed_org].consecutive_error_count == 1

    runs = (
        await db_session.execute(
            select(IntegrationSyncLog.integration_id, IntegrationSyncLog.status).where(
                IntegrationSyncLog.integration_id.in_(
                    [rows[synced_org].id, rows[failed_org].id]
                )
            )
        )
    ).all()
    statuses = {iid: status for iid, status in runs}
    assert statuses[rows[synced_org].id] == INTEGRATION_RUN_SUCCESS
    assert statuses[rows[failed_org].id] == INTEGRATION_RUN_FAILURE
