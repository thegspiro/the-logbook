"""History phase 5 against the database: events, historical apparatus, the
managed station and type lists, the timeline and "Today in history".

Covered: who reads what (drafts, links to drafts, a line-of-duty death whose
date is hidden); a fleet truck copied once and only its descriptive details;
the station list correcting every event and designation; an event's links,
each checked against the department; the timeline's computed milestones and
the opt-in title starts placed only by their own dates; "Today in history"
matching day-precise entries, in earlier years, with 29 February; a person
merge carrying event roles and title dates; apparatus tags on photos and
documents; and nothing reaching across departments.
"""

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from app.api.v1.endpoints import history_documents as documents_endpoint
from app.api.v1.endpoints import history_media as media_endpoint
from app.models.apparatus import Apparatus, ApparatusStatus, ApparatusType
from app.models.history import (
    ApparatusDisposition,
    ClearancePurpose,
    DatePrecision,
    FieldVisibility,
    HistoryApparatus,
    HistoryApparatusDesignation,
    HistoryEvent,
    HistoryRevision,
    HistoryTitle,
    PublicationLevel,
    RevisionKind,
)
from app.models.location import Location
from app.services.history_apparatus_service import HistoryApparatusService
from app.services.history_clearance_service import HistoryClearanceService
from app.services.history_collection_service import HistorySourceService
from app.services.history_document_service import HistoryDocumentService
from app.services.history_event_service import HistoryEventService
from app.services.history_lists_service import (
    APPARATUS_TYPES,
    DEFAULT_APPARATUS_TYPES,
    DEFAULT_EVENT_TYPES,
    EVENT_TYPES,
    STATIONS,
    HistoryListService,
)
from app.services.history_media_service import HistoryMediaService
from app.services.history_merge_service import HistoryMergeService
from app.services.history_service import HistoryService
from app.services.history_timeline_service import HistoryTimelineService
from tests.test_history_documents import _upload as _upload_document
from tests.test_history_media import _Dept
from tests.test_history_media import _upload as _upload_photo
from tests.test_history_module import _org, _position, _user

pytestmark = pytest.mark.integration

MEMBERS = PublicationLevel.MEMBERS


@pytest.fixture
async def dept(db_session, uploads):
    org_id = await _org(db_session)
    historian_pos = await _position(
        db_session,
        org_id,
        "Historian",
        ["history.view", "history.manage", "history.publish"],
        slug="historian",
    )
    president_pos = await _position(db_session, org_id, "President", [])
    historian = await _user(db_session, org_id, "Hannah", historian_pos)
    member = await _user(db_session, org_id, "Mark")
    president = await _user(db_session, org_id, "Pat", president_pos)
    return _Dept(org_id, historian, member, president_pos, president)


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    from app.services import file_storage_service

    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


@pytest.fixture
async def other_dept(db_session):
    """A second department, for the cross-department checks."""
    org_id = await _org(db_session)
    historian_pos = await _position(
        db_session, org_id, "Historian", ["history.view", "history.manage"]
    )
    historian = await _user(db_session, org_id, "Olga", historian_pos)
    return _Dept(org_id, historian, historian, historian_pos, historian)


def _stations(db):
    return HistoryListService(db, STATIONS)


async def _station(db, dept, name="Central Station"):
    return await _stations(db).create_entry(dept.org_id, name, dept.actor)


async def _person(db, dept, last_name="Smith", **values):
    return await HistoryService(db).create_person(
        dept.org_id, {"last_name": last_name, **values}, dept.actor
    )


async def _publish_person(db, dept, person):
    return await HistoryService(db).publish(person, MEMBERS, dept.actor)


async def _apparatus(db, dept, name="1924 Ahrens-Fox", designations=(), **values):
    return await HistoryApparatusService(db).create(
        dept.org_id, {"name": name, **values}, list(designations), dept.actor
    )


async def _event(db, dept, title="Mill fire", start=date(1911, 3, 4), links=None, **v):
    values = {"title": title, "start_date": start, **v}
    values.setdefault("start_precision", DatePrecision.DAY)
    return await HistoryEventService(db).create(
        dept.org_id, values, links or {}, dept.actor
    )


async def _fleet_truck(db, dept, **values):
    fleet_type = ApparatusType(
        id=str(uuid.uuid4()),
        organization_id=dept.org_id,
        name="Engine",
        code=f"ENG{uuid.uuid4().hex[:4]}",
    )
    status = ApparatusStatus(
        id=str(uuid.uuid4()),
        organization_id=dept.org_id,
        name="In Service",
        code=f"IS{uuid.uuid4().hex[:4]}",
    )
    db.add_all([fleet_type, status])
    await db.flush()
    truck = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=dept.org_id,
        unit_number="E-2",
        apparatus_type_id=fleet_type.id,
        status_id=status.id,
        **values,
    )
    db.add(truck)
    await db.flush()
    return truck


