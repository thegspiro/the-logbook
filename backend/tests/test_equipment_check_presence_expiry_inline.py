"""Present/Absent lines, crew-dated replacements, and items on the checklist.

Three changes the department asked for on 2026-10-18:

- A ``presence`` answer type: the crew taps Present or Absent, and Absent
  fails the line without a note because it already says what is wrong.
- Date lines: the Date type always expires, a Date line with no date cannot be
  published, and on a line with no inventory link the crew records the date
  printed on a replacement it put aboard. The line takes that date, logged
  under the member's name; a date already past is refused.
- Items placed directly on the checklist: a headingless (inline) group that
  can sit anywhere among the locations, never named, sealed or nested.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.dependencies import get_current_user
from app.api.v1.endpoints.equipment_check import router
from app.core.database import get_db
from app.models.apparatus import (
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
    TemplateChangeLog,
)
from app.models.training import ShiftEquipmentCheckItem
from app.schemas.equipment_check import (
    CheckTemplateCompartmentCreate,
    CheckTemplateItemCreate,
)
from app.services.equipment_check_pdf import _status_label
from app.services.equipment_check_service import EquipmentCheckService

TODAY = date.today()
YESTERDAY = TODAY - timedelta(days=1)
NEXT_YEAR = TODAY + timedelta(days=365)

# ---------------------------------------------------------------------------
# Pure pieces
# ---------------------------------------------------------------------------


def _needs_note(status, check_type):
    return EquipmentCheckService._failure_needs_note(
        status,
        None,
        None,
        SimpleNamespace(
            check_type=check_type,
            has_expiration=False,
            expiration_date=None,
            deployed_lots=[],
        ),
        None,
        TODAY,
    )


@pytest.mark.unit
class TestPresenceType:
    def test_the_schema_accepts_presence(self):
        item = CheckTemplateItemCreate(name="Map book", check_type="presence")
        assert item.check_type == "presence"

    def test_absent_needs_no_note(self):
        assert _needs_note("fail", "presence") is False

    def test_out_of_service_on_a_presence_line_still_needs_one(self):
        # "It is there but unusable" is something only the crew can explain.
        assert _needs_note("out_of_service", "presence") is True

    def test_a_works_failure_still_needs_one(self):
        assert _needs_note("fail", "function") is True

    def test_the_pdf_says_present_and_absent(self):
        assert _status_label("presence", "pass") == "PRESENT"
        assert _status_label("presence", "fail") == "ABSENT"
        assert _status_label("function", "fail") == "FAIL"


@pytest.mark.unit
class TestDateLineSetup:
    def test_creating_a_date_line_turns_expiration_on(self):
        item = CheckTemplateItemCreate(name="AED pads", check_type="expiry")
        assert item.has_expiration is True

    def test_a_legacy_date_value_turns_it_on_too(self):
        item = CheckTemplateItemCreate(name="AED pads", check_type="date_lot")
        assert item.has_expiration is True

    def test_other_types_keep_their_own_choice(self):
        item = CheckTemplateItemCreate(name="IV bags", check_type="count")
        assert item.has_expiration is False

    def test_a_date_line_without_a_date_cannot_be_published(self):
        errors = EquipmentCheckService._publication_errors(
            {"name": "Medic 1"},
            [
                {
                    "name": "Drug box",
                    "items": [
                        {"name": "Epi", "check_type": "expiry", "has_expiration": True}
                    ],
                }
            ],
        )
        assert 'date item "Epi" needs an expiration date' in errors

    def test_a_dated_lot_aboard_is_enough(self):
        errors = EquipmentCheckService._publication_errors(
            {"name": "Medic 1"},
            [
                {
                    "name": "Drug box",
                    "items": [
                        {
                            "name": "Epi",
                            "check_type": "expiry",
                            "deployed_lots": [{"expiration_date": NEXT_YEAR}],
                        }
                    ],
                }
            ],
        )
        assert errors == []


@pytest.mark.unit
class TestReplacementDateValidation:
    @staticmethod
    def template_item(**overrides):
        values = {
            "id": "ti-1",
            "name": "AED pads",
            "_check_compartment_name": "Cab",
            "check_type": "expiry",
            "required_quantity": None,
            "expected_quantity": None,
            "critical_minimum_quantity": None,
            "min_level": None,
            "level_unit": None,
            "serial_number": None,
            "lot_number": None,
            "has_expiration": True,
            "expiration_date": YESTERDAY,
            "deployed_lots": [],
            "inventory_item_id": None,
            "unit_of_measure": None,
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def validate(self, template, **answer):
        item = {"template_item_id": "ti-1", "status": "pass", **answer}
        EquipmentCheckService._validate_and_snapshot_submission(
            [item], {"ti-1": template}, today=TODAY
        )
        return item

    def test_an_in_date_replacement_lets_an_expired_line_pass(self):
        item = self.validate(self.template_item(), expiration_found=NEXT_YEAR)
        assert item["expiration_found"] == NEXT_YEAR

    def test_a_past_replacement_date_is_refused(self):
        with pytest.raises(ValueError, match="already passed"):
            self.validate(self.template_item(), expiration_found=YESTERDAY)

    def test_without_a_replacement_an_expired_line_cannot_pass(self):
        with pytest.raises(ValueError, match="contradicts"):
            self.validate(self.template_item())

    def test_a_linked_line_ignores_the_crews_date(self):
        # The stock swap owns a linked line's date; a typed one is dropped,
        # and the expired unit still cannot be passed.
        with pytest.raises(ValueError, match="contradicts"):
            self.validate(
                self.template_item(inventory_item_id="inv-1"),
                expiration_found=NEXT_YEAR,
            )

    def test_a_lot_without_a_date_is_dropped(self):
        template = self.template_item(expiration_date=NEXT_YEAR)
        item = self.validate(template, lot_found="L-9")
        assert item["lot_found"] is None


@pytest.mark.unit
class TestInlineGroupSchema:
    def test_an_inline_group_is_kept_plain(self):
        group = CheckTemplateCompartmentCreate(
            name="Stray",
            is_inline=True,
            is_sealed=True,
            is_header=True,
            parent_compartment_id="p-1",
            container_type="bag",
        )
        assert group.name == ""
        assert group.is_sealed is False
        assert group.is_header is False
        assert group.parent_compartment_id is None
        assert group.container_type == "compartment"

    def test_an_inline_group_needs_no_name_and_may_be_empty(self):
        errors = EquipmentCheckService._publication_errors(
            {"name": "Engine 1"},
            [
                {"name": "", "is_inline": True, "items": []},
                {
                    "name": "Cab",
                    "items": [{"name": "Radio", "check_type": "function"}],
                },
            ],
        )
        assert errors == []

    def test_an_ordinary_location_still_needs_both(self):
        errors = EquipmentCheckService._publication_errors(
            {"name": "Engine 1"}, [{"name": "", "items": []}]
        )
        assert "every operational compartment needs a name" in errors


# ---------------------------------------------------------------------------
# Against the database
# ---------------------------------------------------------------------------


async def _template(db_session, org_id, *, active=True):
    template = EquipmentCheckTemplate(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="Medic 1 Daily",
        check_timing="start_of_shift",
        is_active=active,
    )
    db_session.add(template)
    await db_session.flush()
    return template


async def _compartment(db_session, template, **extra):
    compartment = CheckTemplateCompartment(
        id=str(uuid.uuid4()), template_id=template.id, name="Cab", **extra
    )
    db_session.add(compartment)
    await db_session.flush()
    return compartment


async def _item(db_session, compartment, name, check_type, **extra):
    item = CheckTemplateItem(
        id=str(uuid.uuid4()),
        compartment_id=compartment.id,
        name=name,
        check_type=check_type,
        **extra,
    )
    db_session.add(item)
    await db_session.flush()
    return item


def _row(item, status, compartment="Cab", **extra):
    return {
        "template_item_id": item.id,
        "compartment_name": compartment,
        "item_name": item.name,
        "status": status,
        **extra,
    }


async def _post(db_session, org_id, user_id, payload):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        id=user_id,
        organization_id=org_id,
        rank=None,
        positions=[SimpleNamespace(permissions=["inventory.check_submit"])],
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        return await client.post("/checks", json=payload)


async def _results(db_session, check_id):
    rows = await db_session.execute(
        select(ShiftEquipmentCheckItem).where(
            ShiftEquipmentCheckItem.check_id == check_id
        )
    )
    return {r.item_name: r for r in rows.scalars().all()}


@pytest.mark.integration
class TestPresenceSubmission:
    async def test_absent_files_a_failure_without_a_note(
        self, db_session, setup_org_and_admin
    ):
        org_id, user_id = setup_org_and_admin
        template = await _template(db_session, org_id)
        cab = await _compartment(db_session, template)
        gloves = await _item(db_session, cab, "Gloves", "presence")
        maps = await _item(db_session, cab, "Map book", "presence")

        response = await _post(
            db_session,
            org_id,
            user_id,
            {
                "template_id": template.id,
                "items": [_row(gloves, "pass"), _row(maps, "fail")],
            },
        )

        assert response.status_code == 201, response.text
        assert response.json()["overallStatus"] == "fail"
        stored = await _results(db_session, response.json()["id"])
        assert stored["Map book"].status == "fail"
        assert stored["Map book"].check_type == "presence"
        assert stored["Gloves"].status == "pass"


@pytest.mark.integration
class TestReplacementDateSubmission:
    async def test_the_line_takes_the_new_date_and_the_change_is_logged(
        self, db_session, setup_org_and_admin
    ):
        org_id, user_id = setup_org_and_admin
        template = await _template(db_session, org_id)
        cab = await _compartment(db_session, template)
        pads = await _item(
            db_session,
            cab,
            "AED pads",
            "expiry",
            has_expiration=True,
            expiration_date=YESTERDAY,
            lot_number="OLD-1",
        )

        response = await _post(
            db_session,
            org_id,
            user_id,
            {
                "template_id": template.id,
                "items": [
                    _row(
                        pads,
                        "pass",
                        expiration_found=NEXT_YEAR.isoformat(),
                        lot_found="NEW-7",
                    )
                ],
            },
        )

        assert response.status_code == 201, response.text
        assert response.json()["overallStatus"] == "pass"
        stored = await _results(db_session, response.json()["id"])
        assert stored["AED pads"].expiration_found == NEXT_YEAR
        assert stored["AED pads"].lot_found == "NEW-7"
        assert stored["AED pads"].is_expired is False

        await db_session.refresh(pads)
        assert pads.expiration_date == NEXT_YEAR
        assert pads.lot_number == "NEW-7"

        logs = (
            (
                await db_session.execute(
                    select(TemplateChangeLog).where(
                        TemplateChangeLog.entity_id == pads.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [log.action for log in logs] == ["dated"]
        assert logs[0].user_id == user_id
        assert logs[0].changes["from"]["expiration_date"] == YESTERDAY.isoformat()
        assert logs[0].changes["to"]["expiration_date"] == NEXT_YEAR.isoformat()

    async def test_a_past_date_is_refused_and_nothing_changes(
        self, db_session, setup_org_and_admin
    ):
        org_id, user_id = setup_org_and_admin
        template = await _template(db_session, org_id)
        cab = await _compartment(db_session, template)
        pads = await _item(
            db_session,
            cab,
            "AED pads",
            "expiry",
            has_expiration=True,
            expiration_date=YESTERDAY,
        )

        response = await _post(
            db_session,
            org_id,
            user_id,
            {
                "template_id": template.id,
                "items": [_row(pads, "pass", expiration_found=YESTERDAY.isoformat())],
            },
        )

        assert response.status_code == 400
        await db_session.refresh(pads)
        assert pads.expiration_date == YESTERDAY


@pytest.mark.integration
class TestDateLineUpdates:
    async def test_switching_to_the_date_type_turns_expiration_on(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        template = await _template(db_session, org_id, active=False)
        cab = await _compartment(db_session, template)
        item = await _item(db_session, cab, "Epi", "function")

        updated = await EquipmentCheckService(db_session).update_item(
            item.id, org_id, {"check_type": "expiry", "has_expiration": False}
        )

        assert updated is not None
        assert updated.has_expiration is True

    async def test_activating_with_a_dateless_date_line_is_refused(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        template = await _template(db_session, org_id, active=False)
        cab = await _compartment(db_session, template)
        await _item(db_session, cab, "Epi", "expiry", has_expiration=True)

        with pytest.raises(ValueError, match="needs an expiration date"):
            await EquipmentCheckService(db_session).update_template(
                template.id, org_id, {"is_active": True}
            )


@pytest.mark.integration
class TestInlineGroups:
    async def test_items_on_the_checklist_are_checked_like_any_other(
        self, db_session, setup_org_and_admin
    ):
        org_id, user_id = setup_org_and_admin
        template = await _template(db_session, org_id)
        loose = await _compartment(db_session, template, is_inline=True)
        loose.name = ""
        cab = await _compartment(db_session, template, sort_order=1)
        radio = await _item(db_session, loose, "Radios", "function")
        light = await _item(db_session, cab, "Flashlight", "function")
        await db_session.flush()

        response = await _post(
            db_session,
            org_id,
            user_id,
            {
                "template_id": template.id,
                "items": [_row(radio, "pass", compartment=""), _row(light, "pass")],
            },
        )

        assert response.status_code == 201, response.text
        stored = await _results(db_session, response.json()["id"])
        assert stored["Radios"].compartment_name == ""

    async def test_an_inline_group_cannot_hold_a_location(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        template = await _template(db_session, org_id, active=False)
        loose = await _compartment(db_session, template, is_inline=True)

        with pytest.raises(ValueError, match="Nothing can be stored inside"):
            await EquipmentCheckService(db_session).add_compartment(
                template.id,
                org_id,
                {"name": "Bag", "parent_compartment_id": loose.id},
            )

    async def test_an_update_cannot_seal_or_name_an_inline_group(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        template = await _template(db_session, org_id, active=False)
        loose = await _compartment(db_session, template, is_inline=True)

        updated = await EquipmentCheckService(db_session).update_compartment(
            loose.id, org_id, {"name": "Renamed", "is_sealed": True}
        )

        assert updated is not None
        assert updated.name == ""
        assert updated.is_sealed is False

    async def test_another_department_cannot_reach_an_inline_group(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        template = await _template(db_session, org_id, active=False)
        loose = await _compartment(db_session, template, is_inline=True)

        result = await EquipmentCheckService(db_session).update_compartment(
            loose.id, str(uuid.uuid4()), {"description": "x"}
        )

        assert result is None
