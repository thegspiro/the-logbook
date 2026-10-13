"""W46-13: a Fail or Out of service the member chose must carry a note.

The check form has refused to submit one without a note since #2882; this is
the same rule on the server, so a direct API call cannot file a failure — or
take a rig off the fleet board — with no reason recorded. The exemptions are
the form's own (``failureNeedsNote`` in ``EquipmentCheckForm.tsx``): a count or
a reading carries its number, and an expired unit carries its date.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.dependencies import get_current_user
from app.api.v1.endpoints.equipment_check import router
from app.core.database import get_db
from app.models.apparatus import (
    CheckItemDeployedLot,
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
)
from app.models.training import ShiftEquipmentCheck, ShiftEquipmentCheckItem
from app.services.equipment_check_service import EquipmentCheckService

TODAY = date(2026, 10, 12)
LONG_AGO = date(2000, 1, 1)
FAR_OFF = date(2999, 1, 1)


def _template_item(*, expiration=None, lots=()):
    return SimpleNamespace(
        has_expiration=expiration is not None,
        expiration_date=expiration,
        deployed_lots=[
            SimpleNamespace(expiration_date=d, quantity=1, lot_number=None)
            for d in lots
        ],
    )


def _needs(status, *, quantity=None, reading=None, template_item=None, sent=None):
    return EquipmentCheckService._failure_needs_note(
        status, quantity, reading, template_item, sent, TODAY
    )


@pytest.mark.unit
class TestFailureNeedsNote:
    @pytest.mark.parametrize("status", ["fail", "out_of_service"])
    def test_a_chosen_failure_needs_a_note(self, status):
        assert _needs(status, template_item=_template_item()) is True

    @pytest.mark.parametrize("status", ["pass", "not_applicable", "not_checked"])
    def test_anything_else_does_not(self, status):
        assert _needs(status, template_item=_template_item()) is False

    def test_a_count_explains_itself(self):
        assert _needs("fail", quantity=0, template_item=_template_item()) is False

    def test_a_reading_explains_itself(self):
        assert _needs("fail", reading=0.0, template_item=_template_item()) is False

    def test_an_expired_item_explains_itself(self):
        item = _template_item(expiration=TODAY - timedelta(days=1))
        assert _needs("fail", template_item=item) is False

    def test_an_item_expiring_today_is_not_expired(self):
        item = _template_item(expiration=TODAY)
        assert _needs("fail", template_item=item) is True

    # The form reads the soonest lot aboard; the item's own column can be
    # later. Exempting on the lot keeps the server from refusing what the
    # form sent.
    def test_an_expired_lot_aboard_explains_itself(self):
        item = _template_item(expiration=FAR_OFF, lots=[TODAY - timedelta(days=3)])
        assert _needs("out_of_service", template_item=item) is False

    def test_without_a_template_the_submitted_date_decides(self):
        assert _needs("fail", sent=TODAY - timedelta(days=1)) is False
        assert _needs("fail", sent=None) is True


@pytest.mark.unit
class TestRequireFailureNotes:
    @staticmethod
    def _run(items, existing_map=None):
        EquipmentCheckService._require_failure_notes(
            items, {}, today=TODAY, existing_map=existing_map
        )

    def test_names_the_items_missing_a_note(self):
        with pytest.raises(ValueError, match="Flashlight, Halligan"):
            self._run(
                [
                    {"item_name": "Flashlight", "status": "fail"},
                    {"item_name": "Halligan", "status": "out_of_service"},
                    {"item_name": "Axe", "status": "fail", "notes": "Head loose"},
                ]
            )

    def test_whitespace_is_not_a_note(self):
        with pytest.raises(ValueError, match="Flashlight"):
            self._run([{"item_name": "Flashlight", "status": "fail", "notes": " \n"}])

    def test_a_long_list_stays_under_the_error_length_cap(self):
        items = [{"item_name": "x" * 200, "status": "fail"} for _ in range(10)]
        with pytest.raises(ValueError, match="and 7 more") as excinfo:
            self._run(items)
        # safe_error_detail swaps anything longer for a generic message.
        assert len(str(excinfo.value)) <= 300

    def test_a_stored_note_counts_when_the_resume_omits_it(self):
        existing = SimpleNamespace(
            status="fail", notes="Lens cracked", quantity_found=None, level_reading=None
        )
        self._run(
            [{"template_item_id": "ti-1", "item_name": "Light", "status": "fail"}],
            existing_map={"ti-1": existing},
        )

    def test_an_explicit_empty_note_overrides_the_stored_one(self):
        existing = SimpleNamespace(
            status="fail", notes="Lens cracked", quantity_found=None, level_reading=None
        )
        with pytest.raises(ValueError, match="Light"):
            self._run(
                [
                    {
                        "template_item_id": "ti-1",
                        "item_name": "Light",
                        "status": "fail",
                        "notes": None,
                    }
                ],
                existing_map={"ti-1": existing},
            )


@pytest.mark.unit
class TestShiftSubmitRefusesBeforeWriting:
    async def test_nothing_is_added_or_notified(self, monkeypatch):
        monkeypatch.setattr(
            "app.services.equipment_check_service.resolve_org_today",
            AsyncMock(return_value=TODAY),
        )
        db = AsyncMock()
        db.add = MagicMock()
        shift = MagicMock(id="shift-1", shift_officer_id=None, apparatus_id=None)
        shift_result = MagicMock()
        shift_result.scalars.return_value.first.return_value = shift
        db.execute = AsyncMock(side_effect=[shift_result])
        service = EquipmentCheckService(db)

        with (
            patch.object(
                service,
                "_resolve_templates",
                AsyncMock(return_value=[MagicMock(id="tmpl-1")]),
            ),
            patch.object(service, "_validate_and_snapshot_submission"),
            patch.object(
                service, "_load_checkable_template_items", AsyncMock(return_value={})
            ),
            patch.object(
                service, "_send_check_failure_notification", AsyncMock()
            ) as notify,
            pytest.raises(ValueError, match="Suction unit"),
        ):
            await service.submit_check(
                shift_id="shift-1",
                organization_id="org-1",
                checked_by="u-1",
                data={
                    "template_id": "tmpl-1",
                    "items": [
                        {
                            "template_item_id": "ti-1",
                            "item_name": "Suction unit",
                            "status": "out_of_service",
                        }
                    ],
                },
                allow_manage=True,
            )

        db.add.assert_not_called()
        db.commit.assert_not_awaited()
        notify.assert_not_awaited()


# ---------------------------------------------------------------------------
# Against the database, through the endpoint
# ---------------------------------------------------------------------------


async def _build_template(db_session, org_id):
    template = EquipmentCheckTemplate(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="Engine 1 Daily",
        check_timing="start_of_shift",
        is_active=True,
    )
    db_session.add(template)
    await db_session.flush()
    compartment = CheckTemplateCompartment(
        id=str(uuid.uuid4()), template_id=template.id, name="Cab"
    )
    db_session.add(compartment)
    await db_session.flush()

    def item(name, check_type, **extra):
        row = CheckTemplateItem(
            id=str(uuid.uuid4()),
            compartment_id=compartment.id,
            name=name,
            check_type=check_type,
            **extra,
        )
        db_session.add(row)
        return row

    items = {
        "light": item("Flashlight", "function"),
        "gloves": item("Gloves", "count", required_quantity=4),
        "o2": item("O2 cylinder", "level", min_level=1000.0),
        "pads": item(
            "AED pads", "expiry", has_expiration=True, expiration_date=LONG_AGO
        ),
        "epi": item(
            "Epi kit", "function", has_expiration=True, expiration_date=FAR_OFF
        ),
    }
    await db_session.flush()
    db_session.add(
        CheckItemDeployedLot(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            template_item_id=items["epi"].id,
            lot_number="EPI-1",
            expiration_date=LONG_AGO,
            quantity=1,
        )
    )
    await db_session.flush()
    return template, items


def _row(template_item, status, **extra):
    return {
        "template_item_id": template_item.id,
        "compartment_name": "Cab",
        "item_name": template_item.name,
        "status": status,
        **extra,
    }


def _rest_explained(items):
    """Every other row on the template, each a failure its record explains."""
    return [
        _row(items["gloves"], "fail", quantity_found=2),
        _row(items["o2"], "out_of_service", level_reading=400.0),
        _row(items["pads"], "fail"),
        # Expired only by the lot aboard, as the form reads it.
        _row(items["epi"], "out_of_service"),
    ]


async def _post(db_session, org_id, user_id, path, payload, method="POST"):
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
        return await client.request(method, path, json=payload)


async def _check_count(db_session, org_id) -> int:
    result = await db_session.execute(
        select(func.count())
        .select_from(ShiftEquipmentCheck)
        .where(ShiftEquipmentCheck.organization_id == org_id)
    )
    return int(result.scalar_one())


@pytest.mark.integration
class TestStandaloneSubmit:
    @pytest.mark.parametrize(
        ("status", "notes"),
        [
            pytest.param("fail", None, id="fail-no-note"),
            pytest.param("out_of_service", None, id="oos-no-note"),
            pytest.param("fail", "   ", id="whitespace-note"),
        ],
    )
    async def test_refused_with_400_and_nothing_written(
        self, db_session, setup_org_and_admin, status, notes
    ):
        org_id, user_id = setup_org_and_admin
        template, items = await _build_template(db_session, org_id)
        extra = {} if notes is None else {"notes": notes}

        response = await _post(
            db_session,
            org_id,
            user_id,
            "/checks",
            {
                "template_id": template.id,
                "items": [_row(items["light"], status, **extra)],
            },
        )

        assert response.status_code == 400
        assert "Flashlight" in response.json()["detail"]
        assert await _check_count(db_session, org_id) == 0

    async def test_accepted_with_a_note(self, db_session, setup_org_and_admin):
        org_id, user_id = setup_org_and_admin
        template, items = await _build_template(db_session, org_id)

        response = await _post(
            db_session,
            org_id,
            user_id,
            "/checks",
            {
                "template_id": template.id,
                "items": [_row(items["light"], "fail", notes="Bulb dead")],
            },
        )

        assert response.status_code == 201
        assert await _check_count(db_session, org_id) == 1

    async def test_failures_the_record_explains_are_accepted_without_notes(
        self, db_session, setup_org_and_admin
    ):
        org_id, user_id = setup_org_and_admin
        template, items = await _build_template(db_session, org_id)

        response = await _post(
            db_session,
            org_id,
            user_id,
            "/checks",
            {
                "template_id": template.id,
                "items": _rest_explained(items),
            },
        )

        assert response.status_code == 201, response.text
        assert response.json()["overallStatus"] == "fail"


@pytest.mark.integration
class TestCompleteIncompleteCheck:
    async def _incomplete(self, db_session, org_id, user_id, template, items):
        check = ShiftEquipmentCheck(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            template_id=template.id,
            checked_by=user_id,
            check_timing="start_of_shift",
            check_context="standalone",
            overall_status="incomplete",
            total_items=1,
            completed_items=0,
        )
        db_session.add(check)
        await db_session.flush()
        row = ShiftEquipmentCheckItem(
            id=str(uuid.uuid4()),
            check_id=check.id,
            template_item_id=items["light"].id,
            compartment_name="Cab",
            item_name="Flashlight",
            check_type="function",
            status="not_checked",
        )
        db_session.add(row)
        await db_session.flush()
        return check, row

    async def test_refused_and_the_stored_row_is_untouched(
        self, db_session, setup_org_and_admin
    ):
        org_id, user_id = setup_org_and_admin
        template, items = await _build_template(db_session, org_id)
        check, row = await self._incomplete(
            db_session, org_id, user_id, template, items
        )

        response = await _post(
            db_session,
            org_id,
            user_id,
            f"/checks/{check.id}/complete",
            {
                "items": [
                    _row(items["light"], "fail", notes=""),
                    *_rest_explained(items),
                ]
            },
            method="PUT",
        )

        assert response.status_code == 400
        await db_session.refresh(row)
        assert row.status == "not_checked"
        await db_session.refresh(check)
        assert check.overall_status == "incomplete"

    async def test_accepted_with_a_note(self, db_session, setup_org_and_admin):
        org_id, user_id = setup_org_and_admin
        template, items = await _build_template(db_session, org_id)
        check, _ = await self._incomplete(db_session, org_id, user_id, template, items)

        response = await _post(
            db_session,
            org_id,
            user_id,
            f"/checks/{check.id}/complete",
            {
                "items": [
                    _row(items["light"], "fail", notes="Switch broken"),
                    *_rest_explained(items),
                ]
            },
            method="PUT",
        )

        assert response.status_code == 200, response.text
        assert response.json()["overallStatus"] == "fail"