async def _revision_kinds(db, record_type, record_id) -> list[RevisionKind]:
    rows = await db.execute(
        select(HistoryRevision.kind)
        .where(
            HistoryRevision.record_type == record_type,
            HistoryRevision.record_id == record_id,
        )
        .order_by(HistoryRevision.revision_number)
    )
    return list(rows.scalars())


# ----------------------------------------------------------------------
# Managed lists
# ----------------------------------------------------------------------


class TestManagedLists:
    async def test_the_type_lists_start_filled_once_and_stations_start_empty(
        self, db_session, dept
    ):
        types = HistoryListService(db_session, APPARATUS_TYPES)
        first = await types.list_entries(dept.org_id, include_retired=False)
        again = await types.list_entries(dept.org_id, include_retired=False)
        assert [e.name for e, _ in first] == list(DEFAULT_APPARATUS_TYPES)
        assert [e.id for e, _ in again] == [e.id for e, _ in first]
        events = HistoryListService(db_session, EVENT_TYPES)
        assert [
            e.name
            for e, _ in await events.list_entries(dept.org_id, include_retired=False)
        ] == list(DEFAULT_EVENT_TYPES)
        assert (
            await _stations(db_session).list_entries(dept.org_id, include_retired=False)
            == []
        )

    async def test_renaming_a_station_corrects_every_event_and_designation(
        self, db_session, dept
    ):
        station = await _station(db_session, dept, "Centrl Station")
        event = await _event(db_session, dept, station_id=station.id)
        truck = await _apparatus(
            db_session,
            dept,
            designations=[{"designation": "Engine 1", "station_id": station.id}],
        )
        await _stations(db_session).update_entry(station, {"name": "Central Station"})
        event = await HistoryEventService(db_session).get_event(dept.org_id, event.id)
        truck = await HistoryApparatusService(db_session).get_apparatus(
            dept.org_id, truck.id
        )
        assert event.station.name == "Central Station"
        assert truck.designations[0].station.name == "Central Station"

    async def test_merging_stations_moves_events_and_designations_and_counts_both(
        self, db_session, dept
    ):
        stations = _stations(db_session)
        wrong = await _station(db_session, dept, "Station One")
        right = await _station(db_session, dept, "Station 1")
        await _event(db_session, dept, station_id=wrong.id)
        await _apparatus(
            db_session,
            dept,
            designations=[{"designation": "Engine 1", "station_id": wrong.id}],
        )
        usage = dict(
            (e.id, n)
            for e, n in await stations.list_entries(dept.org_id, include_retired=True)
        )
        assert usage[wrong.id] == 2

        await stations.merge_entry(wrong, right)

        assert await stations.get_entry(dept.org_id, wrong.id) is None
        events = (
            await db_session.execute(
                select(HistoryEvent.station_id).where(
                    HistoryEvent.organization_id == dept.org_id
                )
            )
        ).scalars()
        assert set(events) == {right.id}
        designations = (
            await db_session.execute(select(HistoryApparatusDesignation.station_id))
        ).scalars()
        assert right.id in set(designations)
        assert wrong.id not in set(
            (
                await db_session.execute(select(HistoryApparatusDesignation.station_id))
            ).scalars()
        )

    async def test_a_station_from_another_department_is_refused(
        self, db_session, dept, other_dept
    ):
        theirs = await _station(db_session, other_dept, "Their Station")
        with pytest.raises(ValueError, match="not on this department's list"):
            await _event(db_session, dept, station_id=theirs.id)
        with pytest.raises(ValueError, match="not on this department's list"):
            await _apparatus(
                db_session,
                dept,
                designations=[{"designation": "E1", "station_id": theirs.id}],
            )

    async def test_a_source_counts_and_merges_apparatus_and_events(
        self, db_session, dept
    ):
        sources = HistorySourceService(db_session)
        old = await sources.create_source(dept.org_id, "Smith family", dept.actor)
        new = await sources.create_source(dept.org_id, "The Smith family", dept.actor)
        truck = await _apparatus(db_session, dept, source_id=old.id)
        event = await _event(db_session, dept, source_id=old.id)
        usage = dict(
            (s.id, n)
            for s, n in await sources.list_sources(dept.org_id, include_retired=True)
        )
        assert usage[old.id] == 2
        await sources.merge_source(old, new)
        # Re-read: the merge updates rows in bulk, behind the session's copies.
        for model, record_id in (
            (HistoryApparatus, truck.id),
            (HistoryEvent, event.id),
        ):
            stored = await db_session.scalar(
                select(model.source_id).where(model.id == record_id)
            )
            assert stored == new.id


# ----------------------------------------------------------------------
# Apparatus
# ----------------------------------------------------------------------


