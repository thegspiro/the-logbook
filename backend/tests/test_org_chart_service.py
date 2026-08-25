"""
Organizational Chart service behaviour.

The chart is a leadership-curated tree that the whole membership reads, so the
things worth pinning down are the ones that would either publish the wrong
answer or corrupt the tree: the depth-first order the page renders in, hiding a
branch behind its hidden root, refusing a re-parent that would create a
reporting loop, promoting reports instead of deleting them with their boss, and
org-scoping every by-id write.

Since 2026-08-25 a seat also holds several people and may be *linked* to a
corporate position or an operational rank. The link supplements the seat's own
list rather than replacing it, which is the behaviour most worth pinning: the
union, its de-duplication, and the fact that linking and unlinking never
quietly delete somebody leadership typed in.
"""

import uuid
from datetime import datetime, timezone

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


async def _make_position(db: AsyncSession, org_id: str, name: str) -> str:
    position_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, :name, :slug, '[]')"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": name,
            "slug": f"{name.lower().replace(' ', '-')}-{position_id[:8]}",
        },
    )
    await db.flush()
    return position_id


async def _assign_position(db: AsyncSession, user_id: str, position_id: str) -> None:
    await db.execute(
        text(
            "INSERT INTO user_positions (user_id, position_id) "
            "VALUES (:user, :position)"
        ),
        {"user": user_id, "position": position_id},
    )
    await db.flush()


async def _make_rank(
    db: AsyncSession,
    org_id: str,
    code: str,
    display_name: str,
    *,
    is_active: bool = True,
) -> None:
    await db.execute(
        text(
            "INSERT INTO operational_ranks "
            "(id, organization_id, rank_code, display_name, sort_order, is_active) "
            "VALUES (:id, :org, :code, :name, 0, :active)"
        ),
        {
            "id": str(uuid.uuid4()),
            "org": org_id,
            "code": code,
            "name": display_name,
            "active": is_active,
        },
    )
    await db.flush()


async def _add(
    service: OrgChartService, org_id: str, title: str, **kwargs
) -> OrgChartNode:
    payload = {"title": title, "is_published": True}
    payload.update(kwargs)
    return await service.create_node(org_id, payload=payload)


