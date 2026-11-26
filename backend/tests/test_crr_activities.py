"""Recording CRR activities: what is stored, who sees it, and what it credits.

Run against real rows through the endpoints. The rules are the owner's
(2026-11-22): resident details are encrypted and shown only to
``crr.view_contact`` holders, a log entry credits Admin Hours (the type's own
category, else the Public Education mapping), an event's activity credits
nothing, and resident details are cleared after the retention period with the
ZIP code kept.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.api.v1.endpoints import crr as crr_endpoints
from app.api.v1.endpoints import events as events_endpoints
from app.api.v1.endpoints.crr import (
    create_activity,
    delete_activity,
    get_catalogue,
    get_form_options,
    list_activities,
    update_activity,
    update_activity_type,
    update_measure,
    update_settings,
    update_tag,
)
from app.api.v1.endpoints.events import crr_recording_offered
from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    AdminHoursEntryMethod,
    AdminHoursEntryStatus,
    EventHourMapping,
)
from app.models.crr import CrrActivity, CrrActivityType
from app.models.event import Event, EventType
from app.models.user import Organization, User, UserStatus
from app.schemas.crr import (
    CrrActivityCreate,
    CrrActivityTypeUpdate,
    CrrActivityUpdate,
    CrrMeasureUpdate,
    CrrSettingsUpdate,
    CrrTagUpdate,
)
from app.services.crr_activity_service import CrrActivityService
from app.services.scheduled_tasks import run_crr_resident_details_retention
from tests.clock_support import reread_each_test

pytestmark = pytest.mark.integration


def _clock() -> dict:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    return {"NOW": now, "AN_HOUR_AGO": now - timedelta(hours=1)}


NOW, AN_HOUR_AGO = _clock().values()
_reread_clock = reread_each_test(__name__, _clock)


@pytest.fixture
def grants(monkeypatch):
    """The permissions each test's users hold, by user id."""
    held: dict[str, set[str]] = {}

    def has(user, permission):
        return permission in held.get(str(user.id), set())

    monkeypatch.setattr(crr_endpoints, "user_has_permission", has)
    monkeypatch.setattr(events_endpoints, "user_has_permission", has)
    return held


async def _org(db_session, label, country="USA"):
    org = Organization(
        name=f"{label} FD",
        slug=f"{label.lower()}-{uuid.uuid4().hex[:10]}",
        timezone="America/New_York",
        settings={},
        mailing_city="Falls Church",
        mailing_state="VA",
        mailing_zip="22046",
        mailing_country=country,
    )
    db_session.add(org)
    await db_session.flush()
    users = []
    for i in range(3):
        user = User(
            organization_id=org.id,
            username=f"{label.lower()}{i}-{org.id[:8]}",
            email=f"{label.lower()}{i}-{org.id[:8]}@example.test",
            first_name="Member",
            last_name=str(i),
            status=UserStatus.ACTIVE,
        )
        db_session.add(user)
        users.append(user)
    await db_session.flush()
    return org, users


@pytest.fixture
async def dept(db_session):
    return await _org(db_session, "Crr")


async def _catalogue(db_session, user):
    return await get_catalogue(db=db_session, current_user=user)


def _type(catalogue, code):
    return next(t for t in catalogue.activity_types if t.code == code)


async def _category(db_session, org, require_approval=False):
    category = AdminHoursCategory(
        organization_id=org.id,
        name=f"Outreach {uuid.uuid4().hex[:4]}",
        require_approval=require_approval,
        auto_approve_under_hours=None,
    )
    db_session.add(category)
    await db_session.flush()
    return category


async def _record(db_session, user, **fields):
    body = CrrActivityCreate(
        occurred_at=fields.pop("occurred_at", AN_HOUR_AGO), **fields
    )
    return await create_activity(body=body, db=db_session, current_user=user)


async def _entries(db_session, activity_id):
    return (
        (
            await db_session.execute(
                select(AdminHoursEntry).where(
                    AdminHoursEntry.source_crr_activity_id == activity_id
                )
            )
        )
        .scalars()
        .all()
    )


