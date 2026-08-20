"""
Equipment Check Service Unit Tests

Focused on EC2-1: update_template must validate a reassigned apparatus_id in
the caller's org (mirroring create_template / clone_template). The template's
apparatus_id is resolved to an apparatus *name* in the checklist/supply
listings, so a foreign apparatus_id set via the generic update setattr loop
would leak another org's apparatus name.

Mocked sessions/getters — no DB — so it runs in the sandbox.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.equipment_check_service import EquipmentCheckService
from app.services.scheduling_service import SchedulingService


def template_item(item_id, name="Authoritative name", compartment="Cab"):
    return SimpleNamespace(
        id=item_id,
        name=name,
        _check_compartment_name=compartment,
        check_type="pass_fail",
        required_quantity=2,
        critical_minimum_quantity=1,
        level_unit=None,
        serial_number="SERIAL",
        lot_number="LOT",
        has_expiration=False,
        expiration_date=None,
    )


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.commit = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return EquipmentCheckService(mock_db)


class TestUpdateTemplateApparatusValidation:
    async def test_foreign_apparatus_rejected(self, service, mock_db):
        template = MagicMock()
        with (
            patch.object(
                service, "get_template", new_callable=AsyncMock, return_value=template
            ),
            patch(
                "app.services.equipment_check_service.is_in_org",
                new_callable=AsyncMock,
                return_value=False,
            ),
        ):
            with pytest.raises(ValueError, match="Invalid apparatus"):
                await service.update_template(
                    "tmpl-1", "org-1", {"apparatus_id": "foreign-apparatus"}
                )
        # Rejected before any write.
        mock_db.commit.assert_not_awaited()

    async def test_in_org_apparatus_passes(self, service, mock_db):
        template = MagicMock()
        with (
            patch.object(
                service, "get_template", new_callable=AsyncMock, return_value=template
            ),
            patch(
                "app.services.equipment_check_service.is_in_org",
                new_callable=AsyncMock,
                return_value=True,
            ) as mock_in_org,
        ):
            await service.update_template(
                "tmpl-1", "org-1", {"apparatus_id": "own-apparatus"}
            )
        mock_in_org.assert_awaited_once()
        mock_db.commit.assert_awaited_once()

    async def test_no_apparatus_change_skips_validation(self, service, mock_db):
        template = MagicMock()
        with (
            patch.object(
                service, "get_template", new_callable=AsyncMock, return_value=template
            ),
            patch(
                "app.services.equipment_check_service.is_in_org",
                new_callable=AsyncMock,
            ) as mock_in_org,
        ):
            await service.update_template("tmpl-1", "org-1", {"name": "Engine 1 AM"})
        mock_in_org.assert_not_awaited()
        mock_db.commit.assert_awaited_once()

    async def test_clearing_apparatus_skips_validation(self, service, mock_db):
        # apparatus_id=None clears it (a generic template) — not a foreign-id case.
        template = MagicMock()
        with (
            patch.object(
                service, "get_template", new_callable=AsyncMock, return_value=template
            ),
            patch(
                "app.services.equipment_check_service.is_in_org",
                new_callable=AsyncMock,
            ) as mock_in_org,
        ):
            await service.update_template("tmpl-1", "org-1", {"apparatus_id": None})
        mock_in_org.assert_not_awaited()
        mock_db.commit.assert_awaited_once()

    async def test_missing_template_returns_none(self, service):
        with patch.object(
            service, "get_template", new_callable=AsyncMock, return_value=None
        ):
            result = await service.update_template("tmpl-x", "org-1", {"name": "X"})
        assert result is None


class TestSubmitterTemplateVisibility:
    @staticmethod
    def template(*, active=True, positions=None):
        template = MagicMock()
        template.is_active = active
        template.assigned_positions = positions
        return template

    async def test_list_hides_inactive_and_other_position_templates(
        self, service, mock_db
    ):
        general = self.template()
        driver = self.template(positions=["driver"])
        officer = self.template(positions=["officer"])
        inactive = self.template(active=False)
        result_proxy = MagicMock()
        result_proxy.scalars.return_value.all.return_value = [
            general,
            driver,
            officer,
            inactive,
        ]
        mock_db.execute.return_value = result_proxy

        result = await service.list_templates("org-1", visible_positions={"driver"})

        assert result == [general, driver]

    async def test_get_hides_template_before_attaching_inventory_details(
        self, service, mock_db
    ):
        officer = self.template(positions=["officer"])
        result_proxy = MagicMock()
        result_proxy.scalars.return_value.first.return_value = officer
        mock_db.execute.return_value = result_proxy
        with patch.object(
            service, "_attach_unit_labels", new_callable=AsyncMock
        ) as attach_labels:
            result = await service.get_template(
                "tmpl-1", "org-1", visible_positions={"driver"}
            )

        assert result is None
        attach_labels.assert_not_awaited()

    async def test_view_access_remains_unrestricted(self, service, mock_db):
        inactive = self.template(active=False, positions=["officer"])
        inactive.compartments = []
        result_proxy = MagicMock()
        result_proxy.scalars.return_value.first.return_value = inactive
        mock_db.execute.return_value = result_proxy

        result = await service.get_template("tmpl-1", "org-1")

        assert result is inactive


class TestStandaloneTemplateVisibility:
    async def test_inactive_template_cannot_create_check(self, service, mock_db):
        inactive = MagicMock(is_active=False)
        result_proxy = MagicMock()
        result_proxy.scalars.return_value.first.return_value = inactive
        mock_db.execute.return_value = result_proxy

        with pytest.raises(ValueError, match="Template not found"):
            await service.submit_standalone_check(
                "org-1",
                "user-1",
                {"template_id": "inactive-template", "items": [{}]},
            )

        mock_db.add.assert_not_called()
        mock_db.commit.assert_not_awaited()


class TestUpdateItemCompartmentValidation:
    """update_item must validate a reassigned compartment_id in-org — moving an
    item to a foreign compartment transfers it (with the caller's content) into
    another org's checklist, since the item is org-scoped only via
    compartment -> template."""

    async def test_foreign_compartment_rejected(self, service, mock_db):
        with (
            patch.object(
                service, "_get_item", new_callable=AsyncMock, return_value=MagicMock()
            ),
            patch.object(
                service, "_get_compartment", new_callable=AsyncMock, return_value=None
            ),
        ):
            with pytest.raises(ValueError, match="Invalid compartment"):
                await service.update_item(
                    "item-1", "org-1", {"compartment_id": "foreign-compartment"}
                )
        mock_db.commit.assert_not_awaited()

    async def test_in_org_compartment_passes(self, service, mock_db):
        with (
            patch.object(
                service, "_get_item", new_callable=AsyncMock, return_value=MagicMock()
            ),
            patch.object(
                service,
                "_get_compartment",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ) as mock_get_comp,
        ):
            await service.update_item(
                "item-1", "org-1", {"compartment_id": "own-compartment"}
            )
        mock_get_comp.assert_awaited_once()
        mock_db.commit.assert_awaited_once()

    async def test_no_compartment_change_skips_validation(self, service, mock_db):
        with (
            patch.object(
                service, "_get_item", new_callable=AsyncMock, return_value=MagicMock()
            ),
            patch.object(
                service, "_get_compartment", new_callable=AsyncMock
            ) as mock_get_comp,
        ):
            await service.update_item("item-1", "org-1", {"name": "SCBA cylinder"})
        mock_get_comp.assert_not_awaited()
        mock_db.commit.assert_awaited_once()


class TestItemFkValidation:
    """EC2-4/EC2-3: inventory_item_id (name-projected in get_my_checklists) and
    equipment_id must be validated in-org on add_item / update_item."""

    async def test_add_item_rejects_foreign_inventory_item(self, service, mock_db):
        with (
            patch.object(
                service,
                "_get_compartment",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ),
            patch(
                "app.services.equipment_check_service.is_in_org",
                new_callable=AsyncMock,
                return_value=False,
            ),
        ):
            with pytest.raises(ValueError, match="Invalid inventory item"):
                await service.add_item(
                    "comp-1", "org-1", {"inventory_item_id": "foreign-inv"}
                )
        mock_db.commit.assert_not_awaited()

    async def test_add_item_rejects_foreign_equipment(self, service, mock_db):
        with (
            patch.object(
                service,
                "_get_compartment",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ),
            patch(
                "app.services.equipment_check_service.is_in_org",
                new_callable=AsyncMock,
                return_value=False,
            ),
        ):
            with pytest.raises(ValueError, match="Invalid equipment"):
                await service.add_item(
                    "comp-1", "org-1", {"equipment_id": "foreign-equip"}
                )
        mock_db.commit.assert_not_awaited()

    async def test_update_item_rejects_foreign_inventory_item(self, service, mock_db):
        with (
            patch.object(
                service, "_get_item", new_callable=AsyncMock, return_value=MagicMock()
            ),
            patch(
                "app.services.equipment_check_service.is_in_org",
                new_callable=AsyncMock,
                return_value=False,
            ),
        ):
            with pytest.raises(ValueError, match="Invalid inventory item"):
                await service.update_item(
                    "item-1", "org-1", {"inventory_item_id": "foreign-inv"}
                )
        mock_db.commit.assert_not_awaited()


class TestCompartmentParentValidation:
    """EC2-3: a reassigned parent_compartment_id must be in-org."""

    async def test_update_compartment_rejects_foreign_parent(self, service, mock_db):
        # 1st _get_compartment: the compartment itself (in-org). 2nd: the foreign
        # parent (None) -> rejected.
        with patch.object(
            service,
            "_get_compartment",
            new_callable=AsyncMock,
            side_effect=[MagicMock(), None],
        ):
            with pytest.raises(ValueError, match="Invalid parent compartment"):
                await service.update_compartment(
                    "comp-1", "org-1", {"parent_compartment_id": "foreign-comp"}
                )
        mock_db.commit.assert_not_awaited()


class TestSubmitCheckResumeOverride:
    """submit_check delegates a resume to complete_incomplete_check; the manage
    override has to survive the hand-off or a manager finishing another
    member's incomplete check hits the ownership guard's "Check not found"."""

    @staticmethod
    def _wire(mock_db, *, incomplete_owner="member-1"):
        shift = MagicMock(id="shift-1", shift_officer_id=None, apparatus_id=None)
        shift_result = MagicMock()
        shift_result.scalars.return_value.first.return_value = shift
        incomplete = MagicMock(
            id="chk-1", overall_status="incomplete", checked_by=incomplete_owner
        )
        existing_result = MagicMock()
        existing_result.scalars.return_value.first.return_value = incomplete
        mock_db.execute = AsyncMock(side_effect=[shift_result, existing_result])
        return shift

    async def test_manage_override_is_forwarded_on_resume(self, service, mock_db):
        self._wire(mock_db)
        with (
            patch.object(
                service,
                "_resolve_templates",
                AsyncMock(return_value=[MagicMock(id="tmpl-1")]),
            ),
            patch.object(
                service,
                "_load_checkable_template_items",
                AsyncMock(return_value={"item-1": template_item("item-1")}),
            ),
            patch.object(
                service,
                "complete_incomplete_check",
                AsyncMock(return_value=MagicMock()),
            ) as complete,
        ):
            await service.submit_check(
                shift_id="shift-1",
                organization_id="org-1",
                checked_by="manager-9",
                data={
                    "template_id": "tmpl-1",
                    "items": [{"template_item_id": "item-1", "status": "pass"}],
                },
                allow_manage=True,
            )
        assert complete.await_args.kwargs["allow_any"] is True

    async def test_member_resume_keeps_the_ownership_guard(self, service, mock_db):
        shift = MagicMock(id="shift-1", shift_officer_id=None, apparatus_id=None)
        shift_result = MagicMock()
        shift_result.scalars.return_value.first.return_value = shift
        assignment_result = MagicMock()
        assignment_result.scalars.return_value.first.return_value = MagicMock(
            position=None
        )
        incomplete = MagicMock(id="chk-1", overall_status="incomplete")
        existing_result = MagicMock()
        existing_result.scalars.return_value.first.return_value = incomplete
        mock_db.execute = AsyncMock(
            side_effect=[shift_result, assignment_result, existing_result]
        )
        with (
            patch.object(
                service,
                "_resolve_templates",
                AsyncMock(return_value=[MagicMock(id="tmpl-1")]),
            ),
            patch.object(
                service,
                "_load_checkable_template_items",
                AsyncMock(return_value={"item-1": template_item("item-1")}),
            ),
            patch.object(
                service,
                "complete_incomplete_check",
                AsyncMock(return_value=MagicMock()),
            ) as complete,
        ):
            await service.submit_check(
                shift_id="shift-1",
                organization_id="org-1",
                checked_by="member-1",
                data={
                    "template_id": "tmpl-1",
                    "items": [{"template_item_id": "item-1", "status": "pass"}],
                },
                allow_manage=False,
            )
        assert complete.await_args.kwargs["allow_any"] is False


class TestFailureAlertDetails:
    """A check failed entirely by out-of-service items must not alert with an
    empty item list: out_of_service counts toward failed_items, so it belongs
    in the failure details, labeled as out of service."""

    async def test_out_of_service_items_reach_the_alert(self, service, mock_db):
        shift = MagicMock(id="shift-1", shift_officer_id=None, apparatus_id=None)
        shift_result = MagicMock()
        shift_result.scalars.return_value.first.return_value = shift
        existing_result = MagicMock()
        existing_result.scalars.return_value.first.return_value = None
        mock_db.execute = AsyncMock(side_effect=[shift_result, existing_result])
        mock_db.add = MagicMock()

        with (
            patch.object(
                service,
                "_resolve_templates",
                AsyncMock(return_value=[MagicMock(id="tmpl-1")]),
            ),
            patch.object(
                service,
                "_load_checkable_template_items",
                AsyncMock(
                    return_value={
                        "item-1": template_item("item-1", "Suction unit"),
                        "item-2": template_item("item-2", "O2 bottle"),
                    }
                ),
            ),
            patch.object(service, "_create_check_items", AsyncMock(return_value=[])),
            patch.object(service, "_update_apparatus_deficiency", AsyncMock()),
            patch.object(
                service, "_send_check_failure_notification", AsyncMock()
            ) as notify,
            patch.object(service, "get_check", AsyncMock(return_value=MagicMock())),
            patch(
                "app.services.equipment_check_service.resolve_apparatus_ref",
                AsyncMock(return_value=MagicMock(full_id=None)),
            ),
        ):
            await service.submit_check(
                shift_id="shift-1",
                organization_id="org-1",
                checked_by="u-1",
                data={
                    "template_id": "tmpl-1",
                    "items": [
                        {
                            "template_item_id": "item-1",
                            "item_name": "Suction unit",
                            "compartment_name": "Cab",
                            "check_type": "functional",
                            "status": "out_of_service",
                        },
                        {
                            "template_item_id": "item-2",
                            "item_name": "O2 bottle",
                            "compartment_name": "Cab",
                            "check_type": "pass_fail",
                            "status": "pass",
                        },
                    ],
                },
                allow_manage=True,
            )

        kwargs = notify.await_args.kwargs
        assert kwargs["failed_count"] == 1
        assert kwargs["warning_items"] == [
            {
                "name": "Suction unit",
                "compartment": "Cab",
                "check_type": "pass_fail",
                "out_of_service": True,
            }
        ]


class TestShiftCheckStatusItemCount:
    """An unstarted checklist must not advertise more items than it asks for.

    `get_shift_check_status` reports `total_items` for a template nobody has
    started yet by counting its template rows. Headers and free-text rows are
    captions rather than questions — the check form drops them from what it
    asks, and a submitted check's `total_items` drops them too — so counting
    them made the denominator shrink the moment a member opened the checklist
    (0/13 on the card, 12/12 once submitted).
    """

    @staticmethod
    def _item(check_type: str):
        return SimpleNamespace(check_type=check_type)

    def _template(self):
        return SimpleNamespace(
            id="tmpl-1",
            name="Engine Daily Check",
            check_timing="start_of_shift",
            assigned_positions=None,
            compartments=[
                SimpleNamespace(
                    items=[
                        self._item("present"),
                        self._item("header"),
                        self._item("present"),
                    ]
                ),
                SimpleNamespace(
                    items=[self._item("text"), self._item("quantity")],
                ),
            ],
        )

    @pytest.mark.asyncio
    async def test_headers_and_text_are_not_counted(self, mock_db):
        service = EquipmentCheckService(mock_db)
        template = self._template()

        with (
            patch.object(
                service, "_resolve_templates", AsyncMock(return_value=[template])
            ),
            patch.object(service, "_get_user_name_map", AsyncMock(return_value={})),
        ):
            mock_db.execute.return_value = MagicMock(
                scalars=MagicMock(
                    return_value=MagicMock(all=MagicMock(return_value=[]))
                )
            )
            summaries = await service.get_shift_check_status("shift-1", "org-1")

        assert len(summaries) == 1
        # Five template rows, of which a header and a text row are captions.
        assert summaries[0]["total_items"] == 3


class TestAuthoritativeSubmissionItems:
    @pytest.fixture
    def authoritative(self):
        return {
            "item-1": template_item("item-1", "Mask", "Left cabinet"),
            "item-2": template_item("item-2", "Cylinder", "Right cabinet"),
        }

    def test_one_item_partial_submission_is_rejected(self, authoritative):
        with pytest.raises(ValueError, match="missing template items"):
            EquipmentCheckService._validate_and_snapshot_submission(
                [{"template_item_id": "item-1", "status": "pass"}], authoritative
            )

    def test_missing_template_item_id_is_rejected(self, authoritative):
        with pytest.raises(ValueError, match="template_item_id is required"):
            EquipmentCheckService._validate_and_snapshot_submission(
                [{"status": "pass"}, {"template_item_id": "item-2"}], authoritative
            )

    def test_duplicate_template_item_ids_are_rejected(self, authoritative):
        with pytest.raises(ValueError, match="Duplicate"):
            EquipmentCheckService._validate_and_snapshot_submission(
                [{"template_item_id": "item-1"}, {"template_item_id": "item-1"}],
                authoritative,
            )

    def test_foreign_template_item_id_is_rejected(self, authoritative):
        with pytest.raises(ValueError, match="do not belong"):
            EquipmentCheckService._validate_and_snapshot_submission(
                [
                    {"template_item_id": "item-1"},
                    {"template_item_id": "foreign-item"},
                ],
                authoritative,
            )

    def test_valid_complete_submission_uses_template_snapshots(self, authoritative):
        items = [
            {
                "template_item_id": "item-1",
                "status": "pass",
                "item_name": "Client forgery",
                "required_quantity": 999,
            },
            {"template_item_id": "item-2", "status": "pass"},
        ]
        EquipmentCheckService._validate_and_snapshot_submission(items, authoritative)
        assert items[0]["item_name"] == "Mask"
        assert items[0]["compartment_name"] == "Left cabinet"
        assert items[0]["required_quantity"] == 2
        assert EquipmentCheckService._compute_check_status(items, authoritative) == (
            2,
            2,
            0,
            "pass",
        )

    async def test_partial_end_of_shift_submission_cannot_clear_finalization_gate(
        self, authoritative
    ):
        with pytest.raises(ValueError, match="missing template items"):
            EquipmentCheckService._validate_and_snapshot_submission(
                [{"template_item_id": "item-1", "status": "pass"}], authoritative
            )

        equipment = MagicMock()
        equipment.get_shift_check_status = AsyncMock(
            return_value=[
                {
                    "check_timing": "end_of_shift",
                    "is_completed": False,
                    "overall_status": "incomplete",
                }
            ]
        )
        with patch(
            "app.services.equipment_check_service.EquipmentCheckService",
            return_value=equipment,
        ):
            outstanding = await SchedulingService(
                AsyncMock()
            )._count_incomplete_end_checks("shift-1", "org-1")
        assert outstanding == 1
