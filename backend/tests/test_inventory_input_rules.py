"""
Inventory input rules the owner decided on 2026-11-01.

From "Inventory — Input Rules Deliberately Left Open (2026-10-20)" in
docs/KNOWN_LIMITATIONS.md:

  - Category names are unique among siblings (same organization, same parent,
    same domain — medical or gear), compared trimmed and case-insensitively.
    New duplicates are refused; duplicates already stored are left alone and
    flagged in the list response so an officer can rename them.
  - Item dates are checked for plausibility on create, and on update only when
    one of the dates is being written, so a row already holding a bad pair
    stays editable for unrelated fields.
"""

import asyncio
import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import delete, select

from app.core.database import database_manager
from app.models.inventory import InventoryCategory, InventoryItem, ItemType
from app.models.organization_lock import OrganizationLock
from app.models.user import Organization
from app.schemas.inventory import InventoryCategoryResponse
from app.services.inventory_service import InventoryService
from app.utils.item_dates import item_date_error

NAME_TAKEN = "already exists at this level"


# ============================================
# Date rules (pure)
# ============================================


@pytest.mark.unit
class TestItemDateRule:
    TODAY = date(2026, 11, 5)

    def check(self, changes, current=None):
        return item_date_error(changes, current, today=self.TODAY)

    def test_warranty_before_purchase_refused_on_create(self):
        error = self.check(
            {
                "purchase_date": date(2024, 5, 1),
                "warranty_expiration": date(2024, 4, 30),
            }
        )
        assert error == "Warranty expiration cannot be before the purchase date"

    def test_warranty_on_purchase_day_allowed(self):
        assert (
            self.check(
                {
                    "purchase_date": date(2024, 5, 1),
                    "warranty_expiration": date(2024, 5, 1),
                }
            )
            is None
        )

    @pytest.mark.parametrize(
        ("field", "label"),
        [
            ("purchase_date", "Purchase date"),
            ("warranty_expiration", "Warranty expiration"),
            ("last_inspection_date", "Last inspection date"),
            ("next_inspection_due", "Next inspection due"),
        ],
    )
    def test_year_one_refused_naming_the_field(self, field, label):
        assert self.check({field: date(1, 1, 1)}) == (
            f"{label} must be between 1900 and 2126"
        )

    def test_window_edges(self):
        assert self.check({"purchase_date": date(1900, 1, 1)}) is None
        assert self.check({"warranty_expiration": date(2126, 12, 31)}) is None
        assert self.check({"warranty_expiration": date(2127, 1, 1)}) is not None
        assert self.check({"purchase_date": date(1899, 12, 31)}) is not None

    def test_unrelated_update_ignores_a_stored_bad_pair(self):
        stored = {
            "purchase_date": date(2024, 5, 1),
            "warranty_expiration": date(2020, 1, 1),
        }
        assert self.check({"storage_location": "Bay 2"}, stored) is None

    def test_resending_the_stored_dates_is_not_a_change(self):
        """The edit form sends every field it owns on every save, so the
        unchanged bad pair arrives in the payload of an unrelated edit."""
        stored = {
            "purchase_date": date(2024, 5, 1),
            "warranty_expiration": date(2020, 1, 1),
            "last_inspection_date": date(1, 1, 1),
        }
        resent = {**stored, "storage_location": "Bay 2"}
        assert self.check(resent, stored) is None
        # The CSV-style string form of the same date is the same date.
        assert self.check({"purchase_date": "2024-05-01"}, stored) is None

    def test_editing_one_side_checks_against_the_stored_other(self):
        stored = {"purchase_date": date(2024, 5, 1), "warranty_expiration": None}
        assert self.check({"warranty_expiration": date(2024, 1, 1)}, stored) == (
            "Warranty expiration cannot be before the purchase date"
        )
        stored = {
            "purchase_date": date(2024, 5, 1),
            "warranty_expiration": date(2020, 1, 1),
        }
        assert self.check({"purchase_date": date(2019, 1, 1)}, stored) is None

    def test_clearing_a_date_is_allowed(self):
        stored = {
            "purchase_date": date(2024, 5, 1),
            "warranty_expiration": date(2020, 1, 1),
        }
        assert self.check({"warranty_expiration": None}, stored) is None

    def test_csv_strings_are_read_and_unparsable_ones_left_alone(self):
        assert self.check(
            {"purchase_date": "2024-05-01", "warranty_expiration": "2024-01-01"}
        ) == ("Warranty expiration cannot be before the purchase date")
        assert self.check({"purchase_date": "not a date"}) is None


