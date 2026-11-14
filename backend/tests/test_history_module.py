"""History module: past members, titles, family links, publication, clearance.

The unit half pins the pure rules — names, years, partial dates, what each
audience receives. The integration half runs the service and the read
endpoints against the database: tier filtering, department isolation, the
title list, and the clearance flow end to end.
"""

import json
import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import history as endpoint
from app.models.history import (
    ClearanceDecisionKind,
    ClearancePurpose,
    ClearanceStatus,
    DatePrecision,
    FieldVisibility,
    HistoricalMember,
    PublicationLevel,
    RelationType,
)
from app.models.user import User
from app.schemas.history import (
    ClearanceDecide,
    HistoricalMemberFullView,
    HistoricalMemberMemberView,
    RelationCreate,
    ServicePeriodWrite,
)
from app.services.history_clearance_service import HistoryClearanceService
from app.services.history_service import (
    RESTRICTED_FIELDS,
    HistoryService,
    Viewer,
    display_name,
    normalize_partial_date,
    service_years,
    title_key,
)
from app.utils.markdown_render import render_markdown

# ----------------------------------------------------------------------
# Unit
# ----------------------------------------------------------------------


def _period(start=None, end=None, *, ongoing=False, start_circa=False):
    return SimpleNamespace(
        start_date=start,
        start_circa=start_circa,
        end_date=end,
        end_circa=False,
        is_ongoing=ongoing,
    )


@pytest.mark.unit
class TestPureRules:
    def test_display_name_reads_like_a_roll_call(self):
        person = SimpleNamespace(
            first_name="John",
            nickname="Jack",
            middle_name=None,
            last_name="Smith",
            suffix="Jr.",
        )
        assert display_name(person) == 'John "Jack" Smith Jr.'

    def test_a_last_name_alone_is_a_name(self):
        person = SimpleNamespace(
            first_name=None,
            nickname=None,
            middle_name=None,
            last_name="Smith",
            suffix=None,
        )
        assert display_name(person) == "Smith"

    def test_service_years_span_every_period(self):
        periods = [
            _period(date(1951, 1, 1), date(1960, 1, 1)),
            _period(date(1972, 1, 1), date(1980, 1, 1)),
        ]
        assert service_years(periods) == "1951–1980"

    def test_an_ongoing_period_reads_present(self):
        assert service_years([_period(date(1998, 1, 1), ongoing=True)]) == (
            "1998–present"
        )

    def test_circa_is_shown(self):
        assert service_years(
            [_period(date(1923, 1, 1), date(1940, 1, 1), start_circa=True)]
        ) == ("c. 1923–1940")

    def test_no_dates_is_no_span(self):
        assert service_years([]) is None
        assert service_years([_period()]) is None

    def test_partial_dates_are_stored_canonically(self):
        when = date(1962, 7, 14)
        assert normalize_partial_date(when, DatePrecision.YEAR) == date(1962, 1, 1)
        assert normalize_partial_date(when, DatePrecision.MONTH) == date(1962, 7, 1)
        assert normalize_partial_date(when, DatePrecision.DAY) == when

    def test_titles_differ_by_more_than_case_and_spacing(self):
        assert title_key("Asst.  Chief") == title_key("asst. chief")

    def test_markdown_drops_html_scripts_and_javascript_links(self):
        html = render_markdown(
            "<script>alert(1)</script> [x](javascript:alert(1)) "
            "<img src=x onerror=alert(1)> **bold**"
        )
        assert "<script" not in html
        assert "<img" not in html
        assert 'href="javascript' not in html
        assert "<strong>bold</strong>" in html

    def test_markdown_shows_no_images(self):
        assert "<img" not in render_markdown("![tracker](https://example.org/p.png)")

    def test_a_relation_described_as_other_needs_a_label(self):
        with pytest.raises(ValidationError):
            RelationCreate(related_member_id="x", relation_type=RelationType.OTHER)
        RelationCreate(
            related_member_id="x", relation_type=RelationType.OTHER, label="cousin"
        )

    def test_returning_a_record_needs_a_note(self):
        with pytest.raises(ValidationError):
            ClearanceDecide(decision=ClearanceDecisionKind.RETURNED, note="  ")
        ClearanceDecide(decision=ClearanceDecisionKind.CLEARED)

    def test_an_ongoing_period_has_no_end(self):
        with pytest.raises(ValidationError):
            ServicePeriodWrite(is_ongoing=True, end_date=date(2000, 1, 1))
        with pytest.raises(ValidationError):
            ServicePeriodWrite(start_date=date(2000, 1, 1), end_date=date(1999, 1, 1))

    def test_the_member_view_has_no_restricted_field_at_all(self):
        member_fields = set(HistoricalMemberMemberView.model_fields)
        assert not member_fields & set(RESTRICTED_FIELDS)
        assert not member_fields & {
            "addresses",
            "verification_sources",
            "research_notes",
            "user_id",
        }


