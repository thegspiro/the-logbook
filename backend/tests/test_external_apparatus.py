"""The officer-maintained list of outside apparatus, and what it feeds.

Leadership counts which outside units members help staff, so the list has to
hold one spelling per unit, stay inside the organization that keeps it, and
never lose a shift already logged against it:

* **Members can only log against an active unit of their own org.**
* **A shift keeps the names it was logged under** when the unit is renamed,
  deactivated or deleted.
* **Deleting a unit in use is refused**, so the summary cannot quietly change.
* **The summary counts counted shifts only,** per unit, with distinct members.
"""

import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import external_shift_hours as endpoint
from app.models.external_shift_hours import (
    ExternalAgency,
    ExternalApparatus,
    ExternalShiftHours,
)
from app.models.user import User
from app.schemas.external_shift_hours import (
    ExternalAgencyCreate,
    ExternalAgencyUpdate,
    ExternalApparatusCreate,
    ExternalApparatusUpdate,
    ExternalShiftHoursCreate,
    ExternalShiftHoursReject,
    ExternalShiftHoursUpdate,
)
from app.services.external_apparatus_service import (
    ExternalApparatusInUseError,
    ExternalApparatusService,
)
from app.services.external_shift_hours_service import ExternalShiftHoursService
from tests.test_external_shift_hours import _add_org, _add_user, _uid, _unit


@pytest.fixture
async def org_and_officer(db_session):
    org_id = await _add_org(db_session)
    officer_id = await _add_user(db_session, org_id, "Officer")
    await db_session.flush()
    return org_id, await db_session.get(User, officer_id)


async def _log(db_session, org_id, user_id, unit_id, shift_date, hours) -> str:
    entry = await ExternalShiftHoursService(db_session).create(
        org_id,
        user_id,
        {"shift_date": shift_date, "hours": hours, "external_apparatus_id": unit_id},
    )
    return entry.id


