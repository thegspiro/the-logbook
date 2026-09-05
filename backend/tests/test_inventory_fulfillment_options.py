"""The fulfil picker's judgements are made server-side, and must stay honest.

`GET /inventory/requests/{id}/fulfillment-options` exists because the review
screen previously re-derived these answers from browser copies of the service's
size-alias table and unissuable status/condition sets. Both copies drifted: a
size qualifier was dropped, so a plain "10" matched a request for "10 (wide)",
and the shortage warning omitted the product-identity check its sibling
preselection had. These tests pin the rules to the service that enforces them.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import EquipmentRequest, ItemCondition, ItemStatus
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
        {"id": org_id, "n": "Fulfil Dept", "s": f"ful-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :o, :u, 'Dana', 'Cole', :e, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "o": org_id,
            "u": f"dana{user_id[:6]}",
            "e": f"dana{user_id[:6]}@test.com",
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


async def _variant(svc, org_id, user_id, category, *, name, size, quantity=5, **extra):
    item, err = await svc.create_item(
        organization_id=uuid.UUID(org_id),
        item_data={
            "name": name,
            "condition": "good",
            "status": "available",
            "tracking_type": "pool",
            "quantity": quantity,
            "size": size,
            "category_id": category.id,
            **extra,
        },
        created_by=uuid.UUID(user_id),
    )
    assert err is None
    return item


async def _request(db_session, org_id, user_id, category, **extra):
    req = EquipmentRequest(
        id=_uid(),
        organization_id=org_id,
        requester_id=user_id,
        item_name=extra.pop("item_name", "Duty Polo"),
        category_id=category.id,
        quantity=extra.pop("quantity", 1),
        requested_duration="ongoing",
        **extra,
    )
    db_session.add(req)
    await db_session.flush()
    return req


class TestFulfillmentOptions:

    @pytest.mark.asyncio
    async def test_unknown_request_returns_none(self, db_session, org_and_member):
        org_id, _ = org_and_member
        result = await InventoryService(db_session).get_fulfillment_options(
            uuid.uuid4(), uuid.UUID(org_id)
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_a_request_in_another_org_is_not_visible(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        req = await _request(db_session, org_id, user_id, category)

        assert (
            await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.uuid4()) is None
        )

    @pytest.mark.asyncio
    async def test_the_matching_variant_is_suggested(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        await _variant(svc, org_id, user_id, category, name="Duty Polo", size="m")
        large = await _variant(
            svc, org_id, user_id, category, name="Duty Polo", size="l"
        )
        req = await _request(db_session, org_id, user_id, category, requested_size="l")

        result = await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.UUID(org_id))

        assert result["suggested_item_id"] == large.id
        assert result["requested_size_available"] is True
        chosen = next(o for o in result["options"] if o["item_id"] == large.id)
        assert chosen["matches_requested_size"] is True
        assert chosen["size"] == "l"

    @pytest.mark.asyncio
    async def test_a_size_qualifier_is_not_dropped(self, db_session, org_and_member):
        """A plain "10" is not the "10 (wide)" the member asked for."""
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id, name="Boots")
        await _variant(svc, org_id, user_id, category, name="Station Boot", size="10")
        req = await _request(
            db_session,
            org_id,
            user_id,
            category,
            item_name="Station Boot",
            requested_size="10 (wide)",
        )

        result = await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.UUID(org_id))

        assert result["suggested_item_id"] is None
        assert result["requested_size_available"] is False
        assert all(not o["matches_requested_size"] for o in result["options"])

    @pytest.mark.asyncio
    async def test_a_different_product_does_not_answer_the_request(
        self, db_session, org_and_member
    ):
        """Large trousers are not a large polo, and must not suppress the warning."""
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        await _variant(
            svc, org_id, user_id, category, name="Duty Trousers", size="l", quantity=8
        )
        req = await _request(
            db_session,
            org_id,
            user_id,
            category,
            item_name="Duty Polo",
            requested_size="l",
        )

        result = await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.UUID(org_id))

        assert result["requested_size_available"] is False
        assert result["suggested_item_id"] is None
        # The trousers stay on offer as a deliberate substitution; what they
        # must not do is answer the question about the polo.
        assert result["can_fulfill_now"] is True

    @pytest.mark.asyncio
    async def test_quarantined_stock_is_neither_suggested_nor_counted(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        item = await _variant(
            svc, org_id, user_id, category, name="Duty Polo", size="l", quantity=6
        )
        item.status = ItemStatus.IN_MAINTENANCE
        await db_session.flush()
        req = await _request(db_session, org_id, user_id, category, requested_size="l")

        result = await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.UUID(org_id))

        assert result["options"][0]["available"] == 0
        assert result["requested_size_available"] is False
        assert result["can_fulfill_now"] is False
        assert result["suggested_item_id"] is None

    @pytest.mark.asyncio
    async def test_damaged_stock_is_not_issuable(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        item = await _variant(
            svc, org_id, user_id, category, name="Duty Polo", size="l", quantity=6
        )
        item.condition = ItemCondition.DAMAGED
        await db_session.flush()
        req = await _request(db_session, org_id, user_id, category, requested_size="l")

        result = await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.UUID(org_id))

        assert result["options"][0]["available"] == 0
        assert result["can_fulfill_now"] is False

    @pytest.mark.asyncio
    async def test_short_stock_is_not_suggested(self, db_session, org_and_member):
        """A suggestion the fulfil form cannot submit is worse than none."""
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        await _variant(
            svc, org_id, user_id, category, name="Duty Polo", size="l", quantity=2
        )
        req = await _request(
            db_session, org_id, user_id, category, requested_size="l", quantity=5
        )

        result = await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.UUID(org_id))

        assert result["suggested_item_id"] is None
        assert result["can_fulfill_now"] is False
        # Two on the shelf is still two: the shortage warning is about the size
        # being absent, not about the count being short.
        assert result["requested_size_available"] is True

    @pytest.mark.asyncio
    async def test_options_are_scoped_to_the_requests_category(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        uniforms = await _category(svc, org_id, user_id)
        boots = await _category(svc, org_id, user_id, name="Boots")
        await _variant(svc, org_id, user_id, uniforms, name="Duty Polo", size="l")
        stray = await _variant(
            svc, org_id, user_id, boots, name="Station Boot", size="10"
        )
        req = await _request(db_session, org_id, user_id, uniforms, requested_size="l")

        result = await svc.get_fulfillment_options(uuid.UUID(req.id), uuid.UUID(org_id))

        assert stray.id not in {o["item_id"] for o in result["options"]}

    @pytest.mark.asyncio
    async def test_the_override_browse_widens_the_list_but_not_the_verdict(
        self, db_session, org_and_member
    ):
        """A deliberate substitution browse must not flip the size shortage."""
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        uniforms = await _category(svc, org_id, user_id)
        surplus = await _category(svc, org_id, user_id, name="Surplus")
        await _variant(svc, org_id, user_id, uniforms, name="Duty Polo", size="m")
        # The same product, the requested size, filed outside the category the
        # request names -- so it is a real substitution the quartermaster may
        # choose, and it must not be mistaken for the request being satisfiable.
        outside = await _variant(
            svc, org_id, user_id, surplus, name="Duty Polo", size="l"
        )
        req = await _request(db_session, org_id, user_id, uniforms, requested_size="l")

        result = await svc.get_fulfillment_options(
            uuid.UUID(req.id), uuid.UUID(org_id), include_incompatible=True
        )

        listed = {o["item_id"]: o for o in result["options"]}
        assert outside.id in listed
        assert listed[outside.id]["compatible"] is False
        assert listed[outside.id]["matches_requested_size"] is True
        # Judged over the narrowed set: widening what is on screen answers a
        # different question than "can this request be met as filed?".
        assert result["requested_size_available"] is False
        assert result["suggested_item_id"] is None

    @pytest.mark.asyncio
    async def test_search_matches_the_asset_tag(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        tagged = await _variant(
            svc,
            org_id,
            user_id,
            category,
            name="Duty Polo",
            size="l",
            asset_tag="POLO-4417",
        )
        await _variant(svc, org_id, user_id, category, name="Duty Polo", size="m")
        req = await _request(db_session, org_id, user_id, category, requested_size="l")

        result = await svc.get_fulfillment_options(
            uuid.UUID(req.id), uuid.UUID(org_id), search="POLO-4417"
        )

        assert [o["item_id"] for o in result["options"]] == [tagged.id]
        assert result["options"][0]["identifier"] == "POLO-4417"

    @pytest.mark.asyncio
    async def test_a_search_wildcard_is_escaped(self, db_session, org_and_member):
        """`%` is a literal in a search box, not "show me everything"."""
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        await _variant(svc, org_id, user_id, category, name="Duty Polo", size="l")
        req = await _request(db_session, org_id, user_id, category, requested_size="l")

        result = await svc.get_fulfillment_options(
            uuid.UUID(req.id), uuid.UUID(org_id), search="%"
        )

        assert result["options"] == []

    @pytest.mark.asyncio
    async def test_the_requested_size_survives_truncation(
        self, db_session, org_and_member
    ):
        """The cap must drop the least useful rows, never the suggested one."""
        org_id, user_id = org_and_member
        svc = InventoryService(db_session)
        category = await _category(svc, org_id, user_id)
        for index in range(4):
            await _variant(
                svc,
                org_id,
                user_id,
                category,
                name=f"Aaa Filler {index}",
                size="m",
            )
        match = await _variant(
            svc, org_id, user_id, category, name="Duty Polo", size="l"
        )
        req = await _request(db_session, org_id, user_id, category, requested_size="l")

        result = await svc.get_fulfillment_options(
            uuid.UUID(req.id), uuid.UUID(org_id), limit=1
        )

        assert result["truncated"] is True
        assert [o["item_id"] for o in result["options"]] == [match.id]
        assert result["suggested_item_id"] == match.id