# ----------------------------------------------------------------------
# Integration
# ----------------------------------------------------------------------


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"h-{org_id[:8]}"},
    )
    return org_id


async def _position(db, org_id, name, permissions=(), slug=None) -> str:
    position_id = _uid()
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions, "
            "is_system, priority) VALUES (:id, :org, :name, :slug, :perms, 0, 0)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": name,
            "slug": slug or f"p-{position_id[:8]}",
            "perms": json.dumps(list(permissions)),
        },
    )
    return position_id


async def _user(db, org_id, first, *position_ids) -> User:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Tester', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@test.example",
        },
    )
    for position_id in position_ids:
        await db.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
            {"u": user_id, "p": position_id},
        )
    return await db.scalar(
        select(User)
        .options(selectinload(User.positions))
        .where(User.id == user_id)
        .execution_options(populate_existing=True)
    )


class _Dept:
    def __init__(self, org_id, historian, member, president, president_position):
        self.org_id = org_id
        self.historian = historian
        self.member = member
        self.president = president
        self.president_position = president_position


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
    president_pos = await _position(
        db_session, org_id, "President", ["members.view"], slug="president"
    )
    await _position(db_session, org_id, "Member", ["members.view"], slug="member")
    historian = await _user(db_session, org_id, "Hannah", historian_pos)
    member = await _user(db_session, org_id, "Mark")
    president = await _user(db_session, org_id, "Pat", president_pos)
    return _Dept(org_id, historian, member, president, president_pos)


async def _person(db, dept, **values) -> HistoricalMember:
    values.setdefault("last_name", "Smith")
    return await HistoryService(db).create_person(
        dept.org_id, values, str(dept.historian.id)
    )


@pytest.mark.integration
class TestWhoSeesWhat:
    async def test_a_member_cannot_see_a_draft(self, db_session, dept):
        person = await _person(db_session, dept)
        viewer = Viewer.of(dept.member)
        assert (
            await HistoryService(db_session).get_readable_person(viewer, person.id)
            is None
        )
        people, total = await HistoryService(db_session).list_people(viewer)
        assert total == 0
        assert people == []

    async def test_a_member_reads_the_published_view_without_restricted_fields(
        self, db_session, dept
    ):
        person = await _person(
            db_session,
            dept,
            first_name="John",
            birth_date=date(1920, 3, 4),
            addresses="12 Main St",
            research_notes="Census 1930",
            is_memorial=True,
            death_date=date(1962, 7, 14),
            death_date_visibility=FieldVisibility.MEMBERS,
            burial_location="Plot 7, St. Mary's",
            burial_location_visibility=FieldVisibility.HISTORIAN,
        )
        await HistoryService(db_session).publish(
            person, PublicationLevel.MEMBERS, str(dept.historian.id)
        )

        view = await endpoint.get_person(
            person.id, db=db_session, current_user=dept.member
        )

        assert isinstance(view, HistoricalMemberMemberView)
        payload = view.model_dump()
        for field in RESTRICTED_FIELDS + ("addresses", "research_notes"):
            assert field not in payload
        assert payload["death_date"] == date(1962, 7, 14)
        # Burial location is the Historian's alone on this record.
        assert payload["burial_location"] is None
        assert "Plot 7" not in json.dumps(payload, default=str)

    async def test_the_historian_reads_every_field(self, db_session, dept):
        person = await _person(db_session, dept, addresses="12 Main St")
        view = await endpoint.get_person(
            person.id, db=db_session, current_user=dept.historian
        )
        assert isinstance(view, HistoricalMemberFullView)
        assert view.addresses == "12 Main St"

    async def test_another_department_cannot_reach_the_record(self, db_session, dept):
        person = await _person(db_session, dept)
        other_org = await _org(db_session)
        other_pos = await _position(
            db_session, other_org, "Historian", ["history.manage", "history.view"]
        )
        outsider = await _user(db_session, other_org, "Olive", other_pos)
        service = HistoryService(db_session)
        assert await service.get_readable_person(Viewer.of(outsider), person.id) is None
        with pytest.raises(ValueError, match="Member not found"):
            await service.create_person(
                other_org,
                {"last_name": "X", "user_id": str(dept.member.id)},
                str(outsider.id),
            )

    async def test_family_links_show_both_ways_and_only_to_readable_people(
        self, db_session, dept
    ):
        service = HistoryService(db_session)
        father = await _person(db_session, dept, first_name="Robert")
        son = await _person(db_session, dept, first_name="John")
        await service.add_relation(
            father, son.id, RelationType.PARENT_OF, None, str(dept.historian.id)
        )
        archivist = Viewer.of(dept.historian)
        from_father = await service.relations_for(archivist, father)
        from_son = await service.relations_for(archivist, son)
        assert [r["relationship"] for r in from_father] == ["child"]
        assert [r["relationship"] for r in from_son] == ["parent"]

        await service.publish(father, PublicationLevel.MEMBERS, str(dept.historian.id))
        # The son is still a draft, so a member reading the father sees no link.
        assert await service.relations_for(Viewer.of(dept.member), father) == []

        with pytest.raises(ValueError, match="already linked"):
            await service.add_relation(
                son, father.id, RelationType.SIBLING, None, str(dept.historian.id)
            )