class TestApparatus:
    async def test_a_draft_is_hidden_from_members_and_published_without_notes(
        self, db_session, dept
    ):
        service = HistoryApparatusService(db_session)
        truck = await _apparatus(db_session, dept, research_notes="Bought on credit")
        assert await service.get_readable_apparatus(dept.reader, truck.id) is None
        assert (await service.list_apparatus(dept.reader))[1] == 0

        await service.publish(truck, MEMBERS, dept.actor)
        seen = await service.get_readable_apparatus(dept.reader, truck.id)
        view = service.member_view(seen)
        assert "research_notes" not in view
        assert "fleet_apparatus_id" not in view
        assert (await service.list_apparatus(dept.reader))[1] == 1

    async def test_designations_are_kept_in_date_order(self, db_session, dept):
        truck = await _apparatus(
            db_session,
            dept,
            designations=[
                {"designation": "Reserve Engine", "start_date": date(1968, 1, 1)},
                {"designation": "Engine 1", "start_date": date(1924, 1, 1)},
            ],
            in_service_date=date(1924, 5, 1),
            in_service_precision=DatePrecision.MONTH,
        )
        summary = HistoryApparatusService(db_session).summary(truck)
        assert summary["designations"] == ["Engine 1", "Reserve Engine"]
        assert truck.in_service_date == date(1924, 5, 1)

    async def test_search_finds_a_unit_number_and_a_year(self, db_session, dept):
        service = HistoryApparatusService(db_session)
        await _apparatus(
            db_session,
            dept,
            designations=[{"designation": "Hose 3"}],
            year=1911,
        )
        await _apparatus(db_session, dept, name="Chief's car", year=1950)
        found, _ = await service.list_apparatus(dept.keeper, search="hose 3")
        assert [t.name for t in found] == ["1924 Ahrens-Fox"]
        found, _ = await service.list_apparatus(dept.keeper, search="1950")
        assert [t.name for t in found] == ["Chief's car"]
        found, _ = await service.list_apparatus(dept.keeper, search="%")
        assert found == []

    async def test_a_decade_lists_what_was_in_service_during_it(self, db_session, dept):
        service = HistoryApparatusService(db_session)
        await _apparatus(
            db_session,
            dept,
            name="Long servant",
            in_service_date=date(1924, 1, 1),
            out_of_service_date=date(1968, 1, 1),
        )
        await _apparatus(
            db_session, dept, name="Later", in_service_date=date(1970, 1, 1)
        )
        found, _ = await service.list_apparatus(dept.keeper, decade=1950)
        assert [t.name for t in found] == ["Long servant"]

    async def test_leaving_service_before_entering_it_is_refused(
        self, db_session, dept
    ):
        with pytest.raises(ValueError, match="cannot leave service before"):
            await _apparatus(
                db_session,
                dept,
                in_service_date=date(1950, 1, 1),
                out_of_service_date=date(1940, 1, 1),
            )

    async def test_a_note_is_minor_and_a_new_unit_number_is_substantial(
        self, db_session, dept
    ):
        service = HistoryApparatusService(db_session)
        truck = await _apparatus(db_session, dept)
        truck = await service.update(
            truck,
            {"research_notes": "From the minutes"},
            None,
            edit_kind="minor",
            edit_note=None,
            actor_id=dept.actor,
        )
        assert truck.substantial_revision_number == 1
        truck = await service.update(
            truck,
            {},
            [{"designation": "Engine 4"}],
            edit_kind="minor",
            edit_note=None,
            actor_id=dept.actor,
        )
        assert truck.substantial_revision_number == truck.revision_number == 3
        assert await _revision_kinds(db_session, "apparatus", truck.id) == [
            RevisionKind.CREATED,
            RevisionKind.MINOR,
            RevisionKind.SUBSTANTIAL,
        ]

    async def test_only_a_draft_can_be_deleted(self, db_session, dept):
        service = HistoryApparatusService(db_session)
        truck = await _apparatus(db_session, dept)
        await service.publish(truck, MEMBERS, dept.actor)
        with pytest.raises(ValueError, match="Unpublish this apparatus record"):
            await service.delete(truck)
        await service.unpublish(truck, PublicationLevel.DRAFT, dept.actor)
        truck_id = truck.id
        await service.delete(truck)
        assert await service.get_apparatus(dept.org_id, truck_id) is None
        assert await _revision_kinds(db_session, "apparatus", truck_id) == []

    async def test_another_department_cannot_read_it(
        self, db_session, dept, other_dept
    ):
        truck = await _apparatus(db_session, dept)
        service = HistoryApparatusService(db_session)
        assert await service.get_apparatus(other_dept.org_id, truck.id) is None
        assert (await service.list_apparatus(other_dept.keeper))[1] == 0