@pytest.mark.unit
class TestDuplicateNameOnTheWire:
    def _category(self):
        return InventoryCategory(
            id=str(uuid.uuid4()),
            organization_id=str(uuid.uuid4()),
            name="Radios",
            item_type=ItemType.ELECTRONICS,
            active=True,
            requires_assignment=False,
            requires_serial_number=False,
            requires_maintenance=False,
            nfpa_tracking_enabled=False,
            allow_self_checkout=False,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )

    def test_unflagged_row_reads_false(self):
        response = InventoryCategoryResponse.model_validate(self._category())
        assert response.duplicate_name is False

    def test_flag_is_serialized(self):
        category = self._category()
        category.duplicate_name = True
        response = InventoryCategoryResponse.model_validate(category)
        assert response.model_dump()["duplicate_name"] is True


# ============================================
# Database-backed
# ============================================


async def _make_org(db):
    org = Organization(name="Rules FD", slug=f"rules-{uuid.uuid4().hex[:10]}")
    db.add(org)
    await db.flush()
    return org


async def _make_category(db, org, name, item_type=ItemType.EQUIPMENT, **kwargs):
    category = InventoryCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        item_type=item_type,
        active=kwargs.pop("active", True),
        **kwargs,
    )
    db.add(category)
    await db.flush()
    return category


