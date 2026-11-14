"""The fleet board carries the dashboard's apparatus "Maintenance due" figure.

DASH-38, owner decision 2026-11-01: no apparatus maintenance page is built; the
fleet board carries the figure instead. The tile counts the fleet summary's
``maintenance_due_soon`` and links to ``/apparatus?maintenance=due``, where the
board lists ``GET /apparatus/maintenance/due`` with the tile's 30-day window.
Both read ``ApparatusService.get_maintenance_due``, so the list must have
exactly as many rows as the tile's number, overdue work included.
"""

import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.api.v1.endpoints import apparatus as endpoints
from app.api.v1.endpoints.dashboard import get_asset_widgets
from app.models.apparatus import (
    Apparatus,
    ApparatusMaintenance,
    ApparatusMaintenanceType,
    ApparatusStatus,
    ApparatusType,
)
from app.models.user import Organization
from app.utils.org_timezone import resolve_org_today

pytestmark = pytest.mark.integration


async def _org(db, label):
    org = Organization(
        id=str(uuid.uuid4()),
        name=label,
        slug=f"{label.lower()}-{uuid.uuid4().hex[:8]}",
    )
    db.add(org)
    await db.flush()
    return org


async def _engine(db, org, unit):
    kind = ApparatusType(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Engine",
        code=f"ENG{uuid.uuid4().hex[:4]}",
    )
    status = ApparatusStatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="In Service",
        code="in_service",
    )
    service = ApparatusMaintenanceType(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Pump test",
        code=f"PUMP{uuid.uuid4().hex[:4]}",
    )
    db.add_all([kind, status, service])
    await db.flush()
    engine = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        unit_number=unit,
        apparatus_type_id=kind.id,
        status_id=status.id,
    )
    db.add(engine)
    await db.flush()
    return engine, service


def _job(org, engine, service, label, due, **fields):
    return ApparatusMaintenance(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        apparatus_id=engine.id,
        maintenance_type_id=service.id,
        description=label,
        due_date=due,
        **fields,
    )


async def test_the_board_lists_exactly_what_the_tile_counts(db_session):
    org = await _org(db_session, "Fleet")
    engine, service = await _engine(db_session, org, "E-1")
    today = await resolve_org_today(db_session, org.id)
    db_session.add_all(
        [
            _job(org, engine, service, "overdue", today - timedelta(days=3)),
            _job(org, engine, service, "flagged, no date", None, is_overdue=True),
            _job(org, engine, service, "today", today),
            _job(org, engine, service, "day 30", today + timedelta(days=30)),
            _job(org, engine, service, "day 31", today + timedelta(days=31)),
            _job(
                org,
                engine,
                service,
                "completed",
                today + timedelta(days=5),
                is_completed=True,
            ),
        ]
    )
    other = await _org(db_session, "Other")
    their_engine, their_service = await _engine(db_session, other, "X-1")
    db_session.add(
        _job(other, their_engine, their_service, "other org", today),
    )
    await db_session.flush()

    listed = await endpoints.get_maintenance_due(
        days_ahead=30,
        include_overdue=True,
        db=db_session,
        current_user=SimpleNamespace(organization_id=org.id),
    )

    with (
        patch(
            "app.api.v1.endpoints.dashboard.OrganizationService.get_enabled_modules",
            new=AsyncMock(return_value=SimpleNamespace(enabled_modules=["apparatus"])),
        ),
        patch(
            "app.api.v1.endpoints.dashboard.user_has_permission",
            side_effect=lambda _user, permission: permission == "apparatus.manage",
        ),
    ):
        widgets = await get_asset_widgets(
            db=db_session, current_user=SimpleNamespace(organization_id=org.id)
        )
    tile = next(w for w in widgets.widgets if w.id == "apparatus-maintenance")

    assert len(listed) == 4
    assert tile.count == len(listed)
    assert tile.href == "/apparatus?maintenance=due"