class TestFromTheFleet:
    async def test_only_descriptive_details_are_copied(self, db_session, dept):
        location = Location(organization_id=dept.org_id, name="Station 2")
        db_session.add(location)
        await db_session.flush()
        station = await _station(db_session, dept, "station 2")
        truck = await _fleet_truck(
            db_session,
            dept,
            name="Old Two",
            year=1987,
            make="Pierce",
            model="Arrow",
            vin="1FDXK84A0GVA12345",
            license_plate="FD-2",
            pump_capacity_gpm=1500,
            primary_station_id=location.id,
            in_service_date=date(1987, 6, 1),
            is_archived=True,
            disposal_method="Sold at auction",
            disposal_date=date(2010, 9, 30),
            sold_price=12000,
        )
        record = await HistoryApparatusService(db_session).create_from_fleet(
            dept.org_id, truck.id, dept.actor
        )
        assert record.name == "Old Two"
        assert (record.year, record.make, record.model) == (1987, "Pierce", "Arrow")
        assert record.pump_gpm == 1500
        assert record.in_service_date == date(1987, 6, 1)
        assert record.out_of_service_date == date(2010, 9, 30)
        assert record.disposition == ApparatusDisposition.SOLD
        assert record.apparatus_type.name == "Engine"
        assert [(d.designation, d.station_id) for d in record.designations] == [
            ("E-2", station.id)
        ]
        snapshot = str(HistoryApparatusService(db_session)._snapshot(record))
        for operational in ("1FDXK84A0GVA12345", "FD-2", "12000"):
            assert operational not in snapshot

    async def test_a_running_truck_is_in_service_and_has_no_station_guess(
        self, db_session, dept
    ):
        truck = await _fleet_truck(db_session, dept)
        record = await HistoryApparatusService(db_session).create_from_fleet(
            dept.org_id, truck.id, dept.actor
        )
        assert record.disposition == ApparatusDisposition.IN_SERVICE
        assert record.out_of_service_date is None
        assert record.designations[0].station_id is None

    async def test_a_truck_gets_one_record_and_the_options_say_so(
        self, db_session, dept
    ):
        service = HistoryApparatusService(db_session)
        truck = await _fleet_truck(db_session, dept)
        record = await service.create_from_fleet(dept.org_id, truck.id, dept.actor)
        with pytest.raises(ValueError, match="already has a History record"):
            await service.create_from_fleet(dept.org_id, truck.id, dept.actor)
        options = await service.fleet_options(dept.org_id)
        assert [(o["id"], o["history_apparatus_id"]) for o in options] == [
            (truck.id, record.id)
        ]

    async def test_another_departments_truck_is_not_found(
        self, db_session, dept, other_dept
    ):
        truck = await _fleet_truck(db_session, other_dept)
        with pytest.raises(ValueError, match="Apparatus not found"):
            await HistoryApparatusService(db_session).create_from_fleet(
                dept.org_id, truck.id, dept.actor
            )


# ----------------------------------------------------------------------
# Events
# ----------------------------------------------------------------------


