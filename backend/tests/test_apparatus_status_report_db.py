"""The Apparatus Status report against a real database.

The open-work-order count filtered on ``ApparatusMaintenance.status``, a column
the model has never had — open work orders are the ones with
``is_completed`` false. Building the query raised ``AttributeError`` as soon as
the organization had a single apparatus, so the report failed for every fleet
it had anything to say about. ``test_reports_service.py`` mocks the session and
never builds that query, which is how it went unnoticed.
"""

import uuid
from datetime import date

import pytest

from app.models.apparatus import (
    Apparatus,
    ApparatusMaintenance,
    ApparatusMaintenanceType,
    ApparatusStatus,
    ApparatusType,
)
from app.models.user import Organization
from app.services.reports_service import ReportsService

pytestmark = [pytest.mark.integration]


async def _fleet(db_session):
    org = Organization(
        id=str(uuid.uuid4()), name="Fleet", slug=f"fleet-{uuid.uuid4().hex[:8]}"
    )
    db_session.add(org)
    await db_session.flush()

    apparatus_type = ApparatusType(
        id=str(uuid.uuid4()), organization_id=org.id, name="Engine", code="ENG"
    )
    apparatus_status = ApparatusStatus(
        id=str(uuid.uuid4()), organization_id=org.id, name="In Service", code="IS"
    )
    maintenance_type = ApparatusMaintenanceType(
        id=str(uuid.uuid4()), organization_id=org.id, name="Pump test", code="PT"
    )
    db_session.add_all([apparatus_type, apparatus_status, maintenance_type])
    await db_session.flush()

    apparatus = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        unit_number="Engine 1",
        apparatus_type_id=apparatus_type.id,
        status_id=apparatus_status.id,
    )
    db_session.add(apparatus)
    await db_session.flush()
    return org, apparatus, maintenance_type


def _work_order(org, apparatus, maintenance_type, completed: bool):
    return ApparatusMaintenance(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        apparatus_id=apparatus.id,
        maintenance_type_id=maintenance_type.id,
        due_date=date(2026, 1, 1),
        is_completed=completed,
    )


class TestApparatusStatusReport:
    async def test_counts_only_open_work_orders(self, db_session):
        org, apparatus, maintenance_type = await _fleet(db_session)
        db_session.add_all(
            [
                _work_order(org, apparatus, maintenance_type, completed=False),
                _work_order(org, apparatus, maintenance_type, completed=False),
                _work_order(org, apparatus, maintenance_type, completed=True),
            ]
        )
        await db_session.flush()

        report = await ReportsService(db_session)._generate_apparatus_status(org.id)

        [row] = report["entries"]
        assert row["apparatus_id"] == apparatus.id
        assert row["open_work_orders"] == 2

    async def test_apparatus_with_no_work_orders_reports_zero(self, db_session):
        org, apparatus, _maintenance_type = await _fleet(db_session)

        report = await ReportsService(db_session)._generate_apparatus_status(org.id)

        [row] = report["entries"]
        assert row["open_work_orders"] == 0