@pytest.mark.integration
class TestTitles:
    async def test_the_list_is_filled_once_from_ranks_and_positions(
        self, db_session, dept
    ):
        service = HistoryService(db_session)
        titles = await service.list_titles(dept.org_id, include_retired=True)
        names = {t.name for t, _ in titles}
        assert {"Historian", "President"} <= names
        assert "Member" not in names

        retired = next(t for t, _ in titles if t.name == "President")
        await service.update_title(retired, {"is_retired": True})
        again = await service.list_titles(dept.org_id, include_retired=False)
        assert "President" not in {t.name for t, _ in again}
        assert len(await service.list_titles(dept.org_id, include_retired=True)) == len(
            titles
        )

    async def test_a_new_title_cannot_duplicate_another(self, db_session, dept):
        service = HistoryService(db_session)
        await service.create_title(dept.org_id, "Foreman", str(dept.historian.id))
        with pytest.raises(ValueError, match="already on the list"):
            await service.create_title(
                dept.org_id, "  foreman ", str(dept.historian.id)
            )

    async def test_merging_moves_every_record_onto_the_other_title(
        self, db_session, dept
    ):
        service = HistoryService(db_session)
        typo = await service.create_title(
            dept.org_id, "Asst Chief", str(dept.historian.id)
        )
        right = await service.create_title(
            dept.org_id, "Assistant Chief", str(dept.historian.id)
        )
        person = await _person(db_session, dept)
        await service.replace_periods(
            person,
            [{"start_date": date(1950, 1, 1), "title_ids": [typo.id]}],
            edit_kind="minor",
            edit_note=None,
            actor_id=str(dept.historian.id),
        )

        await service.merge_title(typo, right)

        reloaded = await service.get_person(dept.org_id, person.id)
        assert [t.title.name for t in reloaded.service_periods[0].titles] == [
            "Assistant Chief"
        ]
        assert await service.get_title(dept.org_id, typo.id) is None

    async def test_a_title_from_another_department_is_refused(self, db_session, dept):
        other_org = await _org(db_session)
        service = HistoryService(db_session)
        foreign = await service.create_title(
            other_org, "Foreman", str(dept.historian.id)
        )
        person = await _person(db_session, dept)
        with pytest.raises(ValueError, match="not on this department"):
            await service.replace_periods(
                person,
                [{"title_ids": [foreign.id]}],
                edit_kind="minor",
                edit_note=None,
                actor_id=str(dept.historian.id),
            )


@pytest.mark.integration
class TestWarningsAndDeleting:
    async def test_a_reused_badge_and_a_likely_duplicate_are_warned_about(
        self, db_session, dept
    ):
        await _person(db_session, dept, first_name="John", badge_number="12")
        warnings = await HistoryService(db_session).check_warnings(
            dept.org_id, last_name="smith", first_name="J.", badge_number="12"
        )
        assert {w["kind"] for w in warnings} == {"badge_number", "possible_duplicate"}

    async def test_a_different_first_name_is_not_a_duplicate(self, db_session, dept):
        await _person(db_session, dept, first_name="John")
        warnings = await HistoryService(db_session).check_warnings(
            dept.org_id, last_name="Smith", first_name="Mary", badge_number=None
        )
        assert warnings == []

    async def test_only_an_unpublished_record_can_be_deleted(self, db_session, dept):
        service = HistoryService(db_session)
        person = await _person(db_session, dept)
        await service.publish(person, PublicationLevel.MEMBERS, str(dept.historian.id))
        with pytest.raises(ValueError, match="Unpublish this record"):
            await service.delete_person(person)
        await service.unpublish(person, PublicationLevel.DRAFT, str(dept.historian.id))
        await service.delete_person(person)
        assert await service.get_person(dept.org_id, person.id) is None