class TestEvents:
    async def test_an_event_needs_a_start_and_cannot_end_before_it(
        self, db_session, dept
    ):
        with pytest.raises(ValueError, match="Enter the date the event began"):
            await HistoryEventService(db_session).create(
                dept.org_id, {"title": "Undated"}, {}, dept.actor
            )
        with pytest.raises(ValueError, match="cannot end before it begins"):
            await _event(db_session, dept, end_date=date(1910, 1, 1))

    async def test_a_year_only_date_is_stored_as_the_first_of_january(
        self, db_session, dept
    ):
        event = await _event(
            db_session, dept, start=date(1911, 7, 4), start_precision=DatePrecision.YEAR
        )
        assert event.start_date == date(1911, 1, 1)

    async def test_a_member_sees_only_the_links_they_could_open(self, db_session, dept):
        shown = await _person(db_session, dept, "Shown")
        await _publish_person(db_session, dept, shown)
        hidden = await _person(db_session, dept, "Hidden")
        truck = await _apparatus(db_session, dept)
        photo = await _upload_photo(db_session, dept)
        paper = await _upload_document(db_session, dept)
        service = HistoryEventService(db_session)
        event = await _event(
            db_session,
            dept,
            links={
                "members": [
                    {"member_id": shown.id, "role": "commanded"},
                    {"member_id": hidden.id, "role": "injured"},
                ],
                "apparatus_ids": [truck.id],
                "media_ids": [photo.id],
                "document_ids": [paper.document_id],
            },
            research_notes="A civilian, Mrs Jones, was rescued",
        )
        await service.publish(event, MEMBERS, dept.actor)
        seen = await service.get_readable_event(dept.reader, event.id)
        view = service.member_view(dept.reader, seen)
        assert view["members"] == [
            {"member_id": shown.id, "display_name": "Shown", "role": "commanded"}
        ]
        assert view["apparatus"] == []
        assert view["media"] == []
        assert view["documents"] == []
        assert "research_notes" not in view

        full = service.full_view(
            dept.keeper,
            seen,
            None,
            clearance_required=False,
            cleared_for_public=False,
        )
        assert {m["member_id"] for m in full["members"]} == {shown.id, hidden.id}
        assert [a["apparatus_id"] for a in full["apparatus"]] == [truck.id]
        assert [m["id"] for m in full["media"]] == [photo.id]
        assert [d["id"] for d in full["documents"]] == [paper.document_id]

    async def test_a_link_into_another_department_is_refused(
        self, db_session, dept, other_dept
    ):
        theirs = await _person(db_session, other_dept, "Theirs")
        their_truck = await _apparatus(db_session, other_dept)
        their_photo = await _upload_photo(db_session, other_dept)
        for links, what in (
            ({"members": [{"member_id": theirs.id}]}, "person"),
            ({"apparatus_ids": [their_truck.id]}, "apparatus"),
            ({"media_ids": [their_photo.id]}, "photo"),
        ):
            with pytest.raises(ValueError, match=f"linked {what}|tagged {what}"):
                await _event(db_session, dept, links=links)

    async def test_changing_a_link_is_substantial_and_omitted_links_stay(
        self, db_session, dept
    ):
        person = await _person(db_session, dept)
        service = HistoryEventService(db_session)
        event = await _event(
            db_session, dept, links={"members": [{"member_id": person.id}]}
        )
        event = await service.update(
            event,
            {"place": "Mill Street"},
            {},
            edit_kind="minor",
            edit_note=None,
            actor_id=dept.actor,
        )
        assert [m.member_id for m in event.members] == [person.id]
        assert event.substantial_revision_number == 2
        event = await service.update(
            event,
            {},
            {"members": [{"member_id": person.id, "role": "first on scene"}]},
            edit_kind="minor",
            edit_note=None,
            actor_id=dept.actor,
        )
        assert event.substantial_revision_number == event.revision_number == 3
        assert event.members[0].role == "first on scene"

    async def test_search_and_a_decade_that_an_event_ran_across(self, db_session, dept):
        service = HistoryEventService(db_session)
        await _event(
            db_session,
            dept,
            title="Building the firehouse",
            start=date(1908, 1, 1),
            end_date=date(1911, 6, 1),
            place="Elm Street",
        )
        await _event(db_session, dept, title="Parade", start=date(1950, 7, 4))
        found, _ = await service.list_events(dept.keeper, decade=1910)
        assert [e.title for e in found] == ["Building the firehouse"]
        found, _ = await service.list_events(dept.keeper, search="elm")
        assert [e.title for e in found] == ["Building the firehouse"]
        found, _ = await service.list_events(dept.keeper, search="_")
        assert found == []

    async def test_a_photo_and_a_document_show_the_events_they_belong_to(
        self, db_session, dept
    ):
        photo = await _upload_photo(db_session, dept)
        paper = await _upload_document(db_session, dept)
        draft = await _event(
            db_session,
            dept,
            title="Draft event",
            links={"media_ids": [photo.id], "document_ids": [paper.document_id]},
        )
        published = await _event(
            db_session,
            dept,
            title="Published event",
            links={"media_ids": [photo.id], "document_ids": [paper.document_id]},
        )
        service = HistoryEventService(db_session)
        await service.publish(published, MEMBERS, dept.actor)
        # As the endpoints do: each item is read fresh, with what its view
        # needs, before it is published or shown.
        photo = await HistoryMediaService(db_session).get_media(dept.org_id, photo.id)
        paper = await HistoryDocumentService(db_session).get_document(
            dept.org_id, paper.document_id
        )
        await HistoryMediaService(db_session).publish(photo, MEMBERS, dept.actor)
        await HistoryDocumentService(db_session).publish(paper, MEMBERS, dept.actor)
        # And again after the write, as each endpoint re-reads before it answers.
        photo = await HistoryMediaService(db_session).get_media(dept.org_id, photo.id)
        paper = await HistoryDocumentService(db_session).get_document(
            dept.org_id, paper.document_id
        )
        photo_view = await media_endpoint._item_view(db_session, dept.reader, photo)
        assert [e.title for e in photo_view.events] == ["Published event"]
        paper_view = await documents_endpoint._document_view(
            db_session, dept.reader, paper
        )
        assert [e.title for e in paper_view.events] == ["Published event"]
        keeper_view = await media_endpoint._item_view(db_session, dept.keeper, photo)
        assert {e.id for e in keeper_view.events} == {draft.id, published.id}

    async def test_deleting_an_event_leaves_what_it_linked(self, db_session, dept):
        person = await _person(db_session, dept)
        photo = await _upload_photo(db_session, dept)
        event = await _event(
            db_session,
            dept,
            links={"members": [{"member_id": person.id}], "media_ids": [photo.id]},
        )
        await HistoryEventService(db_session).delete(event)
        assert await HistoryService(db_session).get_person(dept.org_id, person.id)
        assert await HistoryMediaService(db_session).get_media(dept.org_id, photo.id)

    async def test_an_event_and_an_apparatus_go_through_clearance(
        self, db_session, dept
    ):
        clearance = HistoryClearanceService(db_session)
        await clearance.replace_steps(
            dept.org_id,
            [{"name": "President", "position_id": dept.president_position}],
        )
        event = await _event(db_session, dept)
        with pytest.raises(ValueError, match="must pass the department's clearance"):
            await HistoryEventService(db_session).publish(
                event, PublicationLevel.PUBLIC, dept.actor
            )
        request, _ = await clearance.submit(event, ClearancePurpose.PUBLIC, dept.actor)
        assert request.record_type == "event"
        truck = await _apparatus(db_session, dept)
        request, _ = await clearance.submit(truck, ClearancePurpose.PUBLIC, dept.actor)
        assert request.record_type == "apparatus"