def _names(node: dict) -> list:
    """The people a resolved seat lists, in the order the chart shows them."""
    return [holder["name"] for holder in node["holders"]]


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

        await _add(service, org_id, "Fire Chief", holders=[{"user_id": admin_id}])
        await _add(
            service,
            org_id,
            "Chaplain",
            holders=[{"user_id": admin_id, "display_name": "Rev. J. Alvarez"}],
        )

        chart = await service.get_chart(org_id, include_unpublished=True)
        by_title = {n["title"]: n for n in chart}

        assert _names(by_title["Fire Chief"]) == ["Admin User"]
        assert _names(by_title["Chaplain"]) == ["Rev. J. Alvarez"]

    async def test_a_seat_with_nobody_in_it_reports_no_holder(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        await _add(service, org_id, "Safety Officer")

        chart = await service.get_chart(org_id, include_unpublished=True)

        assert chart[0]["holders"] == []


class TestOrgScoping:
    async def test_a_seat_cannot_be_given_another_orgs_member(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other_org = await _make_org(db_session)
        outsider = await _make_member(db_session, other_org, "Other", "Person")
        service = OrgChartService(db_session)

        with pytest.raises(ValueError, match="Invalid member"):
            await _add(service, org_id, "Treasurer", holders=[{"user_id": outsider}])

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


class TestReviewFindings:
    """Regressions for the 2026-08-25 review of PR #1796."""

    async def test_a_removed_member_stops_being_published_as_the_holder(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        await _add(service, org_id, "Fire Chief", holders=[{"user_id": admin_id}])

        # How DELETE /users/{id} removes a member: the row stays, deleted_at is
        # stamped. Without the filter the departed member's name keeps being
        # published to the whole membership.
        await db_session.execute(
            text("UPDATE users SET deleted_at = :now WHERE id = :id"),
            {"now": datetime(2026, 8, 25, tzinfo=timezone.utc), "id": admin_id},
        )
        await db_session.flush()

        chart = await service.get_chart(org_id, include_unpublished=True)

        assert chart[0]["holders"] == []

    async def test_the_parent_a_seat_leaves_is_renumbered_too(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        chief = await _add(service, org_id, "Fire Chief")
        president = await _add(service, org_id, "President")
        first = await _add(service, org_id, "Engine 1", parent_id=str(chief.id))
        await _add(service, org_id, "Engine 2", parent_id=str(chief.id))

        # Engine 1 leaves, so the Chief's remaining child must close the gap;
        # otherwise Engine 2 keeps sort_order 1 and the next seat added under
        # the Chief is handed 1 as well.
        await service.move_node(
            org_id, str(first.id), parent_id=str(president.id), position=0
        )
        await _add(service, org_id, "Engine 3", parent_id=str(chief.id))

        chart = await service.get_chart(org_id, include_unpublished=True)
        under_chief = [
            (n["title"], n["sort_order"])
            for n in chart
            if n["parent_id"] == str(chief.id)
        ]
        assert under_chief == [("Engine 2", 0), ("Engine 3", 1)]

    async def test_a_move_reports_the_parent_the_seat_left(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        chief = await _add(service, org_id, "Fire Chief")
        deputy = await _add(service, org_id, "Deputy Chief", parent_id=str(chief.id))

        # The audit entry records what actually changed, which needs the old
        # placement as well as the new one.
        _node, previous_parent_id = await service.move_node(
            org_id, str(deputy.id), parent_id=None, position=0
        )

        assert previous_parent_id == str(chief.id)


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
    async def test_an_empty_holder_list_empties_the_seat(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        seat = await _add(
            service, org_id, "Quartermaster", holders=[{"user_id": admin_id}]
        )

        # The payload the editor sends when the last person is removed. An
        # empty list is the one way to say "nobody" — dropping it would
        # acknowledge the change and leave the old name published (pitfall #1,
        # update direction).
        await service.update_node(org_id, str(seat.id), updates={"holders": []})

        chart = await service.get_chart(org_id, include_unpublished=True)
        assert chart[0]["holders"] == []

    async def test_an_omitted_key_leaves_the_column_alone(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        seat = await _add(
            service,
            org_id,
            "Quartermaster",
            holders=[{"user_id": admin_id}],
            responsibility="Gear",
        )

        await service.update_node(org_id, str(seat.id), updates={"title": "Gear Chief"})

        chart = await service.get_chart(org_id, include_unpublished=True)
        assert chart[0]["title"] == "Gear Chief"
        assert chart[0]["responsibility"] == "Gear"
        assert chart[0]["holders"][0]["user_id"] == admin_id

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
                org_id, str(seat.id), updates={"holders": [{"user_id": outsider}]}
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


class TestSeveralPeopleInOneSeat:
    """Trustees, co-chairs, two assistant chiefs — one box, several names."""

    async def test_a_seat_lists_everybody_in_the_order_leadership_set(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)

        await _add(
            service,
            org_id,
            "Trustees",
            holders=[
                {"display_name": "Jonathan Green"},
                {"user_id": admin_id},
                {"display_name": "Thomas Martin"},
            ],
        )

        chart = await service.get_chart(org_id, include_unpublished=True)

        # Not sorted: the order is leadership's statement about seniority on a
        # board, and alphabetising it would silently rewrite that.
        assert _names(chart[0]) == ["Jonathan Green", "Admin User", "Thomas Martin"]

    async def test_replacing_the_list_does_not_leave_the_old_people_behind(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        seat = await _add(
            service,
            org_id,
            "Trustees",
            holders=[{"display_name": "Outgoing A"}, {"display_name": "Outgoing B"}],
        )

        await service.update_node(
            org_id,
            str(seat.id),
            updates={"holders": [{"display_name": "Incoming"}]},
        )

        chart = await service.get_chart(org_id, include_unpublished=True)
        assert _names(chart[0]) == ["Incoming"]

    async def test_a_removed_member_leaves_their_co_chairs_standing(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        await _add(
            service,
            org_id,
            "Trustees",
            holders=[{"user_id": admin_id}, {"display_name": "Jonathan Green"}],
        )

        await db_session.execute(
            text("UPDATE users SET deleted_at = :now WHERE id = :id"),
            {"now": datetime(2026, 8, 25, tzinfo=timezone.utc), "id": admin_id},
        )
        await db_session.flush()

        chart = await service.get_chart(org_id, include_unpublished=True)
        assert _names(chart[0]) == ["Jonathan Green"]


class TestSeatsLinkedToARole:
    """A seat can be linked to a corporate position as well as naming people."""

    async def test_a_seat_lists_whoever_currently_holds_the_position(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        position_id = await _make_position(db_session, org_id, "Fire Chief")
        await _assign_position(db_session, admin_id, position_id)

        await _add(service, org_id, "Chief", position_id=position_id)

        chart = await service.get_chart(org_id, include_unpublished=True)

        assert _names(chart[0]) == ["Admin User"]
        # The reader is told *why* the seat lists who it lists, without having
        # to look the role up separately.
        assert chart[0]["link_label"] == "Fire Chief"
        assert chart[0]["holders"][0]["from_link"] is True

    async def test_the_chart_follows_the_roster_with_no_second_edit(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        position_id = await _make_position(db_session, org_id, "Fire Chief")
        await _assign_position(db_session, admin_id, position_id)
        await _add(service, org_id, "Chief", position_id=position_id)

        successor = await _make_member(db_session, org_id, "Shelly", "Hernandez")
        await db_session.execute(
            text("DELETE FROM user_positions WHERE user_id = :u"), {"u": admin_id}
        )
        await _assign_position(db_session, successor, position_id)

        chart = await service.get_chart(org_id, include_unpublished=True)

        # Nobody touched the org chart screen. This is the whole point of the
        # source: an election updates one place, not two.
        assert _names(chart[0]) == ["Shelly Hernandez"]

    async def test_a_position_nobody_holds_reads_as_vacant(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        position_id = await _make_position(db_session, org_id, "Fire Chief")

        await _add(service, org_id, "Chief", position_id=position_id)

        chart = await service.get_chart(org_id, include_unpublished=True)
        assert chart[0]["holders"] == []
        assert chart[0]["link_label"] == "Fire Chief"

    async def test_a_seat_cannot_follow_another_orgs_role(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other_org = await _make_org(db_session)
        theirs = await _make_position(db_session, other_org, "Their Chief")
        service = OrgChartService(db_session)

        # Unvalidated, this would publish another department's roster into this
        # department's chart on every read (pitfall #14c).
        with pytest.raises(ValueError, match="Invalid role"):
            await _add(service, org_id, "Chief", position_id=theirs)

    async def test_a_linked_seat_still_lists_the_people_typed_into_it(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        position_id = await _make_position(db_session, org_id, "Fire Chief")
        await _assign_position(db_session, admin_id, position_id)

        # The department the whole design is for: the application knows the
        # Chief, and leadership adds an auxiliary co-chair who has no login.
        await _add(
            service,
            org_id,
            "Chief",
            position_id=position_id,
            holders=[{"display_name": "Rev. J. Alvarez"}],
        )

        chart = await service.get_chart(org_id, include_unpublished=True)

        # Linked first, then the typed extras — the link is what put the seat's
        # principal holder in the box.
        assert _names(chart[0]) == ["Admin User", "Rev. J. Alvarez"]
        assert [h["from_link"] for h in chart[0]["holders"]] == [True, False]

    async def test_a_member_in_both_lists_is_shown_once_under_their_typed_name(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        position_id = await _make_position(db_session, org_id, "Fire Chief")
        await _assign_position(db_session, admin_id, position_id)

        await _add(
            service,
            org_id,
            "Chief",
            position_id=position_id,
            holders=[{"user_id": admin_id, "display_name": "Chief Ramirez"}],
        )

        chart = await service.get_chart(org_id, include_unpublished=True)

        # The typed entry exists precisely to say how this department announces
        # them, so it wins the name — but the link is what put them in the box,
        # so it keeps the position.
        assert _names(chart[0]) == ["Chief Ramirez"]

    async def test_unlinking_a_seat_leaves_the_typed_people_alone(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        position_id = await _make_position(db_session, org_id, "Fire Chief")
        await _assign_position(db_session, admin_id, position_id)
        seat = await _add(
            service,
            org_id,
            "Chief",
            position_id=position_id,
            holders=[{"display_name": "Rev. J. Alvarez"}],
        )

        await service.update_node(org_id, str(seat.id), updates={"position_id": None})

        chart = await service.get_chart(org_id, include_unpublished=True)
        # Unlinking removes what the application supplied and nothing else. An
        # officer dropping the link has not asked for the co-chair they typed in
        # last year to disappear with it.
        assert _names(chart[0]) == ["Rev. J. Alvarez"]
        assert chart[0]["position_id"] is None
        assert chart[0]["link_label"] is None

    async def test_a_seat_cannot_follow_a_role_and_a_rank_at_once(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        position_id = await _make_position(db_session, org_id, "Fire Chief")
        await _make_rank(db_session, org_id, "captain", "Captain")

        # The editor asks one question — "which role is this?" — and two answers
        # would leave the box explaining itself twice.
        with pytest.raises(ValueError, match="not both"):
            await _add(
                service,
                org_id,
                "Chief",
                position_id=position_id,
                rank_code="captain",
            )

    async def test_an_update_cannot_add_a_rank_to_a_seat_that_has_a_role(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        service = OrgChartService(db_session)
        position_id = await _make_position(db_session, org_id, "Fire Chief")
        await _make_rank(db_session, org_id, "captain", "Captain")
        seat = await _add(service, org_id, "Chief", position_id=position_id)

        # Checked against the row's state *after* the payload, so this is
        # refused while swapping one link for the other is not.
        with pytest.raises(ValueError, match="not both"):
            await service.update_node(
                org_id, str(seat.id), updates={"rank_code": "captain"}
            )

    async def test_swapping_a_role_for_a_rank_in_one_request_is_allowed(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        position_id = await _make_position(db_session, org_id, "Fire Chief")
        await _make_rank(db_session, org_id, "captain", "Captain")
        await db_session.execute(
            text("UPDATE users SET rank = 'captain' WHERE id = :id"), {"id": admin_id}
        )
        await db_session.flush()
        seat = await _add(service, org_id, "Chief", position_id=position_id)

        await service.update_node(
            org_id,
            str(seat.id),
            updates={"position_id": None, "rank_code": "captain"},
        )

        chart = await service.get_chart(org_id, include_unpublished=True)
        assert chart[0]["link_label"] == "Captain"


class TestSeatsLinkedToARank:
    async def test_a_seat_lists_everybody_carrying_the_rank(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        await _make_rank(db_session, org_id, "captain", "Captain")
        second = await _make_member(db_session, org_id, "Shelly", "Hernandez")
        for user_id in (admin_id, second):
            await db_session.execute(
                text("UPDATE users SET rank = 'captain' WHERE id = :id"),
                {"id": user_id},
            )
        await db_session.flush()

        await _add(service, org_id, "Captains", rank_code="captain")

        chart = await service.get_chart(org_id, include_unpublished=True)

        # Sorted by name: nobody chose this order, so the only defensible one
        # is the one a reader can predict.
        assert _names(chart[0]) == ["Admin User", "Shelly Hernandez"]
        assert chart[0]["link_label"] == "Captain"

    async def test_a_seat_cannot_follow_a_rank_this_org_does_not_have(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other_org = await _make_org(db_session)
        await _make_rank(db_session, other_org, "commodore", "Commodore")
        service = OrgChartService(db_session)

        with pytest.raises(ValueError, match="Invalid rank"):
            await _add(service, org_id, "Commodore", rank_code="commodore")


class TestLinkOptions:
    """The picker the editor asks "which role is this?" with."""

    async def test_the_picker_names_who_holds_each_role_right_now(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        held = await _make_position(db_session, org_id, "Fire Chief")
        await _make_position(db_session, org_id, "Zamboni Driver")
        await _assign_position(db_session, admin_id, held)

        roles, _ranks = await service.list_link_options(org_id)
        by_label = {o["label"]: o for o in roles}

        # Names, not a count: choosing "Fire Chief" has to be able to answer
        # "Admin User is the Fire Chief" on the spot, which is what the officer
        # is linking for.
        assert [h["name"] for h in by_label["Fire Chief"]["holders"]] == ["Admin User"]
        assert by_label["Fire Chief"]["value"] == f"position:{held}"
        # A role nobody holds is still offered — it is a real seat that happens
        # to be vacant, and hiding it would look like the role was missing.
        assert by_label["Zamboni Driver"]["holders"] == []

    async def test_the_picker_only_offers_the_callers_own_roles(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other_org = await _make_org(db_session)
        await _make_position(db_session, other_org, "Their Chief")
        await _make_position(db_session, org_id, "Our Chief")
        service = OrgChartService(db_session)

        roles, _ranks = await service.list_link_options(org_id)

        assert [o["label"] for o in roles] == ["Our Chief"]

    async def test_the_picker_leaves_out_retired_ranks(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        await _make_rank(db_session, org_id, "captain", "Captain")
        await _make_rank(db_session, org_id, "commodore", "Commodore", is_active=False)
        service = OrgChartService(db_session)

        _roles, ranks = await service.list_link_options(org_id)

        assert [o["value"] for o in ranks] == ["rank:captain"]

    async def test_a_retired_rank_keeps_resolving_on_a_seat_that_names_it(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = OrgChartService(db_session)
        await _make_rank(db_session, org_id, "commodore", "Commodore")
        await db_session.execute(
            text("UPDATE users SET rank = 'commodore' WHERE id = :id"), {"id": admin_id}
        )
        await _add(service, org_id, "Commodore", rank_code="commodore")
        await db_session.execute(
            text("UPDATE operational_ranks SET is_active = 0 WHERE rank_code = :c"),
            {"c": "commodore"},
        )
        await db_session.flush()

        chart = await service.get_chart(org_id, include_unpublished=True)

        # Retiring a rank on the settings screen must not rewrite the published
        # chart as a side effect of an unrelated edit.
        assert _names(chart[0]) == ["Admin User"]
        assert chart[0]["link_label"] == "Commodore"