@pytest.mark.integration
class TestCategoryNameUniqueness:
    async def test_create_refuses_a_sibling_name_trimmed_and_case_folded(
        self, db_session
    ):
        org = await _make_org(db_session)
        await _make_category(db_session, org, "Radios")

        created, error = await InventoryService(db_session).create_category(
            org.id, {"name": " RADIOS ", "item_type": "electronics"}, None
        )

        assert created is None
        assert error is not None
        assert NAME_TAKEN in error

    async def test_same_name_under_another_parent_is_allowed(self, db_session):
        org = await _make_org(db_session)
        station1 = await _make_category(db_session, org, "Station 1")
        await _make_category(db_session, org, "Radios")

        created, error = await InventoryService(db_session).create_category(
            org.id,
            {
                "name": "Radios",
                "item_type": "electronics",
                "parent_category_id": station1.id,
            },
            None,
        )

        assert error is None
        assert created is not None

    async def test_medical_and_gear_domains_are_kept_apart(self, db_session):
        """The gear and medical category pages never list each other's rows,
        so a medical "Bags" does not collide with a gear "Bags"."""
        org = await _make_org(db_session)
        await _make_category(db_session, org, "Bags", item_type=ItemType.EQUIPMENT)

        created, error = await InventoryService(db_session).create_category(
            org.id, {"name": "Bags", "item_type": "medical"}, None
        )

        assert error is None
        assert created is not None

    async def test_a_deactivated_sibling_does_not_hold_the_name(self, db_session):
        org = await _make_org(db_session)
        await _make_category(db_session, org, "Radios", active=False)

        created, error = await InventoryService(db_session).create_category(
            org.id, {"name": "Radios", "item_type": "electronics"}, None
        )

        assert error is None
        assert created is not None

    async def test_rename_onto_a_sibling_name_is_refused(self, db_session):
        org = await _make_org(db_session)
        await _make_category(db_session, org, "Radios")
        pagers = await _make_category(db_session, org, "Pagers")
        # The refusal rolls the session back; committing first keeps the
        # fixture rows (a savepoint release under db_session) to read after.
        await db_session.commit()
        pagers_id, org_id = pagers.id, org.id

        updated, error = await InventoryService(db_session).update_category(
            uuid.UUID(pagers_id), org_id, {"name": "radios"}
        )

        assert error is not None

        assert NAME_TAKEN in error
        stored = await db_session.scalar(
            select(InventoryCategory.name).where(InventoryCategory.id == pagers_id)
        )
        assert stored == "Pagers"

    async def test_moving_under_a_parent_that_has_the_name_is_refused(self, db_session):
        org = await _make_org(db_session)
        station1 = await _make_category(db_session, org, "Station 1")
        await _make_category(db_session, org, "Radios", parent_category_id=station1.id)
        loose = await _make_category(db_session, org, "Radios ")

        _, error = await InventoryService(db_session).update_category(
            uuid.UUID(loose.id), org.id, {"parent_category_id": station1.id}
        )

        assert error is not None

        assert NAME_TAKEN in error

    async def test_reactivating_into_a_taken_name_is_refused(self, db_session):
        org = await _make_org(db_session)
        await _make_category(db_session, org, "Radios")
        retired = await _make_category(db_session, org, "Radios", active=False)

        _, error = await InventoryService(db_session).update_category(
            uuid.UUID(retired.id), org.id, {"active": True}
        )

        assert error is not None

        assert NAME_TAKEN in error

    async def test_existing_duplicates_stay_editable(self, db_session):
        """Grandfathered: the edit form resends the unchanged name on every
        save, and that must not trip the rule the pair predates."""
        org = await _make_org(db_session)
        await _make_category(db_session, org, "Radios")
        twin = await _make_category(db_session, org, "radios")

        updated, error = await InventoryService(db_session).update_category(
            uuid.UUID(twin.id),
            org.id,
            {"name": "radios", "description": "Portable radios"},
        )

        assert error is None
        assert updated is not None
        assert updated.description == "Portable radios"

    async def test_list_flags_grandfathered_duplicates_only(self, db_session):
        org = await _make_org(db_session)
        station1 = await _make_category(db_session, org, "Station 1")
        a = await _make_category(db_session, org, "Radios")
        b = await _make_category(db_session, org, " radios")
        nested = await _make_category(
            db_session, org, "Radios", parent_category_id=station1.id
        )
        medical = await _make_category(
            db_session, org, "Radios", item_type=ItemType.MEDICAL
        )
        retired = await _make_category(db_session, org, "RADIOS", active=False)

        service = InventoryService(db_session)
        categories = await service.get_categories(org.id, active_only=False)
        await service.flag_duplicate_category_names(org.id, categories)

        flags = {c.id: c.duplicate_name for c in categories}
        assert flags[a.id] is True
        assert flags[b.id] is True
        assert flags[nested.id] is False
        assert flags[medical.id] is False
        assert flags[retired.id] is False
        assert flags[station1.id] is False


@pytest.mark.integration
class TestItemDatesOnTheServicePaths:
    async def test_create_refuses_warranty_before_purchase(self, db_session):
        org = await _make_org(db_session)

        item, error = await InventoryService(db_session).create_item(
            org.id,
            {
                "name": "Thermal camera",
                "purchase_date": date(2024, 5, 1),
                "warranty_expiration": date(2023, 5, 1),
            },
            None,
        )

        assert item is None
        assert error == "Warranty expiration cannot be before the purchase date"

    async def test_create_refuses_year_one(self, db_session):
        org = await _make_org(db_session)

        item, error = await InventoryService(db_session).create_item(
            org.id, {"name": "Halligan", "purchase_date": date(1, 1, 1)}, None
        )

        assert item is None
        assert error is not None
        assert error.startswith("Purchase date must be between 1900 and")

    async def test_update_of_an_unrelated_field_keeps_working(self, db_session):
        org = await _make_org(db_session)
        item = InventoryItem(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Old radio",
            purchase_date=date(2024, 5, 1),
            warranty_expiration=date(2020, 1, 1),
        )
        db_session.add(item)
        await db_session.flush()

        updated, error = await InventoryService(db_session).update_item(
            uuid.UUID(item.id),
            org.id,
            # As the edit form sends it: every field, the dates unchanged.
            {
                "storage_location": "Bay 2",
                "purchase_date": date(2024, 5, 1),
                "warranty_expiration": date(2020, 1, 1),
            },
        )

        assert error is None
        assert updated is not None
        assert updated.storage_location == "Bay 2"

    async def test_update_touching_a_date_must_fix_the_pair(self, db_session):
        org = await _make_org(db_session)
        item = InventoryItem(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Old radio",
            purchase_date=date(2024, 5, 1),
        )
        db_session.add(item)
        await db_session.flush()
        service = InventoryService(db_session)

        _, error = await service.update_item(
            uuid.UUID(item.id), org.id, {"warranty_expiration": date(2024, 1, 1)}
        )
        assert error == "Warranty expiration cannot be before the purchase date"

        updated, error = await service.update_item(
            uuid.UUID(item.id), org.id, {"warranty_expiration": date(2027, 1, 1)}
        )
        assert error is None
        assert updated is not None
        assert updated.warranty_expiration == date(2027, 1, 1)


