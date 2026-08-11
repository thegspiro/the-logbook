"""
Apparatus Service Unit Tests

Focused on the AP2-1 fix: update paths must re-validate client-supplied
foreign keys against the caller's org, matching their create counterparts.
Each of these FKs is eager-loaded into a response relationship
(apparatus_type / status_record / primary_station / evoc_level /
maintenance_type), so an unvalidated foreign id set via update is a
cross-tenant read leak, not merely a dangling reference.

Uses mocked sessions/helpers — no DB — so it runs in the sandbox.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.models.apparatus import ApparatusOperator
from app.schemas.apparatus import (
    ApparatusComponentNoteUpdate,
    ApparatusMaintenanceUpdate,
    ApparatusOperatorUpdate,
    ApparatusUpdate,
)
from app.services.apparatus_service import ApparatusService


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
    return ApparatusService(mock_db)


@pytest.fixture
def org_id():
    return str(uuid4())


def _result(value):
    r = MagicMock()
    r.scalar_one_or_none.return_value = value
    r.scalar_one.return_value = value
    return r


class TestUpdateOperatorFKValidation:
    """update_operator must validate a supplied evoc_level_id in-org."""

    async def test_foreign_evoc_level_rejected(self, service, mock_db, org_id):
        operator = MagicMock(spec=ApparatusOperator)
        # 1st execute: fetch the operator (in-org). 2nd execute: assert_in_org's
        # EVOC lookup returns nothing -> the id is foreign/nonexistent.
        mock_db.execute.side_effect = [_result(operator), _result(None)]

        data = ApparatusOperatorUpdate(evoc_level_id=str(uuid4()))
        with pytest.raises(ValueError, match="EVOC level"):
            await service.update_operator(str(uuid4()), data, org_id)

    async def test_no_evoc_change_skips_validation(self, service, mock_db, org_id):
        operator = MagicMock(spec=ApparatusOperator)
        # Two queries, neither of them a validation: the operator fetch, then
        # the post-commit reload that loads evoc_level for the response.
        # assert_in_org(None, allow_none) makes no query of its own, so a third
        # execute would be one (StopIteration).
        mock_db.execute.side_effect = [_result(operator), _result(operator)]

        data = ApparatusOperatorUpdate(is_active=False)
        result = await service.update_operator(str(uuid4()), data, org_id)
        assert result is operator
        assert mock_db.execute.await_count == 2


class TestUpdateApparatusFKValidation:
    """update_apparatus must validate a supplied type/status/station in-org."""

    async def test_foreign_apparatus_type_rejected(self, service, org_id):
        with patch.object(
            service, "get_apparatus", return_value=MagicMock()
        ), patch.object(service, "get_apparatus_type", return_value=None):
            data = ApparatusUpdate(apparatus_type_id=str(uuid4()))
            with pytest.raises(ValueError, match="apparatus type"):
                await service.update_apparatus(str(uuid4()), data, org_id, "user")

    async def test_foreign_status_rejected(self, service, org_id):
        with patch.object(
            service, "get_apparatus", return_value=MagicMock()
        ), patch.object(service, "get_apparatus_status", return_value=None):
            data = ApparatusUpdate(status_id=str(uuid4()))
            with pytest.raises(ValueError, match="status"):
                await service.update_apparatus(str(uuid4()), data, org_id, "user")

    async def test_foreign_station_rejected(self, service, mock_db, org_id):
        # get_apparatus is patched, so the only execute is assert_in_org's
        # Location lookup, which returns nothing -> foreign station.
        mock_db.execute.side_effect = [_result(None)]
        with patch.object(service, "get_apparatus", return_value=MagicMock()):
            data = ApparatusUpdate(primary_station_id=str(uuid4()))
            with pytest.raises(ValueError, match="station"):
                await service.update_apparatus(str(uuid4()), data, org_id, "user")


class TestUpdateMaintenanceFKValidation:
    """update_maintenance_record must validate a supplied maintenance_type_id."""

    async def test_foreign_maintenance_type_rejected(self, service, org_id):
        with patch.object(
            service, "get_maintenance_record", return_value=MagicMock()
        ), patch.object(service, "get_maintenance_type", return_value=None):
            data = ApparatusMaintenanceUpdate(maintenance_type_id=str(uuid4()))
            with pytest.raises(ValueError, match="maintenance type"):
                await service.update_maintenance_record(
                    str(uuid4()), data, org_id, "user"
                )

    async def test_foreign_component_rejected(self, service, mock_db, org_id):
        # AP2-2: only component_id supplied → maintenance_type check skipped, the
        # single execute is assert_in_org's component lookup (returns nothing).
        mock_db.execute.side_effect = [_result(None)]
        with patch.object(service, "get_maintenance_record", return_value=MagicMock()):
            data = ApparatusMaintenanceUpdate(component_id=str(uuid4()))
            with pytest.raises(ValueError, match="component"):
                await service.update_maintenance_record(
                    str(uuid4()), data, org_id, "user"
                )

    async def test_foreign_service_provider_rejected(self, service, mock_db, org_id):
        # AP2-2: component_id is None (no query), so the single execute is the
        # service-provider lookup.
        mock_db.execute.side_effect = [_result(None)]
        with patch.object(service, "get_maintenance_record", return_value=MagicMock()):
            data = ApparatusMaintenanceUpdate(service_provider_id=str(uuid4()))
            with pytest.raises(ValueError, match="service provider"):
                await service.update_maintenance_record(
                    str(uuid4()), data, org_id, "user"
                )


class TestUpdateApparatusEvocFKValidation:
    """AP2-2: update_apparatus must validate a supplied required_evoc_level_id."""

    async def test_foreign_required_evoc_level_rejected(self, service, mock_db, org_id):
        # Only required_evoc_level_id supplied → type/status/station checks make no
        # query, so the single execute is the EVOC-level lookup (returns nothing).
        mock_db.execute.side_effect = [_result(None)]
        with patch.object(service, "get_apparatus", return_value=MagicMock()):
            data = ApparatusUpdate(required_evoc_level_id=str(uuid4()))
            with pytest.raises(ValueError, match="EVOC level"):
                await service.update_apparatus(str(uuid4()), data, org_id, "user")


class TestUpdateComponentNoteFKValidation:
    """AP2-2: update_component_note must validate a supplied service_provider_id."""

    async def test_foreign_service_provider_rejected(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_result(None)]
        with patch.object(service, "get_component_note", return_value=MagicMock()):
            data = ApparatusComponentNoteUpdate(service_provider_id=str(uuid4()))
            with pytest.raises(ValueError, match="service provider"):
                await service.update_component_note(str(uuid4()), data, org_id)
