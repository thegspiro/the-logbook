"""
Items placed directly on a checklist, the Present / Absent answer, and a
replacement date a crew enters on a Date line.

The unit half needs no database: the schemas, the publish rules, and the
answer validation are pure. The integration half covers what outlives the
request — the template a crew's replacement date rewrites, its change log, and
the inline shape the service refuses to break.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.models.apparatus import (
    CheckTemplateItem,
    EquipmentCheckTemplate,
    TemplateChangeLog,
)
from app.models.training import ShiftEquipmentCheckItem
from app.models.user import Organization, User
from app.schemas.equipment_check import (
    CheckItemResultSubmit,
    CheckTemplateCompartmentCreate,
    CheckTemplateItemCreate,
    CheckTemplateItemUpdate,
)
from app.services.equipment_check_pdf import _item_with_count
from app.services.equipment_check_service import EquipmentCheckService

TODAY = date(2026, 10, 18)
YESTERDAY = TODAY - timedelta(days=1)
NEXT_YEAR = TODAY + timedelta(days=365)


def _template_item(**kwargs) -> CheckTemplateItem:
    defaults = {
        "id": "ti-1",
        "compartment_id": "comp-1",
        "name": "AED pads",
        "check_type": "expiry",
        "has_expiration": True,
        "expiration_date": YESTERDAY,
        "inventory_item_id": None,
    }
    defaults.update(kwargs)
    return CheckTemplateItem(**defaults)


def _answer(**kwargs) -> dict:
    defaults = {
        "template_item_id": "ti-1",
        "compartment_name": "",
        "item_name": "AED pads",
        "status": "pass",
    }
    defaults.update(kwargs)
    return CheckItemResultSubmit(**defaults).model_dump()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestInlineGroupSchema:
    def test_an_inline_group_has_no_name(self):
        group = CheckTemplateCompartmentCreate(name="Ignored", is_inline=True)
        assert group.name == ""

    @pytest.mark.parametrize(
        ("field", "value", "message"),
        [
            ("is_sealed", True, "sealed"),
            ("is_header", True, "section"),
            ("parent_compartment_id", "comp-9", "inside a location"),
        ],
    )
    def test_an_inline_group_is_only_items(self, field, value, message):
        with pytest.raises(ValidationError, match=message):
            CheckTemplateCompartmentCreate(name="", is_inline=True, **{field: value})

    def test_an_ordinary_location_keeps_its_name(self):
        assert CheckTemplateCompartmentCreate(name="Cab").name == "Cab"


@pytest.mark.unit
class TestDateLinesCarryADate:
    def test_creating_a_date_line_turns_expiration_on(self):
        item = CheckTemplateItemCreate(name="Pads", check_type="expiry")
        assert item.has_expiration is True

    def test_a_legacy_date_value_does_too(self):
        item = CheckTemplateItemCreate(name="Pads", check_type="date_lot")
        assert item.check_type == "expiry"
        assert item.has_expiration is True

    def test_other_types_keep_the_checkbox(self):
        item = CheckTemplateItemCreate(name="IV bags", check_type="count")
        assert item.has_expiration is False

    def test_switching_to_date_is_sent_as_a_set_field(self):
        """The endpoint dumps updates with exclude_unset; a flag set only in
        memory would never reach the row."""
        update = CheckTemplateItemUpdate(check_type="expiry")
        assert update.model_dump(exclude_unset=True) == {
            "check_type": "expiry",
            "has_expiration": True,
        }

    async def test_clearing_the_checkbox_cannot_strip_a_date_line(self):
        item = _template_item()
        service = EquipmentCheckService(MagicMock())
        service._get_item = AsyncMock(
            return_value=SimpleNamespace(
                **{c: getattr(item, c) for c in ("check_type", "has_expiration")},
                compartment=SimpleNamespace(template_id="tpl-1"),
            )
        )
        service._validate_item_fks = AsyncMock()
        service._advance_content_revision = AsyncMock()
        service.db.commit = AsyncMock()
        service.db.refresh = AsyncMock()

        updated = await service.update_item("ti-1", "org-1", {"has_expiration": False})

        assert updated.has_expiration is True


# ---------------------------------------------------------------------------
# Publishing
# ---------------------------------------------------------------------------


def _item(**kwargs) -> dict:
    return {"name": "Chocks", "check_type": "function", **kwargs}


@pytest.mark.unit
class TestPublishRules:
    def test_a_checklist_of_only_loose_items_can_publish(self):
        errors = EquipmentCheckService._publication_errors(
            {"name": "Engine 1"},
            [{"name": "", "is_inline": True, "items": [_item()]}],
        )
        assert errors == []

    def test_a_loose_group_needs_no_name(self):
        errors = EquipmentCheckService._publication_errors(
            {"name": "Engine 1"},
            [
                {"name": "", "is_inline": True, "items": [_item()]},
                {"name": "Cab", "items": [_item()]},
            ],
        )
        assert errors == []

    def test_an_empty_loose_group_is_not_a_blocker(self):
        errors = EquipmentCheckService._publication_errors(
            {"name": "Engine 1"},
            [
                {"name": "", "is_inline": True, "items": []},
                {"name": "Cab", "items": [_item()]},
            ],
        )
        assert errors == []

    def test_an_empty_loose_group_alone_is_still_an_empty_checklist(self):
        errors = EquipmentCheckService._publication_errors(
            {"name": "Engine 1"},
            [{"name": "", "is_inline": True, "items": []}],
        )
        assert "at least one operational compartment is required" in errors

    def test_an_unnamed_location_still_blocks(self):
        errors = EquipmentCheckService._publication_errors(
            {"name": "Engine 1"}, [{"name": "", "items": [_item()]}]
        )
        assert "every operational compartment needs a name" in errors

    def test_a_date_line_without_a_date_blocks(self):
        errors = EquipmentCheckService._publication_errors(
            {"name": "Engine 1"},
            [{"name": "Cab", "items": [_item(name="Pads", check_type="expiry")]}],
        )
        assert errors == ['date item "Pads" needs an expiration date']

    def test_a_dated_date_line_publishes(self):
        errors = EquipmentCheckService._publication_errors(
            {"name": "Engine 1"},
            [
                {
                    "name": "Cab",
                    "items": [
                        _item(
                            name="Pads", check_type="expiry", expiration_date=NEXT_YEAR
                        )
                    ],
                }
            ],
        )
        assert errors == []

    def test_a_linked_date_line_takes_its_dates_from_inventory(self):
        errors = EquipmentCheckService._publication_errors(
            {"name": "Engine 1"},
            [
                {
                    "name": "Cab",
                    "items": [
                        _item(name="Pads", check_type="expiry", inventory_item_id="i-1")
                    ],
                }
            ],
        )
        assert errors == []


# ---------------------------------------------------------------------------
# Present / Absent
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestPresenceAnswers:
    def test_absent_explains_itself(self):
        assert not EquipmentCheckService._failure_needs_note(
            "fail", None, None, _template_item(check_type="presence"), None, TODAY
        )

    def test_out_of_service_still_needs_a_reason(self):
        assert EquipmentCheckService._failure_needs_note(
            "out_of_service",
            None,
            None,
            _template_item(check_type="presence", has_expiration=False),
            None,
            TODAY,
        )

    def test_a_works_failure_still_needs_a_note(self):
        assert EquipmentCheckService._failure_needs_note(
            "fail",
            None,
            None,
            _template_item(check_type="function", has_expiration=False),
            None,
            TODAY,
        )

    def test_absent_counts_as_a_failure(self):
        items = [{"template_item_id": "ti-1", "status": "fail"}]
        _, _, failed, overall = EquipmentCheckService._compute_check_status(
            items,
            {"ti-1": _template_item(check_type="presence", has_expiration=False)},
            today=TODAY,
        )
        assert (failed, overall) == (1, "fail")

    def test_the_failure_log_says_absent(self):
        record = {"item_name": "Spare bottle", "check_type": "presence"}
        assert _item_with_count({**record, "status": "fail"}) == (
            "Spare bottle (absent)"
        )
        assert _item_with_count({**record, "status": "out_of_service"}) == (
            "Spare bottle"
        )


# ---------------------------------------------------------------------------
# Replacement dates: validation
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestReplacementDateValidation:
    def _validate(self, answer: dict, template_item: CheckTemplateItem) -> dict:
        EquipmentCheckService._validate_and_normalize_observation(
            answer, template_item, TODAY
        )
        return answer

    def test_a_future_date_is_accepted_and_clears_the_expiry(self):
        answer = self._validate(
            _answer(expiration_found=NEXT_YEAR, lot_found=" L-9 "), _template_item()
        )
        _, _, failed, overall = EquipmentCheckService._compute_check_status(
            [answer], {"ti-1": _template_item()}, today=TODAY
        )
        assert answer["status"] == "pass"
        assert answer["expiration_date"] == NEXT_YEAR
        assert (failed, overall) == (0, "pass")

    def test_a_past_date_is_refused(self):
        with pytest.raises(ValueError, match="already passed"):
            self._validate(_answer(expiration_found=YESTERDAY), _template_item())

    def test_today_is_not_past(self):
        answer = self._validate(_answer(expiration_found=TODAY), _template_item())
        assert answer["expiration_found"] == TODAY

    def test_a_linked_line_ignores_it(self):
        """Its dates move only with a lot swap, which also moves the stock."""
        answer = self._validate(
            _answer(status="fail", expiration_found=NEXT_YEAR, lot_found="L-9"),
            _template_item(inventory_item_id="inv-1"),
        )
        assert answer["expiration_found"] is None
        assert answer["lot_found"] is None
        _, _, failed, _ = EquipmentCheckService._compute_check_status(
            [answer], {"ti-1": _template_item(inventory_item_id="inv-1")}, today=TODAY
        )
        assert failed == 1

    def test_a_count_line_ignores_it(self):
        answer = self._validate(
            _answer(expiration_found=NEXT_YEAR),
            _template_item(check_type="count", has_expiration=False),
        )
        assert answer["expiration_found"] is None

    def test_a_pass_on_an_expired_line_without_one_is_still_refused(self):
        with pytest.raises(ValueError, match="contradicts"):
            self._validate(_answer(), _template_item())

    def test_an_unvalidated_date_cannot_clear_the_expiry(self):
        """Only the key validation writes counts, not the submitted field."""
        items = [_answer(expiration_found=NEXT_YEAR)]
        _, _, failed, _ = EquipmentCheckService._compute_check_status(
            items, {"ti-1": _template_item()}, today=TODAY
        )
        assert failed == 1


# ---------------------------------------------------------------------------
# Integration: what the database keeps
# ---------------------------------------------------------------------------


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Loose Items Department",
        slug=f"loose-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(db_session, org) -> User:
    member = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"crew-{uuid.uuid4().hex[:6]}",
        email=f"{uuid.uuid4().hex[:6]}@fd.test",
        password_hash="x",
        first_name="Pat",
        last_name="Crew",
    )
    db_session.add(member)
    await db_session.flush()
    return member


async def _published_template(db_session, org, service) -> EquipmentCheckTemplate:
    template = await service.create_template(
        org.id,
        None,
        {
            "name": "Engine 1 Daily",
            "check_timing": "start_of_shift",
            "is_active": True,
            "compartments": [
                CheckTemplateCompartmentCreate(
                    name="",
                    is_inline=True,
                    sort_order=0,
                    items=[
                        CheckTemplateItemCreate(
                            name="Wheel chocks", check_type="presence"
                        ),
                        CheckTemplateItemCreate(
                            name="AED pads",
                            check_type="expiry",
                            expiration_date=NEXT_YEAR,
                        ),
                    ],
                ).model_dump(),
                CheckTemplateCompartmentCreate(
                    name="Cab",
                    sort_order=1,
                    items=[
                        CheckTemplateItemCreate(name="Radio", check_type="function")
                    ],
                ).model_dump(),
            ],
        },
    )
    return template


def _by_name(template: EquipmentCheckTemplate) -> dict:
    return {i.name: i for c in template.compartments for i in c.items}


@pytest.mark.integration
class TestInlineGroupsStored:
    async def test_a_checklist_with_loose_items_publishes(self, db_session):
        org = await _org(db_session)
        service = EquipmentCheckService(db_session)
        template = await _published_template(db_session, org, service)

        assert template.is_active is True
        inline = [c for c in template.compartments if c.is_inline]
        assert len(inline) == 1
        assert inline[0].name == ""
        assert _by_name(template)["AED pads"].has_expiration is True

    async def test_a_location_cannot_go_inside_loose_items(self, db_session):
        org = await _org(db_session)
        service = EquipmentCheckService(db_session)
        template = await _published_template(db_session, org, service)
        inline = next(c for c in template.compartments if c.is_inline)

        with pytest.raises(ValueError, match="placed directly on the checklist"):
            await service.add_compartment(
                template.id,
                org.id,
                {"name": "Bag", "parent_compartment_id": inline.id},
            )

    async def test_a_location_holding_others_cannot_become_inline(self, db_session):
        org = await _org(db_session)
        service = EquipmentCheckService(db_session)
        template = await _published_template(db_session, org, service)
        cab = next(c for c in template.compartments if c.name == "Cab")
        await service.add_compartment(
            template.id, org.id, {"name": "Bag", "parent_compartment_id": cab.id}
        )

        with pytest.raises(ValueError, match="locations inside it"):
            await service.update_compartment(cab.id, org.id, {"is_inline": True})

    async def test_a_location_turned_inline_loses_its_heading(self, db_session):
        org = await _org(db_session)
        service = EquipmentCheckService(db_session)
        template = await _published_template(db_session, org, service)
        cab = next(c for c in template.compartments if c.name == "Cab")

        updated = await service.update_compartment(cab.id, org.id, {"is_inline": True})

        assert updated.is_inline is True
        assert updated.name == ""


@pytest.mark.integration
class TestReplacementDateStored:
    async def _submit(self, service, org, member, template, **answer):
        items = _by_name(template)
        pads = items["AED pads"]
        data = {
            "template_id": template.id,
            "items": [
                CheckItemResultSubmit(
                    template_item_id=pads.id,
                    compartment_name="",
                    item_name=pads.name,
                    status="pass",
                    **answer,
                ).model_dump()
            ],
        }
        return await service.submit_standalone_check(org.id, member.id, data)

    async def test_the_line_takes_the_new_date_and_logs_who(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        service = EquipmentCheckService(db_session)
        template = await _published_template(db_session, org, service)
        later = NEXT_YEAR + timedelta(days=200)

        check = await self._submit(
            service,
            org,
            member,
            template,
            expiration_found=later,
            lot_found="LOT-42",
        )

        pads = await db_session.get(
            CheckTemplateItem, _by_name(template)["AED pads"].id
        )
        await db_session.refresh(pads)
        assert pads.expiration_date == later
        assert pads.lot_number == "LOT-42"

        result = (
            await db_session.execute(
                select(ShiftEquipmentCheckItem).where(
                    ShiftEquipmentCheckItem.check_id == check.id
                )
            )
        ).scalar_one()
        assert result.expiration_found == later
        assert result.lot_found == "LOT-42"
        assert result.expiration_date == later

        log = (
            await db_session.execute(
                select(TemplateChangeLog).where(
                    TemplateChangeLog.template_id == template.id,
                    TemplateChangeLog.action == "replacement_dated",
                )
            )
        ).scalar_one()
        assert log.user_id == member.id
        assert log.user_name == "Pat Crew"
        assert log.changes["check_id"] == check.id
        assert log.changes["expiration_date"]["new"] == later.isoformat()

    async def test_recording_a_date_leaves_the_checklist_published(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        service = EquipmentCheckService(db_session)
        template = await _published_template(db_session, org, service)

        await self._submit(service, org, member, template, expiration_found=NEXT_YEAR)

        stored = await db_session.get(EquipmentCheckTemplate, template.id)
        await db_session.refresh(stored)
        assert stored.is_active is True

    async def test_a_past_date_writes_nothing(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        service = EquipmentCheckService(db_session)
        template = await _published_template(db_session, org, service)

        with pytest.raises(ValueError, match="already passed"):
            await self._submit(
                service,
                org,
                member,
                template,
                expiration_found=date.today() - timedelta(days=3),
            )

        pads = await db_session.get(
            CheckTemplateItem, _by_name(template)["AED pads"].id
        )
        await db_session.refresh(pads)
        assert pads.expiration_date == NEXT_YEAR
