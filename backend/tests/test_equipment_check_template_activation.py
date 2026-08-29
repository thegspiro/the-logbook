from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.equipment_check_service import EquipmentCheckService


def item(name="Radio", check_type="function", **configuration):
    return SimpleNamespace(name=name, check_type=check_type, **configuration)


def compartment(name="Cab", items=None, is_header=False):
    return SimpleNamespace(name=name, items=items or [], is_header=is_header)


@pytest.mark.asyncio
async def test_activation_rejects_incomplete_blocking_configuration():
    db = SimpleNamespace(commit=AsyncMock())
    service = EquipmentCheckService(db)
    template = SimpleNamespace(
        name="",
        is_active=False,
        apparatus_id=None,
        compartments=[
            compartment(name="", items=[]),
            compartment(
                name="Pump panel",
                items=[
                    item(
                        name="",
                        check_type="count",
                        required_quantity=None,
                        expected_quantity=None,
                    ),
                    item(name="Tank", check_type="level", min_level=None),
                ],
            ),
        ],
    )
    service.get_template = AsyncMock(return_value=template)

    with pytest.raises(ValueError, match="Template cannot be activated") as error:
        await service.update_template("template-1", "org-1", {"is_active": True})

    detail = str(error.value)
    assert "template name is required" in detail
    assert 'operational compartment "Untitled" has no checkable items' in detail
    assert "every checklist item needs a name" in detail
    assert "needs an expected quantity" in detail
    assert "needs a minimum level" in detail
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_activation_succeeds_after_blocking_configuration_is_complete():
    db = SimpleNamespace(commit=AsyncMock())
    service = EquipmentCheckService(db)
    template = SimpleNamespace(
        name="Engine check",
        is_active=False,
        apparatus_id=None,
        compartments=[
            compartment(
                items=[
                    item(
                        check_type="count", required_quantity=None, expected_quantity=2
                    ),
                    item(name="Tank", check_type="level", min_level=0),
                ]
            )
        ],
    )
    service.get_template = AsyncMock(side_effect=[template, template])

    result = await service.update_template("template-1", "org-1", {"is_active": True})

    assert result is template
    assert template.is_active is True
    db.commit.assert_awaited_once()


def test_shift_resolution_visibility_requires_publication():
    draft = SimpleNamespace(is_active=False, assigned_positions=[])
    published = SimpleNamespace(is_active=True, assigned_positions=[])

    assert not EquipmentCheckService._template_visible_to_submitter(draft, {"driver"})
    assert EquipmentCheckService._template_visible_to_submitter(published, {"driver"})


def test_structural_items_do_not_make_a_template_publishable():
    errors = EquipmentCheckService._publication_errors(
        {"name": "Engine check"},
        [compartment(items=[item(check_type="header"), item(check_type="text")])],
    )

    assert errors == ['operational compartment "Cab" has no checkable items']


def test_legacy_reading_requires_a_minimum_level():
    errors = EquipmentCheckService._publication_errors(
        {"name": "Engine check"},
        [compartment(items=[item(check_type="reading", min_level=None)])],
    )

    assert errors == ['level item "Radio" needs a minimum level']


@pytest.mark.asyncio
async def test_published_template_cannot_be_edited_into_an_illegal_state():
    db = SimpleNamespace(commit=AsyncMock())
    service = EquipmentCheckService(db)
    template = SimpleNamespace(
        name="Engine check",
        is_active=True,
        apparatus_id=None,
        compartments=[compartment(items=[item()])],
    )
    service.get_template = AsyncMock(return_value=template)

    with pytest.raises(ValueError, match="template name is required"):
        await service.update_template("template-1", "org-1", {"name": ""})

    assert template.name == "Engine check"
    db.commit.assert_not_awaited()
