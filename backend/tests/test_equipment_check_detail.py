"""
Reading one completed equipment check back.

`GET /equipment-checks/checks/{id}` is what the member-facing detail screen and
the officer's history row both open, and it was the one endpoint returning a
check that resolved neither of the two things a completed record is read for.

It carried `checked_by_name: null` — every other endpoint returning a check
resolves the name — so the screen printed "Checked By: Unknown" over a record
whose purpose is to say who inspected the truck. And the items relationship
carries no ordering, so a twelve-item engine check came back in whatever order
the rows were yielded: compartments interleaved, and not necessarily the same
order twice. A crew reading a record back is walking the same truck in the same
sequence the checklist named.
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
from app.models.training import (
    Shift,
    ShiftEquipmentCheck,
    ShiftEquipmentCheckItem,
)
from app.services.equipment_check_service import EquipmentCheckService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_and_inspector(db_session):
    """An org with one member, who will be the one signing the check."""
    org_id = _uid()
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone) VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Detail FD",
            "otype": "fire_department",
            "slug": f"detail-{org_id[:8]}",
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
            "un": f"insp-{user_id[:8]}",
            "fn": "Nadia",
            "ln": "Belhaj",
            "em": f"insp-{user_id[:8]}@test.com",
            "pw": "hashed",
        },
    )
    await db_session.flush()
    return org_id, user_id


# Compartment sort order, then the items inside it, exactly as a crew walks the
# truck. Deliberately not alphabetical in either direction: sorting by label
# would put "As-Carried Kit" first and "Cab" second, which passes an
# alphabetical assertion while still being the wrong sequence.
TRUCK_ORDER = [
    ("Cab", ["Portable radio", "Thermal imaging camera", "Map book"]),
    ("Compartment 1", ["Hydraulic rescue tool", "Hand light"]),
    ("As-Carried Kit", ["Traffic cones"]),
]


@pytest.fixture
async def completed_check(db_session, org_and_inspector):
    """One submitted check whose item rows are inserted out of order."""
    org_id, user_id = org_and_inspector

    template = EquipmentCheckTemplate(
        id=_uid(),
        organization_id=org_id,
        name="Engine Daily Check",
        check_timing="start_of_shift",
        is_active=True,
    )
    db_session.add(template)

    template_item_ids: dict[str, str] = {}
    for compartment_order, (name, contents) in enumerate(TRUCK_ORDER):
        compartment = CheckTemplateCompartment(
            id=_uid(),
            template_id=template.id,
            name=name,
            sort_order=compartment_order,
        )
        db_session.add(compartment)
        for item_order, item_name in enumerate(contents):
            item = CheckTemplateItem(
                id=_uid(),
                compartment_id=compartment.id,
                name=item_name,
                sort_order=item_order,
                check_type="present",
                is_required=True,
            )
            db_session.add(item)
            template_item_ids[item_name] = item.id

    # Flushed before the check rows below. `ShiftEquipmentCheckItem.
    # template_item_id` is a bare foreign key with no ORM relationship behind
    # it, so SQLAlchemy has no dependency to sort the inserts by and happily
    # emits the child rows first — a 1452 from MySQL rather than a test failure.
    await db_session.flush()

    shift = Shift(
        id=_uid(),
        organization_id=org_id,
        shift_date=date.today() + timedelta(days=1),
        start_time=datetime.now(timezone.utc),
        end_time=datetime.now(timezone.utc) + timedelta(hours=12),
    )
    db_session.add(shift)

    check = ShiftEquipmentCheck(
        id=_uid(),
        organization_id=org_id,
        shift_id=shift.id,
        template_id=template.id,
        checked_by=user_id,
        check_timing="start_of_shift",
        overall_status="pass",
        total_items=6,
        completed_items=6,
        failed_items=0,
    )
    db_session.add(check)

    # Inserted back to front so a response that simply echoes the stored rows
    # cannot accidentally pass.
    flat = [
        (compartment, item)
        for compartment, contents in TRUCK_ORDER
        for item in contents
    ]
    for compartment_name, item_name in reversed(flat):
        db_session.add(
            ShiftEquipmentCheckItem(
                id=_uid(),
                check_id=check.id,
                template_item_id=template_item_ids[item_name],
                compartment_name=compartment_name,
                item_name=item_name,
                status="pass",
            )
        )
    await db_session.flush()
    return org_id, check.id, flat


class TestCheckDetail:
    async def test_the_record_names_who_signed_it(
        self, db_session, org_and_inspector, completed_check
    ):
        org_id, check_id, _ = completed_check
        service = EquipmentCheckService(db_session)

        check = await service.get_check(check_id, org_id)

        assert check is not None
        assert check.checked_by_name == "Nadia Belhaj"

    async def test_items_come_back_in_checklist_order(
        self, db_session, completed_check
    ):
        org_id, check_id, expected = completed_check
        service = EquipmentCheckService(db_session)

        check = await service.get_check(check_id, org_id)

        assert check is not None
        assert [(i.compartment_name, i.item_name) for i in check.items] == expected

    async def test_a_row_whose_template_item_is_gone_still_sorts_last(
        self, db_session, completed_check
    ):
        # `template_item_id` is SET NULL, so a deleted template item leaves the
        # check row behind with nothing to sort it by. It must not vanish, and
        # it must not land in the middle of the walk under a stale position.
        org_id, check_id, expected = completed_check
        orphan = ShiftEquipmentCheckItem(
            id=_uid(),
            check_id=check_id,
            template_item_id=None,
            compartment_name="Cab",
            item_name="Retired torch",
            status="pass",
        )
        db_session.add(orphan)
        await db_session.flush()
        service = EquipmentCheckService(db_session)

        check = await service.get_check(check_id, org_id)

        assert check is not None
        assert [(i.compartment_name, i.item_name) for i in check.items] == expected + [
            ("Cab", "Retired torch")
        ]

    async def test_another_org_cannot_read_the_check(self, db_session, completed_check):
        _, check_id, _ = completed_check

        service = EquipmentCheckService(db_session)

        assert await service.get_check(check_id, _uid()) is None
