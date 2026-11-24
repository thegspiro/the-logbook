"""The CRR catalogue: what a department starts with, and what it may change.

Run against real rows through the endpoints, the way the settings screen uses
them. The rules pinned here are the owner's (2026-11-21/22): defaults are each
department's own, a seeded row is retired rather than deleted, a rename keeps
the stable code, and one department never sees or touches another's catalogue.
"""

import uuid

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select

from app.api.v1.endpoints.crr import (
    add_measure,
    create_activity_type,
    create_tag,
    delete_activity_type,
    get_catalogue,
    set_activity_type_tags,
    update_activity_type,
    update_measure,
    update_tag,
)
from app.models.crr import CrrActivityType, CrrTag
from app.models.user import Organization, User, UserStatus
from app.schemas.crr import (
    CrrActivityTypeCreate,
    CrrActivityTypeUpdate,
    CrrMeasureCreate,
    CrrMeasureUpdate,
    CrrTagCreate,
    CrrTagUpdate,
    CrrTypeTagsUpdate,
)
from app.services.crr_catalogue_defaults import DEFAULT_ACTIVITY_TYPES, DEFAULT_TAGS

pytestmark = pytest.mark.integration


async def _org(db_session, label):
    org = Organization(
        name=f"{label} FD",
        slug=f"{label.lower()}-{uuid.uuid4().hex[:10]}",
        timezone="America/New_York",
        settings={},
    )
    db_session.add(org)
    await db_session.flush()
    officer = User(
        organization_id=org.id,
        username=f"{label.lower()}-{org.id[:8]}",
        email=f"{label.lower()}-{org.id[:8]}@example.test",
        first_name="Outreach",
        last_name="Manager",
        status=UserStatus.ACTIVE,
    )
    db_session.add(officer)
    await db_session.flush()
    return org, officer


@pytest.fixture
async def dept(db_session):
    return await _org(db_session, "Catalogue")


async def _catalogue(db_session, officer):
    return await get_catalogue(db=db_session, current_user=officer)


def _type(catalogue, code):
    return next(t for t in catalogue.activity_types if t.code == code)


class TestDefaults:
    async def test_the_first_read_seeds_the_owners_defaults(self, db_session, dept):
        _, officer = dept

        catalogue = await _catalogue(db_session, officer)

        assert [t.code for t in catalogue.activity_types] == [
            d.code for d in DEFAULT_ACTIVITY_TYPES
        ]
        assert sorted(t.code for t in catalogue.tags) == sorted(
            t.code for t in DEFAULT_TAGS
        )
        car_seats = _type(catalogue, "car_seat_inspection")
        assert [m.label for m in car_seats.measures] == [
            "Seats inspected",
            "Seats installed",
        ]
        tag_codes = {t.id: t.code for t in catalogue.tags}
        assert sorted(tag_codes[i] for i in car_seats.tag_ids) == [
            "children",
            "motor_vehicle",
        ]
        assert all(t.is_system and t.is_active for t in catalogue.activity_types)

    async def test_juvenile_firesetter_intervention_is_not_seeded(
        self, db_session, dept
    ):
        # The owner made it a separate "coming soon" option, not a type.
        _, officer = dept
        catalogue = await _catalogue(db_session, officer)
        assert not any("firesetter" in t.code for t in catalogue.activity_types)

    async def test_a_second_read_seeds_nothing_more(self, db_session, dept):
        org, officer = dept
        await _catalogue(db_session, officer)
        await _catalogue(db_session, officer)

        count = await db_session.scalar(
            select(func.count(CrrActivityType.id)).where(
                CrrActivityType.organization_id == org.id
            )
        )
        tags = await db_session.scalar(
            select(func.count(CrrTag.id)).where(CrrTag.organization_id == org.id)
        )
        assert (count, tags) == (len(DEFAULT_ACTIVITY_TYPES), len(DEFAULT_TAGS))

    async def test_retiring_every_default_does_not_reseed(self, db_session, dept):
        _, officer = dept
        catalogue = await _catalogue(db_session, officer)
        for activity_type in catalogue.activity_types:
            await update_activity_type(
                type_id=activity_type.id,
                body=CrrActivityTypeUpdate(is_active=False),
                db=db_session,
                current_user=officer,
            )

        again = await _catalogue(db_session, officer)

        assert len(again.activity_types) == len(DEFAULT_ACTIVITY_TYPES)
        assert not any(t.is_active for t in again.activity_types)