# ============================================
# Concurrency (real, independently committing sessions)
# ============================================


@pytest.fixture
async def committed_org(_initialize_database):
    """An organization committed for real, removed with its rows afterwards.

    The savepoint-based ``db_session`` never truly commits, so it cannot show
    one transaction missing another's committed row.
    """
    factory = database_manager.session_factory
    setup = factory()
    org = Organization(name="Race FD", slug=f"race-{uuid.uuid4().hex[:10]}")
    setup.add(org)
    await setup.commit()
    org_id = org.id
    await setup.close()
    try:
        yield org_id
    finally:
        cleanup = factory()
        try:
            await cleanup.execute(
                delete(InventoryCategory).where(
                    InventoryCategory.organization_id == org_id
                )
            )
            await cleanup.execute(
                delete(OrganizationLock).where(
                    OrganizationLock.organization_id == org_id
                )
            )
            await cleanup.execute(delete(Organization).where(Organization.id == org_id))
            await cleanup.commit()
        finally:
            await cleanup.close()


async def _category_names(org_id):
    factory = database_manager.session_factory
    verifier = factory()
    try:
        result = await verifier.execute(
            select(InventoryCategory.name).where(
                InventoryCategory.organization_id == org_id
            )
        )
        return sorted(result.scalars().all())
    finally:
        await verifier.close()


@pytest.mark.integration
class TestCategoryNameCheckUnderConcurrency:
    async def test_the_check_sees_a_sibling_committed_after_its_snapshot(
        self, committed_org
    ):
        """A plain read answers from the transaction's first-read snapshot
        (Pitfall #27), so a request that had read anything before another
        committed "Radios" would miss it and insert a second one."""
        factory = database_manager.session_factory
        first, second = factory(), factory()
        try:
            await second.execute(
                select(InventoryCategory.id).where(
                    InventoryCategory.organization_id == committed_org
                )
            )

            _, error = await InventoryService(first).create_category(
                committed_org, {"name": "Radios", "item_type": "electronics"}, None
            )
            assert error is None

            created, error = await InventoryService(second).create_category(
                committed_org, {"name": "radios", "item_type": "electronics"}, None
            )
            assert created is None
            assert error is not None
            assert NAME_TAKEN in error
        finally:
            for session in (first, second):
                await session.rollback()
                await session.close()

        assert await _category_names(committed_org) == ["Radios"]

    async def test_two_simultaneous_creates_store_one(self, committed_org):
        factory = database_manager.session_factory
        sessions = [factory(), factory()]
        try:
            results = await asyncio.gather(
                *(
                    InventoryService(session).create_category(
                        committed_org,
                        {"name": "Radios", "item_type": "electronics"},
                        None,
                    )
                    for session in sessions
                )
            )
        finally:
            for session in sessions:
                await session.rollback()
                await session.close()

        errors = [error for _, error in results]
        assert sum(error is None for error in errors) == 1
        assert await _category_names(committed_org) == ["Radios"]