@pytest.mark.integration
class TestListMaintenance:

    async def test_agency_and_apparatus_round_trip(self, db_session, org_and_officer):
        _, officer = org_and_officer

        agency = await endpoint.create_agency(
            ExternalAgencyCreate(name="  Township Fire Co  "), db_session, officer
        )
        assert agency["name"] == "Township Fire Co"

        unit = await endpoint.create_apparatus(
            uuid.UUID(agency["id"]),
            ExternalApparatusCreate(name="Engine 42", apparatus_type="engine"),
            db_session,
            officer,
        )
        assert unit["agency_id"] == agency["id"]

        listed = await endpoint.list_agencies(db_session, officer)
        assert [a["name"] for a in listed["agencies"]] == ["Township Fire Co"]
        assert [u["name"] for u in listed["agencies"][0]["apparatus"]] == ["Engine 42"]

    async def test_duplicate_names_are_refused(self, db_session, org_and_officer):
        _, officer = org_and_officer
        agency = await endpoint.create_agency(
            ExternalAgencyCreate(name="Township Fire Co"), db_session, officer
        )
        with pytest.raises(HTTPException) as exc:
            await endpoint.create_agency(
                ExternalAgencyCreate(name="Township Fire Co"), db_session, officer
            )
        assert exc.value.status_code == 400

        await endpoint.create_apparatus(
            uuid.UUID(agency["id"]),
            ExternalApparatusCreate(name="Engine 42"),
            db_session,
            officer,
        )
        with pytest.raises(HTTPException) as exc:
            await endpoint.create_apparatus(
                uuid.UUID(agency["id"]),
                ExternalApparatusCreate(name="Engine 42"),
                db_session,
                officer,
            )
        assert exc.value.status_code == 400

    async def test_another_orgs_list_is_out_of_reach(self, db_session, org_and_officer):
        _, officer = org_and_officer
        other_org = await _add_org(db_session)
        other_unit = await _unit(db_session, other_org)
        other_agency = (await db_session.get(ExternalApparatus, other_unit)).agency_id

        with pytest.raises(HTTPException) as exc:
            await endpoint.create_apparatus(
                uuid.UUID(other_agency),
                ExternalApparatusCreate(name="Tower 1"),
                db_session,
                officer,
            )
        assert exc.value.status_code == 404

        with pytest.raises(HTTPException) as exc:
            await endpoint.update_apparatus(
                uuid.UUID(other_unit),
                ExternalApparatusUpdate(name="Renamed"),
                db_session,
                officer,
            )
        assert exc.value.status_code == 404

        with pytest.raises(HTTPException) as exc:
            await endpoint.update_agency(
                uuid.UUID(other_agency),
                ExternalAgencyUpdate(is_active=False),
                db_session,
                officer,
            )
        assert exc.value.status_code == 404

        listed = await endpoint.list_agencies(db_session, officer)
        assert listed["agencies"] == []

    async def test_delete_in_use_is_refused_and_deactivate_works(
        self, db_session, org_and_officer
    ):
        org_id, officer = org_and_officer
        unit_id = await _unit(db_session, org_id)
        agency_id = (await db_session.get(ExternalApparatus, unit_id)).agency_id
        await _log(db_session, org_id, officer.id, unit_id, date(2025, 6, 3), 8)

        with pytest.raises(HTTPException) as exc:
            await endpoint.delete_apparatus(uuid.UUID(unit_id), db_session, officer)
        assert exc.value.status_code == 409
        with pytest.raises(HTTPException) as exc:
            await endpoint.delete_agency(uuid.UUID(agency_id), db_session, officer)
        assert exc.value.status_code == 409

        updated = await endpoint.update_apparatus(
            uuid.UUID(unit_id),
            ExternalApparatusUpdate(is_active=False),
            db_session,
            officer,
        )
        assert updated["is_active"] is False

    async def test_unused_entries_can_be_deleted(self, db_session, org_and_officer):
        org_id, officer = org_and_officer
        unit_id = await _unit(db_session, org_id)
        agency_id = (await db_session.get(ExternalApparatus, unit_id)).agency_id

        await endpoint.delete_apparatus(uuid.UUID(unit_id), db_session, officer)
        await endpoint.delete_agency(uuid.UUID(agency_id), db_session, officer)

        assert await db_session.get(ExternalAgency, agency_id) is None

    async def test_options_hide_inactive_units_and_agencies(
        self, db_session, org_and_officer
    ):
        org_id, officer = org_and_officer
        await _unit(db_session, org_id, agency="A Co", name="Engine 1")
        await _unit(db_session, org_id, agency="B Co", name="Engine 2", active=False)
        await _unit(
            db_session, org_id, agency="C Co", name="Engine 3", agency_active=False
        )

        options = await endpoint.list_apparatus_options(db_session, officer)

        assert [
            (a["name"], [u["name"] for u in a["apparatus"]])
            for a in options["agencies"]
        ] == [("A Co", ["Engine 1"]), ("B Co", [])]