@pytest.mark.integration
class TestClearance:
    async def _with_list(self, db_session, dept):
        await HistoryClearanceService(db_session).replace_steps(
            dept.org_id,
            [{"name": "President's review", "position_id": dept.president_position}],
        )

    async def test_with_no_list_the_publisher_publishes_publicly(
        self, db_session, dept
    ):
        person = await _person(db_session, dept, first_name="John")
        person = await HistoryService(db_session).publish(
            person, PublicationLevel.PUBLIC, str(dept.historian.id)
        )
        assert person.publication_level == PublicationLevel.PUBLIC
        assert person.public_snapshot["display_name"] == "John Smith"

    async def test_with_a_list_public_waits_for_clearance(self, db_session, dept):
        await self._with_list(db_session, dept)
        service = HistoryService(db_session)
        clearance = HistoryClearanceService(db_session)
        person = await _person(db_session, dept)

        # Members need no clearance.
        await service.publish(person, PublicationLevel.MEMBERS, str(dept.historian.id))
        with pytest.raises(ValueError, match="clearance list"):
            await service.publish(
                person, PublicationLevel.PUBLIC, str(dept.historian.id)
            )

        request, notify = await clearance.submit(
            person, ClearancePurpose.PUBLIC, str(dept.historian.id)
        )
        assert notify == [str(dept.president.id)]
        assert not await clearance.can_decide(request, str(dept.member.id))
        with pytest.raises(PermissionError):
            await clearance.decide(
                request, ClearanceDecisionKind.CLEARED, None, str(dept.member.id)
            )

        outcome = await clearance.decide(
            request,
            ClearanceDecisionKind.CLEARED,
            "Looks right",
            str(dept.president.id),
        )
        assert outcome.request.status == ClearanceStatus.CLEARED
        assert outcome.notify_submitter == str(dept.historian.id)

        person = await service.publish(
            person, PublicationLevel.PUBLIC, str(dept.historian.id)
        )
        assert person.publication_level == PublicationLevel.PUBLIC

    async def test_a_returned_record_needs_submitting_again(self, db_session, dept):
        await self._with_list(db_session, dept)
        clearance = HistoryClearanceService(db_session)
        person = await _person(db_session, dept)
        request, _ = await clearance.submit(
            person, ClearancePurpose.PUBLIC, str(dept.historian.id)
        )
        outcome = await clearance.decide(
            request,
            ClearanceDecisionKind.RETURNED,
            "Check the dates",
            str(dept.president.id),
        )
        assert outcome.request.status == ClearanceStatus.RETURNED
        with pytest.raises(ValueError, match="clearance list"):
            await HistoryService(db_session).publish(
                person, PublicationLevel.PUBLIC, str(dept.historian.id)
            )

    async def test_a_substantial_edit_keeps_the_cleared_public_copy(
        self, db_session, dept
    ):
        service = HistoryService(db_session)
        person = await _person(db_session, dept, biography="Original text")
        await service.publish(person, PublicationLevel.PUBLIC, str(dept.historian.id))
        await self._with_list(db_session, dept)

        person = await service.update_person(
            person,
            {"biography": "Rewritten"},
            edit_kind="substantial",
            edit_note="New research",
            actor_id=str(dept.historian.id),
        )
        assert service.public_changes_pending(person)
        assert person.public_snapshot["biography"] == "Original text"

        # A pending request is withdrawn by the next substantial edit.
        clearance = HistoryClearanceService(db_session)
        request, _ = await clearance.submit(
            person, ClearancePurpose.PUBLIC, str(dept.historian.id)
        )
        await service.update_person(
            person,
            {"biography": "Rewritten again"},
            edit_kind="substantial",
            edit_note=None,
            actor_id=str(dept.historian.id),
        )
        withdrawn = await clearance.get_request(dept.org_id, request.id)
        assert withdrawn.status == ClearanceStatus.WITHDRAWN

    async def test_a_minor_edit_reaches_the_public_copy_at_once(self, db_session, dept):
        service = HistoryService(db_session)
        person = await _person(db_session, dept, biography="Orignal text")
        await service.publish(person, PublicationLevel.PUBLIC, str(dept.historian.id))
        person = await service.update_person(
            person,
            {"biography": "Original text"},
            edit_kind="minor",
            edit_note="Typo",
            actor_id=str(dept.historian.id),
        )
        assert not service.public_changes_pending(person)
        assert person.public_snapshot["biography"] == "Original text"

    async def test_the_public_copy_never_holds_restricted_or_private_fields(
        self, db_session, dept
    ):
        person = await _person(
            db_session,
            dept,
            birth_date=date(1920, 3, 4),
            addresses="12 Main St",
            burial_location="Plot 7",
            burial_location_visibility=FieldVisibility.MEMBERS,
            death_circumstances="Structure fire",
            death_circumstances_visibility=FieldVisibility.PUBLIC,
        )
        person = await HistoryService(db_session).publish(
            person, PublicationLevel.PUBLIC, str(dept.historian.id)
        )
        snapshot = person.public_snapshot
        for field in RESTRICTED_FIELDS + ("addresses", "research_notes", "user_id"):
            assert field not in snapshot
        assert "burial_location" not in snapshot
        assert snapshot["death_circumstances"] == "Structure fire"

    async def test_an_author_may_clear_their_own_submission_and_it_says_so(
        self, db_session, dept
    ):
        await self._with_list(db_session, dept)
        clearance = HistoryClearanceService(db_session)
        person = await _person(db_session, dept)
        request, _ = await clearance.submit(
            person, ClearancePurpose.PUBLIC, str(dept.president.id)
        )
        outcome = await clearance.decide(
            request, ClearanceDecisionKind.CLEARED, None, str(dept.president.id)
        )
        assert outcome.request.decisions[0].decided_by_author is True

    async def test_a_reviewer_reads_the_draft_through_the_request(
        self, db_session, dept
    ):
        await self._with_list(db_session, dept)
        person = await _person(db_session, dept, addresses="12 Main St")
        request, _ = await HistoryClearanceService(db_session).submit(
            person, ClearancePurpose.PUBLIC, str(dept.historian.id)
        )

        review = await endpoint.review_clearance_request(
            request.id, db=db_session, current_user=dept.president
        )
        assert review.record.id == person.id
        assert "addresses" not in review.record.model_dump()
        assert review.request.can_decide is True

        with pytest.raises(HTTPException) as caught:
            await endpoint.review_clearance_request(
                request.id, db=db_session, current_user=dept.member
            )
        assert caught.value.status_code == 404

    async def test_the_queue_lists_what_waits_on_the_caller(self, db_session, dept):
        await self._with_list(db_session, dept)
        clearance = HistoryClearanceService(db_session)
        person = await _person(db_session, dept)
        await clearance.submit(person, ClearancePurpose.PUBLIC, str(dept.historian.id))
        assert len(await clearance.queue(dept.org_id, str(dept.president.id))) == 1
        assert await clearance.queue(dept.org_id, str(dept.member.id)) == []

    async def test_a_clearance_list_cannot_name_another_departments_position(
        self, db_session, dept
    ):
        other_org = await _org(db_session)
        foreign = await _position(db_session, other_org, "President")
        with pytest.raises(ValueError, match="not one of this department"):
            await HistoryClearanceService(db_session).replace_steps(
                dept.org_id, [{"name": "Review", "position_id": foreign}]
            )


