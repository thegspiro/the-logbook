"""
Course links: unlinked records' names, suggested and linked to library courses.

A record with no course counts toward no course or certification requirement.
The officer links a name; every unlinked record carrying it takes the course,
its category and its training type, and compliance counts it from then on.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import training as training_endpoints
from app.api.v1.endpoints.training import (
    course_link_history,
    link_course_name,
    link_suggested_course_names,
    list_course_links,
    undo_course_link,
)
from app.models.training import (
    TrainingCategory,
    TrainingCourse,
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.training import CourseLinkRequest
from app.services.training_compliance import certification_record_matches
from app.services.training_course_links import TrainingCourseLinkService, name_key

pytestmark = [pytest.mark.integration]


@pytest.fixture(autouse=True)
def _no_audit(monkeypatch):
    monkeypatch.setattr(training_endpoints, "log_audit_event", AsyncMock())


async def _member(db_session, org_id) -> User:
    member = User(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        username=f"m{uuid.uuid4().hex[:10]}",
        email=f"{uuid.uuid4().hex[:8]}@dept.test",
        first_name="Pat",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(member)
    await db_session.flush()
    result = await db_session.execute(
        select(User)
        .options(selectinload(User.positions))
        .where(User.id == member.id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _category(db_session, org_id, name="Medical") -> TrainingCategory:
    category = TrainingCategory(
        id=str(uuid.uuid4()), organization_id=org_id, name=name, active=True
    )
    db_session.add(category)
    await db_session.flush()
    return category


async def _course(
    db_session, org_id, name, training_type=TrainingType.CERTIFICATION, **extra
) -> TrainingCourse:
    course = TrainingCourse(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=name,
        training_type=training_type,
        active=True,
        **extra,
    )
    db_session.add(course)
    await db_session.flush()
    return course


async def _record(db_session, org_id, user_id, name, day, **extra) -> TrainingRecord:
    record = TrainingRecord(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        user_id=user_id,
        course_name=name,
        training_type=TrainingType.CONTINUING_EDUCATION,
        completion_date=day,
        hours_completed=4,
        status=TrainingStatus.COMPLETED,
        **extra,
    )
    db_session.add(record)
    await db_session.flush()
    return record


async def _view(db_session, officer, **params):
    return await list_course_links(
        search=params.get("search"),
        offset=params.get("offset", 0),
        limit=params.get("limit", 25),
        db=db_session,
        current_user=officer,
    )


async def _reload(db_session, record) -> TrainingRecord:
    result = await db_session.execute(
        select(TrainingRecord)
        .where(TrainingRecord.id == record.id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


class TestListing:
    async def test_spellings_of_one_name_group_with_a_suggestion(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        officer = await _member(db_session, org_id)
        alice = await _member(db_session, org_id)
        bob = await _member(db_session, org_id)
        cpr = await _course(db_session, org_id, "CPR Refresher")
        await _record(db_session, org_id, alice.id, "CPR Refresher", date(2019, 5, 1))
        await _record(
            db_session, org_id, alice.id, "C.P.R. refresher", date(2020, 5, 1)
        )
        await _record(
            db_session,
            org_id,
            bob.id,
            "CAPCE CPR Refresher (3088740)",
            date(2021, 5, 1),
        )
        await _record(db_session, org_id, bob.id, "Ladder raises", date(2021, 6, 1))
        await _record(
            db_session,
            org_id,
            bob.id,
            "Already linked",
            date(2021, 7, 1),
            course_id=cpr.id,
        )

        view = await _view(db_session, officer)

        cpr_row = view.items[0]
        assert (cpr_row.label, cpr_row.records, cpr_row.members) == (
            "CPR Refresher",
            3,
            2,
        )
        assert sorted(s.name for s in cpr_row.spellings) == [
            "C.P.R. refresher",
            "CAPCE CPR Refresher (3088740)",
            "CPR Refresher",
        ]
        assert (cpr_row.first_date, cpr_row.last_date) == (
            date(2019, 5, 1),
            date(2021, 5, 1),
        )
        assert cpr_row.suggested_course.name == "CPR Refresher"
        assert [(i.label, i.suggested_course) for i in view.items[1:]] == [
            ("Ladder raises", None)
        ]
        assert (view.total, view.suggested_names, view.suggested_records) == (2, 1, 3)

    async def test_search_finds_a_name_by_any_spelling(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        officer = await _member(db_session, org_id)
        member = await _member(db_session, org_id)
        await _record(db_session, org_id, member.id, "Hose lays", date(2020, 1, 1))
        await _record(db_session, org_id, member.id, "Ladder raises", date(2020, 1, 1))

        view = await _view(db_session, officer, search="LADDER")

        assert [i.label for i in view.items] == ["Ladder raises"]

    async def test_another_departments_records_are_not_listed(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        other = Organization(
            id=str(uuid.uuid4()), name="Other", slug=f"o-{uuid.uuid4().hex[:8]}"
        )
        db_session.add(other)
        await db_session.flush()
        officer = await _member(db_session, org_id)
        stranger = await _member(db_session, other.id)
        await _record(
            db_session, other.id, stranger.id, "Their class", date(2020, 1, 1)
        )

        view = await _view(db_session, officer)

        assert view.items == []


class TestLinking:
    async def test_linking_a_name_sets_course_category_and_type_on_every_spelling(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        officer = await _member(db_session, org_id)
        member = await _member(db_session, org_id)
        medical = await _category(db_session, org_id)
        cpr = await _course(
            db_session, org_id, "CPR Refresher", category_ids=[medical.id]
        )
        first = await _record(
            db_session, org_id, member.id, "CPR Refresher", date(2019, 5, 1)
        )
        second = await _record(
            db_session, org_id, member.id, "C.P.R. refresher", date(2020, 5, 1)
        )
        other = await _record(
            db_session, org_id, member.id, "Ladder raises", date(2020, 6, 1)
        )

        result = await link_course_name(
            payload=CourseLinkRequest(key=name_key("CPR Refresher"), course_id=cpr.id),
            db=db_session,
            current_user=officer,
        )

        assert (result.names, result.records) == (1, 2)
        for record in (first, second):
            linked = await _reload(db_session, record)
            assert (linked.course_id, linked.category_id, linked.training_type) == (
                cpr.id,
                medical.id,
                TrainingType.CERTIFICATION,
            )
        kept = await _reload(db_session, first)
        assert (kept.course_name, kept.hours_completed) == ("CPR Refresher", 4)
        assert (await _reload(db_session, other)).course_id is None

    async def test_a_record_linked_by_hand_keeps_its_course_and_a_second_link_is_a_no_op(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        officer = await _member(db_session, org_id)
        member = await _member(db_session, org_id)
        cpr = await _course(db_session, org_id, "CPR Refresher")
        bls = await _course(db_session, org_id, "BLS Provider")
        by_hand = await _record(
            db_session,
            org_id,
            member.id,
            "CPR Refresher",
            date(2019, 5, 1),
            course_id=bls.id,
        )
        await _record(db_session, org_id, member.id, "CPR Refresher", date(2020, 5, 1))
        payload = CourseLinkRequest(key=name_key("CPR Refresher"), course_id=cpr.id)

        first = await link_course_name(
            payload=payload, db=db_session, current_user=officer
        )
        with pytest.raises(HTTPException) as again:
            await link_course_name(payload=payload, db=db_session, current_user=officer)

        assert first.records == 1
        assert again.value.status_code == 400
        assert "No unlinked training records" in again.value.detail
        assert (await _reload(db_session, by_hand)).course_id == bls.id

    async def test_a_course_outside_the_department_is_refused(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        other = Organization(
            id=str(uuid.uuid4()), name="Other", slug=f"o-{uuid.uuid4().hex[:8]}"
        )
        db_session.add(other)
        await db_session.flush()
        officer = await _member(db_session, org_id)
        member = await _member(db_session, org_id)
        theirs = await _course(db_session, other.id, "CPR Refresher")
        record = await _record(
            db_session, org_id, member.id, "CPR Refresher", date(2019, 5, 1)
        )

        with pytest.raises(HTTPException) as refused:
            await link_course_name(
                payload=CourseLinkRequest(
                    key=name_key("CPR Refresher"), course_id=theirs.id
                ),
                db=db_session,
                current_user=officer,
            )

        assert refused.value.status_code == 400
        assert (await _reload(db_session, record)).course_id is None

    async def test_link_all_suggested_links_only_names_with_a_suggestion(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        officer = await _member(db_session, org_id)
        member = await _member(db_session, org_id)
        cpr = await _course(db_session, org_id, "CPR Refresher")
        suggested = await _record(
            db_session, org_id, member.id, "CPR refresher", date(2019, 5, 1)
        )
        unmatched = await _record(
            db_session, org_id, member.id, "Ladder raises", date(2019, 6, 1)
        )

        result = await link_suggested_course_names(db=db_session, current_user=officer)

        assert (result.names, result.records) == (1, 1)
        assert (await _reload(db_session, suggested)).course_id == cpr.id
        assert (await _reload(db_session, unmatched)).course_id is None

    async def test_a_course_that_grants_a_qualification_certifies_linked_records(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        emt = await _course(db_session, org_id, "EMT Basic", grants_qualification="emt")
        record = await _record(
            db_session, org_id, member.id, "EMT-Basic", date(2019, 5, 1)
        )
        synced = AsyncMock()
        monkeypatch.setattr(
            "app.services.training_course_links.QualificationService.sync_from_training_record",
            synced,
        )

        await TrainingCourseLinkService(db_session).link(
            org_id, name_key("EMT Basic"), emt.id
        )

        assert [call.args[0].id for call in synced.await_args_list] == [record.id]
        assert synced.await_args_list[0].args[0].course_id == emt.id

    async def test_a_linked_record_meets_the_certification_that_names_its_course(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        cpr = await _course(db_session, org_id, "CPR Refresher")
        record = await _record(
            db_session, org_id, member.id, "C.P.R. refresher", date(2019, 5, 1)
        )
        # A certification requirement created today: it names its course and
        # matches nothing by name (name_match_until is unset).
        requirement = SimpleNamespace(
            required_courses=[cpr.id],
            training_type=None,
            name="CPR",
            name_match_until=None,
            registry_code=None,
        )
        before = certification_record_matches(requirement, record)

        await TrainingCourseLinkService(db_session).link(
            org_id, name_key("CPR Refresher"), cpr.id
        )

        assert before is False
        assert certification_record_matches(
            requirement, await _reload(db_session, record)
        )


class TestUndoingALink:
    async def _linked(self, db_session, org_id, officer):
        member = await _member(db_session, org_id)
        medical = await _category(db_session, org_id)
        old = await _category(db_session, org_id, name="Old")
        cpr = await _course(
            db_session, org_id, "CPR Refresher", category_ids=[medical.id]
        )
        first = await _record(
            db_session,
            org_id,
            member.id,
            "CPR Refresher",
            date(2019, 5, 1),
            category_id=old.id,
        )
        second = await _record(
            db_session, org_id, member.id, "C.P.R. refresher", date(2020, 5, 1)
        )
        await link_course_name(
            payload=CourseLinkRequest(key=name_key("CPR Refresher"), course_id=cpr.id),
            db=db_session,
            current_user=officer,
        )
        history = await course_link_history(
            offset=0, limit=10, db=db_session, current_user=officer
        )
        return cpr, old, first, second, history.items[0]

    async def test_a_link_is_recorded_and_undoing_it_restores_each_record(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        officer = await _member(db_session, org_id)
        cpr, old, first, second, link = await self._linked(db_session, org_id, officer)

        assert (link.course_name, link.record_count, link.undone_at) == (
            "CPR Refresher",
            2,
            None,
        )
        assert link.linked_by_name == "Pat Member"

        result = await undo_course_link(
            link_id=link.id, db=db_session, current_user=officer
        )

        assert (result.reverted, result.kept) == (2, 0)
        restored = await _reload(db_session, first)
        assert (
            restored.course_id,
            restored.category_id,
            restored.training_type,
        ) == (None, old.id, TrainingType.CONTINUING_EDUCATION)
        assert (await _reload(db_session, second)).course_id is None
        after = await course_link_history(
            offset=0, limit=10, db=db_session, current_user=officer
        )
        assert after.items[0].undone_at is not None
        # The name is unlinked again, so it can be linked anew.
        view = await _view(db_session, officer)
        assert [i.records for i in view.items] == [2]

    async def test_a_record_changed_since_keeps_its_course(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        officer = await _member(db_session, org_id)
        cpr, _old, first, second, link = await self._linked(db_session, org_id, officer)
        await db_session.execute(
            update(TrainingRecord)
            .where(TrainingRecord.id == second.id)
            .values(updated_at=datetime.now(timezone.utc) + timedelta(hours=1))
        )
        await db_session.commit()

        result = await undo_course_link(
            link_id=link.id, db=db_session, current_user=officer
        )

        assert (result.reverted, result.kept) == (1, 1)
        assert (await _reload(db_session, first)).course_id is None
        assert (await _reload(db_session, second)).course_id == cpr.id

    async def test_a_link_is_undone_once_and_only_in_its_department(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        officer = await _member(db_session, org_id)
        *_, link = await self._linked(db_session, org_id, officer)
        other = Organization(
            id=str(uuid.uuid4()), name="Other", slug=f"o-{uuid.uuid4().hex[:8]}"
        )
        db_session.add(other)
        await db_session.flush()
        stranger = await _member(db_session, other.id)

        with pytest.raises(HTTPException) as elsewhere:
            await undo_course_link(
                link_id=link.id, db=db_session, current_user=stranger
            )
        await undo_course_link(link_id=link.id, db=db_session, current_user=officer)
        with pytest.raises(HTTPException) as again:
            await undo_course_link(link_id=link.id, db=db_session, current_user=officer)

        assert "not found" in elsewhere.value.detail
        assert "already been undone" in again.value.detail

    async def test_undoing_takes_back_a_qualification_the_link_granted(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        emt = await _course(db_session, org_id, "EMT Basic", grants_qualification="emt")
        await _record(db_session, org_id, member.id, "EMT-Basic", date(2019, 5, 1))
        synced = AsyncMock()
        monkeypatch.setattr(
            "app.services.training_course_links.QualificationService"
            ".sync_from_training_record",
            synced,
        )
        service = TrainingCourseLinkService(db_session)
        await service.link(org_id, name_key("EMT Basic"), emt.id, linked_by=member.id)
        links, _total = await service.history(org_id, 0, 10)
        synced.reset_mock()

        await service.unlink(org_id, links[0].id, member.id)

        call = synced.await_args_list[0].args[0]
        assert (call.user_id, call.course_id) == (member.id, emt.id)
