"""
Equipment Check Service Unit Tests

Focused on EC2-1: update_template must validate a reassigned apparatus_id in
the caller's org (mirroring create_template / clone_template). The template's
apparatus_id is resolved to an apparatus *name* in the checklist/supply
listings, so a foreign apparatus_id set via the generic update setattr loop
would leak another org's apparatus name.

Mocked sessions/getters — no DB — so it runs in the sandbox.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.equipment_check_service import EquipmentCheckService


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.commit = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return EquipmentCheckService(mock_db)


class TestUpdateTemplateApparatusValidation:
    async def test_foreign_apparatus_rejected(self, service, mock_db):
        template = MagicMock()
        with patch.object(
            service, "get_template", new_callable=AsyncMock, return_value=template
        ), patch(
            "app.services.equipment_check_service.is_in_org",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(ValueError, match="Invalid apparatus"):
                await service.update_template(
                    "tmpl-1", "org-1", {"apparatus_id": "foreign-apparatus"}
                )
        # Rejected before any write.
        mock_db.commit.assert_not_awaited()

    async def test_in_org_apparatus_passes(self, service, mock_db):
        template = MagicMock()
        with patch.object(
            service, "get_template", new_callable=AsyncMock, return_value=template
        ), patch(
            "app.services.equipment_check_service.is_in_org",
            new_callable=AsyncMock,
            return_value=True,
        ) as mock_in_org:
            await service.update_template(
                "tmpl-1", "org-1", {"apparatus_id": "own-apparatus"}
            )
        mock_in_org.assert_awaited_once()
        mock_db.commit.assert_awaited_once()

    async def test_no_apparatus_change_skips_validation(self, service, mock_db):
        template = MagicMock()
        with patch.object(
            service, "get_template", new_callable=AsyncMock, return_value=template
        ), patch(
            "app.services.equipment_check_service.is_in_org",
            new_callable=AsyncMock,
        ) as mock_in_org:
            await service.update_template("tmpl-1", "org-1", {"name": "Engine 1 AM"})
        mock_in_org.assert_not_awaited()
        mock_db.commit.assert_awaited_once()

    async def test_clearing_apparatus_skips_validation(self, service, mock_db):
        # apparatus_id=None clears it (a generic template) — not a foreign-id case.
        template = MagicMock()
        with patch.object(
            service, "get_template", new_callable=AsyncMock, return_value=template
        ), patch(
            "app.services.equipment_check_service.is_in_org",
            new_callable=AsyncMock,
        ) as mock_in_org:
            await service.update_template("tmpl-1", "org-1", {"apparatus_id": None})
        mock_in_org.assert_not_awaited()
        mock_db.commit.assert_awaited_once()

    async def test_missing_template_returns_none(self, service):
        with patch.object(
            service, "get_template", new_callable=AsyncMock, return_value=None
        ):
            result = await service.update_template("tmpl-x", "org-1", {"name": "X"})
        assert result is None


class TestUpdateItemCompartmentValidation:
    """update_item must validate a reassigned compartment_id in-org — moving an
    item to a foreign compartment transfers it (with the caller's content) into
    another org's checklist, since the item is org-scoped only via
    compartment -> template."""

    async def test_foreign_compartment_rejected(self, service, mock_db):
        with patch.object(
            service, "_get_item", new_callable=AsyncMock, return_value=MagicMock()
        ), patch.object(
            service, "_get_compartment", new_callable=AsyncMock, return_value=None
        ):
            with pytest.raises(ValueError, match="Invalid compartment"):
                await service.update_item(
                    "item-1", "org-1", {"compartment_id": "foreign-compartment"}
                )
        mock_db.commit.assert_not_awaited()

    async def test_in_org_compartment_passes(self, service, mock_db):
        with patch.object(
            service, "_get_item", new_callable=AsyncMock, return_value=MagicMock()
        ), patch.object(
            service,
            "_get_compartment",
            new_callable=AsyncMock,
            return_value=MagicMock(),
        ) as mock_get_comp:
            await service.update_item(
                "item-1", "org-1", {"compartment_id": "own-compartment"}
            )
        mock_get_comp.assert_awaited_once()
        mock_db.commit.assert_awaited_once()

    async def test_no_compartment_change_skips_validation(self, service, mock_db):
        with patch.object(
            service, "_get_item", new_callable=AsyncMock, return_value=MagicMock()
        ), patch.object(
            service, "_get_compartment", new_callable=AsyncMock
        ) as mock_get_comp:
            await service.update_item("item-1", "org-1", {"name": "SCBA cylinder"})
        mock_get_comp.assert_not_awaited()
        mock_db.commit.assert_awaited_once()


class TestItemFkValidation:
    """EC2-4/EC2-3: inventory_item_id (name-projected in get_my_checklists) and
    equipment_id must be validated in-org on add_item / update_item."""

    async def test_add_item_rejects_foreign_inventory_item(self, service, mock_db):
        with patch.object(
            service,
            "_get_compartment",
            new_callable=AsyncMock,
            return_value=MagicMock(),
        ), patch(
            "app.services.equipment_check_service.is_in_org",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(ValueError, match="Invalid inventory item"):
                await service.add_item(
                    "comp-1", "org-1", {"inventory_item_id": "foreign-inv"}
                )
        mock_db.commit.assert_not_awaited()

    async def test_add_item_rejects_foreign_equipment(self, service, mock_db):
        with patch.object(
            service,
            "_get_compartment",
            new_callable=AsyncMock,
            return_value=MagicMock(),
        ), patch(
            "app.services.equipment_check_service.is_in_org",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(ValueError, match="Invalid equipment"):
                await service.add_item(
                    "comp-1", "org-1", {"equipment_id": "foreign-equip"}
                )
        mock_db.commit.assert_not_awaited()

    async def test_update_item_rejects_foreign_inventory_item(self, service, mock_db):
        with patch.object(
            service, "_get_item", new_callable=AsyncMock, return_value=MagicMock()
        ), patch(
            "app.services.equipment_check_service.is_in_org",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(ValueError, match="Invalid inventory item"):
                await service.update_item(
                    "item-1", "org-1", {"inventory_item_id": "foreign-inv"}
                )
        mock_db.commit.assert_not_awaited()


class TestCompartmentParentValidation:
    """EC2-3: a reassigned parent_compartment_id must be in-org."""

    async def test_update_compartment_rejects_foreign_parent(self, service, mock_db):
        # 1st _get_compartment: the compartment itself (in-org). 2nd: the foreign
        # parent (None) -> rejected.
        with patch.object(
            service,
            "_get_compartment",
            new_callable=AsyncMock,
            side_effect=[MagicMock(), None],
        ):
            with pytest.raises(ValueError, match="Invalid parent compartment"):
                await service.update_compartment(
                    "comp-1", "org-1", {"parent_compartment_id": "foreign-comp"}
                )
        mock_db.commit.assert_not_awaited()
