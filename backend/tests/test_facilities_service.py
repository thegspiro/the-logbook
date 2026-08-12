"""
Facilities Service Unit Tests

Focused on FAC2-1: the sub-entity update paths must re-validate a reassigned
parent FK (facility_id / utility_account_id / checklist_id) in the caller's
org, mirroring their create paths. Without this, `_apply_updates`' blind
setattr (and the two hand-rolled setattr loops) let a row be re-parented onto
another org's facility.

Mocked sessions/getters — no DB — so it runs in the sandbox.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.schemas.facilities import (
    FacilityAccessKeyUpdate,
    FacilityCapitalProjectUpdate,
    FacilityComplianceItemUpdate,
    FacilityOccupantUpdate,
    FacilityRoomUpdate,
)
from app.services.facilities_service import FacilitiesService


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return FacilitiesService(mock_db)


@pytest.fixture
def org_id():
    return str(uuid4())


class TestAssertFacilityInOrg:
    """The shared helper used by every facility_id-bearing update path."""

    async def test_foreign_facility_raises(self, service, org_id):
        with patch.object(service, "get_facility", return_value=None):
            with pytest.raises(ValueError, match="Invalid facility"):
                await service._assert_facility_in_org(str(uuid4()), org_id)

    async def test_none_facility_is_noop(self, service, org_id):
        with patch.object(service, "get_facility", return_value=None) as mock_get:
            await service._assert_facility_in_org(None, org_id)
        mock_get.assert_not_awaited()

    async def test_in_org_facility_passes(self, service, org_id):
        with patch.object(service, "get_facility", return_value=MagicMock()):
            await service._assert_facility_in_org(str(uuid4()), org_id)  # no raise


class TestDashboardCounts:
    async def test_counts_are_unpaginated_database_aggregates(
        self, service, mock_db, org_id
    ):
        mock_db.scalar.side_effect = [125, 98, 17, 9]

        result = await service.get_dashboard_counts(org_id)

        assert result == {
            "total_facilities": 125,
            "operational_facilities": 98,
            "overdue_maintenance": 17,
            "upcoming_inspections": 9,
        }
        assert mock_db.scalar.await_count == 4

    async def test_null_database_counts_become_zero(self, service, mock_db, org_id):
        mock_db.scalar.side_effect = [None, None, None, None]

        result = await service.get_dashboard_counts(org_id)

        assert set(result.values()) == {0}


class TestUpdateReparentingRejected:
    """A reassigned parent FK that isn't in-org is rejected before any write."""

    async def test_room_rejects_foreign_facility(self, service, org_id):
        with patch.object(service, "get_room", return_value=MagicMock()), patch.object(
            service, "get_facility", return_value=None
        ):
            with pytest.raises(ValueError, match="Invalid facility"):
                await service.update_room(
                    str(uuid4()),
                    FacilityRoomUpdate(facility_id=str(uuid4())),
                    org_id,
                )

    async def test_occupant_rejects_foreign_facility(self, service, org_id):
        with patch.object(
            service, "get_occupant", return_value=MagicMock()
        ), patch.object(service, "get_facility", return_value=None):
            with pytest.raises(ValueError, match="Invalid facility"):
                await service.update_occupant(
                    str(uuid4()),
                    FacilityOccupantUpdate(facility_id=str(uuid4())),
                    org_id,
                )

    async def test_capital_project_rejects_foreign_facility(self, service, org_id):
        with patch.object(
            service, "get_capital_project", return_value=MagicMock()
        ), patch.object(service, "get_facility", return_value=None):
            with pytest.raises(ValueError, match="Invalid facility"):
                await service.update_capital_project(
                    str(uuid4()),
                    FacilityCapitalProjectUpdate(facility_id=str(uuid4())),
                    org_id,
                )

    async def test_access_key_rejects_foreign_facility(self, service, org_id):
        with patch.object(
            service, "get_access_key", return_value=MagicMock()
        ), patch.object(service, "get_facility", return_value=None):
            with pytest.raises(ValueError, match="Invalid facility"):
                await service.update_access_key(
                    str(uuid4()),
                    FacilityAccessKeyUpdate(facility_id=str(uuid4())),
                    org_id,
                )

    async def test_compliance_item_rejects_foreign_checklist(self, service, org_id):
        with patch.object(
            service, "get_compliance_item", return_value=MagicMock()
        ), patch.object(service, "get_compliance_checklist", return_value=None):
            with pytest.raises(ValueError, match="Invalid compliance checklist"):
                await service.update_compliance_item(
                    str(uuid4()),
                    FacilityComplianceItemUpdate(checklist_id=str(uuid4())),
                    org_id,
                )


class TestUpdateWithoutReparentingSkipsCheck:
    """An update that doesn't touch the parent FK never queries it."""

    async def test_occupant_no_facility_change_skips_validation(self, service, org_id):
        occupant = MagicMock()
        with patch.object(service, "get_occupant", return_value=occupant), patch.object(
            service, "get_facility", return_value=None
        ) as mock_get, patch.object(service, "_apply_updates", new_callable=AsyncMock):
            result = await service.update_occupant(
                str(uuid4()), FacilityOccupantUpdate(unit_name="Bay 2"), org_id
            )
        assert result is occupant
        mock_get.assert_not_awaited()
