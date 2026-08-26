"""
Facilities Service Unit Tests

Focused on FAC2-1: the sub-entity update paths must re-validate a reassigned
parent FK (facility_id / utility_account_id / checklist_id) in the caller's
org, mirroring their create paths. Without this, `_apply_updates`' blind
setattr (and the two hand-rolled setattr loops) let a row be re-parented onto
another org's facility.

Mocked sessions/getters — no DB — so it runs in the sandbox.
"""

import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.dialects import mysql

from app.models.facilities import Facility, FacilityPhoto
from app.schemas.facilities import (
    FacilityAccessKeyUpdate,
    FacilityCapitalProjectUpdate,
    FacilityComplianceItemUpdate,
    FacilityDocumentResponse,
    FacilityOccupantUpdate,
    FacilityPhotoResponse,
    FacilityRoomUpdate,
)
from app.services.facilities_service import FacilitiesService
from app.utils.model_updates import apply_updates


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

    async def test_dashboard_summary_uses_globally_ordered_preview_queries(
        self, service, mock_db, org_id
    ):
        service.get_dashboard_counts = AsyncMock(
            return_value={
                "total_facilities": 125,
                "operational_facilities": 98,
                "overdue_maintenance": 17,
                "upcoming_inspections": 9,
            }
        )
        overdue = SimpleNamespace(
            id="maint-overdue",
            facility_id="facility-1",
            description="Repair bay door",
            due_date=None,
            completed_date=None,
            updated_at=None,
        )
        inspection = SimpleNamespace(
            id="inspection-next",
            facility_id="facility-2",
            title="Annual inspection",
            next_inspection_date="2026-08-21",
        )
        completed = SimpleNamespace(
            id="maint-complete",
            facility_id="facility-3",
            description="Generator service",
            due_date=None,
            completed_date="2026-08-19",
            updated_at=None,
        )
        mock_db.execute.side_effect = [
            SimpleNamespace(all=lambda: [(overdue, "Station 1")]),
            SimpleNamespace(all=lambda: [(inspection, "Station 2")]),
            SimpleNamespace(all=lambda: [(completed, "Station 3")]),
        ]

        result = await service.get_dashboard_summary(org_id)

        assert result["overdue_maintenance_records"][0]["facility_name"] == "Station 1"
        assert result["upcoming_inspection_records"][0]["facility_name"] == "Station 2"
        assert (
            result["recent_maintenance_completions"][0]["facility_name"] == "Station 3"
        )
        assert mock_db.execute.await_count == 3

        # The production database is MySQL/MariaDB, which rejects the
        # PostgreSQL-style ``NULLS LAST`` modifier.  The preview queries must
        # express null placement portably so opening the dashboard does not
        # fail with LB-SYS-001.
        statements = [call.args[0] for call in mock_db.execute.await_args_list]
        compiled_sql = "\n".join(
            str(statement.compile(dialect=mysql.dialect())) for statement in statements
        )
        assert "NULLS LAST" not in compiled_sql.upper()
        assert "facility_maintenance.due_date IS NULL" in compiled_sql
        assert "facility_maintenance.completed_date IS NULL" in compiled_sql


class TestUpdateReparentingRejected:
    """A reassigned parent FK that isn't in-org is rejected before any write."""

    async def test_room_rejects_foreign_facility(self, service, org_id):
        with (
            patch.object(service, "get_room", return_value=MagicMock()),
            patch.object(service, "get_facility", return_value=None),
        ):
            with pytest.raises(ValueError, match="Invalid facility"):
                await service.update_room(
                    str(uuid4()),
                    FacilityRoomUpdate(facility_id=str(uuid4())),
                    org_id,
                )

    async def test_occupant_rejects_foreign_facility(self, service, org_id):
        with (
            patch.object(service, "get_occupant", return_value=MagicMock()),
            patch.object(service, "get_facility", return_value=None),
        ):
            with pytest.raises(ValueError, match="Invalid facility"):
                await service.update_occupant(
                    str(uuid4()),
                    FacilityOccupantUpdate(facility_id=str(uuid4())),
                    org_id,
                )

    async def test_capital_project_rejects_foreign_facility(self, service, org_id):
        with (
            patch.object(service, "get_capital_project", return_value=MagicMock()),
            patch.object(service, "get_facility", return_value=None),
        ):
            with pytest.raises(ValueError, match="Invalid facility"):
                await service.update_capital_project(
                    str(uuid4()),
                    FacilityCapitalProjectUpdate(facility_id=str(uuid4())),
                    org_id,
                )

    async def test_access_key_rejects_foreign_facility(self, service, org_id):
        with (
            patch.object(service, "get_access_key", return_value=MagicMock()),
            patch.object(service, "get_facility", return_value=None),
        ):
            with pytest.raises(ValueError, match="Invalid facility"):
                await service.update_access_key(
                    str(uuid4()),
                    FacilityAccessKeyUpdate(facility_id=str(uuid4())),
                    org_id,
                )

    async def test_compliance_item_rejects_foreign_checklist(self, service, org_id):
        with (
            patch.object(service, "get_compliance_item", return_value=MagicMock()),
            patch.object(service, "get_compliance_checklist", return_value=None),
        ):
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
        with (
            patch.object(service, "get_occupant", return_value=occupant),
            patch.object(service, "get_facility", return_value=None) as mock_get,
            patch.object(service, "_apply_updates", new_callable=AsyncMock),
        ):
            result = await service.update_occupant(
                str(uuid4()), FacilityOccupantUpdate(unit_name="Bay 2"), org_id
            )
        assert result is occupant
        mock_get.assert_not_awaited()


class TestNullabilityGuard:
    """FAC-7: an explicit null on a NOT NULL column must fail clean (a
    ValueError the endpoint turns into 400), not reach flush and raise a raw
    IntegrityError (500). `Facility.name` and `FacilityPhoto.is_primary` are
    the two columns a Codex review on PR #1836 named as reachable via
    `update_facility`/`update_photo`'s (former) blind `setattr` loops.
    """

    def test_facility_name_cannot_be_nulled(self):
        facility = Facility(name="Station 1", organization_id=str(uuid4()))
        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(facility, {"name": None})

    def test_photo_is_primary_cannot_be_nulled(self):
        photo = FacilityPhoto(is_primary=True)
        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(photo, {"is_primary": None})

    @pytest.mark.parametrize(
        "method_name",
        [
            "_apply_updates",
            "update_facility",
            "update_photo",
            "update_maintenance_record",
            "update_inspection",
            "update_capital_project",
            "update_insurance_policy",
        ],
    )
    def test_update_methods_route_through_the_shared_guard(self, method_name):
        """Every update path that used to hand-roll `for field, value in
        update_data.items(): setattr(...)` must route through the shared
        `apply_updates` utility instead, or a future edit can silently
        reintroduce the null-on-NOT-NULL 500."""
        source = inspect.getsource(getattr(FacilitiesService, method_name))
        assert "apply_updates(" in source
        assert "for field, value in update_data.items()" not in source


class TestFacilityFileResponseRedaction:
    """FAC-8: `file_path` is an internal storage location, not something a
    baseline `facilities.view` holder should learn — mirrors the generic
    Documents module's `DocumentResponse`, which excludes the same field."""

    def test_photo_response_excludes_file_path(self):
        assert "file_path" not in FacilityPhotoResponse.model_fields

    def test_document_response_excludes_file_path(self):
        assert "file_path" not in FacilityDocumentResponse.model_fields