# ----------------------------------------------------------------------
# Apparatus tags on photos and documents
# ----------------------------------------------------------------------


class TestApparatusTags:
    async def test_a_photo_tag_is_substantial_and_a_draft_truck_stays_hidden(
        self, db_session, dept
    ):
        media = HistoryMediaService(db_session)
        photo = await _upload_photo(db_session, dept)
        truck = await _apparatus(db_session, dept)
        photo = await media.replace_apparatus_tags(photo, [truck.id], dept.actor)
        assert photo.substantial_revision_number == photo.revision_number == 2
        assert media.member_view(dept.reader, photo)["apparatus"] == []
        await HistoryApparatusService(db_session).publish(truck, MEMBERS, dept.actor)
        photo = await media.get_media(dept.org_id, photo.id)
        assert media.member_view(dept.reader, photo)["apparatus"] == [
            {"apparatus_id": truck.id, "name": truck.name}
        ]
        found, _ = await media.list_media(dept.keeper, apparatus_id=truck.id)
        assert [i.id for i in found] == [photo.id]

    async def test_a_document_tag_and_another_departments_truck(
        self, db_session, dept, other_dept
    ):
        documents = HistoryDocumentService(db_session)
        paper = await _upload_document(db_session, dept)
        truck = await _apparatus(db_session, dept)
        theirs = await _apparatus(db_session, other_dept)
        with pytest.raises(ValueError, match="not in this department's archive"):
            await documents.replace_apparatus_tags(paper, [theirs.id], dept.actor)
        paper = await documents.replace_apparatus_tags(paper, [truck.id], dept.actor)
        found, _ = await documents.list_documents(dept.keeper, apparatus_id=truck.id)
        assert [d.document_id for d in found] == [paper.document_id]


# ----------------------------------------------------------------------
# Titles held, with their own dates
# ----------------------------------------------------------------------


async def _title(db, dept, name="Chief", show=True) -> HistoryTitle:
    service = HistoryService(db)
    title = await service.create_title(dept.org_id, name, dept.actor)
    return await service.update_title(title, {"show_on_timeline": show})


async def _with_titles(db, dept, person, titles):
    return await HistoryService(db).replace_periods(
        person,
        [{"start_date": date(1950, 1, 1), "titles": titles}],
        edit_kind="minor",
        edit_note=None,
        actor_id=dept.actor,
    )


class TestHeldTitleDates:
    async def test_a_held_title_keeps_its_own_dates(self, db_session, dept):
        chief = await _title(db_session, dept)
        person = await _with_titles(
            db_session,
            dept,
            await _person(db_session, dept),
            [
                {
                    "title_id": chief.id,
                    "held_from_date": date(1975, 6, 9),
                    "held_from_precision": DatePrecision.MONTH,
                    "held_to_date": date(1980, 1, 1),
                }
            ],
        )
        held = person.service_periods[0].titles[0]
        assert held.held_from_date == date(1975, 6, 1)
        assert held.held_from_precision == DatePrecision.MONTH
        assert held.held_to_date == date(1980, 1, 1)
        view = HistoryService(db_session).period_view(person.service_periods[0])
        assert view["titles"][0]["held_from_date"] == date(1975, 6, 1)

    async def test_title_ids_alone_still_work_with_no_dates(self, db_session, dept):
        chief = await _title(db_session, dept)
        person = await HistoryService(db_session).replace_periods(
            await _person(db_session, dept),
            [{"start_date": date(1950, 1, 1), "title_ids": [chief.id]}],
            edit_kind="minor",
            edit_note=None,
            actor_id=dept.actor,
        )
        assert person.service_periods[0].titles[0].held_from_date is None

    async def test_a_title_cannot_end_before_it_began(self, db_session, dept):
        chief = await _title(db_session, dept)
        with pytest.raises(ValueError, match="cannot end before it was first held"):
            await _with_titles(
                db_session,
                dept,
                await _person(db_session, dept),
                [
                    {
                        "title_id": chief.id,
                        "held_from_date": date(1980, 1, 1),
                        "held_to_date": date(1975, 1, 1),
                    }
                ],
            )


