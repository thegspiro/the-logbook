"""
Equipment Check Service Unit Tests

Focused on EC2-1: update_template must validate a reassigned apparatus_id in
the caller's org (mirroring create_template / clone_template). The template's
apparatus_id is resolved to an apparatus *name* in the checklist/supply
listings, so a foreign apparatus_id set via the generic update setattr loop
would leak another org's apparatus name.

Mocked sessions/getters — no DB — so it runs in the sandbox.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.exc import IntegrityError

from app.services.equipment_check_service import EquipmentCheckService


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return EquipmentCheckService(mock_db)


class TestCloneCompartment:
    @staticmethod
    def source():
        item = SimpleNamespace(
            equipment_id=None,
            inventory_item_id="inventory-1",
            name="Portable suction",
            description="Charged",
            sort_order=0,
            check_type="function",
            is_required=True,
            required_quantity=None,
            expected_quantity=None,
            critical_minimum_quantity=None,
            min_level=None,
            level_unit=None,
            serial_number="S-1",
            lot_number=None,
            image_url=None,
            has_expiration=False,
            expiration_date=None,
            expiration_warning_days=30,
        )
        return SimpleNamespace(
            template_id="template-1",
            name="Cab",
            description="Officer side",
            image_url=None,
            is_header=False,
            container_type="compartment",
            is_sealed=False,
            parent_compartment_id=None,
            items=[item],
        )

    async def test_rolls_back_the_whole_clone_when_commit_fails(self, service, mock_db):
        mock_db.commit.side_effect = RuntimeError("database unavailable")
        with patch.object(
            service,
            "_get_compartment",
            new_callable=AsyncMock,
            return_value=self.source(),
        ):
            with pytest.raises(RuntimeError, match="database unavailable"):
                await service.clone_compartment("cab", "org-1", 1)

        mock_db.rollback.assert_awaited_once()
        assert mock_db.add.call_count == 2


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


class TestBulkItemCreation:
    """The batch validates first, orders deterministically, and is retry-safe."""

    @staticmethod
    def empty_result():
        result = MagicMock()
        result.scalars.return_value.all.return_value = []
        result.scalars.return_value.first.return_value = None
        return result

    async def test_orders_after_existing_items_and_commits_once(self, service, mock_db):
        mock_db.execute.return_value = self.empty_result()
        mock_db.scalar.return_value = 7
        with (
            patch.object(
                service,
                "_get_compartment",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ),
            patch.object(service, "_validate_item_fks", new_callable=AsyncMock),
        ):
            created, replayed = await service.add_items_bulk(
                "comp-1",
                "org-1",
                [{"name": "A"}, {"name": "B"}],
                "request-123",
                "user-1",
                "Tester",
            )
        assert [item.name for item in created] == ["A", "B"]
        assert [item.sort_order for item in created] == [8, 9]
        assert replayed is False
        mock_db.commit.assert_awaited_once()

    async def test_invalid_foreign_key_writes_nothing(self, service, mock_db):
        validator = AsyncMock(side_effect=[None, ValueError("Invalid equipment")])
        with (
            patch.object(
                service,
                "_get_compartment",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ),
            patch.object(service, "_validate_item_fks", validator),
        ):
            with pytest.raises(ValueError, match="Invalid equipment"):
                await service.add_items_bulk(
                    "comp-1",
                    "org-1",
                    [{"name": "A"}, {"name": "B", "equipment_id": "bad"}],
                    "request-123",
                    "user-1",
                    "Tester",
                )
        mock_db.add.assert_not_called()
        mock_db.commit.assert_not_awaited()


class TestBulkItemDeletion:
    """A delete batch is parent-scoped, atomic, and retry-safe."""

    @staticmethod
    def result(items):
        result = MagicMock()
        result.scalars.return_value.first.return_value = None
        result.scalars.return_value.all.return_value = items
        return result

    async def test_deletes_complete_validated_batch_in_one_commit(
        self, service, mock_db
    ):
        compartment = SimpleNamespace(template_id="template-1")
        items = [
            SimpleNamespace(id="item-1", name="Radio"),
            SimpleNamespace(id="item-2", name="Light"),
        ]
        mock_db.execute.side_effect = [
            self.result([]),
            self.result([]),
            self.result(items),
        ]
        with (
            patch.object(
                service,
                "_get_compartment",
                new_callable=AsyncMock,
                return_value=compartment,
            ),
            patch.object(service, "log_template_change", new_callable=AsyncMock),
        ):
            deleted, replayed = await service.delete_items_bulk(
                "comp-1",
                "org-1",
                ["item-1", "item-2"],
                "request-123",
                "user-1",
                "Tester",
            )
        assert deleted == ["item-1", "item-2"]
        assert replayed is False
        assert mock_db.delete.await_count == 2
        mock_db.commit.assert_awaited_once()

    async def test_wrong_parent_rolls_back_without_deleting(self, service, mock_db):
        mock_db.execute.side_effect = [
            self.result([]),
            self.result([]),
            self.result([SimpleNamespace(id="item-1", name="Radio")]),
        ]
        with patch.object(
            service,
            "_get_compartment",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(template_id="template-1"),
        ):
            with pytest.raises(ValueError, match="specified compartment"):
                await service.delete_items_bulk(
                    "comp-1",
                    "org-1",
                    ["item-1", "foreign-item"],
                    "request-123",
                    "user-1",
                    "Tester",
                )
        mock_db.delete.assert_not_awaited()
        mock_db.commit.assert_not_awaited()
        mock_db.rollback.assert_awaited_once()

    async def test_delete_failure_rolls_back_entire_batch(self, service, mock_db):
        items = [
            SimpleNamespace(id="item-1", name="Radio"),
            SimpleNamespace(id="item-2", name="Light"),
        ]
        mock_db.execute.side_effect = [
            self.result([]),
            self.result([]),
            self.result(items),
        ]
        mock_db.delete.side_effect = [None, RuntimeError("database failure")]
        with (
            patch.object(
                service,
                "_get_compartment",
                new_callable=AsyncMock,
                return_value=SimpleNamespace(template_id="template-1"),
            ),
            patch.object(service, "log_template_change", new_callable=AsyncMock),
        ):
            with pytest.raises(RuntimeError, match="database failure"):
                await service.delete_items_bulk(
                    "comp-1",
                    "org-1",
                    ["item-1", "item-2"],
                    "request-123",
                    "user-1",
                    "Tester",
                )
        mock_db.commit.assert_not_awaited()
        mock_db.rollback.assert_awaited_once()

    async def test_retry_returns_confirmed_ids_without_deleting(self, service, mock_db):
        item_ids = ["item-1", "item-2"]
        payload_hash = (
            __import__("hashlib")
            .sha256(__import__("json").dumps(item_ids, separators=(",", ":")).encode())
            .hexdigest()
        )
        ledger = SimpleNamespace(payload_hash=payload_hash, item_ids=item_ids)
        result = MagicMock()
        result.scalars.return_value.first.return_value = ledger
        mock_db.execute.return_value = result
        with patch.object(
            service,
            "_get_compartment",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(template_id="template-1"),
        ):
            deleted, replayed = await service.delete_items_bulk(
                "comp-1",
                "org-1",
                item_ids,
                "request-123",
                "user-1",
                "Tester",
            )
        assert deleted == item_ids
        assert replayed is True
        mock_db.delete.assert_not_awaited()
        mock_db.commit.assert_not_awaited()

    async def test_locks_parent_before_current_ledger_read(self, service, mock_db):
        item_ids = ["item-1"]
        payload_hash = (
            __import__("hashlib")
            .sha256(__import__("json").dumps(item_ids, separators=(",", ":")).encode())
            .hexdigest()
        )
        ledger = SimpleNamespace(payload_hash=payload_hash, item_ids=item_ids)
        parent_result = self.result([])
        ledger_result = MagicMock()
        ledger_result.scalars.return_value.first.return_value = ledger
        mock_db.execute.side_effect = [parent_result, ledger_result]
        with patch.object(
            service,
            "_get_compartment",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(template_id="template-1"),
        ):
            deleted, replayed = await service.delete_items_bulk(
                "comp-1",
                "org-1",
                item_ids,
                "request-123",
                "user-1",
                "Tester",
            )

        assert deleted == item_ids
        assert replayed is True
        parent_statement = mock_db.execute.await_args_list[0].args[0]
        ledger_statement = mock_db.execute.await_args_list[1].args[0]
        assert parent_statement._for_update_arg is not None
        assert ledger_statement._for_update_arg is not None


class TestBulkItemCreationFailures(TestBulkItemCreation):
    """Additional creation failure and replay cases."""

    async def test_flush_failure_rolls_back_complete_batch(self, service, mock_db):
        mock_db.execute.return_value = self.empty_result()
        mock_db.scalar.return_value = None
        mock_db.flush.side_effect = RuntimeError("database failure")
        with (
            patch.object(
                service,
                "_get_compartment",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ),
            patch.object(service, "_validate_item_fks", new_callable=AsyncMock),
        ):
            with pytest.raises(RuntimeError, match="database failure"):
                await service.add_items_bulk(
                    "comp-1",
                    "org-1",
                    [{"name": "A"}, {"name": "B"}],
                    "request-123",
                    "user-1",
                    "Tester",
                )
        # The ledger is staged first; neither it nor either item can commit.
        assert mock_db.add.call_count == 1
        mock_db.commit.assert_not_awaited()
        mock_db.rollback.assert_awaited_once()

    async def test_retry_returns_original_rows_without_writing(self, service, mock_db):
        payload = [{"name": "A"}, {"name": "B"}]
        normalized_hash = (
            __import__("hashlib")
            .sha256(
                __import__("json")
                .dumps(payload, sort_keys=True, separators=(",", ":"))
                .encode()
            )
            .hexdigest()
        )
        ledger = SimpleNamespace(
            payload_hash=normalized_hash, item_ids=["first", "second"]
        )
        ledger_result = MagicMock()
        ledger_result.scalars.return_value.first.return_value = ledger
        original = [
            SimpleNamespace(id="first", name="A"),
            SimpleNamespace(id="second", name="B"),
        ]
        item_result = MagicMock()
        item_result.scalars.return_value.all.return_value = original
        mock_db.execute.side_effect = [ledger_result, item_result]
        with (
            patch.object(
                service,
                "_get_compartment",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ),
            patch.object(service, "_validate_item_fks", new_callable=AsyncMock),
        ):
            items, replayed = await service.add_items_bulk(
                "comp-1", "org-1", payload, "request-123", "user-1", "Tester"
            )
        assert items == original
        assert replayed is True
        mock_db.add.assert_not_called()
        mock_db.commit.assert_not_awaited()


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


class TestAuthoritativeCheckTiming:
    """Stored timing comes from the selected template, never the request."""

    async def test_shift_check_discards_timing_that_differs_from_template(
        self, service, mock_db
    ):
        shift_result = MagicMock()
        shift_result.scalars.return_value.first.return_value = MagicMock(
            id="shift-1", shift_officer_id="manager-1", apparatus_id=None
        )
        mock_db.execute.return_value = shift_result
        template = MagicMock(id="tmpl-1", check_timing="end_of_shift")

        # Stop after template selection: the request value must not be read or
        # rejected, because the public request schema no longer exposes it.
        with (
            patch.object(
                service, "_resolve_templates", AsyncMock(return_value=[template])
            ),
            patch.object(service, "_validate_and_snapshot_submission"),
            patch.object(
                service, "_load_checkable_template_items", AsyncMock(return_value={})
            ),
            patch.object(
                service,
                "complete_incomplete_check",
                AsyncMock(return_value=MagicMock()),
            ) as complete,
        ):
            existing = MagicMock(id="check-1", overall_status="incomplete")
            existing_result = MagicMock()
            existing_result.scalars.return_value.first.return_value = existing
            mock_db.execute.side_effect = [shift_result, existing_result]
            await service.submit_check(
                "shift-1",
                "org-1",
                "manager-1",
                {
                    "template_id": "tmpl-1",
                    "check_timing": "start_of_shift",
                    "items": [{"status": "pass"}],
                },
            )

        assert "check_timing" not in complete.await_args.kwargs["data"]

    async def test_standalone_check_stores_template_timing(self, service, mock_db):
        template = MagicMock(
            id="tmpl-1",
            is_active=True,
            apparatus_id=None,
            check_timing="end_of_shift",
        )
        template_result = MagicMock()
        template_result.scalars.return_value.first.return_value = template
        mock_db.execute.return_value = template_result
        stored = []
        mock_db.add = MagicMock(side_effect=stored.append)

        with (
            patch.object(
                service,
                "_load_checkable_template_items",
                AsyncMock(return_value={"item-1": MagicMock()}),
            ),
            patch.object(
                service, "_compute_check_status", return_value=(1, 1, 0, "pass")
            ),
            patch.object(service, "_create_check_items", AsyncMock()),
            patch.object(service, "_update_apparatus_deficiency", AsyncMock()),
            patch.object(service, "get_check", AsyncMock(return_value=MagicMock())),
        ):
            await service.submit_standalone_check(
                "org-1",
                "user-1",
                {
                    "template_id": "tmpl-1",
                    "items": [
                        {
                            "template_item_id": "item-1",
                            "item_name": "SCBA",
                            "status": "pass",
                        }
                    ],
                },
            )

        assert stored[0].check_timing == "end_of_shift"

    async def test_completion_repairs_legacy_timing_from_template(
        self, service, mock_db
    ):
        item = MagicMock(
            template_item_id="item-1",
            status="not_checked",
            is_expired=False,
            required_quantity=None,
            quantity_found=None,
            level_reading=None,
            notes=None,
            serial_found=None,
            lot_found=None,
            expiration_found=None,
            expiration_date=None,
        )
        check = MagicMock(
            id="check-1",
            checked_by="user-1",
            overall_status="incomplete",
            template_id="tmpl-1",
            check_timing="start_of_shift",
            items=[item],
        )
        check_result = MagicMock()
        check_result.scalars.return_value.first.return_value = check
        template_result = MagicMock()
        template_result.scalars.return_value.first.return_value = MagicMock(
            check_timing="end_of_shift"
        )
        mock_db.execute.side_effect = [check_result, template_result]

        with (
            patch.object(
                service,
                "_load_checkable_template_items",
                AsyncMock(return_value={"item-1": MagicMock()}),
            ),
            patch.object(service, "get_check", AsyncMock(return_value=check)),
            patch.object(service, "_resolve_expiration", return_value=None),
        ):
            await service.complete_incomplete_check(
                "check-1",
                "org-1",
                "user-1",
                {
                    "client_submission_id": "completion-1",
                    "items": [{"template_item_id": "item-1", "status": "pass"}],
                },
            )

        assert check.check_timing == "end_of_shift"
        assert check.overall_status == "pass"
        assert check.client_submission_id == "completion-1"


class TestShiftCheckCompletionStatus:
    """A row is complete only after it has left the draft state."""

    @pytest.mark.parametrize(
        ("overall_status", "expected_completed"),
        [
            pytest.param(None, False, id="missing"),
            pytest.param("incomplete", False, id="incomplete"),
            pytest.param("pass", True, id="passing"),
            pytest.param("fail", True, id="failing"),
        ],
    )
    async def test_get_shift_check_status_uses_canonical_completion_predicate(
        self, service, mock_db, overall_status, expected_completed
    ):
        shift = SimpleNamespace(id="shift-1")
        template = SimpleNamespace(
            id="tmpl-1",
            name="End check",
            check_timing="end_of_shift",
            assigned_positions=[],
            compartments=[],
        )
        check = None
        if overall_status is not None:
            check = SimpleNamespace(
                template_id="tmpl-1",
                overall_status=overall_status,
                checked_by=None,
                checked_at=None,
                total_items=2,
                completed_items=1 if overall_status == "incomplete" else 2,
                failed_items=1 if overall_status == "fail" else 0,
            )

        shift_result = MagicMock()
        shift_result.scalars.return_value.first.return_value = shift
        checks_result = MagicMock()
        checks_result.scalars.return_value.all.return_value = [check] if check else []
        mock_db.execute.side_effect = [shift_result, checks_result]

        with (
            patch.object(
                service,
                "_resolve_templates",
                new_callable=AsyncMock,
                return_value=[template],
            ),
            patch.object(
                service, "_get_user_name_map", new_callable=AsyncMock, return_value={}
            ),
        ):
            summaries = await service.get_shift_check_status("shift-1", "org-1")

        assert summaries[0]["is_completed"] is expected_completed
        assert summaries[0]["overall_status"] == overall_status


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
    """A compartment hierarchy stays within its template and remains acyclic."""

    @staticmethod
    def compartment(compartment_id, parent_id=None, template_id="tmpl-1"):
        return SimpleNamespace(
            id=compartment_id,
            parent_compartment_id=parent_id,
            template_id=template_id,
        )

    async def test_rejects_self_parenting(self, service, mock_db):
        compartment = self.compartment("comp-1")
        with patch.object(
            service,
            "_get_compartment",
            new_callable=AsyncMock,
            return_value=compartment,
        ):
            with pytest.raises(ValueError, match="cannot be stored inside itself"):
                await service.update_compartment(
                    "comp-1", "org-1", {"parent_compartment_id": "comp-1"}
                )
        mock_db.commit.assert_not_awaited()

    async def test_rejects_two_node_cycle(self, service, mock_db):
        compartment = self.compartment("a")
        child = self.compartment("b", "a")
        with patch.object(
            service,
            "_get_compartment",
            new_callable=AsyncMock,
            side_effect=[compartment, child],
        ):
            with pytest.raises(ValueError, match="cannot be stored inside itself"):
                await service.update_compartment(
                    "a", "org-1", {"parent_compartment_id": "b"}
                )
        mock_db.commit.assert_not_awaited()

    async def test_rejects_three_node_cycle(self, service, mock_db):
        compartment = self.compartment("a")
        grandchild = self.compartment("c", "b")
        child = self.compartment("b", "a")
        with patch.object(
            service,
            "_get_compartment",
            new_callable=AsyncMock,
            side_effect=[compartment, grandchild, child],
        ):
            with pytest.raises(ValueError, match="cannot be stored inside itself"):
                await service.update_compartment(
                    "a", "org-1", {"parent_compartment_id": "c"}
                )
        mock_db.commit.assert_not_awaited()

    async def test_rejects_parent_from_another_template_in_same_org(
        self, service, mock_db
    ):
        template = SimpleNamespace(id="tmpl-1")
        foreign_parent = self.compartment("other-parent", template_id="tmpl-2")
        with (
            patch.object(
                service, "get_template", new_callable=AsyncMock, return_value=template
            ),
            patch.object(
                service,
                "_get_compartment",
                new_callable=AsyncMock,
                return_value=foreign_parent,
            ),
        ):
            with pytest.raises(ValueError, match="same template"):
                await service.add_compartment(
                    "tmpl-1",
                    "org-1",
                    {"name": "Child", "parent_compartment_id": "other-parent"},
                )
        mock_db.commit.assert_not_awaited()

    async def test_accepts_valid_multi_level_hierarchy(self, service, mock_db):
        compartment = self.compartment("leaf")
        parent = self.compartment("middle", "root")
        root = self.compartment("root")
        result = MagicMock()
        result.scalars.return_value.first.return_value = compartment
        mock_db.execute.return_value = result
        with patch.object(
            service,
            "_get_compartment",
            new_callable=AsyncMock,
            side_effect=[compartment, parent, root],
        ):
            await service.update_compartment(
                "leaf", "org-1", {"parent_compartment_id": "middle"}
            )
        assert compartment.parent_compartment_id == "middle"
        mock_db.commit.assert_awaited_once()


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
            patch.object(service, "_validate_and_snapshot_submission"),
            patch.object(
                service, "_load_checkable_template_items", AsyncMock(return_value={})
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
                data={"template_id": "tmpl-1", "items": [{"status": "pass"}]},
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
            patch.object(service, "_validate_and_snapshot_submission"),
            patch.object(
                service, "_load_checkable_template_items", AsyncMock(return_value={})
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
                data={"template_id": "tmpl-1", "items": [{"status": "pass"}]},
                allow_manage=False,
            )
        assert complete.await_args.kwargs["allow_any"] is False

    async def test_completed_idempotent_retry_precedes_template_validation(
        self, service, mock_db
    ):
        shift = MagicMock(id="shift-1", shift_officer_id=None, apparatus_id=None)
        completed = MagicMock(
            id="chk-1",
            shift_id="shift-1",
            template_id="tmpl-1",
            overall_status="pass",
        )
        shift_result = MagicMock()
        shift_result.scalars.return_value.first.return_value = shift
        retry_result = MagicMock()
        retry_result.scalars.return_value.first.return_value = completed
        mock_db.execute = AsyncMock(side_effect=[shift_result, retry_result])

        with (
            patch.object(service, "_resolve_templates", AsyncMock()) as resolve,
            patch.object(
                service, "get_check", AsyncMock(return_value=completed)
            ) as get_check,
        ):
            result = await service.submit_check(
                shift_id="shift-1",
                organization_id="org-1",
                checked_by="manager-1",
                data={
                    "template_id": "tmpl-1",
                    "client_submission_id": "retry-1",
                    "items": [{"status": "pass"}],
                },
                allow_manage=True,
            )

        assert result is completed
        resolve.assert_not_awaited()
        get_check.assert_awaited_once_with("chk-1", "org-1")


class TestConcurrentShiftTemplateSubmission:
    async def test_one_record_and_one_set_of_operational_effects(self):
        """Both requests miss the advisory read; the flush is the race gate."""

        shift = SimpleNamespace(id="shift-1", shift_officer_id=None, apparatus_id=None)
        template = SimpleNamespace(id="tmpl-1", check_timing="start_of_shift")
        both_at_flush = asyncio.Event()
        winner_persisted = asyncio.Event()
        flush_count = 0
        persisted = []
        effects = 0

        class RaceSession:
            def __init__(self, winner: bool):
                self.winner = winner
                self.execute_count = 0
                self.candidate = None

            async def execute(self, _statement):
                self.execute_count += 1
                value = shift if self.execute_count == 1 else None
                if self.execute_count == 4:
                    value = persisted[0]
                result = MagicMock()
                result.scalars.return_value.first.return_value = value
                return result

            def add(self, candidate):
                self.candidate = candidate

            async def flush(self):
                nonlocal flush_count
                flush_count += 1
                if flush_count == 2:
                    both_at_flush.set()
                await both_at_flush.wait()
                if self.winner:
                    persisted.append(self.candidate)
                    winner_persisted.set()
                    return
                await winner_persisted.wait()
                raise IntegrityError("insert", {}, Exception("duplicate"))

            async def rollback(self):
                return None

            async def commit(self):
                return None

        winner_service = EquipmentCheckService(RaceSession(winner=True))
        loser_service = EquipmentCheckService(RaceSession(winner=False))

        async def run(service):
            async def create_items(*_args, **_kwargs):
                nonlocal effects
                effects += 1
                return []

            with (
                patch.object(
                    service, "_resolve_templates", AsyncMock(return_value=[template])
                ),
                patch.object(
                    service,
                    "_load_checkable_template_items",
                    AsyncMock(return_value={}),
                ),
                patch.object(service, "_validate_and_snapshot_submission"),
                patch.object(service, "_create_check_items", create_items),
                patch.object(
                    service, "_update_apparatus_deficiency", AsyncMock()
                ) as deficiency,
                patch.object(
                    service, "get_check", AsyncMock(side_effect=lambda *_: persisted[0])
                ),
            ):
                result = await service.submit_check(
                    shift_id="shift-1",
                    organization_id="org-1",
                    checked_by="user-1",
                    data={
                        "template_id": "tmpl-1",
                        "client_submission_id": "stable-request-1",
                        "items": [{"status": "pass"}],
                    },
                    allow_manage=True,
                )
                return result, deficiency.await_count

        first, second = await asyncio.gather(run(winner_service), run(loser_service))

        assert len(persisted) == 1
        assert first[0] is second[0] is persisted[0]
        assert effects == 1
        assert first[1] + second[1] == 1


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
            patch.object(service, "_validate_and_snapshot_submission"),
            patch.object(
                service, "_load_checkable_template_items", AsyncMock(return_value={})
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
                            "item_name": "Suction unit",
                            "compartment_name": "Cab",
                            "check_type": "functional",
                            "status": "out_of_service",
                        },
                        {
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
                "check_type": "functional",
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
