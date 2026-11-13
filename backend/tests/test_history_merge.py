"""History merge against the database.

Two records of one person become one: field choices, combined periods, moved
family links and change history, a forwarding address, and the refusals that
keep a merge from joining two different people or two departments. A merge
into a public record leaves the public on the last cleared version.
"""

from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1.endpoints import history as endpoint
from app.models.history import (
    ClearancePurpose,
    HistoricalMember,
    HistoricalMemberRelation,
    HistoryClearanceRequest,
    HistoryRevision,
    PublicationLevel,
    RelationType,
)
from app.schemas.history import HistoricalMemberFullView, ServicePeriodWrite
from app.services.history_clearance_service import HistoryClearanceService
from app.services.history_merge_service import HistoryMergeService
from app.services.history_service import RECORD_MEMBER, HistoryService
from tests.test_history_module import _org, _position, _user

pytestmark = pytest.mark.integration


class _Dept:
    def __init__(self, org_id, historian, member):
        self.org_id = org_id
        self.historian = historian
        self.member = member
        self.actor = str(historian.id)


@pytest.fixture
async def dept(db_session):
    org_id = await _org(db_session)
    historian_pos = await _position(
        db_session,
        org_id,
        "Historian",
        ["history.view", "history.manage", "history.publish"],
        slug="historian",
    )
    historian = await _user(db_session, org_id, "Hannah", historian_pos)
    member = await _user(db_session, org_id, "Mark")
    return _Dept(org_id, historian, member)


async def _person(db, dept, periods=(), **values) -> HistoricalMember:
    service = HistoryService(db)
    values.setdefault("last_name", "Smith")
    person = await service.create_person(dept.org_id, values, dept.actor)
    if periods:
        person = await service.replace_periods(
            person,
            [ServicePeriodWrite(**p).model_dump() for p in periods],
            edit_kind="minor",
            edit_note=None,
            actor_id=dept.actor,
        )
    return person


async def _merge(db, dept, keep, other, **choices) -> HistoricalMember:
    return await HistoryMergeService(db).merge(
        dept.org_id, keep.id, other.id, choices, dept.actor
    )


class TestPreview:
    async def test_each_field_says_whether_it_needs_a_choice(self, db_session, dept):
        keep = await _person(db_session, dept, first_name="John", badge_number="14")
        other = await _person(
            db_session, dept, first_name="Jack", nickname="Jack", badge_number="14"
        )
        preview = await HistoryMergeService(db_session).preview(keep, other)
        states = {f["field"]: f["state"] for f in preview["fields"]}
        assert states["first_name"] == "differs"
        assert states["nickname"] == "keep_blank"
        assert states["badge_number"] == "same"
        assert states["middle_name"] == "same"
        assert preview["refusal"] is None

    async def test_a_wider_published_other_record_is_warned_about(
        self, db_session, dept
    ):
        keep = await _person(db_session, dept)
        other = await _person(db_session, dept)
        await HistoryService(db_session).publish(
            other, PublicationLevel.MEMBERS, dept.actor
        )
        preview = await HistoryMergeService(db_session).preview(keep, other)
        assert any("stays draft" in w for w in preview["warnings"])