@pytest.mark.integration
class TestLoggingAgainstTheList:

    @pytest.mark.parametrize(
        "kwargs",
        [{"active": False}, {"agency_active": False}],
        ids=["inactive unit", "inactive agency"],
    )
    async def test_inactive_units_cannot_be_picked(
        self, db_session, org_and_officer, kwargs
    ):
        org_id, officer = org_and_officer
        unit_id = await _unit(db_session, org_id, **kwargs)
        with pytest.raises(HTTPException) as exc:
            await endpoint.log_external_shift(
                ExternalShiftHoursCreate(
                    shift_date=date(2025, 6, 3),
                    hours=8,
                    external_apparatus_id=unit_id,
                ),
                db_session,
                officer,
            )
        assert exc.value.status_code == 400

    async def test_another_orgs_unit_cannot_be_picked(
        self, db_session, org_and_officer
    ):
        _, officer = org_and_officer
        other_unit = await _unit(db_session, await _add_org(db_session))
        with pytest.raises(ValueError, match="Pick an apparatus from the list"):
            await ExternalShiftHoursService(db_session).create(
                officer.organization_id,
                officer.id,
                {
                    "shift_date": date(2025, 6, 3),
                    "hours": 8,
                    "external_apparatus_id": other_unit,
                },
            )

    async def test_snapshot_survives_rename_and_deactivation(
        self, db_session, org_and_officer
    ):
        org_id, officer = org_and_officer
        unit_id = await _unit(db_session, org_id)
        entry_id = await _log(
            db_session, org_id, officer.id, unit_id, date(2025, 6, 3), 8
        )

        service = ExternalApparatusService(db_session)
        await service.update_apparatus(
            org_id, unit_id, {"name": "Engine 42A", "is_active": False}
        )

        entry = await db_session.get(ExternalShiftHours, entry_id)
        assert entry.apparatus_name == "Engine 42"

        # The member can still correct the hours on a shift whose unit is
        # no longer offered, as long as they keep the same unit.
        updated = await ExternalShiftHoursService(db_session).update_own(
            org_id,
            officer.id,
            entry_id,
            ExternalShiftHoursUpdate(
                hours=10, external_apparatus_id=uuid.UUID(unit_id)
            ).model_dump(exclude_unset=True),
        )
        assert updated.duration_minutes == 600
        assert updated.apparatus_name == "Engine 42"

    async def test_switching_units_takes_the_new_snapshot(
        self, db_session, org_and_officer
    ):
        org_id, officer = org_and_officer
        first = await _unit(db_session, org_id, agency="A Co", name="Engine 1")
        second = await _unit(db_session, org_id, agency="B Co", name="Ladder 2")
        entry_id = await _log(
            db_session, org_id, officer.id, first, date(2025, 6, 3), 8
        )

        updated = await ExternalShiftHoursService(db_session).update_own(
            org_id, officer.id, entry_id, {"external_apparatus_id": uuid.UUID(second)}
        )

        assert updated.external_apparatus_id == second
        assert (updated.agency_name, updated.apparatus_name) == ("B Co", "Ladder 2")

    async def test_null_apparatus_on_update_is_refused(
        self, db_session, org_and_officer
    ):
        org_id, officer = org_and_officer
        unit_id = await _unit(db_session, org_id)
        entry_id = await _log(
            db_session, org_id, officer.id, unit_id, date(2025, 6, 3), 8
        )
        with pytest.raises(ValueError, match="An apparatus is required"):
            await ExternalShiftHoursService(db_session).update_own(
                org_id, officer.id, entry_id, {"external_apparatus_id": None}
            )


