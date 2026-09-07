"""Which variant a member is preselected onto, once fit is a real preference.

The style axes made a men's and a women's polo two catalog lines instead of
one. That was the point — but it also meant size alone could no longer choose
between them, and the suggestion layer was still doing exactly that: it took
the first size match, and variants sort by their comma-joined attribute string,
so ``long_sleeve,mens`` sorted ahead of ``long_sleeve,womens`` and the men's cut
won that tie for every member on every request.

These pin the replacement: the member's own fit, then a cut that fits anybody,
then — for the overwhelming majority of catalogs, which stock one cut — exactly
what happened before.

``integration`` so it runs on the MariaDB leg alongside MySQL.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
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
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Fit Dept", "slug": f"fit-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Alex', 'Reed', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"alex{user_id[:6]}",
            "em": f"alex{user_id[:6]}@test.com",
        },
    )
    await db_session.flush()
    return org_id, await db_session.get(User, user_id)


async def _stock(svc, org_id, user, styles):
    """A polo stocked in M, in each of the given style combinations."""
    cat, _ = await svc.create_category(
        organization_id=uuid.UUID(org_id),
        category_data={"name": "Uniform Shirts", "item_type": "uniform"},
        created_by=uuid.UUID(user.id),
    )
    await svc.create_size_variants(
        organization_id=uuid.UUID(org_id),
        created_by=uuid.UUID(user.id),
        base_name="Dept Polo",
        sizes=["m"],
        styles=styles,
        create_variant_group=True,
        category_id=cat.id,
        tracking_type="pool",
        quantity_per_variant=4,
    )


async def _suggested_fit(svc, org_id, user):
    products = await svc.get_requestable_catalog(
        organization_id=uuid.UUID(org_id), user=user
    )
    variant = products[0]["suggested_variant"]
    return None if variant is None else variant["style_attributes"]


class TestFitPreference:
    async def test_a_member_gets_the_cut_they_recorded(
        self, db_session: AsyncSession, org_and_member
    ):
        """The regression this whole change exists for: 'womens' sorts after
        'mens', so the alphabetical tie went the wrong way every time."""
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        await _stock(svc, org_id, user, ["long_sleeve", "mens", "womens", "polo"])
        await svc.upsert_member_size_preferences(
            user_id=uuid.UUID(user.id),
            organization_id=uuid.UUID(org_id),
            data={"shirt_size": "m", "garment_fit": "womens"},
        )

        assert await _suggested_fit(svc, org_id, user) == [
            "long_sleeve",
            "womens",
            "polo",
        ]

    async def test_a_mens_member_gets_the_mens_cut(
        self, db_session: AsyncSession, org_and_member
    ):
        """Asserted separately from the womens case on purpose: a men's-first
        bug passes the men's test, so only the pair proves the fit is read."""
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        await _stock(svc, org_id, user, ["long_sleeve", "mens", "womens", "polo"])
        await svc.upsert_member_size_preferences(
            user_id=uuid.UUID(user.id),
            organization_id=uuid.UUID(org_id),
            data={"shirt_size": "m", "garment_fit": "mens"},
        )

        assert await _suggested_fit(svc, org_id, user) == [
            "long_sleeve",
            "mens",
            "polo",
        ]

    async def test_an_unstated_fit_prefers_the_cut_that_fits_anybody(
        self, db_session: AsyncSession, org_and_member
    ):
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        await _stock(svc, org_id, user, ["mens", "unisex", "womens", "polo"])
        await svc.upsert_member_size_preferences(
            user_id=uuid.UUID(user.id),
            organization_id=uuid.UUID(org_id),
            data={"shirt_size": "m"},
        )

        assert await _suggested_fit(svc, org_id, user) == ["unisex", "polo"]

    async def test_an_unstocked_fit_falls_back_to_neutral(
        self, db_session: AsyncSession, org_and_member
    ):
        """A member's cut not being stocked is not a reason to hand them the
        opposite cut when something fits anybody."""
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        await _stock(svc, org_id, user, ["mens", "unisex", "polo"])
        await svc.upsert_member_size_preferences(
            user_id=uuid.UUID(user.id),
            organization_id=uuid.UUID(org_id),
            data={"shirt_size": "m", "garment_fit": "womens"},
        )

        assert await _suggested_fit(svc, org_id, user) == ["unisex", "polo"]

    async def test_a_single_cut_catalog_behaves_exactly_as_before(
        self, db_session: AsyncSession, org_and_member
    ):
        """The regression guard on the fallback. Most departments stock one
        cut, and for them nothing about this change may be visible."""
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        await _stock(svc, org_id, user, ["long_sleeve", "mens", "polo"])
        await svc.upsert_member_size_preferences(
            user_id=uuid.UUID(user.id),
            organization_id=uuid.UUID(org_id),
            data={"shirt_size": "m"},
        )

        products = await svc.get_requestable_catalog(
            organization_id=uuid.UUID(org_id), user=user
        )
        assert products[0]["suggested_size"] == "m"
        assert products[0]["suggested_variant"]["style_attributes"] == [
            "long_sleeve",
            "mens",
            "polo",
        ]

    async def test_a_deprecated_shirt_style_fit_is_still_honoured(
        self, db_session: AsyncSession, org_and_member
    ):
        """An installation whose garment_fit column came from startup's schema
        repair never ran the backfill. The member's recorded answer should not
        go quiet because of how a column was created.
        """
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        await _stock(svc, org_id, user, ["mens", "womens", "polo"])
        await svc.upsert_member_size_preferences(
            user_id=uuid.UUID(user.id),
            organization_id=uuid.UUID(org_id),
            data={"shirt_size": "m", "shirt_style": "womens"},
        )

        assert await _suggested_fit(svc, org_id, user) == ["womens", "polo"]

    async def test_a_non_fit_shirt_style_is_not_read_as_a_fit(
        self, db_session: AsyncSession, org_and_member
    ):
        """`long_sleeve` is a sleeve, not a cut. It must not steer the choice."""
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        await _stock(svc, org_id, user, ["mens", "unisex", "polo"])
        await svc.upsert_member_size_preferences(
            user_id=uuid.UUID(user.id),
            organization_id=uuid.UUID(org_id),
            data={"shirt_size": "m", "shirt_style": "long_sleeve"},
        )

        assert await _suggested_fit(svc, org_id, user) == ["unisex", "polo"]

    async def test_no_size_on_file_suggests_nothing(
        self, db_session: AsyncSession, org_and_member
    ):
        org_id, user = org_and_member
        svc = InventoryService(db_session)
        await _stock(svc, org_id, user, ["mens", "womens", "polo"])

        products = await svc.get_requestable_catalog(
            organization_id=uuid.UUID(org_id), user=user
        )
        assert products[0]["suggested_variant"] is None
        assert products[0]["suggested_size"] is None
