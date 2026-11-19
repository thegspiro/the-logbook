"""Merging two spellings of one outside department into one.

A history import, or two officers typing the same department differently,
leaves "Arlington County" and "Arlington County Fire Department" side by side.
A merge has to leave one department behind with no shift lost and none left
under the old spelling:

* **Units move to the kept department**, and a unit it already has under the
  same name is combined rather than duplicated.
* **Past shifts carry the kept name** (owner decision 2026-11-16), including a
  shift whose unit was deleted but which still names the merged department.
* **Nothing outside the caller's organization moves**, and nothing about a
  shift's review changes.
"""

import uuid
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints import external_shift_hours as endpoint
from app.models.external_shift_hours import (
    ExternalAgency,
    ExternalApparatus,
    ExternalShiftHours,
    ExternalShiftHoursStatus,
)
from app.models.user import User
from app.schemas.external_shift_hours import ExternalAgencyMerge
from app.services.external_apparatus_service import ExternalApparatusService
from tests.test_external_shift_hours import _add_org, _add_user, _uid

pytestmark = [pytest.mark.integration]

COUNTY = "Arlington County"
COUNTY_FD = "Arlington County Fire Department"


@pytest.fixture
async def org_and_officer(db_session):
    org_id = await _add_org(db_session)
    officer_id = await _add_user(db_session, org_id, "Officer")
    await db_session.flush()
    return org_id, await db_session.get(User, officer_id)


async def _agency(db_session, org_id, name, *, evaluate=False, active=True) -> str:
    agency_id = _uid()
    db_session.add(
        ExternalAgency(
            id=agency_id,
            organization_id=org_id,
            name=name,
            evaluate_shifts=evaluate,
            is_active=active,
        )
    )
    await db_session.flush()
    return agency_id


async def _unit(db_session, org_id, agency_id, name) -> str:
    unit_id = _uid()
    db_session.add(
        ExternalApparatus(
            id=unit_id, organization_id=org_id, agency_id=agency_id, name=name
        )
    )
    await db_session.flush()
    return unit_id


async def _shift(
    db_session,
    org_id,
    user_id,
    unit_id,
    agency_name,
    apparatus_name,
    status=ExternalShiftHoursStatus.COUNTED.value,
) -> str:
    entry_id = _uid()
    db_session.add(
        ExternalShiftHours(
            id=entry_id,
            organization_id=org_id,
            user_id=user_id,
            shift_date=date(2025, 6, 1),
            duration_minutes=600,
            external_apparatus_id=unit_id,
            agency_name=agency_name,
            apparatus_name=apparatus_name,
            status=status,
        )
    )
    await db_session.flush()
    return entry_id


async def _entry(db_session, entry_id) -> ExternalShiftHours:
    entry = await db_session.get(ExternalShiftHours, entry_id)
    await db_session.refresh(entry)
    return entry


async def _merge(db_session, officer, source_id, target_id):
    with patch.object(endpoint, "log_audit_event", new=AsyncMock()) as audit:
        result = await endpoint.merge_agency(
            uuid.UUID(source_id),
            ExternalAgencyMerge(into_agency_id=uuid.UUID(target_id)),
            db_session,
            officer,
        )
    return result, audit