class TestRecording:
    async def test_a_log_entry_keeps_its_counts_tags_and_place(
        self, db_session, dept, grants
    ):
        _, (manager, *_rest) = dept
        catalogue = await _catalogue(db_session, manager)
        smoke = _type(catalogue, "smoke_alarm_install")
        alarms = smoke.measures[0]

        row = await _record(
            db_session,
            manager,
            activity_type_id=smoke.id,
            counts={alarms.id: 3},
            zip_code="22046-1234",
        )

        assert row.activity_type_name == "Smoke alarm install"
        assert [(c.label, c.quantity) for c in row.counts] == [("Alarms installed", 3)]
        assert [t.label for t in row.tags] == ["Fire"]
        assert (row.zip_code, row.city, row.state, row.county) == (
            "22046",
            "Falls Church",
            "VA",
            "Falls Church (city)",
        )

    async def test_a_removed_member_cannot_be_credited(self, db_session, dept, grants):
        _, (manager, removed, *_rest) = dept
        removed.deleted_at = NOW
        await db_session.flush()
        catalogue = await _catalogue(db_session, manager)

        with pytest.raises(HTTPException) as caught:
            await _record(
                db_session,
                manager,
                activity_type_id=_type(catalogue, "hands_only_cpr").id,
                members={removed.id: 30},
            )
        assert caught.value.status_code == 400

    async def test_a_retired_tag_cannot_be_put_on_a_new_activity(
        self, db_session, dept, grants
    ):
        _, (manager, *_rest) = dept
        catalogue = await _catalogue(db_session, manager)
        drowning = next(t for t in catalogue.tags if t.code == "drowning")
        await update_tag(
            tag_id=drowning.id,
            body=CrrTagUpdate(is_active=False),
            db=db_session,
            current_user=manager,
        )

        with pytest.raises(HTTPException) as caught:
            await _record(
                db_session,
                manager,
                activity_type_id=_type(catalogue, "home_safety_survey").id,
                tag_ids=[drowning.id],
            )
        assert caught.value.status_code == 400

    async def test_a_retired_tag_already_on_an_activity_may_stay_or_be_removed(
        self, db_session, dept, grants
    ):
        _, (manager, *_rest) = dept
        catalogue = await _catalogue(db_session, manager)
        by_code = {t.code: t.id for t in catalogue.tags}
        row = await _record(
            db_session,
            manager,
            activity_type_id=_type(catalogue, "smoke_alarm_install").id,
            tag_ids=[by_code["fire"], by_code["older_adults"]],
        )
        await update_tag(
            tag_id=by_code["fire"],
            body=CrrTagUpdate(is_active=False),
            db=db_session,
            current_user=manager,
        )

        kept = await update_activity(
            activity_id=row.id,
            body=CrrActivityUpdate(tag_ids=[by_code["fire"], by_code["older_adults"]]),
            db=db_session,
            current_user=manager,
        )
        assert sorted(t.id for t in kept.tags) == sorted(
            [by_code["fire"], by_code["older_adults"]]
        )
        removed = await update_activity(
            activity_id=row.id,
            body=CrrActivityUpdate(tag_ids=[by_code["older_adults"]]),
            db=db_session,
            current_user=manager,
        )
        assert [t.id for t in removed.tags] == [by_code["older_adults"]]

    async def test_changing_counts_keeps_a_retired_counts_tally(
        self, db_session, dept, grants
    ):
        # The form offers only active counts, so a retired count is never in
        # the payload; replacing the counts must not erase what it recorded.
        _, (manager, *_rest) = dept
        catalogue = await _catalogue(db_session, manager)
        smoke = _type(catalogue, "smoke_alarm_install")
        first, second = smoke.measures[0], smoke.measures[1]
        row = await _record(
            db_session,
            manager,
            activity_type_id=smoke.id,
            counts={first.id: 3, second.id: 2},
        )
        await update_measure(
            measure_id=second.id,
            body=CrrMeasureUpdate(is_active=False),
            db=db_session,
            current_user=manager,
        )

        changed = await update_activity(
            activity_id=row.id,
            body=CrrActivityUpdate(counts={first.id: 5}),
            db=db_session,
            current_user=manager,
        )

        assert sorted((c.measure_id, c.quantity) for c in changed.counts) == sorted(
            [(first.id, 5), (second.id, 2)]
        )

    async def test_a_new_zip_brings_its_own_place(self, db_session, dept, grants):
        _, (manager, *_rest) = dept
        catalogue = await _catalogue(db_session, manager)
        row = await _record(
            db_session,
            manager,
            activity_type_id=_type(catalogue, "hands_only_cpr").id,
            zip_code="22046",
        )

        moved = await update_activity(
            activity_id=row.id,
            body=CrrActivityUpdate(zip_code="10001"),
            db=db_session,
            current_user=manager,
        )

        assert (moved.zip_code, moved.city, moved.state) == ("10001", "New York", "NY")

    async def test_a_count_from_another_type_is_refused(self, db_session, dept, grants):
        _, (manager, *_rest) = dept
        catalogue = await _catalogue(db_session, manager)
        smoke = _type(catalogue, "smoke_alarm_install")
        cpr = _type(catalogue, "hands_only_cpr")
        with pytest.raises(HTTPException) as caught:
            await _record(
                db_session,
                manager,
                activity_type_id=smoke.id,
                counts={cpr.measures[0].id: 5},
            )
        assert caught.value.status_code == 400

    async def test_a_retired_type_is_refused(self, db_session, dept, grants):
        _, (manager, *_rest) = dept
        catalogue = await _catalogue(db_session, manager)
        smoke = _type(catalogue, "smoke_alarm_install")
        await update_activity_type(
            type_id=smoke.id,
            body=CrrActivityTypeUpdate(is_active=False),
            db=db_session,
            current_user=manager,
        )
        with pytest.raises(HTTPException) as caught:
            await _record(db_session, manager, activity_type_id=smoke.id)
        assert caught.value.status_code == 400
        assert "retired" in caught.value.detail

    async def test_another_departments_member_is_refused(
        self, db_session, dept, grants
    ):
        _, (manager, *_rest) = dept
        _, (stranger, *_others) = await _org(db_session, "Other")
        catalogue = await _catalogue(db_session, manager)
        with pytest.raises(HTTPException) as caught:
            await _record(
                db_session,
                manager,
                activity_type_id=_type(catalogue, "hands_only_cpr").id,
                members={stranger.id: 60},
            )
        assert caught.value.status_code == 400

    async def test_another_departments_activity_reads_as_not_found(
        self, db_session, dept, grants
    ):
        _, (manager, *_rest) = dept
        _, (outsider, *_others) = await _org(db_session, "Elsewhere")
        catalogue = await _catalogue(db_session, manager)
        row = await _record(
            db_session, manager, activity_type_id=_type(catalogue, "hands_only_cpr").id
        )
        grants[str(outsider.id)] = {"events.manage"}
        with pytest.raises(HTTPException) as caught:
            await update_activity(
                activity_id=row.id,
                body=CrrActivityUpdate(counts={}),
                db=db_session,
                current_user=outsider,
            )
        assert caught.value.status_code == 404


