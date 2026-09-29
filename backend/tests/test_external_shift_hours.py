"""Shift hours members worked outside the department's own schedule.

A member who rides a neighbouring jurisdiction's apparatus logs the shift
themselves, and it counts straight away toward their scheduling hours and
shift/hours compliance. These tests pin the invariants that make that safe:

* **Counted means counted everywhere.** The member's own history, the
  department's hours report and the compliance report read the same rows, so
  a rejected entry disappears from all three at once.
* **It is reported beside the department's own hours, not inside them.**
  ``hours`` / ``worked_hours`` stay attendance on this department's shifts.
* **A member can only touch their own entries, and nobody reaches another
  organization's.**
"""

import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import external_shift_hours as endpoint
from app.models.external_shift_hours import (
    ExternalAgency,
    ExternalApparatus,
    ExternalShiftHours,
)
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    Shift,
    ShiftAttendance,
    TrainingRequirement,
)
from app.models.user import User
from app.schemas.external_shift_hours import (
    ExternalShiftHoursCreate,
    ExternalShiftHoursReject,
    ExternalShiftHoursResponse,
    ExternalShiftHoursUpdate,
)
from app.services.external_shift_hours_service import ExternalShiftHoursService
from app.services.scheduling_service import SchedulingService


def _uid() -> str:
    return str(uuid.uuid4())


async def _add_org(db_session: AsyncSession) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, 'America/New_York', "
            ":settings)"
        ),
        {
            "id": org_id,
            "name": "External FD",
            "slug": f"ext-{org_id[:8]}",
            "settings": json.dumps({}),
        },
    )
    return org_id


async def _add_user(db_session: AsyncSession, org_id: str, first: str = "Casey") -> str:
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, :fn, 'Reed', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"member-{user_id[:8]}",
            "fn": first,
            "em": f"{user_id[:8]}@test.com",
        },
    )
    return user_id


async def _external(
    db_session: AsyncSession,
    org_id: str,
    user_id: str,
    shift_date: date,
    minutes: int,
    *,
    status: str = "counted",
) -> str:
    entry_id = _uid()
    db_session.add(
        ExternalShiftHours(
            id=entry_id,
            organization_id=org_id,
            user_id=user_id,
            shift_date=shift_date,
            duration_minutes=minutes,
            agency_name="Neighbouring FD",
            apparatus_name="Engine 1",
            status=status,
        )
    )
    await db_session.flush()
    return entry_id


async def _unit(
    db_session: AsyncSession,
    org_id: str,
    *,
    agency: str = "County Fire Company",
    name: str = "Engine 42",
    active: bool = True,
    agency_active: bool = True,
) -> str:
    """A unit on the officer-maintained list; returns its id."""
    agency_id = _uid()
    unit_id = _uid()
    db_session.add(
        ExternalAgency(
            id=agency_id, organization_id=org_id, name=agency, is_active=agency_active
        )
    )
    await db_session.flush()
    db_session.add(
        ExternalApparatus(
            id=unit_id,
            organization_id=org_id,
            agency_id=agency_id,
            name=name,
            is_active=active,
        )
    )
    await db_session.flush()
    return unit_id


async def _worked(
    db_session: AsyncSession, org_id: str, user_id: str, shift_date: date, minutes: int
) -> None:
    shift_id = _uid()
    start = datetime(shift_date.year, shift_date.month, shift_date.day, 8, 0)
    db_session.add(
        Shift(
            id=shift_id,
            organization_id=org_id,
            shift_date=shift_date,
            start_time=start,
            end_time=start + timedelta(minutes=minutes),
            is_finalized=True,
        )
    )
    db_session.add(
        ShiftAttendance(
            id=_uid(),
            shift_id=shift_id,
            user_id=user_id,
            checked_in_at=start,
            checked_out_at=start + timedelta(minutes=minutes),
            duration_minutes=minutes,
        )
    )
    await db_session.flush()


@pytest.fixture
async def org_and_member(db_session: AsyncSession):
    org_id = await _add_org(db_session)
    user_id = await _add_user(db_session, org_id)
    await db_session.flush()
    return org_id, user_id