@pytest.mark.integration
class TestApparatusSummary:

    async def test_groups_by_unit_and_counts_distinct_members(
        self, db_session, org_and_officer
    ):
        org_id, officer = org_and_officer
        member_a = await _add_user(db_session, org_id, "Avery")
        member_b = await _add_user(db_session, org_id, "Blake")
        engine = await _unit(db_session, org_id, agency="A Co", name="Engine 1")
        ladder = await _unit(db_session, org_id, agency="B Co", name="Ladder 2")

        await _log(db_session, org_id, member_a, engine, date(2025, 6, 1), 12)
        await _log(db_session, org_id, member_a, engine, date(2025, 6, 2), 12)
        await _log(db_session, org_id, member_b, engine, date(2025, 6, 3), 6)
        await _log(db_session, org_id, member_b, ladder, date(2025, 6, 4), 8)
        rejected = await _log(
            db_session, org_id, member_b, ladder, date(2025, 6, 5), 24
        )
        await ExternalShiftHoursService(db_session).reject(
            org_id, rejected, officer.id, "Duplicate"
        )
        # Outside the period.
        await _log(db_session, org_id, member_a, ladder, date(2025, 7, 1), 24)

        result = await endpoint.get_apparatus_summary(
            "2025-06-01", "2025-06-30", db_session, officer
        )

        rows = [
            (
                r["agency_name"],
                r["apparatus_name"],
                r["shifts"],
                r["hours"],
                r["members"],
            )
            for r in result["rows"]
        ]
        assert rows == [
            ("A Co", "Engine 1", 3, 30.0, 2),
            ("B Co", "Ladder 2", 1, 8.0, 1),
        ]

    async def test_a_renamed_unit_reads_as_one_row(self, db_session, org_and_officer):
        org_id, officer = org_and_officer
        unit_id = await _unit(db_session, org_id, name="Engine 42")
        await _log(db_session, org_id, officer.id, unit_id, date(2025, 6, 1), 8)
        await ExternalApparatusService(db_session).update_apparatus(
            org_id, unit_id, {"name": "Engine 42A"}
        )
        await _log(db_session, org_id, officer.id, unit_id, date(2025, 6, 2), 8)

        rows = await ExternalShiftHoursService(db_session).apparatus_summary(
            org_id, date(2025, 6, 1), date(2025, 6, 30)
        )

        assert len(rows) == 1
        assert rows[0]["apparatus_name"] == "Engine 42A"
        assert rows[0]["shifts"] == 2

    async def test_a_deleted_unit_falls_back_to_the_snapshot(
        self, db_session, org_and_officer
    ):
        org_id, officer = org_and_officer
        db_session.add(
            ExternalShiftHours(
                id=_uid(),
                organization_id=org_id,
                user_id=officer.id,
                shift_date=date(2025, 6, 1),
                duration_minutes=480,
                agency_name="Gone Co",
                apparatus_name="Rescue 9",
            )
        )
        await db_session.flush()

        rows = await ExternalShiftHoursService(db_session).apparatus_summary(
            org_id, date(2025, 6, 1), date(2025, 6, 30)
        )

        assert [(r["agency_name"], r["apparatus_name"]) for r in rows] == [
            ("Gone Co", "Rescue 9")
        ]
        assert rows[0]["external_apparatus_id"] is None

    async def test_another_orgs_shifts_are_not_counted(
        self, db_session, org_and_officer
    ):
        org_id, officer = org_and_officer
        other_org = await _add_org(db_session)
        other_member = await _add_user(db_session, other_org)
        other_unit = await _unit(db_session, other_org)
        await _log(db_session, other_org, other_member, other_unit, date(2025, 6, 1), 8)

        result = await endpoint.get_apparatus_summary(
            "2025-06-01", "2025-06-30", db_session, officer
        )
        assert result["rows"] == []

    async def test_range_is_validated(self, db_session, org_and_officer):
        _, officer = org_and_officer
        with pytest.raises(HTTPException) as exc:
            await endpoint.get_apparatus_summary(
                "2025-06-30", "2025-06-01", db_session, officer
            )
        assert exc.value.status_code == 400


@pytest.mark.unit
class TestListPermissionGates:
    @staticmethod
    def _permissions(path: str, method: str) -> set:
        for route in endpoint.router.routes:
            if route.path == path and method in route.methods:
                perms = set()
                for dep in route.dependant.dependencies:
                    for sub in [dep, *dep.dependencies]:
                        perms |= set(getattr(sub.call, "required_permissions", ()))
                return perms
        pytest.fail(f"{method} {path} not found")

    def test_members_can_read_the_picker(self):
        assert self._permissions("/apparatus-options", "GET") == set()

    @pytest.mark.parametrize(
        ("path", "method"),
        [
            ("/agencies", "GET"),
            ("/agencies", "POST"),
            ("/agencies/{agency_id}", "PATCH"),
            ("/agencies/{agency_id}", "DELETE"),
            ("/agencies/{agency_id}/apparatus", "POST"),
            ("/apparatus/{apparatus_id}", "PATCH"),
            ("/apparatus/{apparatus_id}", "DELETE"),
        ],
    )
    def test_list_maintenance_needs_scheduling_manage(self, path, method):
        assert self._permissions(path, method) == {"scheduling.manage"}

    def test_summary_is_open_to_report_viewers(self):
        assert self._permissions("/summary", "GET") == {
            "scheduling.manage",
            "scheduling.report",
        }

    def test_reject_schema_still_requires_a_reason(self):
        with pytest.raises(ValueError, match="A reason is required"):
            ExternalShiftHoursReject(reason="   ")

    def test_list_in_use_error_is_distinct_from_validation(self):
        assert not issubclass(ExternalApparatusInUseError, ValueError)