# ----------------------------------------------------------------------
# The timeline
# ----------------------------------------------------------------------


def _labels(entries) -> list[str]:
    return [e["label"] for e in entries]


class TestTimeline:
    async def test_events_and_milestones_each_appear_only_when_readable(
        self, db_session, dept
    ):
        events = HistoryEventService(db_session)
        apparatus = HistoryApparatusService(db_session)
        published = await _event(db_session, dept, title="Mill fire")
        await events.publish(published, MEMBERS, dept.actor)
        await _event(db_session, dept, title="Draft fire", start=date(1912, 1, 1))
        truck = await _apparatus(
            db_session,
            dept,
            name="Engine 1",
            in_service_date=date(1914, 1, 1),
            out_of_service_date=date(1931, 1, 1),
            disposition=ApparatusDisposition.SCRAPPED,
        )
        await apparatus.publish(truck, MEMBERS, dept.actor)

        timeline = HistoryTimelineService(db_session)
        member_sees = await timeline.decade(dept.reader, 1910)
        assert _labels(member_sees) == ["Mill fire", "Engine 1 entered service"]
        keeper_sees = await timeline.decade(dept.keeper, 1910)
        assert "Draft fire" in _labels(keeper_sees)
        out = await timeline.decade(dept.reader, 1930)
        assert [(e["label"], e["detail"]) for e in out] == [
            ("Engine 1 left service", "scrapped")
        ]

    async def test_a_line_of_duty_death_follows_its_dates_own_visibility(
        self, db_session, dept
    ):
        person = await _person(
            db_session,
            dept,
            "Brave",
            is_line_of_duty_death=True,
            death_date=date(1923, 2, 3),
            death_date_precision=DatePrecision.DAY,
            death_date_visibility=FieldVisibility.HISTORIAN,
        )
        await _publish_person(db_session, dept, person)
        timeline = HistoryTimelineService(db_session)
        assert await timeline.decade(dept.reader, 1920) == []
        assert _labels(await timeline.decade(dept.keeper, 1920)) == [
            "Brave died in the line of duty"
        ]
        await HistoryService(db_session).update_person(
            person,
            {"death_date_visibility": FieldVisibility.MEMBERS},
            edit_kind="minor",
            edit_note=None,
            actor_id=dept.actor,
        )
        assert _labels(await timeline.decade(dept.reader, 1920)) == [
            "Brave died in the line of duty"
        ]

    async def test_a_title_start_needs_the_switch_and_its_own_date(
        self, db_session, dept
    ):
        chief = await _title(db_session, dept, "Chief", show=True)
        captain = await _title(db_session, dept, "Captain", show=False)
        lieutenant = await _title(db_session, dept, "Lieutenant", show=True)
        person = await _with_titles(
            db_session,
            dept,
            await _person(db_session, dept, "Long"),
            [
                {"title_id": chief.id, "held_from_date": date(1975, 1, 1)},
                {"title_id": captain.id, "held_from_date": date(1965, 1, 1)},
                # Flagged but undated: never placed by the period's 1950.
                {"title_id": lieutenant.id},
            ],
        )
        await _publish_person(db_session, dept, person)
        timeline = HistoryTimelineService(db_session)
        department = []
        for decade in (1950, 1960, 1970):
            department += await timeline.decade(dept.reader, decade)
        assert _labels(department) == ["Long became Chief"]
        # On the person's own page every dated title belongs.
        own = await timeline.for_person(dept.reader, person)
        assert _labels(own) == ["Long became Captain", "Long became Chief"]

    async def test_decades_count_and_kinds_narrow(self, db_session, dept):
        events = HistoryEventService(db_session)
        for start in (date(1911, 1, 1), date(1915, 1, 1), date(1950, 1, 1)):
            event = await _event(db_session, dept, start=start)
            await events.publish(event, MEMBERS, dept.actor)
        truck = await _apparatus(db_session, dept, in_service_date=date(1950, 1, 1))
        await HistoryApparatusService(db_session).publish(truck, MEMBERS, dept.actor)
        timeline = HistoryTimelineService(db_session)
        assert await timeline.decades(dept.reader) == [
            {"decade": 1910, "count": 2},
            {"decade": 1950, "count": 2},
        ]
        assert await timeline.decades(dept.reader, kinds=["event"]) == [
            {"decade": 1910, "count": 2},
            {"decade": 1950, "count": 1},
        ]

    async def test_an_apparatus_timeline_has_its_unit_numbers(self, db_session, dept):
        truck = await _apparatus(
            db_session,
            dept,
            in_service_date=date(1924, 1, 1),
            designations=[
                {"designation": "Engine 1", "start_date": date(1924, 1, 1)},
                {"designation": "Engine 3", "start_date": date(1951, 1, 1)},
            ],
        )
        entries = await HistoryTimelineService(db_session).for_apparatus(
            dept.keeper, truck
        )
        assert _labels(entries) == [
            "1924 Ahrens-Fox entered service",
            "Became Engine 1",
            "Became Engine 3",
        ]

    async def test_another_departments_records_never_appear(
        self, db_session, dept, other_dept
    ):
        await _event(db_session, other_dept, title="Theirs")
        assert await HistoryTimelineService(db_session).decade(dept.keeper, 1910) == []


