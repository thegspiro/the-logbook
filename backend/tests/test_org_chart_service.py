"""
Organizational Chart service behaviour.

The chart is a leadership-curated tree that the whole membership reads, so the
things worth pinning down are the ones that would either publish the wrong
answer or corrupt the tree: the depth-first order the page renders in, hiding a
branch behind its hidden root, refusing a re-parent that would create a
reporting loop, promoting reports instead of deleting them with their boss, and
org-scoping every by-id write.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.org_chart import OrgChartNode
from app.services.org_chart_service import MAX_DEPTH, OrgChartService

# Every test here drives the service against a real database through the
# `db_session` fixture, so they belong to the integration job. Without this the
# unit job — which runs `-m "not integration"` with no database service — picks
# them up and every one errors on connection refused.
pytestmark = [pytest.mark.integration]


async def _make_org(db: AsyncSession, name: str = "Second Dept") -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": name,
            "otype": "fire_department",
            "slug": f"org-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    await db.flush()
    return org_id


async def _make_member(db: AsyncSession, org_id: str, first: str, last: str) -> str:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "ln": last,
            "em": f"{user_id[:8]}@test.com",
        },
    )
    await db.flush()
    return user_id


async def _add(
    service: OrgChartService, org_id: str, title: str, **kwargs
) -> OrgChartNode:
    payload = {"title": title, "is_published": True}
    payload.update(kwargs)
    return await service.create_node(org_id, payload=payload)


class TestChartShape:
    async def test_chart_is_depth_first_with_the_depth_of_each_seat(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)

        chief = await _add(service, org_id, "Fire Chief")
        deputy = await _add(service, org_id, "Deputy Chief", parent_id=str(chief.id))
        await _add(service, org_id, "Captain", parent_id=str(deputy.id))
        await _add(service, org_id, "President")

        chart = await service.get_chart(org_id, include_unpublished=True)

        assert [(n["title"], n["depth"]) for n in chart] == [
            ("Fire Chief", 0),
            ("Deputy Chief", 1),
            ("Captain", 2),
            ("President", 0),
        ]

    async def test_hiding_a_seat_hides_everyone_reporting_to_it(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)

        chief = await _add(service, org_id, "Fire Chief")
        training = await _add(
            service,
            org_id,
            "Training Officer",
            parent_id=str(chief.id),
            is_published=False,
        )
        await _add(service, org_id, "Drill Instructor", parent_id=str(training.id))

        members_view = await service.get_chart(org_id, include_unpublished=False)
        managers_view = await service.get_chart(org_id, include_unpublished=True)

        # A hidden branch goes entirely: listing the report without its boss
        # would leave the membership an orphan with no chain of command.
        assert [n["title"] for n in members_view] == ["Fire Chief"]
        assert [n["title"] for n in managers_view] == [
            "Fire Chief",
            "Training Officer",
            "Drill Instructor",
        ]

    async def test_a_typed_name_wins_over_the_linked_member(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)

        await _add(service, org_id, "Fire Chief", user_id=admin_id)
        await _add(
            service,
            org_id,
            "Chaplain",
            user_id=admin_id,
            display_name="Rev. J. Alvarez",
        )

        chart = await service.get_chart(org_id, include_unpublished=True)
        by_title = {n["title"]: n for n in chart}

        assert by_title["Fire Chief"]["holder_name"] == "Admin User"
        assert by_title["Chaplain"]["holder_name"] == "Rev. J. Alvarez"

    async def test_a_seat_with_nobody_in_it_reports_no_holder(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        await _add(service, org_id, "Safety Officer")

        chart = await service.get_chart(org_id, include_unpublished=True)

        assert chart[0]["holder_name"] is None


class TestOrgScoping:
    async def test_a_seat_cannot_be_given_another_orgs_member(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other_org = await _make_org(db_session)
        outsider = await _make_member(db_session, other_org, "Other", "Person")
        service = OrgChartService(db_session)

        with pytest.raises(ValueError, match="Invalid member"):
            await _add(service, org_id, "Treasurer", user_id=outsider)

    async def test_a_seat_cannot_report_into_another_orgs_chart(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other_org = await _make_org(db_session)
        service = OrgChartService(db_session)
        theirs = await _add(service, other_org, "Their Chief")

        with pytest.raises(ValueError, match="Invalid parent position"):
            await _add(service, org_id, "Our Captain", parent_id=str(theirs.id))

    async def test_an_update_cannot_reach_another_orgs_seat(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other_org = await _make_org(db_session)
        service = OrgChartService(db_session)
        theirs = await _add(service, other_org, "Their Chief")

        # The permission dependency asserts the caller may edit *their* chart,
        # not that this row is on it (pitfall #14b).
        with pytest.raises(ValueError, match="not on this chart"):
            await service.update_node(
                org_id, str(theirs.id), updates={"title": "Renamed"}
            )

    async def test_a_delete_cannot_reach_another_orgs_seat(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other_org = await _make_org(db_session)
        service = OrgChartService(db_session)
        theirs = await _add(service, other_org, "Their Chief")

        with pytest.raises(ValueError, match="not on this chart"):
            await service.delete_node(org_id, str(theirs.id))


class TestMove:
    async def test_a_seat_cannot_report_to_its_own_subordinate(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        chief = await _add(service, org_id, "Fire Chief")
        deputy = await _add(service, org_id, "Deputy Chief", parent_id=str(chief.id))
        captain = await _add(service, org_id, "Captain", parent_id=str(deputy.id))

        with pytest.raises(ValueError, match="own subordinates"):
            await service.move_node(
                org_id, str(chief.id), parent_id=str(captain.id), position=0
            )

    async def test_a_seat_cannot_report_to_itself(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        chief = await _add(service, org_id, "Fire Chief")

        with pytest.raises(ValueError, match="report to itself"):
            await service.move_node(
                org_id, str(chief.id), parent_id=str(chief.id), position=0
            )

    async def test_moving_within_a_level_renumbers_the_siblings(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        chief = await _add(service, org_id, "Fire Chief")
        for title in ("Engine 1", "Engine 2", "Engine 3"):
            await _add(service, org_id, title, parent_id=str(chief.id))

        chart = await service.get_chart(org_id, include_unpublished=True)
        engine3 = next(n for n in chart if n["title"] == "Engine 3")
        await service.move_node(
            org_id, engine3["id"], parent_id=str(chief.id), position=0
        )

        moved = await service.get_chart(org_id, include_unpublished=True)
        assert [n["title"] for n in moved] == [
            "Fire Chief",
            "Engine 3",
            "Engine 1",
            "Engine 2",
        ]
        # Contiguous from zero, so the next insert is not competing with a hole.
        assert [n["sort_order"] for n in moved[1:]] == [0, 1, 2]

    async def test_a_position_past_the_end_lands_last(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        chief = await _add(service, org_id, "Fire Chief")
        first = await _add(service, org_id, "Engine 1", parent_id=str(chief.id))
        await _add(service, org_id, "Engine 2", parent_id=str(chief.id))

        await service.move_node(
            org_id, str(first.id), parent_id=str(chief.id), position=99
        )

        moved = await service.get_chart(org_id, include_unpublished=True)
        assert [n["title"] for n in moved] == ["Fire Chief", "Engine 2", "Engine 1"]

    async def test_a_seat_can_be_promoted_to_a_root(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        chief = await _add(service, org_id, "Fire Chief")
        auxiliary = await _add(service, org_id, "Auxiliary", parent_id=str(chief.id))

        await service.move_node(org_id, str(auxiliary.id), parent_id=None, position=0)

        chart = await service.get_chart(org_id, include_unpublished=True)
        assert [(n["title"], n["depth"]) for n in chart] == [
            ("Auxiliary", 0),
            ("Fire Chief", 0),
        ]


class TestDepthCap:
    async def test_a_chain_past_the_cap_is_refused(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)

        parent = await _add(service, org_id, "Level 0")
        for level in range(1, MAX_DEPTH + 1):
            parent = await _add(
                service, org_id, f"Level {level}", parent_id=str(parent.id)
            )

        with pytest.raises(ValueError, match="nested too deeply"):
            await _add(service, org_id, "One too deep", parent_id=str(parent.id))


class TestDelete:
    async def test_removing_a_seat_promotes_its_reports(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        chief = await _add(service, org_id, "Fire Chief")
        deputy = await _add(service, org_id, "Deputy Chief", parent_id=str(chief.id))
        await _add(service, org_id, "Captain", parent_id=str(deputy.id))

        await service.delete_node(org_id, str(deputy.id))

        chart = await service.get_chart(org_id, include_unpublished=True)
        # The Captain survives, reporting to the Chief — one click must not be
        # able to erase a branch nobody meant to touch.
        assert [(n["title"], n["depth"]) for n in chart] == [
            ("Fire Chief", 0),
            ("Captain", 1),
        ]

    async def test_removing_a_root_leaves_its_reports_as_roots(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        chief = await _add(service, org_id, "Fire Chief")
        await _add(service, org_id, "Deputy Chief", parent_id=str(chief.id))

        await service.delete_node(org_id, str(chief.id))

        chart = await service.get_chart(org_id, include_unpublished=True)
        assert [(n["title"], n["depth"]) for n in chart] == [("Deputy Chief", 0)]


class TestUpdate:
    async def test_an_explicit_null_clears_the_holder(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        seat = await _add(service, org_id, "Quartermaster", user_id=admin_id)

        # The payload the editor sends when the box is emptied. Dropping the
        # null would acknowledge the change and leave the old name published
        # (pitfall #1, update direction).
        await service.update_node(
            org_id, str(seat.id), updates={"user_id": None, "display_name": None}
        )

        chart = await service.get_chart(org_id, include_unpublished=True)
        assert chart[0]["holder_name"] is None
        assert chart[0]["user_id"] is None

    async def test_an_omitted_key_leaves_the_column_alone(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        seat = await _add(
            service, org_id, "Quartermaster", user_id=admin_id, responsibility="Gear"
        )

        await service.update_node(org_id, str(seat.id), updates={"title": "Gear Chief"})

        chart = await service.get_chart(org_id, include_unpublished=True)
        assert chart[0]["title"] == "Gear Chief"
        assert chart[0]["responsibility"] == "Gear"
        assert chart[0]["user_id"] == admin_id

    async def test_an_update_cannot_link_another_orgs_member(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other_org = await _make_org(db_session)
        outsider = await _make_member(db_session, other_org, "Other", "Person")
        service = OrgChartService(db_session)
        seat = await _add(service, org_id, "Treasurer")

        with pytest.raises(ValueError, match="Invalid member"):
            await service.update_node(
                org_id, str(seat.id), updates={"user_id": outsider}
            )


class TestMemberOptions:
    async def test_the_picker_only_offers_the_callers_own_members(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        other_org = await _make_org(db_session)
        await _make_member(db_session, other_org, "Other", "Person")
        service = OrgChartService(db_session)

        options = await service.list_member_options(org_id)

        assert [o["id"] for o in options] == [admin_id]
