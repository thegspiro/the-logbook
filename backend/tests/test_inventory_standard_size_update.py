"""
The item form's Size control writes both size columns.

Before it existed the form edited only the free-text ``size``, so changing a
shirt from L to XL left ``standard_size`` at ``l`` — and the detail card, the
variant capsules, the stock matrix and the list endpoint's size filter all read
that column. The picker now submits the chosen code to both, and an explicit
``None`` when the size is cleared.

Against a real database rather than a mocked session, because what is asserted
here is what the ORM does with an ``Enum`` column: that it takes the *value*
the picker submits (``"xl"``) rather than the enum member's name, and that a
``None`` reaches the column as a clear instead of being dropped.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.inventory import InventoryItem, StandardSize
from app.models.user import Organization
from app.schemas.inventory import InventoryItemUpdate
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _make_org(db):
    org = Organization(name="Size FD", slug=f"size-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_item(db, org, **kwargs):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=kwargs.pop("name", "Duty Shirt"),
        active=True,
        **kwargs,
    )
    db.add(item)
    await db.flush()
    return item


async def _reload(db, item_id):
    return (
        await db.execute(select(InventoryItem).where(InventoryItem.id == item_id))
    ).scalar_one()


class TestStandardSizeRoundTrip:
    async def test_a_size_change_moves_both_columns(self, db_session):
        org = await _make_org(db_session)
        item = await _make_item(db_session, org, size="l", standard_size=StandardSize.L)
        service = InventoryService(db_session)

        updated, error = await service.update_item(
            item_id=uuid.UUID(item.id),
            organization_id=uuid.UUID(org.id),
            update_data={"size": "xl", "standard_size": "xl"},
        )

        assert error is None
        assert updated is not None
        stored = await _reload(db_session, item.id)
        # The value, not the member name: the picker submits "xl" and the
        # column is declared with values_callable, so a name-based lookup
        # would be the thing that breaks silently.
        assert stored.standard_size == StandardSize.XL
        assert stored.size == "xl"

    async def test_clearing_the_picker_clears_the_column(self, db_session):
        org = await _make_org(db_session)
        item = await _make_item(db_session, org, size="l", standard_size=StandardSize.L)
        service = InventoryService(db_session)

        updated, error = await service.update_item(
            item_id=uuid.UUID(item.id),
            organization_id=uuid.UUID(org.id),
            update_data={"size": None, "standard_size": None},
        )

        assert error is None
        assert updated is not None
        stored = await _reload(db_session, item.id)
        assert stored.standard_size is None
        assert stored.size is None

    async def test_a_custom_size_keeps_free_text_and_no_code(self, db_session):
        """The picker's Custom option clears ``standard_size`` rather than
        storing the ``custom`` sentinel, so the ``standard_size or size``
        fallback every reader already has resolves to the free text."""
        org = await _make_org(db_session)
        item = await _make_item(db_session, org, size="l", standard_size=StandardSize.L)
        service = InventoryService(db_session)

        updated, error = await service.update_item(
            item_id=uuid.UUID(item.id),
            organization_id=uuid.UUID(org.id),
            update_data={"size": "10.5 EE", "standard_size": None},
        )

        assert error is None
        assert updated is not None
        stored = await _reload(db_session, item.id)
        assert stored.standard_size is None
        assert stored.size == "10.5 EE"


class TestStandardSizeSchema:
    """The picker offers the whole ``StandardSize`` vocabulary. A value the
    frontend list carries and this schema rejects is a 422 on save, so the
    boot and waist blocks are asserted alongside the letters."""

    @pytest.mark.unit
    @pytest.mark.parametrize("code", ["xl", "xxxl", "one_size", "10.5", "34"])
    def test_the_update_schema_accepts_every_picker_value(self, code):
        assert InventoryItemUpdate(standard_size=code).standard_size == code

    @pytest.mark.unit
    def test_the_update_schema_accepts_an_explicit_clear(self):
        payload = InventoryItemUpdate(standard_size=None)
        assert payload.model_dump(exclude_unset=True) == {"standard_size": None}
