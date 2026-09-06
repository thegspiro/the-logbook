"""A request names one row; fulfilment must offer the variant it stood for.

The member-facing catalog collapses rows that share a product and a
size/colour/style into one line and sums their availability
(``_group_requestable``) — deliberately, so ten serialized radios read as
"7 available" rather than as ten indistinguishable rows. The request then
stores a single ``item_id`` out of that collapsed line, and nothing validates
the quantity against it at request time.

Fulfilment used to narrow with ``InventoryItem.id == req.item_id``: one row,
out of however many the member was shown the sum of. A member could ask for
ten radios against a line advertising ten and leave the quartermaster looking
at the one row holding one.

These pin the widened narrowing: the request resolves to the *variant*, not to
the row that happened to represent it, while everything outside that variant
stays out.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import EquipmentRequest, ItemVariantGroup
from app.services.inventory_service import InventoryService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_and_member(db_session: AsyncSession):
    org_id, user_id = _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :n, 'fire_department', :s, 'UTC')"
        ),
        {"id": org_id, "n": "Sibling Dept", "s": f"sib-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :o, :u, 'Rio', 'Vance', :e, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "o": org_id,
            "u": f"rio{user_id[:6]}",
            "e": f"rio{user_id[:6]}@test.com",
        },
    )
    await db_session.flush()
    return org_id, user_id


async def _category(svc, org_id, user_id, name="Uniforms"):
    category, _ = await svc.create_category(
        organization_id=uuid.UUID(org_id),
        category_data={"name": name, "item_type": "uniform"},
        created_by=uuid.UUID(user_id),
    )
    return category


async def _group(db_session, org_id, name="Duty Polo"):
    group = ItemVariantGroup(id=_uid(), organization_id=org_id, name=name, active=True)
    db_session.add(group)
    await db_session.flush()
    return group


async def _item(svc, org_id, user_id, category, *, name, **extra):
    item, err = await svc.create_item(
        organization_id=uuid.UUID(org_id),
        item_data={
            "name": name,
            "condition": "good",
            "status": "available",
            "tracking_type": extra.pop("tracking_type", "pool"),
            "quantity": extra.pop("quantity", 5),
            "category_id": category.id,
            **extra,
        },
        created_by=uuid.UUID(user_id),
    )
    assert err is None
    return item


async def _request(db_session, org_id, user_id, category, item, **extra):
    req = EquipmentRequest(
        id=_uid(),
        organization_id=org_id,
        requester_id=user_id,
        item_name=extra.pop("item_name", "Duty Polo"),
        category_id=category.id,
        item_id=item.id if item is not None else None,
        quantity=extra.pop("quantity", 1),
        requested_duration="ongoing",
        **extra,
    )
    db_session.add(req)
    await db_session.flush()
    return req


def _ids(result):
    return {option["item_id"] for option in result["options"]}


class TestVariantSiblingsAreOffered:

    async def test_a_duplicate_pool_row_is_offered_alongside_the_named_one(
        self, db_session, org_and_member
    ):
        """The case Codex raised: two pool rows share an identity in a group."""
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        group = await _group(db_session, org_id)
        named = await _item(
            svc,
            org_id,
            user_id,
            category,
            name="Duty Polo — XL — Navy",
            standard_size="xl",
            color="Navy",
            quantity=2,
            variant_group_id=group.id,
        )
        twin = await _item(
            svc,
            org_id,
            user_id,
            category,
            name="Duty Polo — XL — Navy",
            standard_size="xl",
            color="Navy",
            quantity=9,
            variant_group_id=group.id,
        )
        req = await _request(
            db_session,
            org_id,
            user_id,
            category,
            named,
            quantity=9,
            requested_size="xl",
        )

        result = await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.UUID(org_id))

        assert _ids(result) == {named.id, twin.id}
        # The catalog advertised 11 for this variant; the row the request
        # happened to name holds 2. Before the widening this read False.
        assert result["can_fulfill_now"] is True

    async def test_serialized_rows_of_one_variant_are_all_offered(
        self, db_session, org_and_member
    ):
        """The collapse is intended here, so the widening is the whole fix.

        Ten identical radios are shown to the member as one line worth ten. No
        duplicate-rejection rule could help: these rows are *supposed* to
        coexist.
        """
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id, name="Comms")
        group = await _group(db_session, org_id, name="Portable Radio")
        radios = [
            await _item(
                svc,
                org_id,
                user_id,
                category,
                name="Portable Radio",
                tracking_type="individual",
                quantity=1,
                serial_number=f"SN-{n}",
                variant_group_id=group.id,
            )
            for n in range(4)
        ]
        req = await _request(
            db_session,
            org_id,
            user_id,
            category,
            radios[0],
            item_name="Portable Radio",
            quantity=3,
        )

        result = await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.UUID(org_id))

        assert _ids(result) == {radio.id for radio in radios}

    async def test_a_name_based_product_resolves_without_a_variant_group(
        self, db_session, org_and_member
    ):
        """A product is name-based when the rows carry no group."""
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        named = await _item(
            svc,
            org_id,
            user_id,
            category,
            name="Duty Polo — XL — Navy",
            standard_size="xl",
            color="Navy",
        )
        twin = await _item(
            svc,
            org_id,
            user_id,
            category,
            name="Duty Polo — XL — Navy",
            standard_size="xl",
            color="Navy",
        )
        req = await _request(db_session, org_id, user_id, category, named)

        result = await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.UUID(org_id))

        assert _ids(result) == {named.id, twin.id}


class TestTheNarrowingStillHolds:
    """Widening to a variant must not become widening to a category."""

    async def test_a_different_size_is_not_offered(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        group = await _group(db_session, org_id)
        named = await _item(
            svc,
            org_id,
            user_id,
            category,
            name="Duty Polo — XL — Navy",
            standard_size="xl",
            color="Navy",
            variant_group_id=group.id,
        )
        await _item(
            svc,
            org_id,
            user_id,
            category,
            name="Duty Polo — L — Navy",
            standard_size="l",
            color="Navy",
            variant_group_id=group.id,
        )
        req = await _request(db_session, org_id, user_id, category, named)

        result = await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.UUID(org_id))

        assert _ids(result) == {named.id}

    async def test_a_different_colour_is_not_offered(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        group = await _group(db_session, org_id)
        named = await _item(
            svc,
            org_id,
            user_id,
            category,
            name="Duty Polo — XL — Navy",
            standard_size="xl",
            color="Navy",
            variant_group_id=group.id,
        )
        await _item(
            svc,
            org_id,
            user_id,
            category,
            name="Duty Polo — XL — White",
            standard_size="xl",
            color="White",
            variant_group_id=group.id,
        )
        req = await _request(db_session, org_id, user_id, category, named)

        result = await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.UUID(org_id))

        assert _ids(result) == {named.id}

    async def test_an_identical_row_in_another_group_is_not_offered(
        self, db_session, org_and_member
    ):
        """Two groups may hold the same size and colour and still be two
        different products — a dress shirt is not a duty polo."""
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        mine = await _group(db_session, org_id, name="Duty Polo")
        theirs = await _group(db_session, org_id, name="Dress Shirt")
        named = await _item(
            svc,
            org_id,
            user_id,
            category,
            name="Duty Polo — XL — Navy",
            standard_size="xl",
            color="Navy",
            variant_group_id=mine.id,
        )
        await _item(
            svc,
            org_id,
            user_id,
            category,
            name="Dress Shirt — XL — Navy",
            standard_size="xl",
            color="Navy",
            variant_group_id=theirs.id,
        )
        req = await _request(db_session, org_id, user_id, category, named)

        result = await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.UUID(org_id))

        assert _ids(result) == {named.id}

    async def test_another_orgs_row_is_never_offered(self, db_session, org_and_member):
        """The widening runs inside the org-scoped base query, and the
        identity lookup is scoped too (CLAUDE.md pitfall #14)."""
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        group = await _group(db_session, org_id)
        named = await _item(
            svc,
            org_id,
            user_id,
            category,
            name="Duty Polo — XL — Navy",
            standard_size="xl",
            color="Navy",
            variant_group_id=group.id,
        )
        req = await _request(db_session, org_id, user_id, category, named)

        # The same request read as some other organization stays invisible.
        assert (
            await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.uuid4()) is None
        )

    async def test_a_cross_org_item_id_offers_nothing(self, db_session, org_and_member):
        """The identity lookup is org-scoped, so a foreign ``item_id`` resolves
        to nothing rather than widening to this org's catalog.

        The FK on ``equipment_requests.item_id`` carries no tenancy clause, and
        is ``ON DELETE SET NULL`` — so a *dangling* id cannot exist, but a row
        pointing at another organization's item can. The create endpoint 404s
        that today; this is the layer behind it (CLAUDE.md pitfall #14).
        """
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        # Something in this org that a widening bug would happily return.
        await _item(
            svc,
            org_id,
            user_id,
            category,
            name="Duty Polo — XL — Navy",
            standard_size="xl",
            color="Navy",
        )

        other_org_id, other_user_id = _uid(), _uid()
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, "
                "timezone) VALUES (:id, :n, 'fire_department', :s, 'UTC')"
            ),
            {"id": other_org_id, "n": "Other Dept", "s": f"oth-{other_org_id[:8]}"},
        )
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :o, :u, 'Sam', 'Ford', :e, 'hashed', 'active')"
            ),
            {
                "id": other_user_id,
                "o": other_org_id,
                "u": f"sam{other_user_id[:6]}",
                "e": f"sam{other_user_id[:6]}@test.com",
            },
        )
        await db_session.flush()
        other_category = await _category(svc, other_org_id, other_user_id)
        foreign = await _item(
            svc,
            other_org_id,
            other_user_id,
            other_category,
            name="Duty Polo — XL — Navy",
            standard_size="xl",
            color="Navy",
        )

        req = await _request(db_session, org_id, user_id, category, foreign)

        result = await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.UUID(org_id))

        assert result["options"] == []