@pytest.mark.integration
class TestMemberSelfService:

    async def test_log_counts_immediately_for_the_caller(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        unit_id = await _unit(db_session, org_id)
        member = await db_session.get(User, user_id)

        result = await endpoint.log_external_shift(
            ExternalShiftHoursCreate(
                shift_date=date(2025, 6, 3),
                hours=12,
                external_apparatus_id=unit_id,
                role="",
            ),
            db_session,
            member,
        )

        assert result["user_id"] == user_id
        assert result["status"] == "counted"
        assert result["hours"] == 12.0
        assert result["external_apparatus_id"] == unit_id
        assert result["agency_name"] == "County Fire Company"
        assert result["apparatus_name"] == "Engine 42"
        assert result["role"] is None

        row = await db_session.get(ExternalShiftHours, result["id"])
        assert row.organization_id == org_id
        assert row.duration_minutes == 720

    async def test_future_date_is_refused(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        unit_id = await _unit(db_session, org_id)
        member = await db_session.get(User, user_id)

        with pytest.raises(HTTPException) as exc:
            await endpoint.log_external_shift(
                ExternalShiftHoursCreate(
                    shift_date=date.today() + timedelta(days=5),
                    hours=8,
                    external_apparatus_id=unit_id,
                ),
                db_session,
                member,
            )
        assert exc.value.status_code == 400

    async def test_member_cannot_edit_or_delete_anothers_entry(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        other_id = await _add_user(db_session, org_id, "Other")
        entry_id = await _external(db_session, org_id, other_id, date(2025, 6, 3), 480)
        member = await db_session.get(User, user_id)

        with pytest.raises(HTTPException) as exc:
            await endpoint.update_my_external_shift(
                uuid.UUID(entry_id),
                ExternalShiftHoursUpdate(hours=24),
                db_session,
                member,
            )
        assert exc.value.status_code == 404

        with pytest.raises(HTTPException) as exc:
            await endpoint.delete_my_external_shift(
                uuid.UUID(entry_id), db_session, member
            )
        assert exc.value.status_code == 404

    async def test_update_clears_an_optional_field_and_converts_hours(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        unit_id = await _unit(db_session, org_id, agency="Somewhere FD")
        svc = ExternalShiftHoursService(db_session)
        entry = await svc.create(
            org_id,
            user_id,
            {
                "shift_date": date(2025, 6, 3),
                "hours": 8,
                "external_apparatus_id": unit_id,
                "notes": "Covered for a sick call",
            },
        )

        updated = await svc.update_own(
            org_id,
            user_id,
            entry.id,
            ExternalShiftHoursUpdate(hours=10.5, notes=None).model_dump(
                exclude_unset=True
            ),
        )

        assert updated.duration_minutes == 630
        assert updated.notes is None
        assert updated.agency_name == "Somewhere FD"

    async def test_null_hours_on_update_is_refused(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        entry_id = await _external(db_session, org_id, user_id, date(2025, 6, 3), 480)
        with pytest.raises(ValueError, match="Hours are required"):
            await ExternalShiftHoursService(db_session).update_own(
                org_id, user_id, entry_id, {"hours": None}
            )

    async def test_rejected_entry_is_locked_for_the_member(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        entry_id = await _external(
            db_session, org_id, user_id, date(2025, 6, 3), 480, status="rejected"
        )
        svc = ExternalShiftHoursService(db_session)
        with pytest.raises(ValueError, match="cannot be edited"):
            await svc.update_own(org_id, user_id, entry_id, {"hours": 12})
        with pytest.raises(ValueError, match="cannot be deleted"):
            await svc.delete_own(org_id, user_id, entry_id)

    async def test_my_list_holds_only_the_callers_entries(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        other_id = await _add_user(db_session, org_id, "Other")
        mine = await _external(db_session, org_id, user_id, date(2025, 6, 3), 480)
        await _external(db_session, org_id, other_id, date(2025, 6, 4), 480)
        member = await db_session.get(User, user_id)

        result = await endpoint.list_my_external_shifts(
            None, None, 100, 0, db_session, member
        )

        assert result["total"] == 1
        assert [i["id"] for i in result["items"]] == [mine]


def _utc(value: datetime) -> datetime:
    """A stored datetime read back naive is UTC; compare it as such."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


@pytest.mark.integration
class TestStartAndEndTimes:
    """A shift given by its start and end derives its date and hours."""

    async def test_times_derive_the_date_and_hours(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        unit_id = await _unit(db_session, org_id)
        member = await db_session.get(User, user_id)
        # 07:00-19:00 in New York (EDT, UTC-4).
        start = datetime(2025, 6, 3, 11, 0, tzinfo=timezone.utc)

        result = await endpoint.log_external_shift(
            ExternalShiftHoursCreate(
                start_at=start,
                end_at=start + timedelta(hours=12),
                external_apparatus_id=unit_id,
            ),
            db_session,
            member,
        )

        assert result["hours"] == 12.0
        assert result["shift_date"] == date(2025, 6, 3)
        row = await db_session.get(ExternalShiftHours, result["id"])
        assert row.duration_minutes == 720
        assert _utc(row.start_at) == start
        assert _utc(row.end_at) == start + timedelta(hours=12)

    async def test_night_shift_counts_on_the_local_day_it_began(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        unit_id = await _unit(db_session, org_id)
        # 22:00 on 3 June in New York is 02:00 on 4 June in UTC.
        start = datetime(2025, 6, 4, 2, 0, tzinfo=timezone.utc)

        entry = await ExternalShiftHoursService(db_session).create(
            org_id,
            user_id,
            ExternalShiftHoursCreate(
                start_at=start,
                end_at=start + timedelta(hours=24),
                external_apparatus_id=unit_id,
            ).model_dump(),
        )

        assert entry.shift_date == date(2025, 6, 3)
        assert entry.duration_minutes == 24 * 60

    async def test_future_start_is_refused(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        unit_id = await _unit(db_session, org_id)
        start = datetime.now(timezone.utc) + timedelta(days=5)
        with pytest.raises(ValueError, match="future"):
            await ExternalShiftHoursService(db_session).create(
                org_id,
                user_id,
                ExternalShiftHoursCreate(
                    start_at=start,
                    end_at=start + timedelta(hours=12),
                    external_apparatus_id=unit_id,
                ).model_dump(),
            )

    async def test_update_with_times_recomputes_date_and_hours(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        entry_id = await _external(db_session, org_id, user_id, date(2025, 6, 3), 480)
        start = datetime(2025, 6, 10, 11, 0, tzinfo=timezone.utc)

        updated = await ExternalShiftHoursService(db_session).update_own(
            org_id,
            user_id,
            entry_id,
            ExternalShiftHoursUpdate(
                start_at=start, end_at=start + timedelta(hours=24)
            ).model_dump(exclude_unset=True),
        )

        assert updated.shift_date == date(2025, 6, 10)
        assert updated.duration_minutes == 24 * 60
        assert _utc(updated.start_at) == start

    async def test_correcting_hours_alone_clears_the_times(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        unit_id = await _unit(db_session, org_id)
        svc = ExternalShiftHoursService(db_session)
        start = datetime(2025, 6, 3, 11, 0, tzinfo=timezone.utc)
        entry = await svc.create(
            org_id,
            user_id,
            ExternalShiftHoursCreate(
                start_at=start,
                end_at=start + timedelta(hours=12),
                external_apparatus_id=unit_id,
            ).model_dump(),
        )

        updated = await svc.update_own(org_id, user_id, entry.id, {"hours": 10})

        assert updated.duration_minutes == 600
        assert updated.start_at is None
        assert updated.end_at is None

    async def test_one_time_without_the_other_is_refused(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        entry_id = await _external(db_session, org_id, user_id, date(2025, 6, 3), 480)
        start = datetime(2025, 6, 3, 11, 0, tzinfo=timezone.utc)
        with pytest.raises(ValueError, match="both a start and an end"):
            await ExternalShiftHoursService(db_session).update_own(
                org_id, user_id, entry_id, {"start_at": start}
            )

    async def test_times_beside_hours_on_update_are_refused(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        entry_id = await _external(db_session, org_id, user_id, date(2025, 6, 3), 480)
        start = datetime(2025, 6, 3, 11, 0, tzinfo=timezone.utc)
        with pytest.raises(ValueError, match="not both"):
            await ExternalShiftHoursService(db_session).update_own(
                org_id,
                user_id,
                entry_id,
                {"start_at": start, "end_at": start + timedelta(hours=8), "hours": 8},
            )


@pytest.mark.unit
class TestStartAndEndSchema:
    _unit_id = uuid.uuid4()
    _start = datetime(2025, 6, 3, 11, 0, tzinfo=timezone.utc)

    def test_end_must_follow_start(self):
        with pytest.raises(ValidationError, match="end after it starts"):
            ExternalShiftHoursCreate(
                start_at=self._start,
                end_at=self._start,
                external_apparatus_id=self._unit_id,
            )

    def test_span_is_capped_at_48_hours(self):
        with pytest.raises(ValidationError, match="at most 48 hours"):
            ExternalShiftHoursCreate(
                start_at=self._start,
                end_at=self._start + timedelta(hours=48, minutes=15),
                external_apparatus_id=self._unit_id,
            )
        ExternalShiftHoursCreate(
            start_at=self._start,
            end_at=self._start + timedelta(hours=48),
            external_apparatus_id=self._unit_id,
        )

    def test_times_and_hours_together_are_refused(self):
        with pytest.raises(ValidationError, match="not both"):
            ExternalShiftHoursCreate(
                start_at=self._start,
                end_at=self._start + timedelta(hours=12),
                hours=12,
                external_apparatus_id=self._unit_id,
            )

    def test_a_shift_needs_times_or_date_and_hours(self):
        with pytest.raises(ValidationError, match="start and end times"):
            ExternalShiftHoursCreate(external_apparatus_id=self._unit_id)
        with pytest.raises(ValidationError, match="both a start and an end"):
            ExternalShiftHoursCreate(
                start_at=self._start, external_apparatus_id=self._unit_id
            )

    def test_offset_times_are_stored_as_utc(self):
        payload = ExternalShiftHoursCreate(
            start_at="2025-06-03T07:00:00-04:00",
            end_at="2025-06-03T23:00:00",
            external_apparatus_id=self._unit_id,
        )
        assert payload.start_at == self._start
        assert payload.start_at.tzinfo == timezone.utc
        assert payload.end_at == self._start + timedelta(hours=12)

    def test_update_checks_the_pair(self):
        with pytest.raises(ValidationError, match="end after it starts"):
            ExternalShiftHoursUpdate(
                start_at=self._start, end_at=self._start - timedelta(hours=1)
            )

    def test_response_marks_times_as_utc(self):
        naive = datetime(2025, 6, 3, 11, 0)
        body = ExternalShiftHoursResponse(
            id="x",
            user_id="u",
            shift_date=date(2025, 6, 3),
            hours=12,
            start_at=naive,
            end_at=naive + timedelta(hours=12),
            agency_name="A",
            apparatus_name="E1",
            status="counted",
            created_at=naive,
            updated_at=naive,
        ).model_dump_json()
        assert '"start_at":"2025-06-03T11:00:00Z"' in body


@pytest.mark.integration
class TestOfficerReview:

    async def test_reject_and_restore(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        officer_id = await _add_user(db_session, org_id, "Officer")
        entry_id = await _external(db_session, org_id, user_id, date(2025, 6, 3), 480)
        officer = await db_session.get(User, officer_id)

        rejected = await endpoint.reject_external_shift(
            uuid.UUID(entry_id),
            ExternalShiftHoursReject(reason="  Not on the mutual aid roster "),
            db_session,
            officer,
        )
        assert rejected["status"] == "rejected"
        assert rejected["rejection_reason"] == "Not on the mutual aid roster"
        assert rejected["reviewed_by"] == officer_id
        assert rejected["reviewer_name"]
        assert rejected["member_name"]

        restored = await endpoint.restore_external_shift(
            uuid.UUID(entry_id), db_session, officer
        )
        assert restored["status"] == "counted"
        assert restored["rejection_reason"] is None

    async def test_other_orgs_entry_is_not_found(self, db_session, org_and_member):
        org_id, _ = org_and_member
        other_org = await _add_org(db_session)
        other_member = await _add_user(db_session, other_org)
        entry_id = await _external(
            db_session, other_org, other_member, date(2025, 6, 3), 480
        )
        officer = await db_session.get(User, await _add_user(db_session, org_id))

        with pytest.raises(HTTPException) as exc:
            await endpoint.reject_external_shift(
                uuid.UUID(entry_id),
                ExternalShiftHoursReject(reason="x"),
                db_session,
                officer,
            )
        assert exc.value.status_code == 404

        listing = await endpoint.list_external_shifts(
            None, None, None, None, 100, 0, db_session, officer
        )
        assert entry_id not in [i["id"] for i in listing["items"]]


@pytest.mark.integration
class TestTotals:

    async def test_history_reports_external_beside_credited(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        await _worked(db_session, org_id, user_id, date(2025, 3, 4), 600)
        await _external(db_session, org_id, user_id, date(2025, 3, 10), 720)
        await _external(db_session, org_id, user_id, date(2025, 8, 1), 360)
        await _external(
            db_session, org_id, user_id, date(2025, 8, 2), 480, status="rejected"
        )

        history = await SchedulingService(db_session).get_my_hours_history(
            user_id, org_id, 2025
        )

        march = history["months"][2]
        assert march["hours"] == 10.0
        assert march["external_hours"] == 12.0
        assert march["external_shifts"] == 1
        assert history["months"][7]["external_hours"] == 6.0
        assert history["totals"]["hours"] == 10.0
        assert history["totals"]["external_hours"] == 18.0
        assert history["totals"]["external_shifts"] == 2

    async def test_external_only_year_is_offered(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        await _external(db_session, org_id, user_id, date(2023, 5, 1), 480)

        history = await SchedulingService(db_session).get_my_hours_history(
            user_id, org_id, 2025
        )
        assert history["earliest_year"] == 2023
        assert history["all_time"]["external_hours"] == 8.0

    async def test_member_hours_report_includes_external_only_members(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        await _external(db_session, org_id, user_id, date(2025, 6, 3), 720)
        other_org = await _add_org(db_session)
        other_member = await _add_user(db_session, other_org)
        await _external(db_session, other_org, other_member, date(2025, 6, 3), 720)

        report = await SchedulingService(db_session).get_member_hours_report(
            org_id, date(2025, 6, 1), date(2025, 6, 30)
        )

        assert [m["user_id"] for m in report] == [user_id]
        assert report[0]["worked_hours"] == 0.0
        assert report[0]["external_hours"] == 12.0
        assert report[0]["external_shifts"] == 1
        assert report[0]["first_name"] == "Casey"

    async def test_rejected_entries_leave_every_total(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        await _external(
            db_session, org_id, user_id, date(2025, 6, 3), 720, status="rejected"
        )
        svc = SchedulingService(db_session)

        report = await svc.get_member_hours_report(
            org_id, date(2025, 6, 1), date(2025, 6, 30)
        )
        assert report == []

        months = await svc.get_member_month_totals(user_id, org_id)
        assert months == {}

    async def test_compliance_counts_external_shifts_and_hours(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        await _worked(db_session, org_id, user_id, date(2025, 6, 2), 600)
        await _external(db_session, org_id, user_id, date(2025, 6, 10), 720)
        await _external(
            db_session, org_id, user_id, date(2025, 6, 11), 720, status="rejected"
        )
        for req_type, extra in (
            (RequirementType.SHIFTS, {"required_shifts": 2}),
            (RequirementType.HOURS, {"required_hours": 22}),
        ):
            db_session.add(
                TrainingRequirement(
                    id=_uid(),
                    organization_id=org_id,
                    name=f"Min {req_type.value}",
                    requirement_type=req_type.value,
                    frequency=RequirementFrequency.ANNUAL.value,
                    due_date_type=DueDateType.CALENDAR_PERIOD.value,
                    applies_to_all=True,
                    active=True,
                    **extra,
                )
            )
        await db_session.flush()

        results = await SchedulingService(db_session).get_shift_compliance(
            org_id, reference_date=date(2025, 7, 1)
        )

        by_type = {r["requirement_type"]: r for r in results}
        shifts_member = by_type[RequirementType.SHIFTS.value]["members"][0]
        assert shifts_member["shift_count"] == 2
        assert shifts_member["external_shift_count"] == 1
        assert shifts_member["compliant"] is True

        hours_member = by_type[RequirementType.HOURS.value]["members"][0]
        assert hours_member["total_hours"] == 22.0
        assert hours_member["external_hours"] == 12.0
        assert hours_member["compliant"] is True


@pytest.mark.unit
class TestPermissionGates:
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

    def test_member_routes_need_only_authentication(self):
        assert self._permissions("", "POST") == set()
        assert self._permissions("/my", "GET") == set()
        assert self._permissions("/{entry_id}", "PATCH") == set()
        assert self._permissions("/{entry_id}", "DELETE") == set()

    def test_officer_routes_are_gated(self):
        assert self._permissions("", "GET") == {
            "scheduling.manage",
            "scheduling.report",
        }
        assert self._permissions("/{entry_id}/reject", "POST") == {"scheduling.manage"}
        assert self._permissions("/{entry_id}/restore", "POST") == {"scheduling.manage"}

    def test_create_schema_bounds_hours(self):
        unit = uuid.uuid4()
        with pytest.raises(ValidationError, match="greater than 0"):
            ExternalShiftHoursCreate(
                shift_date=date(2025, 1, 1), hours=0, external_apparatus_id=unit
            )
        with pytest.raises(ValidationError, match="less than or equal to 48"):
            ExternalShiftHoursCreate(
                shift_date=date(2025, 1, 1), hours=48.5, external_apparatus_id=unit
            )

    def test_create_schema_requires_an_apparatus(self):
        with pytest.raises(ValidationError, match="external_apparatus_id"):
            ExternalShiftHoursCreate(shift_date=date(2025, 1, 1), hours=8)
