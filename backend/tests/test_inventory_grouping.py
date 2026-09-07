"""Tests for grouping the inventory items list.

Real database rather than a mocked session: what is at stake is the counts
MySQL returns and the order it returns rows in -- a mock would assert the query
I wrote rather than the rows it produces.
"""

import uuid

import pytest
from sqlalchemy import text

from app.services.inventory_service import InventoryService

# What these assert is what MySQL actually returns — the GROUP BY counts, the
# COALESCE location precedence, the case-insensitive colour collation. The unit
# CI job runs with no database service, so without this marker they are
# collected there and every one errors on connect.
pytestmark = pytest.mark.integration


async def _org(db, name: str) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": name, "slug": f"{name}-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


async def _category(db, org_id: str, name: str, item_type: str = "uniform") -> str:
    cat_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO inventory_categories "
            "(id, organization_id, name, item_type, active) "
            "VALUES (:id, :org, :name, :t, 1)"
        ),
        {"id": cat_id, "org": org_id, "name": name, "t": item_type},
    )
    await db.flush()
    return cat_id


async def _item(
    db,
    org_id: str,
    name: str,
    *,
    category_id=None,
    color=None,
    status: str = "available",
    storage_location=None,
    size=None,
    standard_size=None,
    style=None,
) -> str:
    item_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO inventory_items "
            "(id, organization_id, category_id, name, color, `condition`, "
            "status, tracking_type, quantity, quantity_issued, "
            "storage_location, size, standard_size, style, active) "
            "VALUES (:id, :org, :cat, :name, :color, 'good', :status, "
            "'pool', 5, 0, :loc, :size, :ssize, :style, 1)"
        ),
        {
            "id": item_id,
            "org": org_id,
            "cat": category_id,
            "name": name,
            "color": color,
            "status": status,
            "loc": storage_location,
            "size": size,
            "ssize": standard_size,
            "style": style,
        },
    )
    await db.flush()
    return item_id


@pytest.fixture
async def org(db_session):
    return await _org(db_session, "group-org")


@pytest.fixture
async def service(db_session):
    return InventoryService(db_session)


@pytest.fixture
async def classes(db_session, org):
    """Class A and Class B, with a lopsided split and one unavailable item."""
    a = await _category(db_session, org, "Class A Uniform")
    b = await _category(db_session, org, "Class B Uniform")
    await _item(db_session, org, "Dress Coat", category_id=a, color="Navy")
    await _item(db_session, org, "Dress Trousers", category_id=a, color="Navy")
    await _item(db_session, org, "Long Sleeve", category_id=b, color="Navy")
    await _item(db_session, org, "Short Sleeve", category_id=b, color="navy")
    await _item(
        db_session,
        org,
        "Parade Jacket",
        category_id=a,
        color="White",
        status="in_maintenance",
    )
    return a, b


class TestGroupCounts:
    async def test_counts_split_by_availability(self, service, org, classes):
        a, b = classes
        groups = await service.get_item_group_counts(
            organization_id=uuid.UUID(org),
            group_by="category",
            exclude_item_types=None,
        )
        by_label = {g["label"]: g for g in groups}

        # Class A: two available, one in maintenance. The list nests groups
        # inside Available/Unavailable, so one category heads both sections.
        assert by_label["Class A Uniform"]["available_count"] == 2
        assert by_label["Class A Uniform"]["unavailable_count"] == 1
        assert by_label["Class B Uniform"]["available_count"] == 2
        assert by_label["Class B Uniform"]["unavailable_count"] == 0

    async def test_counts_cover_everything_not_just_a_page(
        self, service, db_session, org
    ):
        cat = await _category(db_session, org, "Bulk")
        for i in range(60):
            await _item(db_session, org, f"Item {i:03d}", category_id=cat)

        items, total = await service.get_items(
            organization_id=uuid.UUID(org), group_by="category", limit=50
        )
        groups = await service.get_item_group_counts(
            organization_id=uuid.UUID(org), group_by="category"
        )

        # The page holds 50; the header must say 60. A tally of what loaded is
        # precisely the mislabel this feature exists to avoid.
        assert len(items) == 50
        assert total == 60
        assert groups[0]["available_count"] == 60

    async def test_colour_grouping_is_case_insensitive(self, service, org, classes):
        groups = await service.get_item_group_counts(
            organization_id=uuid.UUID(org), group_by="color"
        )
        by_label = {(g["label"] or "").lower(): g for g in groups}

        # "Navy" and "navy" are one colour. The colour FILTER has always
        # matched case-insensitively; grouping on the raw column would split
        # them into two buckets that can never be viewed together.
        assert len(groups) == 2
        assert by_label["navy"]["available_count"] == 4
        # The header carries a real spelling from the data, not the
        # lower-cased key the bucket was collapsed on. WHICH spelling is not
        # asserted: MIN() under a case-insensitive collation treats "Navy" and
        # "navy" as equal, so either is a correct representative and pinning
        # one made this test order-dependent.
        assert by_label["navy"]["label"] in {"Navy", "navy"}

    async def test_a_missing_value_gets_its_own_bucket(self, service, db_session, org):
        await _item(db_session, org, "Unsorted Helmet")
        groups = await service.get_item_group_counts(
            organization_id=uuid.UUID(org), group_by="category"
        )
        # An item with no category is not an absence of a group -- it is the
        # "Unspecified" group, and it must not silently vanish from a list it
        # matches the filters for.
        assert any(g["key"] is None for g in groups)

    async def test_unspecified_sorts_last(self, service, db_session, org, classes):
        await _item(db_session, org, "Unsorted Helmet")
        groups = await service.get_item_group_counts(
            organization_id=uuid.UUID(org), group_by="category"
        )
        assert groups[-1]["label"] is None

    async def test_counts_respect_the_active_filters(self, service, org, classes):
        a, _ = classes
        groups = await service.get_item_group_counts(
            organization_id=uuid.UUID(org),
            group_by="category",
            category_id=uuid.UUID(a),
        )
        # Sharing _build_items_query with get_items is what makes this hold:
        # a second copy of the WHERE clause is how a header comes to disagree
        # with the list beneath it.
        assert len(groups) == 1
        assert groups[0]["label"] == "Class A Uniform"

    async def test_location_grouping_matches_the_column_precedence(
        self, service, db_session, org
    ):
        await _item(db_session, org, "Nozzle", storage_location="Shelf B-3")
        groups = await service.get_item_group_counts(
            organization_id=uuid.UUID(org), group_by="location"
        )
        # Grouping on location_id alone would file this under Unspecified
        # while the Location cell beside it plainly reads "Shelf B-3".
        assert groups[0]["label"] == "Shelf B-3"

    async def test_an_unknown_dimension_returns_no_groups(self, service, org):
        # A grouping the UI cannot render is a missing header, not a failed
        # request.
        assert (
            await service.get_item_group_counts(
                organization_id=uuid.UUID(org), group_by="haircut"
            )
            == []
        )


