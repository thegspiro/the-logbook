"""
The failure log's ``total`` counts this organization's failed items, once each.

`get_failure_log` paged a filtered item query and counted it with
``select(count(ShiftEquipmentCheckItem.id)).select_from(base_q.subquery())``.
Naming the *table's* column beside the subquery puts both in the FROM clause,
so MySQL cross-joined every ``shift_equipment_check_items`` row in the database
against the matching failures: one failed flashlight in a four-item check was
reported as "4 total failures", and the figure grew with every other
department's checks on the same server. The page below the header still listed
the one real failure, so the two disagreed on the same screen.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.models.apparatus import (
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
)
from app.models.training import Shift, ShiftEquipmentCheck, ShiftEquipmentCheckItem
from app.services.equipment_check_service import EquipmentCheckService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _org_with_member(db_session, label: str) -> tuple[str, str]:
    org_id = _uid()
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone) VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": f"{label} FD",
            "otype": "fire_department",
            "slug": f"{label.lower()}-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"m-{user_id[:8]}",
            "fn": "Ryan",
            "ln": "Hill",
            "em": f"m-{user_id[:8]}@test.com",
            "pw": "hashed",
        },
    )
    await db_session.flush()
    return org_id, user_id


async def _submitted_check(
    db_session, org_id: str, user_id: str, results: list[tuple[str, str]]
) -> None:
    """One submitted check whose items carry the given (name, status) results."""
    template = EquipmentCheckTemplate(
        id=_uid(),
        organization_id=org_id,
        name="Engine Morning Check",
        check_timing="start_of_shift",
        is_active=True,
    )
    db_session.add(template)
    compartment = CheckTemplateCompartment(
        id=_uid(), template_id=template.id, name="Cab", sort_order=0
    )
    db_session.add(compartment)
    template_items = []
    for order, (name, _status) in enumerate(results):
        item = CheckTemplateItem(
            id=_uid(),
            compartment_id=compartment.id,
            name=name,
            sort_order=order,
            check_type="function",
            is_required=True,
        )
        db_session.add(item)
        template_items.append(item)
    # template_item_id is a bare FK with no relationship to order the inserts.
    await db_session.flush()

    now = datetime.now(timezone.utc)
    shift = Shift(
        id=_uid(),
        organization_id=org_id,
        shift_date=date.today(),
        start_time=now - timedelta(hours=1),
        end_time=now + timedelta(hours=11),
    )
    db_session.add(shift)
    failed = sum(1 for _name, status in results if status == "fail")
    check = ShiftEquipmentCheck(
        id=_uid(),
        organization_id=org_id,
        shift_id=shift.id,
        template_id=template.id,
        checked_by=user_id,
        checked_at=now,
        check_timing="start_of_shift",
        overall_status="fail" if failed else "pass",
        total_items=len(results),
        completed_items=len(results),
        failed_items=failed,
    )
    db_session.add(check)
    await db_session.flush()
    for template_item, (name, status) in zip(template_items, results):
        db_session.add(
            ShiftEquipmentCheckItem(
                id=_uid(),
                check_id=check.id,
                template_item_id=template_item.id,
                compartment_name="Cab",
                item_name=name,
                check_type="function",
                status=status,
            )
        )
    await db_session.flush()


async def test_total_counts_each_failed_item_once(db_session):
    org_id, user_id = await _org_with_member(db_session, "Ours")
    await _submitted_check(
        db_session,
        org_id,
        user_id,
        [
            ("Portable radios", "pass"),
            ("SCBA masks", "pass"),
            ("Flashlights work", "fail"),
            ("Map book", "pass"),
        ],
    )

    result = await EquipmentCheckService(db_session).get_failure_log(org_id)

    assert [row["item_name"] for row in result["items"]] == ["Flashlights work"]
    assert result["total"] == 1


async def test_total_ignores_other_organizations_rows(db_session):
    """Another department's items must not multiply this one's total."""
    org_id, user_id = await _org_with_member(db_session, "Ours")
    other_org, other_user = await _org_with_member(db_session, "Theirs")
    await _submitted_check(db_session, org_id, user_id, [("Flashlights work", "fail")])
    await _submitted_check(
        db_session,
        other_org,
        other_user,
        [("Hose", "pass"), ("Nozzle", "fail"), ("Axe", "out_of_service")],
    )

    ours = await EquipmentCheckService(db_session).get_failure_log(org_id)
    theirs = await EquipmentCheckService(db_session).get_failure_log(other_org)

    assert ours["total"] == 1
    assert theirs["total"] == 2
    assert sorted(row["item_name"] for row in theirs["items"]) == ["Axe", "Nozzle"]