class TestActivityTypes:
    async def test_a_rename_keeps_the_code(self, db_session, dept):
        _, officer = dept
        catalogue = await _catalogue(db_session, officer)
        smoke = _type(catalogue, "smoke_alarm_install")

        renamed = await update_activity_type(
            type_id=smoke.id,
            body=CrrActivityTypeUpdate(name="Smoke detector install"),
            db=db_session,
            current_user=officer,
        )

        assert (renamed.name, renamed.code) == (
            "Smoke detector install",
            "smoke_alarm_install",
        )

    async def test_a_new_type_gets_its_counts_and_a_code(self, db_session, dept):
        _, officer = dept

        created = await create_activity_type(
            body=CrrActivityTypeCreate(
                name="  Water   safety talk ",
                measures=["People reached", "Sessions"],
            ),
            db=db_session,
            current_user=officer,
        )

        assert created.name == "Water safety talk"
        assert created.code == "water_safety_talk"
        assert [m.label for m in created.measures] == ["People reached", "Sessions"]
        assert created.is_system is False

    async def test_a_duplicate_name_is_refused_whatever_its_case(
        self, db_session, dept
    ):
        _, officer = dept
        await _catalogue(db_session, officer)
        with pytest.raises(HTTPException) as caught:
            await create_activity_type(
                body=CrrActivityTypeCreate(name="hands-only cpr"),
                db=db_session,
                current_user=officer,
            )
        assert caught.value.status_code == 400

    async def test_a_seeded_type_cannot_be_deleted(self, db_session, dept):
        _, officer = dept
        catalogue = await _catalogue(db_session, officer)
        with pytest.raises(HTTPException) as caught:
            await delete_activity_type(
                type_id=_type(catalogue, "stop_the_bleed").id,
                db=db_session,
                current_user=officer,
            )
        assert caught.value.status_code == 400
        assert "Retire it instead" in caught.value.detail

    async def test_a_type_the_department_added_can_be_deleted(self, db_session, dept):
        _, officer = dept
        created = await create_activity_type(
            body=CrrActivityTypeCreate(name="Knox box check"),
            db=db_session,
            current_user=officer,
        )
        await delete_activity_type(
            type_id=created.id, db=db_session, current_user=officer
        )
        catalogue = await _catalogue(db_session, officer)
        assert not any(t.id == created.id for t in catalogue.activity_types)

    async def test_an_explicit_null_is_refused_rather_than_dropped(
        self, db_session, dept
    ):
        _, officer = dept
        catalogue = await _catalogue(db_session, officer)
        smoke = _type(catalogue, "smoke_alarm_install")
        for body in (
            CrrActivityTypeUpdate(name=None),
            CrrActivityTypeUpdate(is_active=None),
        ):
            with pytest.raises(HTTPException) as caught:
                await update_activity_type(
                    type_id=smoke.id, body=body, db=db_session, current_user=officer
                )
            assert caught.value.status_code == 400

    async def test_clearing_a_description_persists(self, db_session, dept):
        _, officer = dept
        catalogue = await _catalogue(db_session, officer)
        smoke = _type(catalogue, "smoke_alarm_install")
        cleared = await update_activity_type(
            type_id=smoke.id,
            body=CrrActivityTypeUpdate(description=None),
            db=db_session,
            current_user=officer,
        )
        assert cleared.description is None


class TestMeasures:
    async def test_a_count_is_added_renamed_and_retired(self, db_session, dept):
        _, officer = dept
        catalogue = await _catalogue(db_session, officer)
        cpr = _type(catalogue, "hands_only_cpr")

        added = await add_measure(
            type_id=cpr.id,
            body=CrrMeasureCreate(label="Sessions"),
            db=db_session,
            current_user=officer,
        )
        sessions = next(m for m in added.measures if m.label == "Sessions")
        renamed = await update_measure(
            measure_id=sessions.id,
            body=CrrMeasureUpdate(label="Classes", is_active=False),
            db=db_session,
            current_user=officer,
        )

        classes = next(m for m in renamed.measures if m.id == sessions.id)
        assert (classes.label, classes.code, classes.is_active) == (
            "Classes",
            "sessions",
            False,
        )

    async def test_a_duplicate_count_on_one_type_is_refused(self, db_session, dept):
        _, officer = dept
        catalogue = await _catalogue(db_session, officer)
        with pytest.raises(HTTPException) as caught:
            await add_measure(
                type_id=_type(catalogue, "hands_only_cpr").id,
                body=CrrMeasureCreate(label="people TRAINED"),
                db=db_session,
                current_user=officer,
            )
        assert caught.value.status_code == 400