@pytest.mark.integration
class TestRosterFilters:
    async def test_search_decade_and_title_narrow_the_roster(self, db_session, dept):
        service = HistoryService(db_session)
        chief = await service.create_title(dept.org_id, "Chief", str(dept.historian.id))
        early = await _person(db_session, dept, last_name="Doyle", first_name="Robert")
        later = await _person(db_session, dept, last_name="Nguyen", first_name="Ann")
        await service.replace_periods(
            early,
            [
                {
                    "start_date": date(1923, 1, 1),
                    "end_date": date(1940, 1, 1),
                    "title_ids": [chief.id],
                }
            ],
            edit_kind="minor",
            edit_note=None,
            actor_id=str(dept.historian.id),
        )
        await service.replace_periods(
            later,
            [{"start_date": date(1998, 1, 1), "is_ongoing": True}],
            edit_kind="minor",
            edit_note=None,
            actor_id=str(dept.historian.id),
        )
        viewer = Viewer.of(dept.historian)

        async def names(**filters):
            people, _ = await service.list_people(viewer, **filters)
            return {p.last_name for p in people}

        assert await names(decade=1930) == {"Doyle"}
        assert await names(decade=2020) == {"Nguyen"}
        assert await names(title_id=chief.id) == {"Doyle"}
        assert await names(search="nguy") == {"Nguyen"}
        # A wildcard typed into the search is a literal, not "everyone".
        assert await names(search="%") == set()