class TestResidentDetails:
    async def test_details_are_hidden_without_view_contact(
        self, db_session, dept, grants
    ):
        _, (recorder, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        row = await _record(
            db_session,
            recorder,
            activity_type_id=_type(catalogue, "home_safety_survey").id,
            has_resident_details=True,
            street_address="12 Oak St",
            resident_name="Pat Resident",
            notes="Back door sticks",
        )
        assert row.has_resident_details is True
        assert (row.street_address, row.resident_name, row.notes) == (None, None, None)

    async def test_details_are_shown_to_view_contact_and_audited(
        self, db_session, dept, grants
    ):
        org, (recorder, manager, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        row = await _record(
            db_session,
            recorder,
            activity_type_id=_type(catalogue, "home_safety_survey").id,
            has_resident_details=True,
            street_address="12 Oak St",
            resident_phone="703-555-0100",
        )
        grants[str(manager.id)] = {"crr.view_contact"}

        listed = await list_activities(
            start=None,
            end=None,
            activity_type_id=None,
            event_id=None,
            limit=50,
            offset=0,
            db=db_session,
            current_user=manager,
        )

        seen = next(i for i in listed.items if i.id == row.id)
        assert (seen.street_address, seen.resident_phone) == (
            "12 Oak St",
            "703-555-0100",
        )
        audit = (
            await db_session.execute(
                text(
                    "SELECT event_data FROM audit_logs WHERE event_type = "
                    "'crr.resident_details_viewed' ORDER BY timestamp DESC LIMIT 1"
                )
            )
        ).scalar_one()
        assert row.id in str(audit)
        assert "12 Oak St" not in str(audit)

    async def test_recording_and_changing_details_is_audited(
        self, db_session, dept, grants
    ):
        # The create and update responses carry the details back to a
        # view_contact holder, so each is a disclosure like a read.
        _, (recorder, *_rest) = dept
        grants[str(recorder.id)] = {"crr.view_contact"}
        catalogue = await _catalogue(db_session, recorder)

        async def disclosures():
            return [
                str(data)
                for data in (
                    await db_session.execute(
                        text(
                            "SELECT event_data FROM audit_logs WHERE event_type = "
                            "'crr.resident_details_viewed'"
                        )
                    )
                ).scalars()
            ]

        before = len(await disclosures())
        row = await _record(
            db_session,
            recorder,
            activity_type_id=_type(catalogue, "home_safety_survey").id,
            has_resident_details=True,
            street_address="12 Oak St",
        )
        assert row.street_address == "12 Oak St"
        after_create = await disclosures()
        assert len(after_create) == before + 1
        assert row.id in after_create[-1]

        changed = await update_activity(
            activity_id=row.id,
            body=CrrActivityUpdate(street_address="1 Elm St"),
            db=db_session,
            current_user=recorder,
        )
        assert changed.street_address == "1 Elm St"
        after_update = await disclosures()
        assert len(after_update) == before + 2
        assert all("Oak" not in d and "Elm" not in d for d in after_update)

    async def test_details_are_stored_encrypted(self, db_session, dept, grants):
        _, (recorder, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        row = await _record(
            db_session,
            recorder,
            activity_type_id=_type(catalogue, "home_safety_survey").id,
            has_resident_details=True,
            resident_name="Pat Resident",
        )
        stored = (
            await db_session.execute(
                text("SELECT resident_name FROM crr_activities WHERE id = :id"),
                {"id": row.id},
            )
        ).scalar_one()
        assert stored
        assert "Pat Resident" not in stored

    async def test_unticked_details_are_not_stored(self, db_session, dept, grants):
        _, (recorder, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        row = await _record(
            db_session,
            recorder,
            activity_type_id=_type(catalogue, "home_safety_survey").id,
            has_resident_details=False,
            street_address="12 Oak St",
        )
        assert row.has_resident_details is False

    async def test_changing_details_needs_view_contact(self, db_session, dept, grants):
        _, (recorder, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        row = await _record(
            db_session,
            recorder,
            activity_type_id=_type(catalogue, "home_safety_survey").id,
        )
        for body in (
            CrrActivityUpdate(street_address="1 Elm St"),
            CrrActivityUpdate(notes="Anything"),
        ):
            with pytest.raises(HTTPException) as caught:
                await update_activity(
                    activity_id=row.id, body=body, db=db_session, current_user=recorder
                )
            assert caught.value.status_code == 403


class TestAdminHours:
    async def test_a_log_entry_credits_the_types_own_category(
        self, db_session, dept, grants
    ):
        org, (recorder, helper, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        cpr = _type(catalogue, "hands_only_cpr")
        category = await _category(db_session, org)
        await db_session.execute(
            text(
                "UPDATE crr_activity_types SET admin_hours_category_id = :c WHERE id = :id"
            ),
            {"c": category.id, "id": cpr.id},
        )

        row = await _record(
            db_session,
            recorder,
            activity_type_id=cpr.id,
            members={recorder.id: 90, helper.id: 45},
        )

        entries = sorted(
            await _entries(db_session, row.id), key=lambda e: e.duration_minutes
        )
        assert [(e.user_id, e.duration_minutes) for e in entries] == [
            (helper.id, 45),
            (recorder.id, 90),
        ]
        assert all(
            e.entry_method == AdminHoursEntryMethod.CRR_ACTIVITY for e in entries
        )
        assert all(e.status == AdminHoursEntryStatus.APPROVED for e in entries)
        assert all(e.category_id == category.id for e in entries)

    async def test_without_its_own_category_it_follows_the_public_education_mapping(
        self, db_session, dept, grants
    ):
        org, (recorder, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        first = await _category(db_session, org, require_approval=True)
        second = await _category(db_session, org)
        for category, share in ((first, 60), (second, 40)):
            db_session.add(
                EventHourMapping(
                    organization_id=org.id,
                    event_type=EventType.PUBLIC_EDUCATION.value,
                    admin_hours_category_id=category.id,
                    percentage=share,
                )
            )
        await db_session.flush()

        row = await _record(
            db_session,
            recorder,
            activity_type_id=_type(catalogue, "stop_the_bleed").id,
            members={recorder.id: 100},
        )

        entries = {e.category_id: e for e in await _entries(db_session, row.id)}
        assert entries[first.id].duration_minutes == 60
        assert entries[first.id].status == AdminHoursEntryStatus.PENDING
        assert entries[second.id].duration_minutes == 40
        assert entries[second.id].status == AdminHoursEntryStatus.APPROVED

    async def test_nothing_is_credited_with_no_category_and_no_mapping(
        self, db_session, dept, grants
    ):
        _, (recorder, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        row = await _record(
            db_session,
            recorder,
            activity_type_id=_type(catalogue, "stop_the_bleed").id,
            members={recorder.id: 60},
        )
        assert await _entries(db_session, row.id) == []

    async def test_an_events_activity_credits_nothing(self, db_session, dept, grants):
        org, (recorder, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        cpr = _type(catalogue, "hands_only_cpr")
        category = await _category(db_session, org)
        await db_session.execute(
            text(
                "UPDATE crr_activity_types SET admin_hours_category_id = :c WHERE id = :id"
            ),
            {"c": category.id, "id": cpr.id},
        )
        event = Event(
            organization_id=org.id,
            title="CPR day",
            event_type=EventType.PUBLIC_EDUCATION,
            start_datetime=AN_HOUR_AGO,
            end_datetime=NOW,
        )
        db_session.add(event)
        await db_session.flush()

        row = await _record(
            db_session,
            recorder,
            activity_type_id=cpr.id,
            event_id=event.id,
            members={recorder.id: 60},
        )

        assert row.event_title == "CPR day"
        assert row.members == []
        assert await _entries(db_session, row.id) == []

    async def test_a_non_outreach_event_is_refused(self, db_session, dept, grants):
        org, (recorder, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        meeting = Event(
            organization_id=org.id,
            title="Board meeting",
            event_type=EventType.BUSINESS_MEETING,
            start_datetime=AN_HOUR_AGO,
            end_datetime=NOW,
        )
        db_session.add(meeting)
        await db_session.flush()
        with pytest.raises(HTTPException) as caught:
            await _record(
                db_session,
                recorder,
                activity_type_id=_type(catalogue, "hands_only_cpr").id,
                event_id=meeting.id,
            )
        assert caught.value.status_code == 400

    async def test_a_cancelled_event_is_refused(self, db_session, dept, grants):
        org, (recorder, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        event = Event(
            organization_id=org.id,
            title="Called-off safety day",
            event_type=EventType.PUBLIC_EDUCATION,
            start_datetime=AN_HOUR_AGO,
            end_datetime=NOW,
            is_cancelled=True,
        )
        db_session.add(event)
        await db_session.flush()
        with pytest.raises(HTTPException) as caught:
            await _record(
                db_session,
                recorder,
                activity_type_id=_type(catalogue, "hands_only_cpr").id,
                event_id=event.id,
            )
        assert caught.value.status_code == 400

    async def test_the_event_page_offers_recording_when_a_save_would_succeed(
        self, db_session, dept, grants
    ):
        org, (recorder, *_rest) = dept
        events = {}
        for title, event_type, cancelled in (
            ("Safety day", EventType.PUBLIC_EDUCATION, False),
            ("Called off", EventType.PUBLIC_EDUCATION, True),
            ("Board meeting", EventType.BUSINESS_MEETING, False),
        ):
            events[title] = Event(
                organization_id=org.id,
                title=title,
                event_type=event_type,
                start_datetime=AN_HOUR_AGO,
                end_datetime=NOW,
                is_cancelled=cancelled,
            )
            db_session.add(events[title])
        await db_session.flush()
        grants[recorder.id] = {"crr.record"}

        offered = {
            title: await crr_recording_offered(db_session, event, recorder)
            for title, event in events.items()
        }
        assert offered == {
            "Safety day": True,
            "Called off": False,
            "Board meeting": False,
        }

        grants[recorder.id] = {"events.manage"}
        assert (
            await crr_recording_offered(db_session, events["Safety day"], recorder)
            is True
        )
        grants[recorder.id] = set()
        assert (
            await crr_recording_offered(db_session, events["Safety day"], recorder)
            is False
        )

    async def test_deleting_the_activity_removes_its_hours(
        self, db_session, dept, grants
    ):
        org, (recorder, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        cpr = _type(catalogue, "hands_only_cpr")
        category = await _category(db_session, org)
        await db_session.execute(
            text(
                "UPDATE crr_activity_types SET admin_hours_category_id = :c WHERE id = :id"
            ),
            {"c": category.id, "id": cpr.id},
        )
        row = await _record(
            db_session, recorder, activity_type_id=cpr.id, members={recorder.id: 30}
        )

        await delete_activity(activity_id=row.id, db=db_session, current_user=recorder)

        assert await _entries(db_session, row.id) == []
        assert await db_session.get(CrrActivity, row.id) is None


class TestEditing:
    async def test_only_the_recorder_or_an_events_manager_may_change_it(
        self, db_session, dept, grants
    ):
        _, (recorder, other, manager) = dept
        catalogue = await _catalogue(db_session, recorder)
        row = await _record(
            db_session, recorder, activity_type_id=_type(catalogue, "hands_only_cpr").id
        )
        with pytest.raises(HTTPException) as caught:
            await delete_activity(activity_id=row.id, db=db_session, current_user=other)
        assert caught.value.status_code == 403

        grants[str(manager.id)] = {"events.manage"}
        cpr = _type(catalogue, "hands_only_cpr")
        updated = await update_activity(
            activity_id=row.id,
            body=CrrActivityUpdate(counts={cpr.measures[0].id: 12}),
            db=db_session,
            current_user=manager,
        )
        assert [c.quantity for c in updated.counts] == [12]


class TestRetention:
    async def _old_and_new(self, db_session, dept):
        _, (recorder, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        survey = _type(catalogue, "home_safety_survey").id
        old = await _record(
            db_session,
            recorder,
            activity_type_id=survey,
            occurred_at=NOW - timedelta(days=800),
            zip_code="22046",
            has_resident_details=True,
            street_address="12 Oak St",
            notes="Ask for Pat",
        )
        recent = await _record(
            db_session,
            recorder,
            activity_type_id=survey,
            occurred_at=NOW - timedelta(days=45),
            has_resident_details=True,
            street_address="9 Pine St",
        )
        return old, recent

    async def test_old_details_are_cleared_and_the_zip_kept(
        self, db_session, dept, grants
    ):
        org, _users = dept
        old, recent = await self._old_and_new(db_session, dept)

        cleared = await CrrActivityService(db_session).clear_expired_resident_details(
            org, now=NOW
        )

        assert cleared == 1
        old_row = await db_session.get(CrrActivity, old.id)
        await db_session.refresh(old_row)
        assert (old_row.street_address, old_row.notes) == (None, None)
        assert old_row.zip_code == "22046"
        assert old_row.resident_details_cleared_at is not None
        recent_row = await db_session.get(CrrActivity, recent.id)
        await db_session.refresh(recent_row)
        assert recent_row.street_address == "9 Pine St"

    async def test_an_old_activity_without_details_is_not_marked_cleared(
        self, db_session, dept, grants
    ):
        org, (recorder, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        plain = await _record(
            db_session,
            recorder,
            activity_type_id=_type(catalogue, "hands_only_cpr").id,
            occurred_at=NOW - timedelta(days=800),
            zip_code="22046",
        )

        await CrrActivityService(db_session).clear_expired_resident_details(
            org, now=NOW
        )

        row = await db_session.get(CrrActivity, plain.id)
        await db_session.refresh(row)
        assert row.resident_details_cleared_at is None
        listed = await list_activities(
            start=None,
            end=None,
            activity_type_id=None,
            event_id=None,
            limit=50,
            offset=0,
            db=db_session,
            current_user=recorder,
        )
        assert [a.resident_details_cleared for a in listed.items] == [False]

    async def test_a_second_run_clears_nothing(self, db_session, dept, grants):
        org, _users = dept
        await self._old_and_new(db_session, dept)
        service = CrrActivityService(db_session)
        await service.clear_expired_resident_details(org, now=NOW)
        assert await service.clear_expired_resident_details(org, now=NOW) == 0

    async def test_the_departments_period_is_honoured(self, db_session, dept, grants):
        org, (recorder, *_rest) = dept
        await self._old_and_new(db_session, dept)
        await update_settings(
            body=CrrSettingsUpdate(resident_details_retention_months=1),
            db=db_session,
            current_user=recorder,
        )
        await db_session.refresh(org)
        assert (
            await CrrActivityService(db_session).clear_expired_resident_details(
                org, now=NOW
            )
            == 2
        )

    async def test_the_daily_task_clears_and_audits(self, db_session, dept, grants):
        old, _recent = await self._old_and_new(db_session, dept)

        result = await run_crr_resident_details_retention(db_session)

        assert result["task"] == "crr_resident_details_retention"
        assert result["activities_cleared"] >= 1
        old_row = await db_session.get(CrrActivity, old.id)
        await db_session.refresh(old_row)
        assert old_row.street_address is None
        audited = (
            await db_session.execute(
                text(
                    "SELECT COUNT(*) FROM audit_logs WHERE event_type = "
                    "'crr_resident_details_retention'"
                )
            )
        ).scalar_one()
        assert audited >= 1

    async def test_notes_cannot_be_added_once_details_are_cleared(
        self, db_session, dept, grants
    ):
        # A note written after the sweep would never be swept: free text is
        # where resident details turn up, so it is refused like the details.
        org, (recorder, *_rest) = dept
        grants[str(recorder.id)] = {"crr.view_contact"}
        old, _recent = await self._old_and_new(db_session, dept)
        await CrrActivityService(db_session).clear_expired_resident_details(
            org, now=NOW
        )

        with pytest.raises(HTTPException) as caught:
            await update_activity(
                activity_id=old.id,
                body=CrrActivityUpdate(notes="Lives at 12 Oak St"),
                db=db_session,
                current_user=recorder,
            )
        assert caught.value.status_code == 400

    async def test_a_cleared_activity_still_holding_text_is_cleared_again(
        self, db_session, dept, grants
    ):
        org, _users = dept
        old, _recent = await self._old_and_new(db_session, dept)
        service = CrrActivityService(db_session)
        await service.clear_expired_resident_details(org, now=NOW)
        row = await db_session.get(CrrActivity, old.id)
        first_stamp = row.resident_details_cleared_at
        row.notes = "Written before the refusal existed"
        await db_session.flush()

        assert await service.clear_expired_resident_details(org, now=NOW) == 1

        await db_session.refresh(row)
        assert row.notes is None
        assert row.resident_details_cleared_at == first_stamp

    async def test_the_daily_tasks_audit_row_is_committed(
        self, db_session, dept, grants
    ):
        # The scheduler never commits after a task returns, so anything the
        # task leaves uncommitted is rolled back with its session.
        org_id = str(dept[0].id)
        await self._old_and_new(db_session, dept)

        await run_crr_resident_details_retention(db_session)
        await db_session.rollback()

        audited = (
            await db_session.execute(
                text(
                    "SELECT COUNT(*) FROM audit_logs WHERE event_type = "
                    "'crr_resident_details_retention' AND event_data LIKE :org"
                ),
                {"org": f"%{org_id}%"},
            )
        ).scalar_one()
        assert audited == 1

    async def test_one_departments_failure_leaves_the_others_swept(
        self, db_session, dept, grants, monkeypatch
    ):
        old, _recent = await self._old_and_new(db_session, dept)
        other_org, (other_recorder, *_rest) = await _org(db_session, "Other")
        other_old, _ = await self._old_and_new(
            db_session, (other_org, [other_recorder])
        )
        real = CrrActivityService.clear_expired_resident_details
        calls: list[str] = []

        async def first_one_fails(self, organization, now=None):
            calls.append(str(organization.id))
            if len(calls) == 1:
                raise RuntimeError("simulated failure")
            return await real(self, organization, now)

        monkeypatch.setattr(
            CrrActivityService, "clear_expired_resident_details", first_one_fails
        )

        swept = {str(dept[0].id): old.id, str(other_org.id): other_old.id}

        result = await run_crr_resident_details_retention(db_session)

        assert result["organizations_failed"] == 1
        failed_org = calls[0]
        for org_id, activity_id in swept.items():
            row = await db_session.get(CrrActivity, activity_id)
            await db_session.refresh(row)
            if org_id == failed_org:
                assert row.street_address == "12 Oak St"
            else:
                assert row.street_address is None

    async def test_a_malformed_setting_means_the_default(
        self, db_session, dept, grants
    ):
        org, _users = dept
        org.settings = {"crr": {"resident_details_retention_months": "forever"}}
        await db_session.flush()
        await self._old_and_new(db_session, dept)
        assert (
            await CrrActivityService(db_session).clear_expired_resident_details(
                org, now=NOW
            )
            == 1
        )


class TestFormOptions:
    async def test_a_us_department_gets_the_lookup_and_its_own_city(
        self, db_session, dept, grants
    ):
        _, (recorder, *_rest) = dept
        options = await get_form_options(db=db_session, current_user=recorder)
        assert options.zip_lookup_enabled is True
        assert (options.default_city, options.default_state) == ("Falls Church", "VA")
        assert options.can_view_contact is False
        assert len(options.members) == 3

    async def test_a_department_outside_the_us_types_the_city(self, db_session, grants):
        _, (recorder, *_rest) = await _org(db_session, "Canada", country="Canada")
        options = await get_form_options(db=db_session, current_user=recorder)
        assert options.zip_lookup_enabled is False

    async def test_retired_types_are_not_offered(self, db_session, dept, grants):
        _, (recorder, *_rest) = dept
        catalogue = await _catalogue(db_session, recorder)
        smoke = _type(catalogue, "smoke_alarm_install")
        await update_activity_type(
            type_id=smoke.id,
            body=CrrActivityTypeUpdate(is_active=False),
            db=db_session,
            current_user=recorder,
        )
        options = await get_form_options(db=db_session, current_user=recorder)
        assert smoke.id not in {t.id for t in options.activity_types}
        assert await db_session.scalar(
            select(CrrActivityType.id).where(CrrActivityType.id == smoke.id)
        )