class TestMerge:
    async def test_choices_blanks_and_research_kept_both(self, db_session, dept):
        keep = await _person(
            db_session,
            dept,
            first_name="John",
            research_notes="From the 1951 minutes",
        )
        other = await _person(
            db_session,
            dept,
            first_name="Jack",
            nickname="Jack",
            birth_date=date(1929, 3, 2),
            research_notes="From his daughter",
            is_line_of_duty_death=True,
        )
        merged = await _merge(
            db_session,
            dept,
            keep,
            other,
            first_name="keep",
            research_notes="both",
        )
        assert merged.first_name == "John"
        assert merged.nickname == "Jack"
        assert merged.birth_date == date(1929, 3, 2)
        assert "From the 1951 minutes" in merged.research_notes
        assert "From his daughter" in merged.research_notes
        assert merged.is_line_of_duty_death
        gone = await HistoryService(db_session).get_person(dept.org_id, other.id)
        assert gone is None

    async def test_an_unanswered_difference_is_refused(self, db_session, dept):
        keep = await _person(db_session, dept, first_name="John")
        other = await _person(db_session, dept, first_name="Jack")
        with pytest.raises(ValueError, match="First name"):
            await _merge(db_session, dept, keep, other)

    async def test_periods_combine_and_an_exact_repeat_folds(self, db_session, dept):
        keep = await _person(
            db_session,
            dept,
            periods=[{"start_date": date(1950, 1, 1), "end_date": date(1955, 1, 1)}],
        )
        other = await _person(
            db_session,
            dept,
            periods=[
                {"start_date": date(1950, 1, 1), "end_date": date(1955, 1, 1)},
                {"start_date": date(1960, 1, 1), "end_date": date(1970, 1, 1)},
            ],
        )
        merged = await _merge(db_session, dept, keep, other)
        assert sorted(p.start_date.year for p in merged.service_periods) == [
            1950,
            1960,
        ]

    async def test_family_links_move_and_self_or_duplicate_links_drop(
        self, db_session, dept
    ):
        service = HistoryService(db_session)
        keep = await _person(db_session, dept, first_name="John")
        other = await _person(db_session, dept, first_name="J.")
        father = await _person(db_session, dept, first_name="Robert")
        son = await _person(db_session, dept, first_name="Tim")
        await service.add_relation(
            father, keep.id, RelationType.PARENT_OF, None, dept.actor
        )
        await service.add_relation(
            father, other.id, RelationType.PARENT_OF, None, dept.actor
        )
        await service.add_relation(
            other, son.id, RelationType.PARENT_OF, None, dept.actor
        )
        await service.add_relation(
            keep, other.id, RelationType.SIBLING, None, dept.actor
        )
        merged = await _merge(db_session, dept, keep, other, first_name="keep")
        links = (
            (
                await db_session.execute(
                    select(HistoricalMemberRelation).where(
                        HistoricalMemberRelation.organization_id == dept.org_id
                    )
                )
            )
            .scalars()
            .all()
        )
        pairs = {(r.member_id, r.related_member_id, r.relation_type) for r in links}
        assert pairs == {
            (father.id, merged.id, RelationType.PARENT_OF),
            (merged.id, son.id, RelationType.PARENT_OF),
        }

    async def test_both_change_histories_are_kept(self, db_session, dept):
        keep = await _person(db_session, dept)
        other = await _person(db_session, dept)
        merged = await _merge(db_session, dept, keep, other)
        count = await db_session.scalar(
            select(func.count())
            .select_from(HistoryRevision)
            .where(
                HistoryRevision.organization_id == dept.org_id,
                HistoryRevision.record_type == RECORD_MEMBER,
                HistoryRevision.record_id == merged.id,
            )
        )
        # Two creations and the merge itself.
        assert count == 3

    async def test_two_different_accounts_are_refused(self, db_session, dept):
        keep = await _person(db_session, dept, user_id=str(dept.historian.id))
        other = await _person(db_session, dept, user_id=str(dept.member.id))
        with pytest.raises(ValueError, match="different member accounts"):
            await _merge(db_session, dept, keep, other)

    async def test_one_linked_account_carries_to_the_kept_record(
        self, db_session, dept
    ):
        keep = await _person(db_session, dept)
        other = await _person(db_session, dept, user_id=str(dept.member.id))
        merged = await _merge(db_session, dept, keep, other)
        assert merged.user_id == str(dept.member.id)

    async def test_a_record_cannot_merge_into_itself_or_across_departments(
        self, db_session, dept
    ):
        keep = await _person(db_session, dept)
        with pytest.raises(ValueError, match="different record"):
            await _merge(db_session, dept, keep, keep)
        other_org = await _org(db_session)
        other_pos = await _position(db_session, other_org, "H", ["history.manage"])
        other_user = await _user(db_session, other_org, "Olga", other_pos)
        foreign = await HistoryService(db_session).create_person(
            other_org, {"last_name": "Smith"}, str(other_user.id)
        )
        with pytest.raises(LookupError):
            await _merge(db_session, dept, keep, foreign)


class TestPublicAndClearance:
    async def test_the_public_keeps_the_cleared_version(self, db_session, dept):
        service = HistoryService(db_session)
        keep = await _person(db_session, dept, biography="Cleared text")
        await service.publish(keep, PublicationLevel.PUBLIC, dept.actor)
        other = await _person(db_session, dept, nickname="Jack")
        merged = await _merge(db_session, dept, keep, other)
        assert merged.publication_level == PublicationLevel.PUBLIC
        assert service.public_changes_pending(merged)
        assert merged.public_snapshot.get("nickname") is None

    async def test_the_removed_records_clearance_requests_go(self, db_session, dept):
        clearance = HistoryClearanceService(db_session)
        position = await _position(db_session, dept.org_id, "President", [])
        await clearance.replace_steps(
            dept.org_id, [{"name": "President", "position_id": position}]
        )
        keep = await _person(db_session, dept)
        other = await _person(db_session, dept)
        await clearance.submit(other, ClearancePurpose.PUBLIC, dept.actor)
        await _merge(db_session, dept, keep, other)
        left = await db_session.scalar(
            select(func.count())
            .select_from(HistoryClearanceRequest)
            .where(HistoryClearanceRequest.record_id == other.id)
        )
        assert left == 0


class TestForwarding:
    async def test_the_removed_address_forwards_and_never_chains(
        self, db_session, dept
    ):
        first = await _person(db_session, dept)
        second = await _person(db_session, dept)
        third = await _person(db_session, dept)
        await _merge(db_session, dept, second, first)
        await _merge(db_session, dept, third, second)
        service = HistoryService(db_session)
        assert await service.redirected_id(dept.org_id, first.id) == third.id
        assert await service.redirected_id(dept.org_id, second.id) == third.id

    async def test_the_read_endpoint_follows_the_forward(self, db_session, dept):
        keep = await _person(db_session, dept)
        other = await _person(db_session, dept)
        await _merge(db_session, dept, keep, other)
        view = await endpoint.get_person(
            person_id=other.id, db=db_session, current_user=dept.historian
        )
        assert isinstance(view, HistoricalMemberFullView)
        assert view.id == keep.id
        assert view.redirected_from == other.id

    async def test_a_forward_does_not_reveal_a_draft_to_a_member(
        self, db_session, dept
    ):
        keep = await _person(db_session, dept)
        other = await _person(db_session, dept)
        await HistoryService(db_session).publish(
            other, PublicationLevel.MEMBERS, dept.actor
        )
        await _merge(db_session, dept, keep, other)
        with pytest.raises(HTTPException) as caught:
            await endpoint.get_person(
                person_id=other.id, db=db_session, current_user=dept.member
            )
        assert caught.value.status_code == 404

    async def test_deleting_the_kept_record_ends_the_forward(self, db_session, dept):
        keep = await _person(db_session, dept)
        other = await _person(db_session, dept)
        await _merge(db_session, dept, keep, other)
        service = HistoryService(db_session)
        kept = await service.get_person(dept.org_id, keep.id)
        await service.delete_person(kept)
        assert await service.redirected_id(dept.org_id, other.id) is None