class TestKeysAndLabels:
    """Regressions for three ways a group key could be spelled wrongly.

    All three shipped and none was caught by the original suite, because its
    fixtures set no size and its smoke test asserted only that each dimension
    RAN, never what it returned.
    """

    async def test_a_free_text_size_does_not_crash_the_endpoint(
        self, service, db_session, org
    ):
        # `size` is deliberately free text -- "10.5 EE", "lg". Without a CAST,
        # SQLAlchemy types the COALESCE from its first argument as
        # Enum(StandardSize) and feeds every row through the enum result
        # processor, so this raised LookupError and 500'd the whole items
        # endpoint for any department stocking boots.
        await _item(db_session, org, "Boots", size="10.5 EE")

        groups = await service.get_item_group_counts(
            organization_id=uuid.UUID(org), group_by="size"
        )
        assert [g["key"] for g in groups] == ["10.5 EE"]

        items, _ = await service.get_items(
            organization_id=uuid.UUID(org), group_by="size"
        )
        assert [i.group_key for i in items] == ["10.5 EE"]

    async def test_enum_dimensions_key_to_their_value(self, service, db_session, org):
        await _item(db_session, org, "Polo", standard_size="m", style="polo")

        for dimension, expected in (
            ("condition", "good"),
            ("style", "polo"),
            ("size", "m"),
        ):
            groups = await service.get_item_group_counts(
                organization_id=uuid.UUID(org), group_by=dimension
            )
            keys = [g["key"] for g in groups]
            # str() on a (str, Enum) member renders "ItemCondition.GOOD", which
            # would both head the group with a Python repr and never match the
            # value a row carries -- leaving every count unresolved.
            assert expected in keys, f"{dimension} keyed {keys}"
            assert not any(k and "." in k for k in keys), f"{dimension} keyed {keys}"

    async def test_every_row_key_matches_a_counted_group(
        self, service, db_session, org, classes
    ):
        await _item(db_session, org, "Boots", size="10.5 EE")
        await _item(db_session, org, "Unsorted", storage_location="Shelf B-3")

        for dimension in InventoryService.GROUPABLE:
            items, _ = await service.get_items(
                organization_id=uuid.UUID(org), group_by=dimension
            )
            groups = await service.get_item_group_counts(
                organization_id=uuid.UUID(org), group_by=dimension
            )
            counted = {g["key"] for g in groups}
            rendered = {i.group_key for i in items}
            # A row whose key is absent from the counts renders under a header
            # showing no total at all -- the failure mode is a silent "(—)",
            # not an error.
            assert (
                rendered <= counted
            ), f"{dimension}: rows keyed {rendered - counted} have no count"

    async def test_ungrouped_rows_carry_no_group_key(self, service, org, classes):
        items, _ = await service.get_items(organization_id=uuid.UUID(org))
        # Stamped None rather than left unset, so the response schema does not
        # raise reading an attribute that was never assigned.
        assert all(i.group_key is None for i in items)


class TestGroupOrdering:
    async def test_rows_are_contiguous_within_a_group(self, service, org, classes):
        items, _ = await service.get_items(
            organization_id=uuid.UUID(org), group_by="category"
        )
        cats = [i.category_id for i in items if i.status == "available"]
        # Each category appears in exactly one run. A group split across a page
        # boundary would show half its contents under a header claiming all.
        runs = [cats[0]] + [b for a, b in zip(cats, cats[1:]) if a != b]
        assert len(runs) == len(set(runs))

    async def test_available_rows_come_before_unavailable(self, service, org, classes):
        items, _ = await service.get_items(
            organization_id=uuid.UUID(org), group_by="category"
        )
        statuses = [i.status == "available" for i in items]
        assert statuses == sorted(statuses, reverse=True)

    async def test_grouping_changes_order_not_membership(self, service, org, classes):
        plain, plain_total = await service.get_items(organization_id=uuid.UUID(org))
        grouped, grouped_total = await service.get_items(
            organization_id=uuid.UUID(org), group_by="category"
        )
        assert plain_total == grouped_total
        assert {i.id for i in plain} == {i.id for i in grouped}

    async def test_every_groupable_dimension_runs(self, service, org, classes):
        # A dimension that 500s is worse than one that is missing, and the
        # joins differ enough between them that a smoke test earns its place.
        for dimension in InventoryService.GROUPABLE:
            items, _ = await service.get_items(
                organization_id=uuid.UUID(org), group_by=dimension
            )
            assert items
            await service.get_item_group_counts(
                organization_id=uuid.UUID(org), group_by=dimension
            )