class TestTodayInHistory:
    async def test_only_day_precise_entries_from_earlier_years(self, db_session, dept):
        events = HistoryEventService(db_session)
        for title, start, precision in (
            ("On the day", date(1911, 3, 4), DatePrecision.DAY),
            ("That month", date(1911, 3, 4), DatePrecision.MONTH),
            ("That year", date(1911, 3, 4), DatePrecision.YEAR),
            ("Another day", date(1911, 3, 5), DatePrecision.DAY),
            ("This year", date(2026, 3, 4), DatePrecision.DAY),
        ):
            event = await _event(
                db_session, dept, title=title, start=start, start_precision=precision
            )
            await events.publish(event, MEMBERS, dept.actor)
        draft = await _event(db_session, dept, title="Draft", start=date(1950, 3, 4))
        timeline = HistoryTimelineService(db_session)
        seen = await timeline.today_in_history(dept.reader, date(2026, 3, 4))
        assert _labels(seen) == ["On the day"]
        keeper = await timeline.today_in_history(dept.keeper, date(2026, 3, 4))
        assert draft.title in _labels(keeper)

    async def test_a_month_or_year_alone_never_matches_its_first_day(
        self, db_session, dept
    ):
        # Stored as the 1st, a month-only or year-only date would otherwise
        # match 1 March or 1 January every year.
        events = HistoryEventService(db_session)
        for title, precision in (
            ("March 1911", DatePrecision.MONTH),
            ("1911", DatePrecision.YEAR),
        ):
            event = await _event(
                db_session,
                dept,
                title=title,
                start=date(1911, 3, 1),
                start_precision=precision,
            )
            await events.publish(event, MEMBERS, dept.actor)
        timeline = HistoryTimelineService(db_session)
        assert await timeline.today_in_history(dept.reader, date(2026, 3, 1)) == []
        assert await timeline.today_in_history(dept.reader, date(2026, 1, 1)) == []

    async def test_the_29th_of_february_shows_on_the_28th_in_a_short_year(
        self, db_session, dept
    ):
        events = HistoryEventService(db_session)
        leap = await _event(db_session, dept, title="Leap day", start=date(1912, 2, 29))
        await events.publish(leap, MEMBERS, dept.actor)
        timeline = HistoryTimelineService(db_session)
        assert _labels(
            await timeline.today_in_history(dept.reader, date(2027, 2, 28))
        ) == ["Leap day"]
        assert await timeline.today_in_history(dept.reader, date(2028, 2, 28)) == []
        assert _labels(
            await timeline.today_in_history(dept.reader, date(2028, 2, 29))
        ) == ["Leap day"]


# ----------------------------------------------------------------------
# Person merge
# ----------------------------------------------------------------------


class TestPersonMerge:
    async def test_event_links_follow_and_the_kept_persons_role_wins(
        self, db_session, dept
    ):
        keep = await _person(db_session, dept, "Smith", first_name="John")
        other = await _person(db_session, dept, "Smith", first_name="J.")
        both = await _event(
            db_session,
            dept,
            title="Both",
            links={
                "members": [
                    {"member_id": keep.id, "role": "commanded"},
                    {"member_id": other.id, "role": "drove"},
                ]
            },
        )
        only_other = await _event(
            db_session,
            dept,
            title="Only other",
            links={"members": [{"member_id": other.id, "role": "injured"}]},
        )
        await HistoryMergeService(db_session).merge(
            dept.org_id, keep.id, other.id, {"first_name": "keep"}, dept.actor
        )
        events = HistoryEventService(db_session)
        both = await events.get_event(dept.org_id, both.id)
        only_other = await events.get_event(dept.org_id, only_other.id)
        assert [(m.member_id, m.role) for m in both.members] == [(keep.id, "commanded")]
        assert [(m.member_id, m.role) for m in only_other.members] == [
            (keep.id, "injured")
        ]

    async def test_a_held_titles_dates_move_with_it(self, db_session, dept):
        chief = await _title(db_session, dept)
        keep = await _with_titles(
            db_session, dept, await _person(db_session, dept, "Smith"), []
        )
        other = await _with_titles(
            db_session,
            dept,
            await _person(db_session, dept, "Smith"),
            [{"title_id": chief.id, "held_from_date": date(1975, 1, 1)}],
        )
        merged = await HistoryMergeService(db_session).merge(
            dept.org_id, keep.id, other.id, {}, dept.actor
        )
        held = merged.service_periods[0].titles[0]
        assert (held.title_id, held.held_from_date) == (chief.id, date(1975, 1, 1))