class TestMerge:
    async def test_units_move_and_shifts_take_the_kept_name(
        self, db_session, org_and_officer
    ):
        org_id, officer = org_and_officer
        member = await _add_user(db_session, org_id, "Casey")
        source = await _agency(db_session, org_id, COUNTY)
        target = await _agency(db_session, org_id, COUNTY_FD)
        fas = await _unit(db_session, org_id, source, "FAS")
        await _unit(db_session, org_id, target, "A106")
        moved_shift = await _shift(db_session, org_id, member, fas, COUNTY, "FAS")

        result, audit = await _merge(db_session, officer, source, target)

        assert result["moved_apparatus"] == 1
        assert result["combined_apparatus"] == 0
        assert result["relabelled_shifts"] == 1
        assert sorted(u["name"] for u in result["agency"]["apparatus"]) == [
            "A106",
            "FAS",
        ]
        entry = await _entry(db_session, moved_shift)
        assert entry.agency_name == COUNTY_FD
        assert entry.apparatus_name == "FAS"
        assert entry.external_apparatus_id == fas
        assert await db_session.get(ExternalAgency, source) is None
        data = audit.call_args.kwargs["event_data"]
        assert data["merged_name"] == COUNTY
        assert data["kept_name"] == COUNTY_FD

    async def test_a_unit_both_list_is_combined(self, db_session, org_and_officer):
        """Same unit, two spellings of its department: one unit afterwards,
        compared without regard to case, as the unique index compares."""
        org_id, officer = org_and_officer
        member = await _add_user(db_session, org_id, "Casey")
        source = await _agency(db_session, org_id, COUNTY)
        target = await _agency(db_session, org_id, COUNTY_FD)
        dup = await _unit(db_session, org_id, source, "a106")
        kept = await _unit(db_session, org_id, target, "A106")
        on_dup = await _shift(db_session, org_id, member, dup, COUNTY, "a106")

        result, _ = await _merge(db_session, officer, source, target)

        assert result["combined_apparatus"] == 1
        assert result["moved_apparatus"] == 0
        assert [u["id"] for u in result["agency"]["apparatus"]] == [kept]
        entry = await _entry(db_session, on_dup)
        assert entry.external_apparatus_id == kept
        assert entry.apparatus_name == "A106"
        assert entry.agency_name == COUNTY_FD
        assert await db_session.get(ExternalApparatus, dup) is None

    async def test_units_the_collation_calls_equal_are_combined_not_moved(
        self, db_session, org_and_officer
    ):
        """The unique index compares under utf8mb4_unicode_ci, which is
        accent-blind: "Cafe" and "Café" are one name to it. Moving the source's
        unit beside the target's would violate the index and roll the whole
        merge back, so they must be combined."""
        org_id, officer = org_and_officer
        member = await _add_user(db_session, org_id, "Casey")
        source = await _agency(db_session, org_id, COUNTY)
        target = await _agency(db_session, org_id, COUNTY_FD)
        plain = await _unit(db_session, org_id, source, "Cafe")
        kept = await _unit(db_session, org_id, target, "Café")
        on_plain = await _shift(db_session, org_id, member, plain, COUNTY, "Cafe")

        result, _ = await _merge(db_session, officer, source, target)

        assert result["combined_apparatus"] == 1
        assert [u["id"] for u in result["agency"]["apparatus"]] == [kept]
        entry = await _entry(db_session, on_plain)
        assert entry.external_apparatus_id == kept
        assert entry.apparatus_name == "Café"

    async def test_a_shift_whose_unit_was_deleted_is_relabelled_by_name(
        self, db_session, org_and_officer
    ):
        org_id, officer = org_and_officer
        member = await _add_user(db_session, org_id, "Casey")
        source = await _agency(db_session, org_id, COUNTY)
        target = await _agency(db_session, org_id, COUNTY_FD)
        detached = await _shift(db_session, org_id, member, None, COUNTY, "M110")
        unrelated = await _shift(
            db_session, org_id, member, None, "Township Fire Co", "E42"
        )

        result, _ = await _merge(db_session, officer, source, target)

        assert result["relabelled_shifts"] == 1
        assert (await _entry(db_session, detached)).agency_name == COUNTY_FD
        assert (await _entry(db_session, unrelated)).agency_name == ("Township Fire Co")

    async def test_the_kept_department_keeps_its_settings_and_reviews_stand(
        self, db_session, org_and_officer
    ):
        org_id, officer = org_and_officer
        member = await _add_user(db_session, org_id, "Casey")
        source = await _agency(db_session, org_id, COUNTY, evaluate=True)
        target = await _agency(
            db_session, org_id, COUNTY_FD, evaluate=False, active=False
        )
        fas = await _unit(db_session, org_id, source, "FAS")
        pending = await _shift(
            db_session,
            org_id,
            member,
            fas,
            COUNTY,
            "FAS",
            status=ExternalShiftHoursStatus.PENDING.value,
        )

        result, _ = await _merge(db_session, officer, source, target)

        assert result["agency"]["evaluate_shifts"] is False
        assert result["agency"]["is_active"] is False
        assert (await _entry(db_session, pending)).status == (
            ExternalShiftHoursStatus.PENDING.value
        )

    async def test_another_departments_shifts_with_the_same_name_are_untouched(
        self, db_session, org_and_officer
    ):
        org_id, officer = org_and_officer
        other_org = await _add_org(db_session)
        stranger = await _add_user(db_session, other_org, "Robin")
        source = await _agency(db_session, org_id, COUNTY)
        target = await _agency(db_session, org_id, COUNTY_FD)
        theirs = await _shift(db_session, other_org, stranger, None, COUNTY, "FAS")

        result, _ = await _merge(db_session, officer, source, target)

        assert result["relabelled_shifts"] == 0
        assert (await _entry(db_session, theirs)).agency_name == COUNTY


class TestRefusals:
    async def test_merging_into_itself_is_refused(self, db_session, org_and_officer):
        org_id, officer = org_and_officer
        source = await _agency(db_session, org_id, COUNTY)
        with pytest.raises(HTTPException) as refused:
            await _merge(db_session, officer, source, source)
        assert refused.value.status_code == 400

    @pytest.mark.parametrize("foreign_side", ["source", "target"])
    async def test_another_orgs_agency_reads_as_not_found(
        self, db_session, org_and_officer, foreign_side
    ):
        org_id, officer = org_and_officer
        other_org = await _add_org(db_session)
        mine = await _agency(db_session, org_id, COUNTY)
        theirs = await _agency(db_session, other_org, COUNTY_FD)
        source, target = (theirs, mine) if foreign_side == "source" else (mine, theirs)

        with pytest.raises(HTTPException) as missing:
            await _merge(db_session, officer, source, target)

        assert missing.value.status_code == 404
        assert await db_session.get(ExternalAgency, mine) is not None
        assert await db_session.get(ExternalAgency, theirs) is not None

    async def test_a_second_merge_of_the_same_pair_changes_nothing(
        self, db_session, org_and_officer
    ):
        """A retried request finds the merged department gone, and stops."""
        org_id, officer = org_and_officer
        member = await _add_user(db_session, org_id, "Casey")
        source = await _agency(db_session, org_id, COUNTY)
        target = await _agency(db_session, org_id, COUNTY_FD)
        fas = await _unit(db_session, org_id, source, "FAS")
        await _shift(db_session, org_id, member, fas, COUNTY, "FAS")
        await _merge(db_session, officer, source, target)

        with pytest.raises(HTTPException) as missing:
            await _merge(db_session, officer, source, target)

        assert missing.value.status_code == 404
        units = (
            await db_session.execute(
                select(ExternalApparatus).where(
                    ExternalApparatus.organization_id == org_id
                )
            )
        ).scalars()
        assert [(u.agency_id, u.name) for u in units] == [(target, "FAS")]

    async def test_the_service_returns_none_for_an_unknown_agency(
        self, db_session, org_and_officer
    ):
        org_id, _ = org_and_officer
        target = await _agency(db_session, org_id, COUNTY_FD)
        assert (
            await ExternalApparatusService(db_session).merge_agency(
                org_id, _uid(), target
            )
            is None
        )