class TestTags:
    async def test_a_type_takes_only_the_departments_own_tags(self, db_session, dept):
        _, officer = dept
        other_org, other_officer = await _org(db_session, "Elsewhere")
        theirs = await _catalogue(db_session, other_officer)
        catalogue = await _catalogue(db_session, officer)
        smoke = _type(catalogue, "smoke_alarm_install")

        with pytest.raises(HTTPException) as caught:
            await set_activity_type_tags(
                type_id=smoke.id,
                body=CrrTypeTagsUpdate(tag_ids=[theirs.tags[0].id]),
                db=db_session,
                current_user=officer,
            )
        assert caught.value.status_code == 400

    async def test_a_types_tags_are_replaced(self, db_session, dept):
        _, officer = dept
        catalogue = await _catalogue(db_session, officer)
        by_code = {t.code: t.id for t in catalogue.tags}
        smoke = _type(catalogue, "smoke_alarm_install")

        updated = await set_activity_type_tags(
            type_id=smoke.id,
            body=CrrTypeTagsUpdate(tag_ids=[by_code["older_adults"], by_code["fire"]]),
            db=db_session,
            current_user=officer,
        )

        assert sorted(updated.tag_ids) == sorted(
            [by_code["older_adults"], by_code["fire"]]
        )

    async def test_a_tag_is_added_and_a_duplicate_refused(self, db_session, dept):
        _, officer = dept
        added = await create_tag(
            body=CrrTagCreate(kind="risk", label="Wildfire"),
            db=db_session,
            current_user=officer,
        )
        assert (added.kind, added.code, added.is_system) == ("risk", "wildfire", False)
        with pytest.raises(HTTPException) as caught:
            await create_tag(
                body=CrrTagCreate(kind="risk", label="FIRE"),
                db=db_session,
                current_user=officer,
            )
        assert caught.value.status_code == 400

    async def test_the_same_label_may_be_a_risk_and_a_population(
        self, db_session, dept
    ):
        _, officer = dept
        await _catalogue(db_session, officer)
        added = await create_tag(
            body=CrrTagCreate(kind="population", label="Falls"),
            db=db_session,
            current_user=officer,
        )
        assert added.kind == "population"

    async def test_a_tag_kind_is_a_risk_or_a_population(self):
        with pytest.raises(ValidationError):
            CrrTagCreate(kind="hazard", label="Anything")

    async def test_a_tag_is_retired(self, db_session, dept):
        _, officer = dept
        catalogue = await _catalogue(db_session, officer)
        drowning = next(t for t in catalogue.tags if t.code == "drowning")
        retired = await update_tag(
            tag_id=drowning.id,
            body=CrrTagUpdate(is_active=False),
            db=db_session,
            current_user=officer,
        )
        assert retired.is_active is False


class TestIsolation:
    async def test_another_departments_type_reads_as_not_found(self, db_session, dept):
        _, officer = dept
        _, other_officer = await _org(db_session, "Neighbour")
        theirs = await _catalogue(db_session, other_officer)

        with pytest.raises(HTTPException) as caught:
            await update_activity_type(
                type_id=theirs.activity_types[0].id,
                body=CrrActivityTypeUpdate(name="Hijacked"),
                db=db_session,
                current_user=officer,
            )
        assert caught.value.status_code == 404

    async def test_each_department_has_its_own_copy(self, db_session, dept):
        _, officer = dept
        _, other_officer = await _org(db_session, "Sister")
        ours = await _catalogue(db_session, officer)
        theirs = await _catalogue(db_session, other_officer)

        assert {t.code for t in ours.activity_types} == {
            t.code for t in theirs.activity_types
        }
        assert not {t.id for t in ours.activity_types} & {
            t.id for t in theirs.activity_types
        }
