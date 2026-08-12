"""
Equipment Check Service

Business logic for equipment check template management, shift equipment
check submissions, checklist resolution by position, and item history.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.utils import generate_uuid
from app.models.apparatus import (
    Apparatus,
    ApparatusEquipment,
    CheckItemDeployedLot,
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
    TemplateChangeLog,
)
from app.models.inventory import InventoryItem, InventoryLot
from app.models.training import (
    AssignmentStatus,
    Shift,
    ShiftAssignment,
    ShiftEquipmentCheck,
    ShiftEquipmentCheckItem,
)
from app.models.user import Organization, User
from app.services.inventory_service import InventoryService
from app.utils.apparatus_ref import resolve_apparatus_labels, resolve_apparatus_ref
from app.utils.model_updates import apply_updates
from app.utils.name_matching import best_matches
from app.utils.org_scoping import is_in_org


class EquipmentCheckService:
    """Service for equipment check template and submission management."""

    PROTECTED_FIELDS = frozenset(
        {
            "id",
            "organization_id",
            "created_at",
            "updated_at",
            "created_by",
        }
    )

    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _trend_bucket_for_status(status: str) -> Optional[str]:
        """Map every stored item outcome to its reporting bucket."""
        if status == "pass":
            return "pass_count"
        if status in ("fail", "out_of_service"):
            return "fail_count"
        if status == "not_applicable":
            return "not_applicable_count"
        if status == "not_checked":
            return "not_checked_count"
        return None

    # ------------------------------------------------------------------
    # Template CRUD
    # ------------------------------------------------------------------

    async def create_template(
        self,
        organization_id: str,
        created_by: str,
        data: Dict[str, Any],
    ) -> EquipmentCheckTemplate:
        """Create a new equipment check template with nested compartments."""
        compartments_data = data.pop("compartments", None) or []

        template = EquipmentCheckTemplate(
            id=generate_uuid(),
            organization_id=organization_id,
            created_by=created_by,
            **data,
        )
        self.db.add(template)
        await self.db.flush()

        for comp_data in compartments_data:
            await self._create_compartment(template.id, comp_data)

        await self.db.commit()
        return await self.get_template(template.id, organization_id)

    async def get_template(
        self,
        template_id: str,
        organization_id: str,
        visible_positions: Optional[set[str]] = None,
    ) -> Optional[EquipmentCheckTemplate]:
        """Get a template with all compartments and items.

        ``visible_positions`` restricts submit-only users to active templates
        that are either general or assigned to one of their shift positions.
        ``None`` preserves unrestricted access for template administrators.
        """
        result = await self.db.execute(
            select(EquipmentCheckTemplate)
            .where(
                EquipmentCheckTemplate.id == template_id,
                EquipmentCheckTemplate.organization_id == organization_id,
            )
            .options(
                selectinload(EquipmentCheckTemplate.compartments).selectinload(
                    CheckTemplateCompartment.items
                )
            )
        )
        template = result.scalars().first()
        if template is not None and not self._template_visible_to_submitter(
            template, visible_positions
        ):
            return None
        if template is not None:
            items = [i for c in template.compartments for i in c.items]
            await self._attach_unit_labels(organization_id, items)
            # Sorted and stripped of spent rows here rather than letting the
            # response read the raw relationship: the crew needs them in the
            # order they should be drawn from, and a schema field bound to the
            # ORM collection could not carry the expired flag.
            for item in items:
                item.lots_aboard = self._deployed_lot_payload(item)
        return template

    async def _attach_unit_labels(
        self,
        organization_id: str,
        items: List[CheckTemplateItem],
    ) -> None:
        """Hang each item's unit of measure on it for the response schema.

        "2/4" does not tell a crew whether it is looking for two boxes or two
        gloves, and the catalog already knows which. Read from the linked
        inventory item rather than stored again on the checklist, so a
        department that relabels a unit does not have to re-enter it on every
        truck that carries it.
        """
        inv_ids = [i.inventory_item_id for i in items if i.inventory_item_id]
        if not inv_ids:
            return
        # Org-scoped: inventory_item_id is a client-supplied FK, and an
        # unfiltered read here would render a foreign org's label (EC2-4).
        result = await self.db.execute(
            select(InventoryItem.id, InventoryItem.unit_of_measure).where(
                InventoryItem.id.in_(inv_ids),
                InventoryItem.organization_id == organization_id,
            )
        )
        units = {iid: unit for iid, unit in result.all()}
        for item in items:
            item.unit_of_measure = (
                units.get(item.inventory_item_id) if item.inventory_item_id else None
            )

    async def list_templates(
        self,
        organization_id: str,
        apparatus_id: Optional[str] = None,
        apparatus_type: Optional[str] = None,
        check_timing: Optional[str] = None,
        visible_positions: Optional[set[str]] = None,
    ) -> List[EquipmentCheckTemplate]:
        """List templates with optional filters and submitter visibility."""
        query = (
            select(EquipmentCheckTemplate)
            .where(EquipmentCheckTemplate.organization_id == organization_id)
            .options(
                selectinload(EquipmentCheckTemplate.compartments).selectinload(
                    CheckTemplateCompartment.items
                )
            )
            .order_by(EquipmentCheckTemplate.sort_order)
        )

        if apparatus_id is not None:
            query = query.where(EquipmentCheckTemplate.apparatus_id == apparatus_id)
        if apparatus_type is not None:
            query = query.where(EquipmentCheckTemplate.apparatus_type == apparatus_type)
        if check_timing is not None:
            query = query.where(EquipmentCheckTemplate.check_timing == check_timing)

        result = await self.db.execute(query)
        return [
            template
            for template in result.scalars().all()
            if self._template_visible_to_submitter(template, visible_positions)
        ]

    @staticmethod
    def _template_visible_to_submitter(
        template: EquipmentCheckTemplate,
        visible_positions: Optional[set[str]],
    ) -> bool:
        """Apply the narrow template scope used for submit-only access."""
        if visible_positions is None:
            return True
        assigned_positions = set(template.assigned_positions or [])
        return bool(template.is_active) and (
            not assigned_positions or bool(assigned_positions & visible_positions)
        )

    async def get_user_check_positions(
        self, user_id: str, organization_id: str
    ) -> set[str]:
        """Return shift positions the user may perform equipment checks as."""
        result = await self.db.execute(
            select(ShiftAssignment.position)
            .join(Shift, Shift.id == ShiftAssignment.shift_id)
            .where(
                ShiftAssignment.user_id == user_id,
                Shift.organization_id == organization_id,
                ShiftAssignment.position.is_not(None),
            )
            .distinct()
        )
        return {position for position in result.scalars().all() if position}

    async def update_template(
        self,
        template_id: str,
        organization_id: str,
        data: Dict[str, Any],
    ) -> Optional[EquipmentCheckTemplate]:
        """Update template metadata (not compartments)."""
        template = await self.get_template(template_id, organization_id)
        if not template:
            return None

        # XC-1: create_template/clone_template validate the apparatus is in-org,
        # but this generic setattr loop did not — and the template's apparatus_id
        # is resolved to an apparatus *name* in the checklist/supply listings, so
        # a foreign apparatus_id set here would leak another org's apparatus name.
        # Validate a reassigned apparatus_id (None clears it — a generic template).
        if data.get("apparatus_id") and not await is_in_org(
            self.db, Apparatus, data["apparatus_id"], organization_id
        ):
            raise ValueError("Invalid apparatus")

        for key, value in data.items():
            if key not in self.PROTECTED_FIELDS and hasattr(template, key):
                setattr(template, key, value)

        await self.db.commit()
        return await self.get_template(template_id, organization_id)

    async def delete_template(self, template_id: str, organization_id: str) -> bool:
        """Delete a template and all its compartments/items."""
        template = await self.get_template(template_id, organization_id)
        if not template:
            return False

        await self.db.delete(template)
        await self.db.commit()
        return True

    async def clone_template(
        self,
        template_id: str,
        organization_id: str,
        target_apparatus_id: str,
        created_by: str,
    ) -> Optional[EquipmentCheckTemplate]:
        """Clone a template to a specific apparatus."""
        source = await self.get_template(template_id, organization_id)
        if not source:
            return None

        # Look up apparatus (org-scoped) to get the name and to reject cloning
        # onto another org's apparatus id.
        result = await self.db.execute(
            select(Apparatus).where(
                Apparatus.id == target_apparatus_id,
                Apparatus.organization_id == organization_id,
            )
        )
        apparatus = result.scalars().first()
        if apparatus is None:
            raise ValueError("Target apparatus not found")
        apparatus_name = apparatus.name or ""

        clone_name = (
            f"{apparatus_name} - {source.name}" if apparatus_name else source.name
        )
        new_template = EquipmentCheckTemplate(
            id=generate_uuid(),
            organization_id=organization_id,
            apparatus_id=target_apparatus_id,
            apparatus_type=source.apparatus_type,
            name=clone_name,
            description=source.description,
            check_timing=source.check_timing,
            template_type=source.template_type,
            assigned_positions=source.assigned_positions,
            is_active=source.is_active,
            sort_order=source.sort_order,
            created_by=created_by,
        )
        self.db.add(new_template)
        await self.db.flush()

        for compartment in source.compartments:
            await self._clone_compartment(new_template.id, compartment, parent_id=None)

        await self.db.commit()
        return await self.get_template(new_template.id, organization_id)

    # ------------------------------------------------------------------
    # Compartment CRUD
    # ------------------------------------------------------------------

    async def add_compartment(
        self,
        template_id: str,
        organization_id: str,
        data: Dict[str, Any],
    ) -> Optional[CheckTemplateCompartment]:
        """Add a compartment to a template."""
        template = await self.get_template(template_id, organization_id)
        if not template:
            return None

        # EC2-3: a client-supplied parent_compartment_id must be in-org
        # (integrity-only — not projected — but validate on both paths).
        if data.get("parent_compartment_id") and not await self._get_compartment(
            data["parent_compartment_id"], organization_id
        ):
            raise ValueError("Invalid parent compartment")

        items_data = data.pop("items", None) or []
        # EC2-4: nested items carry the same client-supplied inventory_item_id /
        # equipment_id as add_item; validate each in-org before creating them.
        for item_data in items_data:
            await self._validate_item_fks(item_data, organization_id)
        compartment = CheckTemplateCompartment(
            id=generate_uuid(),
            template_id=template_id,
            **data,
        )
        self.db.add(compartment)
        await self.db.flush()

        for item_data in items_data:
            self._create_item(compartment.id, item_data)

        await self.db.commit()

        # Re-fetch with eager-loaded relationships to avoid MissingGreenlet
        # errors when FastAPI serializes the response outside the async context.
        result = await self.db.execute(
            select(CheckTemplateCompartment)
            .options(selectinload(CheckTemplateCompartment.items))
            .where(CheckTemplateCompartment.id == compartment.id)
        )
        return result.scalars().first()

    async def update_compartment(
        self,
        compartment_id: str,
        organization_id: str,
        data: Dict[str, Any],
    ) -> Optional[CheckTemplateCompartment]:
        """Update a compartment."""
        compartment = await self._get_compartment(compartment_id, organization_id)
        if not compartment:
            return None

        # EC2-3: validate a reassigned parent_compartment_id in-org before the
        # setattr loop applies it.
        if data.get("parent_compartment_id") and not await self._get_compartment(
            data["parent_compartment_id"], organization_id
        ):
            raise ValueError("Invalid parent compartment")

        for key, value in data.items():
            if key not in self.PROTECTED_FIELDS and hasattr(compartment, key):
                setattr(compartment, key, value)

        await self.db.commit()

        # Re-fetch with eager-loaded relationships to avoid MissingGreenlet
        result = await self.db.execute(
            select(CheckTemplateCompartment)
            .options(selectinload(CheckTemplateCompartment.items))
            .where(CheckTemplateCompartment.id == compartment.id)
        )
        return result.scalars().first()

    async def delete_compartment(
        self, compartment_id: str, organization_id: str
    ) -> bool:
        """Delete a compartment and all its items."""
        compartment = await self._get_compartment(compartment_id, organization_id)
        if not compartment:
            return False

        await self.db.delete(compartment)
        await self.db.commit()
        return True

    async def reorder_compartments(
        self,
        template_id: str,
        organization_id: str,
        ordered_ids: List[str],
    ) -> bool:
        """Reorder compartments within a template."""
        template = await self.get_template(template_id, organization_id)
        if not template:
            return False

        for idx, cid in enumerate(ordered_ids):
            for comp in template.compartments:
                if comp.id == cid:
                    comp.sort_order = idx
                    break

        await self.db.commit()
        return True

    # ------------------------------------------------------------------
    # Item CRUD
    # ------------------------------------------------------------------

    async def _validate_item_fks(
        self, data: Dict[str, Any], organization_id: str
    ) -> None:
        """Reject a client-supplied inventory_item_id / equipment_id that isn't
        in the caller's org (EC2-3 / EC2-4).

        inventory_item_id is projected as ``inventory_item_name`` in
        ``get_my_checklists`` (the org-scoped name lookup is the definitive guard;
        this validates the write side too). equipment_id is integrity-only, but
        validated here for defense-in-depth. Only checked when supplied.
        """
        if data.get("inventory_item_id") and not await is_in_org(
            self.db, InventoryItem, data["inventory_item_id"], organization_id
        ):
            raise ValueError("Invalid inventory item")
        if data.get("equipment_id") and not await is_in_org(
            self.db, ApparatusEquipment, data["equipment_id"], organization_id
        ):
            raise ValueError("Invalid equipment")

    async def add_item(
        self,
        compartment_id: str,
        organization_id: str,
        data: Dict[str, Any],
    ) -> Optional[CheckTemplateItem]:
        """Add an item to a compartment."""
        compartment = await self._get_compartment(compartment_id, organization_id)
        if not compartment:
            return None

        await self._validate_item_fks(data, organization_id)

        item = CheckTemplateItem(
            id=generate_uuid(),
            compartment_id=compartment_id,
            **data,
        )
        self.db.add(item)
        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def update_item(
        self,
        item_id: str,
        organization_id: str,
        data: Dict[str, Any],
    ) -> Optional[CheckTemplateItem]:
        """Update a check template item."""
        item = await self._get_item(item_id, organization_id)
        if not item:
            return None

        # XC-1 (cross-org write): compartment_id is client-supplied and the
        # generic setattr loop would move the item under it. A foreign
        # compartment_id would transfer this item — with the caller's content —
        # into another org's checklist (the item is org-scoped only via
        # compartment -> template, so it leaves this org entirely). Validate the
        # target compartment is in-org before re-parenting.
        if data.get("compartment_id") and not await self._get_compartment(
            data["compartment_id"], organization_id
        ):
            raise ValueError("Invalid compartment")

        # EC2-3/EC2-4: a reassigned inventory_item_id/equipment_id must be in-org
        # (inventory_item_id is name-projected in get_my_checklists).
        await self._validate_item_fks(data, organization_id)

        # apply_updates rather than a setattr loop: the builder clears an
        # expiration or unlinks an inventory item by sending an explicit null,
        # and a null aimed at a NOT NULL column has to surface as a 400 instead
        # of a flush-time IntegrityError.
        apply_updates(item, data, skip=self.PROTECTED_FIELDS)

        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def delete_item(self, item_id: str, organization_id: str) -> bool:
        """Delete a check template item."""
        item = await self._get_item(item_id, organization_id)
        if not item:
            return False

        await self.db.delete(item)
        await self.db.commit()
        return True

    async def reorder_items(
        self,
        compartment_id: str,
        organization_id: str,
        ordered_ids: List[str],
    ) -> bool:
        """Reorder items within a compartment."""
        compartment = await self._get_compartment(compartment_id, organization_id)
        if not compartment:
            return False

        for idx, iid in enumerate(ordered_ids):
            for item in compartment.items:
                if item.id == iid:
                    item.sort_order = idx
                    break

        await self.db.commit()
        return True

    # ------------------------------------------------------------------
    # Checklist Resolution for Shifts
    # ------------------------------------------------------------------

    async def _checklists_for_shift(
        self,
        shift: Shift,
        organization_id: str,
        user_position: Optional[str],
        existing_checks: Optional[Dict[str, ShiftEquipmentCheck]] = None,
    ) -> List[Dict[str, Any]]:
        """Build checklist entries for an already-loaded shift.

        Used by ``get_my_checklists`` (many shifts) so it does not re-fetch the
        shift/assignment it already holds. Pass ``existing_checks`` (keyed by
        template_id) to reuse a batch-loaded check map instead of querying the
        checks per shift.
        """
        templates = await self._resolve_templates(shift, organization_id, user_position)

        if existing_checks is None:
            result = await self.db.execute(
                select(ShiftEquipmentCheck).where(
                    ShiftEquipmentCheck.shift_id == shift.id,
                    ShiftEquipmentCheck.organization_id == organization_id,
                )
            )
            existing_checks = {c.template_id: c for c in result.scalars().all()}

        checklists = []
        for tmpl in templates:
            check = existing_checks.get(tmpl.id)
            is_completed = check is not None and check.overall_status != "incomplete"
            checklists.append(
                {
                    "template": tmpl,
                    "is_completed": is_completed,
                    "check": check,
                }
            )

        return checklists

    async def get_shift_check_status(
        self, shift_id: str, organization_id: str
    ) -> List[Dict[str, Any]]:
        """Get summary of all checks for a shift (for shift detail view)."""
        # Get shift
        result = await self.db.execute(
            select(Shift).where(
                Shift.id == shift_id,
                Shift.organization_id == organization_id,
            )
        )
        shift = result.scalars().first()
        if not shift:
            return []

        # Get all templates for this apparatus
        templates = await self._resolve_templates(
            shift, organization_id, user_position=None
        )

        # Get existing checks
        result = await self.db.execute(
            select(ShiftEquipmentCheck).where(
                ShiftEquipmentCheck.shift_id == shift_id,
                ShiftEquipmentCheck.organization_id == organization_id,
            )
        )
        checks = {c.template_id: c for c in result.scalars().all()}

        # Build user name map
        user_ids = [c.checked_by for c in checks.values() if c.checked_by]
        user_map = await self._get_user_name_map(user_ids)

        summaries = []
        for tmpl in templates:
            check = checks.get(tmpl.id)
            # Headers and free-text rows are captions, not questions: the check
            # form excludes them from what it asks for, and a submitted check's
            # total_items excludes them too. Counting them here made an
            # unstarted checklist advertise more items than it turned out to
            # have — 0/13 on the card, 12 once you opened it.
            item_count = sum(
                1
                for comp in tmpl.compartments
                for item in comp.items
                if item.check_type not in ("header", "text")
            )
            summaries.append(
                {
                    "template_id": tmpl.id,
                    "template_name": tmpl.name,
                    "check_timing": tmpl.check_timing,
                    "assigned_positions": tmpl.assigned_positions,
                    "is_completed": check is not None,
                    "overall_status": check.overall_status if check else None,
                    "checked_by_name": (
                        user_map.get(check.checked_by, "")
                        if check and check.checked_by
                        else None
                    ),
                    "checked_at": check.checked_at if check else None,
                    "total_items": check.total_items if check else item_count,
                    "completed_items": check.completed_items if check else 0,
                    "failed_items": check.failed_items if check else 0,
                }
            )

        return summaries

    # ------------------------------------------------------------------
    # Check Submission — shared helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_expiration(
        item_data: Dict[str, Any],
        tmpl_item: Optional[CheckTemplateItem],
    ) -> Optional[date]:
        """Resolve the authoritative expiration for this item result.

        The template is authoritative because changes to its expiration must
        go through the validated inventory-lot swap flow. ``expiration_found``
        remains part of the check result as an observation, but a check
        submitter cannot use it to clear an expired equipment record.
        """
        if tmpl_item is not None:
            return tmpl_item.expiration_date if tmpl_item.has_expiration else None
        return item_data.get("expiration_date")

    @classmethod
    def _compute_check_status(
        cls,
        items_data: List[Dict[str, Any]],
        template_items_map: Optional[Dict[str, CheckTemplateItem]] = None,
    ) -> tuple:
        """Auto-fail expired/under-quantity items and compute aggregate counts.

        Expiry is recomputed here rather than taken from the submitted
        ``is_expired`` flag: it decides whether a safety-critical item is
        force-failed, so it must come from the department's own record, not
        from whatever the client asserted. ``item["is_expired"]`` and
        ``item["expiration_date"]`` are
        normalized in place so the stored result agrees with the verdict.

        Returns (total, completed, failed, overall_status).
        """
        today = date.today()
        template_items_map = template_items_map or {}
        for item in items_data:
            tmpl_item = template_items_map.get(item.get("template_item_id") or "")
            expiration = cls._resolve_expiration(item, tmpl_item)
            item["expiration_date"] = expiration
            item["is_expired"] = bool(expiration and expiration < today)
            if item.get("is_expired"):
                item["status"] = "fail"
            # "not_applicable" is the crew answering that the item is not on
            # this apparatus, so there is no count to be short of. Expiry above
            # still wins — that verdict comes from the department's own record —
            # but a shortfall cannot be read off an item nobody is carrying.
            if item.get("status") == "not_applicable":
                continue
            req_qty = item.get("required_quantity")
            found_qty = item.get("quantity_found")
            if req_qty is not None and found_qty is not None and found_qty < req_qty:
                item["status"] = "fail"

        total = len(items_data)
        completed = sum(1 for i in items_data if i.get("status") != "not_checked")
        failed = sum(
            1 for i in items_data if i.get("status") in ("fail", "out_of_service")
        )

        if completed < total:
            overall_status = "incomplete"
        elif failed > 0:
            overall_status = "fail"
        else:
            overall_status = "pass"

        return total, completed, failed, overall_status

    @staticmethod
    def _apply_found_values_to_template(
        tmpl_item: Optional[CheckTemplateItem],
        *,
        serial_found: Optional[str] = None,
        lot_found: Optional[str] = None,
        expiration_found: Optional[date] = None,
    ) -> bool:
        """Write a swapped-in unit's identifiers back onto the template item.

        Serial and lot observations remain synchronized for existing behavior.
        Expiration observations are deliberately not applied here: only the
        validated inventory-lot swap flow may change the authoritative date.

        Returns True when the template actually changed.
        """
        if tmpl_item is None:
            return False
        serial_changed = serial_found and serial_found != (
            tmpl_item.serial_number or ""
        )
        lot_changed = lot_found and lot_found != (tmpl_item.lot_number or "")
        if not (serial_changed or lot_changed):
            return False

        if serial_found:
            tmpl_item.serial_number = serial_found
        if lot_found:
            tmpl_item.lot_number = lot_found
        return True

    async def _create_check_items(
        self,
        check_id: str,
        items_data: List[Dict[str, Any]],
        template_items_map: Dict[str, CheckTemplateItem],
        organization_id: str,
    ) -> List[ShiftEquipmentCheckItem]:
        """Create ORM check item records, updating template serials as needed."""
        created: List[ShiftEquipmentCheckItem] = []
        for item_data in items_data:
            tmpl_item_id = item_data.get("template_item_id")
            serial_found = item_data.get("serial_found")
            lot_found = item_data.get("lot_found")
            expiration_found = item_data.get("expiration_found")

            tmpl_item = template_items_map.get(tmpl_item_id) if tmpl_item_id else None
            updated_serial = self._apply_found_values_to_template(
                tmpl_item,
                serial_found=serial_found,
                lot_found=lot_found,
                expiration_found=expiration_found,
            )
            # A check is a recount. quantity_found is a crew standing at the
            # compartment counting, so it outranks whatever the running total
            # had drifted to, and it settles a shortfall report if the truck is
            # back to full.
            found_qty = item_data.get("quantity_found")
            if (
                tmpl_item is not None
                and found_qty is not None
                and self._target_quantity(tmpl_item) is not None
            ):
                counted = max(0, int(found_qty))
                # Where lots are aboard the total has to be reconciled against
                # them; writing the scalar alone would be discarded, since the
                # lot sum is what every reader uses.
                if self._deployed_lots(tmpl_item):
                    self._reconcile_to_total(tmpl_item, counted, organization_id)
                    tmpl_item.quantity_on_truck = self._on_truck(tmpl_item)
                else:
                    tmpl_item.quantity_on_truck = counted
                self._sync_restock_after_restocking(tmpl_item)

            check_item = ShiftEquipmentCheckItem(
                id=generate_uuid(),
                check_id=check_id,
                template_item_id=tmpl_item_id,
                compartment_name=item_data.get("compartment_name", ""),
                item_name=item_data.get("item_name", ""),
                check_type=item_data.get("check_type"),
                status=item_data.get("status", "not_checked"),
                quantity_found=item_data.get("quantity_found"),
                required_quantity=item_data.get("required_quantity"),
                critical_minimum_quantity=item_data.get("critical_minimum_quantity"),
                level_reading=item_data.get("level_reading"),
                level_unit=item_data.get("level_unit"),
                serial_number=item_data.get("serial_number"),
                lot_number=item_data.get("lot_number"),
                serial_found=serial_found,
                lot_found=lot_found,
                expiration_found=expiration_found,
                updated_serial=updated_serial,
                photo_urls=item_data.get("photo_urls"),
                is_expired=item_data.get("is_expired", False),
                expiration_date=item_data.get("expiration_date"),
                notes=item_data.get("notes"),
            )
            self.db.add(check_item)
            created.append(check_item)
        return created

    async def _update_apparatus_deficiency(
        self,
        apparatus_id: Optional[str],
        organization_id: str,
        overall_status: str,
    ) -> None:
        """Update the deficiency flag on an apparatus after a check."""
        if not apparatus_id:
            return
        # Scope to the caller's org: apparatus_id can be client-supplied
        # (standalone checks), and this mutates safety state (has_deficiency),
        # so a foreign id must never match.
        apparatus_result = await self.db.execute(
            select(Apparatus).where(
                Apparatus.id == apparatus_id,
                Apparatus.organization_id == organization_id,
            )
        )
        apparatus = apparatus_result.scalars().first()
        if not apparatus:
            return
        if overall_status == "fail":
            if not apparatus.has_deficiency:
                apparatus.has_deficiency = True
                apparatus.deficiency_since = datetime.now(timezone.utc)
        elif overall_status == "pass":
            apparatus.has_deficiency = False
            apparatus.deficiency_since = None

    async def _load_template_items_map(
        self,
        items_data: List[Dict[str, Any]],
        organization_id: str,
        template_id: str,
    ) -> Dict[str, CheckTemplateItem]:
        """Load CheckTemplateItem records referenced by the submitted items.

        Scoped to the caller's org via the compartment→template join:
        _create_check_items writes serial/lot numbers back onto these rows, so
        a foreign template_item_id must never resolve to a loaded record.
        """
        template_item_ids = [
            i.get("template_item_id") for i in items_data if i.get("template_item_id")
        ]
        template_items_map: Dict[str, CheckTemplateItem] = {}
        if template_item_ids:
            tmpl_result = await self.db.execute(
                select(CheckTemplateItem)
                .join(
                    CheckTemplateCompartment,
                    CheckTemplateItem.compartment_id == CheckTemplateCompartment.id,
                )
                .join(
                    EquipmentCheckTemplate,
                    CheckTemplateCompartment.template_id == EquipmentCheckTemplate.id,
                )
                .where(
                    CheckTemplateItem.id.in_(template_item_ids),
                    EquipmentCheckTemplate.organization_id == organization_id,
                    EquipmentCheckTemplate.id == template_id,
                )
            )
            for ti in tmpl_result.scalars().all():
                template_items_map[str(ti.id)] = ti
        return template_items_map

    # ------------------------------------------------------------------
    # Check Submission
    # ------------------------------------------------------------------

    async def submit_check(
        self,
        shift_id: str,
        organization_id: str,
        checked_by: str,
        data: Dict[str, Any],
        allow_manage: bool = False,
    ) -> ShiftEquipmentCheck:
        """Submit an equipment check for a shift."""
        result = await self.db.execute(
            select(Shift).where(
                Shift.id == shift_id,
                Shift.organization_id == organization_id,
            )
        )
        shift = result.scalars().first()
        if not shift:
            raise ValueError("Shift not found")

        # A submit grant permits members to perform checks, but does not grant
        # org-wide authority over every shift.  Limit ordinary submitters to
        # shifts they actively crew; the named shift officer and equipment
        # check managers have an explicit per-shift/org-wide override.
        assignment = None
        is_shift_officer = str(shift.shift_officer_id or "") == str(checked_by)
        if not allow_manage and not is_shift_officer:
            assignment_result = await self.db.execute(
                select(ShiftAssignment).where(
                    ShiftAssignment.shift_id == shift_id,
                    ShiftAssignment.organization_id == organization_id,
                    ShiftAssignment.user_id == checked_by,
                    ShiftAssignment.assignment_status.in_(
                        [AssignmentStatus.ASSIGNED, AssignmentStatus.CONFIRMED]
                    ),
                )
            )
            assignment = assignment_result.scalars().first()
            if not assignment:
                raise PermissionError("Not authorized to submit a check for this shift")

        items_data = data.pop("items", [])
        template_id = data.get("template_id")

        if not items_data:
            raise ValueError("At least one checklist item is required")

        if template_id:
            position = getattr(assignment, "position", None)
            if hasattr(position, "value"):
                position = position.value
            applicable_templates = await self._resolve_templates(
                shift,
                organization_id,
                None if allow_manage or is_shift_officer else position,
            )
            if str(template_id) not in {str(t.id) for t in applicable_templates}:
                raise ValueError("Template is not applicable to this shift")

        # Prevent duplicate submission for same shift+template
        if template_id:
            existing_result = await self.db.execute(
                select(ShiftEquipmentCheck).where(
                    ShiftEquipmentCheck.shift_id == shift_id,
                    ShiftEquipmentCheck.template_id == template_id,
                )
            )
            existing_check = existing_result.scalars().first()
            if existing_check:
                if existing_check.overall_status == "incomplete":
                    return await self.complete_incomplete_check(
                        check_id=existing_check.id,
                        organization_id=organization_id,
                        checked_by=checked_by,
                        data={
                            "items": items_data,
                            "notes": data.get("notes"),
                            "signature_data": data.get("signature_data"),
                        },
                    )
                raise ValueError(
                    "A check for this template has already "
                    "been submitted for this shift"
                )

        # Loaded before the status computation, not after: expiry is decided
        # from the template item (see _compute_check_status), so the map has to
        # exist before any item can be force-failed.
        template_items_map = await self._load_template_items_map(
            items_data, organization_id, template_id
        )
        total, completed, failed, overall_status = self._compute_check_status(
            items_data, template_items_map
        )

        # shifts.apparatus_id is polymorphic — it holds an apparatus.id for a
        # department on the full Apparatus module and a basic_apparatus.id for
        # one that only completed onboarding (see utils/apparatus_ref). This
        # column is a real FK to apparatus.id, so the raw shift value cannot be
        # copied across: for a BasicApparatus department it named no apparatus
        # row and every submission failed the constraint with a 500. Resolve it,
        # and store NULL when the department has no full apparatus record for
        # the vehicle — the column is nullable with SET NULL precisely because
        # a check need not be attributable to one.
        apparatus_ref = await resolve_apparatus_ref(
            self.db, shift.apparatus_id, organization_id
        )

        check = ShiftEquipmentCheck(
            id=generate_uuid(),
            organization_id=organization_id,
            shift_id=shift_id,
            template_id=template_id,
            apparatus_id=apparatus_ref.full_id,
            checked_by=checked_by,
            checked_at=datetime.now(timezone.utc),
            check_timing=data.get("check_timing", "start_of_shift"),
            overall_status=overall_status,
            total_items=total,
            completed_items=completed,
            failed_items=failed,
            notes=data.get("notes"),
            signature_data=data.get("signature_data"),
        )
        self.db.add(check)

        # Validate submitted items belong to the template
        submitted_ids = {
            i.get("template_item_id") for i in items_data if i.get("template_item_id")
        }
        if template_id and submitted_ids:
            valid_result = await self.db.execute(
                select(CheckTemplateItem.id)
                .join(CheckTemplateCompartment)
                .where(CheckTemplateCompartment.template_id == template_id)
            )
            valid_ids = {str(r) for r in valid_result.scalars().all()}
            invalid = submitted_ids - valid_ids
            if invalid:
                raise ValueError(
                    f"Items do not belong to template: " f"{', '.join(invalid)}"
                )

        await self._create_check_items(
            check.id, items_data, template_items_map, organization_id
        )

        await self._update_apparatus_deficiency(
            shift.apparatus_id, organization_id, overall_status
        )

        # Collect failed item details for notifications
        critical_items: List[Dict[str, Any]] = []
        warning_items: List[Dict[str, Any]] = []
        for item_data in items_data:
            if item_data.get("status") != "fail":
                continue
            detail = {
                "name": item_data.get("item_name", "Unknown"),
                "compartment": item_data.get("compartment_name", ""),
                "check_type": item_data.get("check_type"),
            }
            found = item_data.get("quantity_found")
            expected = item_data.get("required_quantity")
            crit = item_data.get("critical_minimum_quantity")
            if found is not None and expected is not None:
                detail["expected"] = expected
                detail["found"] = found
            if crit is not None and found is not None and found <= crit:
                detail["critical_minimum"] = crit
                critical_items.append(detail)
            else:
                warning_items.append(detail)

        # Send failure notifications
        if overall_status == "fail":
            await self._send_check_failure_notification(
                organization_id=organization_id,
                shift=shift,
                checked_by=checked_by,
                template_id=template_id,
                failed_count=failed,
                total_count=total,
                critical_items=critical_items,
                warning_items=warning_items,
            )

        try:
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            raise
        return await self.get_check(check.id, organization_id)

    async def submit_standalone_check(
        self,
        organization_id: str,
        checked_by: str,
        data: Dict[str, Any],
    ) -> ShiftEquipmentCheck:
        """Submit a standalone equipment check not tied to a shift."""
        template_id = data.get("template_id")
        if not template_id:
            raise ValueError("template_id is required")

        result = await self.db.execute(
            select(EquipmentCheckTemplate).where(
                EquipmentCheckTemplate.id == template_id,
                EquipmentCheckTemplate.organization_id == organization_id,
            )
        )
        template = result.scalars().first()
        if not template:
            raise ValueError("Template not found")

        apparatus_id = data.get("apparatus_id") or template.apparatus_id
        # A client-supplied apparatus_id must belong to the caller's org — the
        # template's own apparatus_id is already org-scoped.
        if data.get("apparatus_id"):
            appt_result = await self.db.execute(
                select(Apparatus.id).where(
                    Apparatus.id == apparatus_id,
                    Apparatus.organization_id == organization_id,
                )
            )
            if appt_result.scalar_one_or_none() is None:
                raise ValueError("Apparatus not found")

        items_data = data.pop("items", [])

        if not items_data:
            raise ValueError("At least one checklist item is required")

        # See submit_check: the template map decides expiry, so it is loaded
        # before the status computation rather than just before the write.
        template_items_map = await self._load_template_items_map(
            items_data, organization_id, template_id
        )
        submitted_ids = {item["template_item_id"] for item in items_data}
        invalid = submitted_ids - template_items_map.keys()
        if invalid:
            raise ValueError(f"Items do not belong to template: {', '.join(invalid)}")
        total, completed, failed, overall_status = self._compute_check_status(
            items_data, template_items_map
        )

        check = ShiftEquipmentCheck(
            id=generate_uuid(),
            organization_id=organization_id,
            shift_id=None,
            template_id=template_id,
            apparatus_id=apparatus_id,
            checked_by=checked_by,
            checked_at=datetime.now(timezone.utc),
            check_timing=data.get("check_timing", "start_of_shift"),
            check_context="standalone",
            overall_status=overall_status,
            total_items=total,
            completed_items=completed,
            failed_items=failed,
            notes=data.get("notes"),
            signature_data=data.get("signature_data"),
        )
        self.db.add(check)
        await self.db.flush()

        await self._create_check_items(
            check.id, items_data, template_items_map, organization_id
        )

        await self._update_apparatus_deficiency(
            apparatus_id, organization_id, overall_status
        )

        try:
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            raise
        return await self.get_check(check.id, organization_id)

    async def complete_incomplete_check(
        self,
        check_id: str,
        organization_id: str,
        checked_by: str,
        data: Dict[str, Any],
        allow_any: bool = False,
    ) -> ShiftEquipmentCheck:
        """Complete remaining items on an incomplete check.

        Only the member who originally performed the check may complete it,
        unless ``allow_any`` is set (caller holds equipment_check.manage). This
        prevents an IDOR where any member could overwrite another member's
        safety-critical equipment check by supplying its id.
        """
        result = await self.db.execute(
            select(ShiftEquipmentCheck)
            .where(
                ShiftEquipmentCheck.id == check_id,
                ShiftEquipmentCheck.organization_id == organization_id,
            )
            .options(selectinload(ShiftEquipmentCheck.items))
        )
        check = result.scalars().first()
        # Treat "not yours" the same as "not found" so check ids can't be
        # enumerated by an unauthorized caller.
        if not check or (not allow_any and str(check.checked_by) != str(checked_by)):
            raise ValueError("Check not found")
        if check.overall_status != "incomplete":
            raise ValueError("Only incomplete checks can be updated")

        items_data = data.get("items", [])
        if not items_data:
            raise ValueError("At least one item is required")

        existing_map: Dict[str, ShiftEquipmentCheckItem] = {
            item.template_item_id: item for item in check.items if item.template_item_id
        }

        # A replacement logged while finishing an incomplete check has to reach
        # the template too — otherwise which write path the crew happened to
        # take decides whether the truck's record gets updated.
        template_items_map = await self._load_template_items_map(
            items_data, organization_id, check.template_id
        )
        today = date.today()

        for item_data in items_data:
            tmpl_id = item_data.get("template_item_id")
            existing = existing_map.get(tmpl_id) if tmpl_id else None
            if existing:
                new_status = item_data.get("status", "not_checked")
                if existing.status == "not_checked" or new_status != "not_checked":
                    existing.status = new_status
                existing.quantity_found = item_data.get(
                    "quantity_found", existing.quantity_found
                )
                existing.level_reading = item_data.get(
                    "level_reading", existing.level_reading
                )
                existing.notes = item_data.get("notes", existing.notes)
                existing.serial_found = item_data.get(
                    "serial_found", existing.serial_found
                )
                existing.lot_found = item_data.get("lot_found", existing.lot_found)
                existing.expiration_found = (
                    item_data.get("expiration_found") or existing.expiration_found
                )

                tmpl_item = template_items_map.get(tmpl_id or "")
                if self._apply_found_values_to_template(
                    tmpl_item,
                    serial_found=existing.serial_found,
                    lot_found=existing.lot_found,
                    expiration_found=existing.expiration_found,
                ):
                    existing.updated_serial = True

                expiration = self._resolve_expiration(
                    {
                        "expiration_found": existing.expiration_found,
                        "expiration_date": existing.expiration_date,
                    },
                    tmpl_item,
                )
                existing.expiration_date = expiration
                existing.is_expired = bool(expiration and expiration < today)

        all_items = check.items
        # Re-apply the same auto-fail rule the initial submit uses
        # (_compute_check_status): an expired item, or one found below its
        # required quantity, is forced to "fail" so completing an incomplete
        # check can't leave a safety-critical shortfall marked as passing and
        # under-count failed_items/overall_status (EC-10). Keeps the two write
        # paths consistent.
        for item in all_items:
            if item.is_expired:
                item.status = "fail"
            # An item answered "not on truck" has no count to be short of; see
            # _compute_check_status, which this mirrors.
            if item.status == "not_applicable":
                continue
            req_qty = item.required_quantity
            found_qty = item.quantity_found
            if req_qty is not None and found_qty is not None and found_qty < req_qty:
                item.status = "fail"

        total = len(all_items)
        completed = sum(1 for i in all_items if i.status != "not_checked")
        failed = sum(1 for i in all_items if i.status in ("fail", "out_of_service"))

        if completed < total:
            check.overall_status = "incomplete"
        elif failed > 0:
            check.overall_status = "fail"
        else:
            check.overall_status = "pass"

        check.completed_items = completed
        check.failed_items = failed

        if data.get("notes"):
            check.notes = data["notes"]
        if data.get("signature_data"):
            check.signature_data = data["signature_data"]

        await self.db.commit()
        return await self.get_check(check.id, organization_id)

    async def get_checks_for_shift(
        self,
        shift_id: str,
        organization_id: str,
        check_timing: Optional[str] = None,
    ) -> List[ShiftEquipmentCheck]:
        """Get all completed checks for a shift."""
        query = (
            select(ShiftEquipmentCheck)
            .where(
                ShiftEquipmentCheck.shift_id == shift_id,
                ShiftEquipmentCheck.organization_id == organization_id,
            )
            .options(selectinload(ShiftEquipmentCheck.items))
            .order_by(ShiftEquipmentCheck.checked_at.desc())
        )

        if check_timing:
            query = query.where(ShiftEquipmentCheck.check_timing == check_timing)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_check(
        self, check_id: str, organization_id: str
    ) -> Optional[ShiftEquipmentCheck]:
        """Get a single completed check with items."""
        result = await self.db.execute(
            select(ShiftEquipmentCheck)
            .where(
                ShiftEquipmentCheck.id == check_id,
                ShiftEquipmentCheck.organization_id == organization_id,
            )
            .options(selectinload(ShiftEquipmentCheck.items))
        )
        return result.scalars().first()

    # ------------------------------------------------------------------
    # My Checklists (Member Page)
    # ------------------------------------------------------------------

    async def get_my_checklists(
        self,
        user_id: str,
        organization_id: str,
    ) -> List[Dict[str, Any]]:
        """Get pending + recently completed checklists for a user."""
        # Get user's active shift assignments with shift data
        result = await self.db.execute(
            select(ShiftAssignment, Shift)
            .join(Shift, Shift.id == ShiftAssignment.shift_id)
            .where(
                ShiftAssignment.user_id == user_id,
                Shift.organization_id == organization_id,
                Shift.shift_date >= date.today(),
            )
            .order_by(Shift.shift_date)
        )
        rows = list(result.all())

        # Collect apparatus IDs for name lookup. Resolved across both apparatus
        # tables and org-scoped: shifts carry whichever id the shift form was
        # served, so a single-table lookup left every BasicApparatus department
        # with blank apparatus names here.
        apparatus_map = await resolve_apparatus_labels(
            self.db,
            {row[1].apparatus_id for row in rows if row[1].apparatus_id},
            organization_id,
        )

        # Batch-load existing checks for all of the user's shifts at once, then
        # resolve each shift from the already-loaded shift/assignment objects —
        # avoids re-fetching the shift, assignment, and checks per shift.
        shift_ids = [assignment.shift_id for assignment, _ in rows]
        checks_by_shift: Dict[str, Dict[str, ShiftEquipmentCheck]] = {}
        if shift_ids:
            checks_result = await self.db.execute(
                select(ShiftEquipmentCheck).where(
                    ShiftEquipmentCheck.shift_id.in_(shift_ids),
                    ShiftEquipmentCheck.organization_id == organization_id,
                )
            )
            for c in checks_result.scalars().all():
                checks_by_shift.setdefault(str(c.shift_id), {})[c.template_id] = c

        checklists = []
        for assignment, shift in rows:
            shift_checklists = await self._checklists_for_shift(
                shift,
                organization_id,
                assignment.position,
                existing_checks=checks_by_shift.get(str(assignment.shift_id), {}),
            )
            apparatus_name = apparatus_map.get(shift.apparatus_id or "", "")
            for cl in shift_checklists:
                cl["shift_id"] = assignment.shift_id
                cl["shift_date"] = shift.shift_date
                cl["apparatus_name"] = apparatus_name
                checklists.append(cl)

        return checklists

    async def get_my_checklist_history(
        self,
        user_id: str,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[ShiftEquipmentCheck]:
        """Get completed check history for a user."""
        query = (
            select(ShiftEquipmentCheck)
            .where(
                ShiftEquipmentCheck.checked_by == user_id,
                ShiftEquipmentCheck.organization_id == organization_id,
            )
            .options(selectinload(ShiftEquipmentCheck.items))
            .order_by(ShiftEquipmentCheck.checked_at.desc())
            .limit(limit)
            .offset(offset)
        )

        if start_date:
            query = query.where(
                ShiftEquipmentCheck.checked_at
                >= datetime.combine(start_date, datetime.min.time()).replace(
                    tzinfo=timezone.utc
                )
            )
        if end_date:
            query = query.where(
                ShiftEquipmentCheck.checked_at
                <= datetime.combine(end_date, datetime.max.time()).replace(
                    tzinfo=timezone.utc
                )
            )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # Last Check Results (for pre-populating new checks)
    # ------------------------------------------------------------------

    async def get_last_check_results(
        self,
        template_id: str,
        organization_id: str,
        apparatus_id: Optional[str] = None,
    ) -> Dict[str, Dict[str, Any]]:
        """Return item results from the most recent completed check for a
        given template and (optionally) apparatus.  The response is keyed by
        ``template_item_id`` so the frontend can map values back onto the
        current template items."""

        filters = [
            ShiftEquipmentCheck.template_id == template_id,
            ShiftEquipmentCheck.organization_id == organization_id,
            ShiftEquipmentCheck.overall_status.in_(["pass", "fail"]),
        ]
        if apparatus_id:
            filters.append(ShiftEquipmentCheck.apparatus_id == apparatus_id)

        latest_check = (
            await self.db.execute(
                select(ShiftEquipmentCheck)
                .where(*filters)
                .order_by(ShiftEquipmentCheck.checked_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

        if not latest_check:
            return {}

        items_result = await self.db.execute(
            select(ShiftEquipmentCheckItem).where(
                ShiftEquipmentCheckItem.check_id == latest_check.id,
            )
        )

        results: Dict[str, Dict[str, Any]] = {}
        for item in items_result.scalars().all():
            if not item.template_item_id:
                continue
            results[item.template_item_id] = {
                "status": item.status,
                "quantity_found": item.quantity_found,
                "level_reading": item.level_reading,
                "serial_number": item.serial_number,
                "lot_number": item.lot_number,
                # Prefilled so a crew reading a date off the unit sees what the
                # last crew recorded and only has to correct a mismatch.
                "expiration_date": item.expiration_date,
                "notes": item.notes,
            }

        return results

    # ------------------------------------------------------------------
    # Item History
    # ------------------------------------------------------------------

    async def get_item_check_history(
        self,
        template_item_id: str,
        organization_id: str,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """Get check history for a specific template item."""
        result = await self.db.execute(
            select(ShiftEquipmentCheckItem)
            .join(
                ShiftEquipmentCheck,
                ShiftEquipmentCheck.id == ShiftEquipmentCheckItem.check_id,
            )
            .where(
                ShiftEquipmentCheckItem.template_item_id == template_item_id,
                ShiftEquipmentCheck.organization_id == organization_id,
            )
            .order_by(ShiftEquipmentCheckItem.created_at.desc())
            .limit(limit)
        )
        items = list(result.scalars().all())

        # Enrich with checker names and shift dates
        check_ids = [i.check_id for i in items]
        if not check_ids:
            return []

        result = await self.db.execute(
            select(ShiftEquipmentCheck).where(ShiftEquipmentCheck.id.in_(check_ids))
        )
        checks = {c.id: c for c in result.scalars().all()}

        user_ids = [c.checked_by for c in checks.values() if c.checked_by]
        user_map = await self._get_user_name_map(user_ids)

        # Get shift dates
        shift_ids = [c.shift_id for c in checks.values()]
        result = await self.db.execute(select(Shift).where(Shift.id.in_(shift_ids)))
        shift_map = {s.id: s for s in result.scalars().all()}

        history = []
        for item in items:
            check = checks.get(item.check_id)
            shift = shift_map.get(check.shift_id) if check else None
            history.append(
                {
                    "check_id": item.check_id,
                    "shift_id": (check.shift_id if check else None),
                    "shift_date": (shift.shift_date if shift else None),
                    "status": item.status,
                    "quantity_found": item.quantity_found,
                    "level_reading": item.level_reading,
                    "serial_number": item.serial_number,
                    "lot_number": item.lot_number,
                    "is_expired": item.is_expired,
                    "notes": item.notes,
                    "checked_by_name": (
                        user_map.get(check.checked_by, "")
                        if check and check.checked_by
                        else None
                    ),
                    "checked_at": (check.checked_at if check else None),
                }
            )

        return history

    # ------------------------------------------------------------------
    # Expiration Handling
    # ------------------------------------------------------------------

    async def get_supply_overview(
        self, organization_id: str, days_ahead: int = 30
    ) -> Dict[str, Any]:
        """Supply-officer view: checklist items expiring soon on apparatus,
        joined with the ready replacement stock available to swap in."""
        today = date.today()
        cutoff = today + timedelta(days=days_ahead)

        result = await self.db.execute(
            select(
                CheckTemplateItem,
                CheckTemplateCompartment,
                EquipmentCheckTemplate,
            )
            .join(
                CheckTemplateCompartment,
                CheckTemplateCompartment.id == CheckTemplateItem.compartment_id,
            )
            .join(
                EquipmentCheckTemplate,
                EquipmentCheckTemplate.id == CheckTemplateCompartment.template_id,
            )
            .where(
                EquipmentCheckTemplate.organization_id == organization_id,
                # Two ways onto this worklist. A date the officer can see
                # coming, and a crew's report that something was used or pulled
                # — the second has no expiration to sort by and would otherwise
                # sit unseen until someone ran a check.
                or_(
                    and_(
                        CheckTemplateItem.has_expiration.is_(True),
                        CheckTemplateItem.expiration_date.isnot(None),
                        CheckTemplateItem.expiration_date <= cutoff,
                    ),
                    # The rows display the soonest date *aboard*, so the filter
                    # has to see it too. An item whose column reads next year
                    # while it carries a lot expiring this week belongs on this
                    # list, and matching only the column would hide exactly the
                    # case the deployed-lot table was added for.
                    CheckTemplateItem.id.in_(
                        select(CheckItemDeployedLot.template_item_id).where(
                            CheckItemDeployedLot.organization_id == organization_id,
                            CheckItemDeployedLot.quantity > 0,
                            CheckItemDeployedLot.expiration_date.isnot(None),
                            CheckItemDeployedLot.expiration_date <= cutoff,
                        )
                    ),
                    CheckTemplateItem.restock_needed.is_(True),
                    # A counted position below its target belongs here whether
                    # or not anyone filed a report — a check that recorded two
                    # of four is the same shortfall as a crew reporting it.
                    and_(
                        CheckTemplateItem.quantity_on_truck.isnot(None),
                        CheckTemplateItem.quantity_on_truck
                        < func.coalesce(
                            CheckTemplateItem.required_quantity,
                            CheckTemplateItem.expected_quantity,
                            0,
                        ),
                    ),
                ),
            )
            .order_by(CheckTemplateItem.expiration_date.asc())
        )
        rows = result.all()

        apparatus_ids = {t.apparatus_id for (_, _, t) in rows if t.apparatus_id}
        apparatus_names: Dict[str, str] = {}
        if apparatus_ids:
            ares = await self.db.execute(
                select(Apparatus.id, Apparatus.name).where(
                    Apparatus.id.in_(apparatus_ids),
                    Apparatus.organization_id == organization_id,
                )
            )
            apparatus_names = {aid: name for aid, name in ares.all()}

        inv_ids = [i.inventory_item_id for (i, _, _) in rows if i.inventory_item_id]
        inventory_service = InventoryService(self.db)
        lots_by_item = await inventory_service.get_lots_for_items(
            organization_id, inv_ids
        )
        item_names: Dict[str, str] = {}
        if inv_ids:
            # EC2-4: org-scope this name lookup (the adjacent apparatus_names query
            # already does). inventory_item_id is a client-supplied FK stored raw by
            # add_item/update_item; without this filter a checklist item pointing at
            # a foreign org's inventory item would render that item's NAME into the
            # checklist response (a cross-tenant read leak). A foreign id now resolves
            # to no name.
            nres = await self.db.execute(
                select(InventoryItem.id, InventoryItem.name).where(
                    InventoryItem.id.in_(inv_ids),
                    InventoryItem.organization_id == organization_id,
                )
            )
            item_names = {iid: name for iid, name in nres.all()}

        items: List[Dict[str, Any]] = []
        for item, comp, tmpl in rows:
            exp = self._soonest_expiration(item)
            lots = lots_by_item.get(item.inventory_item_id or "", [])
            items.append(
                {
                    "template_item_id": item.id,
                    "item_name": item.name,
                    "compartment_name": comp.name,
                    "template_id": tmpl.id,
                    "template_name": tmpl.name,
                    "apparatus_id": tmpl.apparatus_id,
                    "apparatus_name": (
                        apparatus_names.get(tmpl.apparatus_id)
                        if tmpl.apparatus_id
                        else None
                    ),
                    "lot_number": self._soonest_lot_number(item),
                    "expiration_date": exp,
                    "days_until_expiration": (exp - today).days if exp else None,
                    "is_expired": bool(exp and exp < today),
                    "restock_needed": bool(item.restock_needed),
                    "restock_note": item.restock_note,
                    "restock_reported_at": item.restock_reported_at,
                    "quantity_on_truck": self._on_truck(item),
                    "target_quantity": self._target_quantity(item),
                    "is_short": self._is_short(item),
                    "inventory_item_id": item.inventory_item_id,
                    "inventory_item_name": (
                        item_names.get(item.inventory_item_id)
                        if item.inventory_item_id
                        else None
                    ),
                    # Stock that has itself expired on the shelf is not ready
                    # stock: swapping it in would fail the item on the next
                    # check. It stays in ready_lots (so the officer can see and
                    # pull it) but must not mask a restock need.
                    "ready_stock": sum(
                        lot.quantity
                        for lot in lots
                        if not (lot.expiration_date and lot.expiration_date < today)
                    ),
                    "ready_lots": [
                        {
                            "id": lot.id,
                            "lot_number": lot.lot_number,
                            "expiration_date": lot.expiration_date,
                            "quantity": lot.quantity,
                            "is_expired": bool(
                                lot.expiration_date and lot.expiration_date < today
                            ),
                        }
                        for lot in lots
                    ],
                }
            )

        return {"days_ahead": days_ahead, "total": len(items), "items": items}

    async def get_apparatus_inventory(
        self, apparatus_id: str, organization_id: str
    ) -> Dict[str, Any]:
        """What a given apparatus is carrying right now, compartment by
        compartment, with the ready stock behind each tracked item.

        Deliberately not a check. A check is a scheduled, signed, whole-truck
        pass that produces a report; this is the standing view a member opens
        at any hour to say "we used the last of these" or to put a fresh unit
        in a bracket. Forcing that through a check submission is what left
        mid-shift consumption unrecorded until the next morning.
        """
        today = date.today()

        apparatus = await self.db.scalar(
            select(Apparatus).where(
                Apparatus.id == apparatus_id,
                Apparatus.organization_id == organization_id,
            )
        )
        if apparatus is None:
            return {}

        result = await self.db.execute(
            select(
                CheckTemplateItem,
                CheckTemplateCompartment,
                EquipmentCheckTemplate,
            )
            .join(
                CheckTemplateCompartment,
                CheckTemplateCompartment.id == CheckTemplateItem.compartment_id,
            )
            .join(
                EquipmentCheckTemplate,
                EquipmentCheckTemplate.id == CheckTemplateCompartment.template_id,
            )
            .where(
                EquipmentCheckTemplate.organization_id == organization_id,
                EquipmentCheckTemplate.apparatus_id == apparatus_id,
            )
            .order_by(
                CheckTemplateCompartment.sort_order.asc(),
                CheckTemplateItem.sort_order.asc(),
            )
        )
        rows = result.all()

        inv_ids = [i.inventory_item_id for (i, _, _) in rows if i.inventory_item_id]
        inventory_service = InventoryService(self.db)
        lots_by_item = await inventory_service.get_lots_for_items(
            organization_id, inv_ids
        )
        reporter_names = await self._get_user_name_map(
            [i.restock_reported_by for (i, _, _) in rows if i.restock_reported_by]
        )
        await self._attach_unit_labels(organization_id, [i for (i, _, _) in rows])

        compartments: List[Dict[str, Any]] = []
        by_compartment: Dict[str, Dict[str, Any]] = {}
        for item, compartment, _tmpl in rows:
            # Headers and free-text lines are checklist scaffolding, not things
            # anyone stocks; they would be dead rows in a supply view.
            if item.check_type in ("header", "text"):
                continue
            entry = by_compartment.get(compartment.id)
            if entry is None:
                entry = {
                    "compartment_id": compartment.id,
                    "compartment_name": compartment.name,
                    "items": [],
                }
                by_compartment[compartment.id] = entry
                compartments.append(entry)

            exp = self._soonest_expiration(item)
            lots = lots_by_item.get(item.inventory_item_id or "", [])
            in_date = [
                lot
                for lot in lots
                if not (lot.expiration_date and lot.expiration_date < today)
            ]
            entry["items"].append(
                {
                    "template_item_id": item.id,
                    "item_name": item.name,
                    "check_type": item.check_type,
                    "target_quantity": self._target_quantity(item),
                    "quantity_on_truck": self._on_truck(item),
                    "is_short": self._is_short(item),
                    "unit_of_measure": getattr(item, "unit_of_measure", None),
                    "deployed_lots": self._deployed_lot_payload(item),
                    "serial_number": item.serial_number,
                    "lot_number": self._soonest_lot_number(item),
                    "expiration_date": exp,
                    "days_until_expiration": (exp - today).days if exp else None,
                    "is_expired": bool(exp and exp < today),
                    "restock_needed": bool(item.restock_needed),
                    "restock_note": item.restock_note,
                    "restock_reported_at": item.restock_reported_at,
                    "restock_reported_by_name": (
                        reporter_names.get(str(item.restock_reported_by))
                        if item.restock_reported_by
                        else None
                    ),
                    "inventory_item_id": item.inventory_item_id,
                    "ready_stock": sum(lot.quantity for lot in in_date),
                    "ready_lots": [
                        {
                            "id": lot.id,
                            "lot_number": lot.lot_number,
                            "expiration_date": lot.expiration_date,
                            "quantity": lot.quantity,
                            "is_expired": False,
                        }
                        for lot in in_date
                    ],
                }
            )

        return {
            "apparatus_id": apparatus.id,
            "apparatus_name": apparatus.name,
            "compartments": compartments,
        }

    @staticmethod
    def _target_quantity(item: CheckTemplateItem) -> Optional[int]:
        """How many this position should hold, or None if it is not counted.

        ``required_quantity`` is the state-mandated floor and outranks the
        department's own ``expected_quantity`` where both are set — being short
        of the legal minimum is the fact that matters.
        """
        return item.required_quantity or item.expected_quantity

    @staticmethod
    def _deployed_lots(item: CheckTemplateItem) -> List[CheckItemDeployedLot]:
        """Lots aboard for this position, soonest to expire first.

        Sorting is first-expiring-first-out, which is both the order a crew
        should draw from and the order consumption is applied in. Lots with no
        date sort last: an undated unit is never the one that needs using up.
        """
        lots = getattr(item, "deployed_lots", None) or []
        return sorted(
            [lot for lot in lots if lot.quantity > 0],
            key=lambda lot: (lot.expiration_date is None, lot.expiration_date),
        )

    @classmethod
    def _soonest_dated_lot(cls, item: CheckTemplateItem):
        """The first lot aboard that carries a date, or None."""
        for lot in cls._deployed_lots(item):
            if lot.expiration_date:
                return lot
        return None

    @classmethod
    def _soonest_expiration(cls, item: CheckTemplateItem):
        """The earliest date aboard — the one that actually puts a truck out.

        Falls back to the item's own column for a position with no deployed
        lots recorded, which is every position a department has not yet
        restocked through the lot flow.
        """
        lot = cls._soonest_dated_lot(item)
        if lot is not None:
            return lot.expiration_date
        return item.expiration_date if item.has_expiration else None

    @classmethod
    def _soonest_lot_number(cls, item: CheckTemplateItem) -> Optional[str]:
        """The lot number belonging to the date this position reports.

        ``item.lot_number`` is the scalar left over from the last swap, and on
        a position carrying more than one lot it names a *different* lot from
        the one ``_soonest_expiration`` reports. Rendered side by side that
        reads as a single fact — "lot NLX-2411 expires 9/4" — about a lot that
        expires six months later. The number has to come from the same row as
        the date or it should not be shown at all.
        """
        lot = cls._soonest_dated_lot(item)
        if lot is not None:
            return lot.lot_number
        return item.lot_number

    @classmethod
    def _on_truck(cls, item: CheckTemplateItem) -> Optional[int]:
        """The live count, falling back to what the item was stocked with.

        Deployed lots outrank the scalar where they exist: they are a count of
        actual units with actual dates, and keeping the scalar as the authority
        would let the two disagree.

        A NULL ``quantity_on_truck`` with no lots means nobody has counted since
        the item was defined, not that the bracket is empty; the template's
        target is the best available answer until a crew contradicts it.
        """
        lots = cls._deployed_lots(item)
        if lots:
            return sum(lot.quantity for lot in lots)
        if item.quantity_on_truck is not None:
            return item.quantity_on_truck
        return cls._target_quantity(item)

    @classmethod
    def _is_short(cls, item: CheckTemplateItem) -> bool:
        """True when a counted position holds less than it should."""
        target = cls._target_quantity(item)
        on_truck = cls._on_truck(item)
        if target is None or on_truck is None:
            return False
        return on_truck < target

    @classmethod
    def _materialize_untracked_units(
        cls, item: CheckTemplateItem, organization_id: str
    ) -> None:
        """Give the units already aboard a row before the first lot joins them.

        A position counted as 3 with no lot rows, restocked with 1 fresh unit,
        would otherwise read as 1 aboard — the lot sum becomes the authority
        the moment any lot exists, and the three units nobody had recorded a lot
        for would vanish. They are recorded with the item's existing lot number
        and date, which is all that was ever known about them.
        """
        # The raw collection, not the in-stock view: the question is whether
        # this position has ever had a lot recorded, and a row sitting at zero
        # still means yes. Asking the filtered view would add a second row
        # describing the same units.
        if item.deployed_lots:
            return
        existing_count = cls._on_truck(item)
        if not existing_count or existing_count < 1:
            return
        item.deployed_lots.append(
            CheckItemDeployedLot(
                id=generate_uuid(),
                organization_id=organization_id,
                template_item_id=item.id,
                lot_number=item.lot_number,
                expiration_date=(item.expiration_date if item.has_expiration else None),
                quantity=existing_count,
            )
        )

    @classmethod
    def _reconcile_to_total(
        cls, item: CheckTemplateItem, total: int, organization_id: str
    ) -> None:
        """Make the lots aboard add up to a counted total.

        A recount gives one number for a position that may hold several lots,
        so the difference has to be placed somewhere. Writing it to
        ``quantity_on_truck`` alone would be silently discarded: once lots
        exist their sum is what every reader uses.

        Fewer than recorded means units left, and they come off soonest-first
        like any other consumption. More than recorded means the record was
        incomplete; the surplus goes to an undated row, because the honest
        answer to "when do these expire" is that nobody knows — and an undated
        row neither flatters the position's soonest-date reading nor gets
        drawn from before the dated stock.
        """
        current = cls._on_truck(item) or 0
        if total == current:
            return
        if total < current:
            cls._consume_deployed(item, current - total)
            return
        item.deployed_lots.append(
            CheckItemDeployedLot(
                id=generate_uuid(),
                organization_id=organization_id,
                template_item_id=item.id,
                lot_number=None,
                expiration_date=None,
                quantity=total - current,
            )
        )

    @classmethod
    def _consume_deployed(cls, item: CheckTemplateItem, quantity: int) -> int:
        """Draw units off the deployed lots, soonest to expire first.

        First-expiring-first-out is the order a crew should be pulling from
        anyway, and it is the only order that keeps a truck's remaining stock
        as fresh as possible. Returns how many were actually drawn, which is
        less than asked when the record held fewer than the crew used — that
        is a correction to the record, not a negative quantity.
        """
        remaining = quantity
        emptied = []
        # _deployed_lots returns a fresh sorted list, so removing from the
        # collection below does not disturb this iteration.
        for lot in cls._deployed_lots(item):
            if remaining <= 0:
                break
            take = min(lot.quantity, remaining)
            lot.quantity -= take
            remaining -= take
            if lot.quantity == 0:
                emptied.append(lot)
        # A lot drawn down to nothing is no longer aboard. Leaving the row
        # would accumulate dead records against every position a truck ever
        # restocked, and keep a spent lot's foreign key alive for no reader.
        for lot in emptied:
            item.deployed_lots.remove(lot)
        return quantity - remaining

    @classmethod
    def _sync_restock_after_restocking(cls, item: CheckTemplateItem) -> None:
        """Settle the restock report if the shortfall it described is gone.

        A partial restock leaves the report standing: two of the four back on
        the truck is still a truck that is short two, and clearing the flag
        there would drop it off the worklist with the gap still open.
        """
        if not cls._is_short(item):
            cls._clear_restock(item)

    async def report_item_used(
        self,
        template_item_id: str,
        organization_id: str,
        user: User,
        note: Optional[str] = None,
        quantity_used: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """Record consumption against a checklist item, from whoever used it.

        Raised at the moment of use rather than discovered at the next check.
        For a counted position the on-truck figure comes down by the number
        used, so the worklist can say how short the truck is rather than only
        that something is needed. The count floors at zero: a crew reporting
        more than the record thought was there is telling you the record was
        wrong, and a negative count is not a fact about any truck.
        """
        item, template_id = await self._get_item_with_template(
            template_item_id, organization_id
        )
        if item is None:
            return None

        before = self._on_truck(item)
        if quantity_used:
            if self._deployed_lots(item):
                self._consume_deployed(item, quantity_used)
                # Where lots exist their sum is the authority; the scalar is a
                # cached mirror of it.
                if self._target_quantity(item) is not None:
                    item.quantity_on_truck = self._on_truck(item)
            elif self._target_quantity(item) is not None:
                item.quantity_on_truck = max(0, (before or 0) - quantity_used)

        item.restock_needed = True
        item.restock_reported_at = datetime.now(timezone.utc)
        item.restock_reported_by = str(user.id)
        item.restock_note = (note or "").strip() or None

        await self._log_item_action(
            template_id,
            organization_id,
            item,
            user,
            action="restock_needed",
            changes={
                "note": item.restock_note,
                "quantity_used": quantity_used,
                "quantity_on_truck": item.quantity_on_truck,
            },
        )
        await self.db.commit()
        return self._restock_state(item)

    def _deployed_lot_payload(self, item: CheckTemplateItem) -> List[Dict[str, Any]]:
        """Each lot aboard, in the order a crew should draw from it."""
        return [
            {
                "id": lot.id,
                "lot_number": lot.lot_number,
                "expiration_date": lot.expiration_date,
                "quantity": lot.quantity,
                "is_expired": bool(
                    lot.expiration_date and lot.expiration_date < date.today()
                ),
            }
            for lot in self._deployed_lots(item)
        ]

    async def get_item_deployed_lots(
        self, template_item_id: str, organization_id: str
    ) -> Optional[Dict[str, Any]]:
        """The lots aboard for one position, with the position's totals."""
        item, _ = await self._get_item_with_template(template_item_id, organization_id)
        if item is None:
            return None
        return {
            "template_item_id": item.id,
            "item_name": item.name,
            "target_quantity": self._target_quantity(item),
            "quantity_on_truck": self._on_truck(item),
            "is_short": self._is_short(item),
            "unit_of_measure": getattr(item, "unit_of_measure", None),
            "lots": self._deployed_lot_payload(item),
        }

    async def update_deployed_lot(
        self,
        template_item_id: str,
        deployed_lot_id: str,
        organization_id: str,
        user: User,
        updates: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """Correct one lot aboard so the record matches what is in the bag.

        Quantity, lot number and date together, because they are one act: a
        crew changing a drug out is reading a new box and telling the
        application what it says. Recording the count without the date would
        leave the application asserting an expiration for a unit that is no
        longer there.

        Zero quantity removes the lot. A lot counted down to nothing is not a
        lot the truck carries, and an empty row would keep contributing its
        date to the position's soonest-expiry reading forever.
        """
        quantity = updates.get("quantity")
        if quantity is None or quantity < 0:
            raise ValueError("Quantity cannot be negative")

        item, template_id = await self._get_item_with_template(
            template_item_id, organization_id
        )
        if item is None:
            return None

        target = next(
            (lot for lot in (item.deployed_lots or []) if lot.id == deployed_lot_id),
            None,
        )
        if target is None:
            return None

        before = {
            "quantity": target.quantity,
            "lot_number": target.lot_number,
            "expiration_date": (
                target.expiration_date.isoformat() if target.expiration_date else None
            ),
        }

        if quantity == 0:
            item.deployed_lots.remove(target)
        else:
            target.quantity = quantity
            # Partial: an absent key leaves the field alone, an explicit null
            # clears it. Sending a blank date as "unchanged" is how a corrected
            # box silently keeps the old expiration.
            if "lot_number" in updates:
                lot_number = updates["lot_number"]
                target.lot_number = (lot_number or "").strip() or None
            if "expiration_date" in updates:
                target.expiration_date = updates["expiration_date"]

        if self._target_quantity(item) is not None:
            item.quantity_on_truck = self._on_truck(item)
        self._sync_restock_after_restocking(item)

        await self._log_item_action(
            template_id,
            organization_id,
            item,
            user,
            action="counted",
            changes={
                "from": before,
                "to": (
                    None
                    if quantity == 0
                    else {
                        "quantity": target.quantity,
                        "lot_number": target.lot_number,
                        "expiration_date": (
                            target.expiration_date.isoformat()
                            if target.expiration_date
                            else None
                        ),
                    }
                ),
            },
        )
        await self.db.commit()
        return await self.get_item_deployed_lots(template_item_id, organization_id)

    async def set_item_quantity(
        self,
        template_item_id: str,
        organization_id: str,
        user: User,
        quantity: int,
    ) -> Optional[Dict[str, Any]]:
        """Set the on-truck count outright — a recount, or a hand restock.

        Distinct from reporting use: this is the crew saying what is actually
        in the compartment, which is also how a count that drifted gets put
        right without inventing a consumption that never happened.
        """
        if quantity < 0:
            raise ValueError("Quantity cannot be negative")

        item, template_id = await self._get_item_with_template(
            template_item_id, organization_id
        )
        if item is None:
            return None
        if self._target_quantity(item) is None:
            raise ValueError("This item does not carry a quantity")

        previous = self._on_truck(item)
        if self._deployed_lots(item):
            self._reconcile_to_total(item, quantity, organization_id)
            item.quantity_on_truck = self._on_truck(item)
        else:
            item.quantity_on_truck = quantity
        self._sync_restock_after_restocking(item)

        await self._log_item_action(
            template_id,
            organization_id,
            item,
            user,
            action="counted",
            changes={"from": previous, "to": quantity},
        )
        await self.db.commit()
        return self._restock_state(item)

    async def clear_item_restock(
        self,
        template_item_id: str,
        organization_id: str,
        user: User,
    ) -> Optional[Dict[str, Any]]:
        """Withdraw a restock report — restocked by hand, or raised in error."""
        item, template_id = await self._get_item_with_template(
            template_item_id, organization_id
        )
        if item is None:
            return None

        self._clear_restock(item)
        await self._log_item_action(
            template_id,
            organization_id,
            item,
            user,
            action="restocked",
            changes=None,
        )
        await self.db.commit()
        return self._restock_state(item)

    @staticmethod
    def _clear_restock(item: CheckTemplateItem) -> None:
        """Drop a restock report and everything that described it.

        Leaving the reporter and note behind would attribute a stale report to
        whoever raised the last one the next time the flag is set.
        """
        item.restock_needed = False
        item.restock_reported_at = None
        item.restock_reported_by = None
        item.restock_note = None

    @classmethod
    def _restock_state(cls, item: CheckTemplateItem) -> Dict[str, Any]:
        return {
            "template_item_id": item.id,
            "restock_needed": bool(item.restock_needed),
            "restock_note": item.restock_note,
            "restock_reported_at": item.restock_reported_at,
            "quantity_on_truck": cls._on_truck(item),
            "target_quantity": cls._target_quantity(item),
            "is_short": cls._is_short(item),
        }

    async def _get_item_with_template(
        self, template_item_id: str, organization_id: str
    ) -> tuple:
        """Org-scoped item fetch that also yields its template id for the log."""
        result = await self.db.execute(
            select(CheckTemplateItem, EquipmentCheckTemplate.id)
            .join(
                CheckTemplateCompartment,
                CheckTemplateCompartment.id == CheckTemplateItem.compartment_id,
            )
            .join(
                EquipmentCheckTemplate,
                EquipmentCheckTemplate.id == CheckTemplateCompartment.template_id,
            )
            .where(
                CheckTemplateItem.id == template_item_id,
                EquipmentCheckTemplate.organization_id == organization_id,
            )
        )
        row = result.first()
        return (None, None) if not row else (row[0], row[1])

    async def _log_item_action(
        self,
        template_id: Optional[str],
        organization_id: str,
        item: CheckTemplateItem,
        user: Optional[User],
        *,
        action: str,
        changes: Optional[Dict[str, Any]],
    ) -> None:
        """Record a mid-shift change to a checklist item in the template log."""
        if user is None or template_id is None:
            return
        first = getattr(user, "first_name", "") or ""
        last = getattr(user, "last_name", "") or ""
        await self.log_template_change(
            organization_id=organization_id,
            template_id=str(template_id),
            user_id=str(user.id),
            user_name=f"{first} {last}".strip() or "Unknown",
            action=action,
            entity_type="item",
            entity_id=str(item.id),
            entity_name=item.name,
            changes=changes,
        )

    async def get_item_deployments(
        self, inventory_item_id: str, organization_id: str
    ) -> List[Dict[str, Any]]:
        """Every apparatus checklist position this inventory item fills.

        The supply view reads apparatus -> item; this is the same link read the
        other way, which is the direction a recall or an expiring lot is worked
        from: the officer is holding the item and needs to know which trucks
        carry it and what is on each of them right now.
        """
        today = date.today()
        result = await self.db.execute(
            select(
                CheckTemplateItem,
                CheckTemplateCompartment.name,
                EquipmentCheckTemplate,
            )
            .join(
                CheckTemplateCompartment,
                CheckTemplateCompartment.id == CheckTemplateItem.compartment_id,
            )
            .join(
                EquipmentCheckTemplate,
                EquipmentCheckTemplate.id == CheckTemplateCompartment.template_id,
            )
            .where(
                CheckTemplateItem.inventory_item_id == inventory_item_id,
                EquipmentCheckTemplate.organization_id == organization_id,
            )
            .order_by(CheckTemplateItem.expiration_date.asc())
        )
        rows = result.all()
        if not rows:
            return []

        apparatus_ids = {t.apparatus_id for (_, _, t) in rows if t.apparatus_id}
        apparatus_names: Dict[str, str] = {}
        if apparatus_ids:
            ares = await self.db.execute(
                select(Apparatus.id, Apparatus.name).where(
                    Apparatus.id.in_(apparatus_ids),
                    Apparatus.organization_id == organization_id,
                )
            )
            apparatus_names = {aid: name for aid, name in ares.all()}

        deployments: List[Dict[str, Any]] = []
        for item, compartment_name, tmpl in rows:
            exp = self._soonest_expiration(item)
            deployments.append(
                {
                    "template_item_id": item.id,
                    "item_name": item.name,
                    "compartment_name": compartment_name,
                    "template_id": tmpl.id,
                    "template_name": tmpl.name,
                    "apparatus_id": tmpl.apparatus_id,
                    "apparatus_name": (
                        apparatus_names.get(tmpl.apparatus_id)
                        if tmpl.apparatus_id
                        else None
                    ),
                    # A template defined for an apparatus *type* rather than one
                    # vehicle has no apparatus_id to name; say which type so the
                    # row is still actionable.
                    "apparatus_type": tmpl.apparatus_type,
                    "lot_number": self._soonest_lot_number(item),
                    "serial_number": item.serial_number,
                    "expiration_date": exp,
                    "days_until_expiration": (exp - today).days if exp else None,
                    "is_expired": bool(exp and exp < today),
                }
            )
        return deployments

    async def swap_item_lot(
        self,
        template_item_id: str,
        inventory_lot_id: str,
        organization_id: str,
        user: Optional[User] = None,
        quantity: int = 1,
    ) -> Optional[Dict[str, Any]]:
        """Move units from a ready-stock lot onto the apparatus.

        Draws ``quantity`` off the lot and updates the deployed checklist item's
        lot number and expiration to the new stock, so the truck reflects what
        is now in the bracket. For a counted position the on-truck figure goes
        up by the same number, which is what makes a two-of-four restock
        expressible; ``quantity`` defaults to 1 for the single-unit case that
        covers everything else. Raises ValueError on a mismatched, empty or
        expired lot.
        """
        if quantity < 1:
            raise ValueError("Restock quantity must be at least 1")
        item, template_id = await self._get_item_with_template(
            template_item_id, organization_id
        )
        if item is None:
            return None

        # Lock the lot row for the read-check-decrement so two concurrent
        # swaps of the same unit can't both pass the stock guard and
        # over-consume (matches the with_for_update pattern used across the
        # inventory service's stock mutations).
        lot = await self.db.scalar(
            select(InventoryLot)
            .where(
                InventoryLot.id == inventory_lot_id,
                InventoryLot.organization_id == organization_id,
            )
            .with_for_update()
        )
        if lot is None:
            raise ValueError("Stock lot not found")
        if item.inventory_item_id and lot.inventory_item_id != item.inventory_item_id:
            raise ValueError("This stock lot is for a different inventory item")
        if lot.quantity < quantity:
            raise ValueError(
                f"This lot has only {lot.quantity} on hand"
                if lot.quantity
                else "No stock available in this lot"
            )
        if lot.expiration_date and lot.expiration_date < date.today():
            # Deploying expired stock would fail the item on the next check and
            # put expired supplies in service; refuse rather than record it.
            raise ValueError("This stock lot has expired and cannot be deployed")

        lot_id_value = str(lot.id)
        previous = {
            "lot_number": item.lot_number,
            "expiration_date": (
                item.expiration_date.isoformat() if item.expiration_date else None
            ),
        }

        lot.quantity -= quantity
        was_restock = bool(item.restock_needed)

        # Before anything overwrites the item's own lot/date: whatever is
        # already aboard gets a row carrying the values it was actually
        # recorded with. Doing this after the write below would stamp the
        # incoming lot's date onto the older units — the very substitution
        # this table exists to prevent.
        self._materialize_untracked_units(item, organization_id)

        # Establish the catalog link if this was the item's first swap.
        if not item.inventory_item_id:
            item.inventory_item_id = lot.inventory_item_id
        if lot.lot_number is not None:
            item.lot_number = lot.lot_number
        if lot.expiration_date is not None:
            item.has_expiration = True
            item.expiration_date = lot.expiration_date

        # Record the units as their own presence on the truck rather than
        # overwriting the position's single lot/date.
        existing = next(
            (
                deployed
                for deployed in (item.deployed_lots or [])
                if deployed.inventory_lot_id == lot_id_value
            ),
            None,
        )
        if existing is not None:
            existing.quantity += quantity
        else:
            item.deployed_lots.append(
                CheckItemDeployedLot(
                    id=generate_uuid(),
                    organization_id=organization_id,
                    template_item_id=item.id,
                    inventory_lot_id=lot_id_value,
                    lot_number=lot.lot_number,
                    expiration_date=lot.expiration_date,
                    quantity=quantity,
                    deployed_by=str(user.id) if user is not None else None,
                )
            )
        if self._target_quantity(item) is not None:
            item.quantity_on_truck = self._on_truck(item)
        self._sync_restock_after_restocking(item)

        # A swap rewrites the same safety-critical template row that every
        # manual edit logs, and it is the one change nobody typed — without an
        # entry the changelog shows a lot number appearing on an apparatus with
        # no author and no source lot.
        if user is not None:
            first = getattr(user, "first_name", "") or ""
            last = getattr(user, "last_name", "") or ""
            await self.log_template_change(
                organization_id=organization_id,
                template_id=str(template_id),
                user_id=str(user.id),
                user_name=f"{first} {last}".strip() or "Unknown",
                action="swap",
                entity_type="item",
                entity_id=str(item.id),
                entity_name=item.name,
                changes={
                    "inventory_lot_id": inventory_lot_id,
                    "quantity": quantity,
                    "quantity_on_truck": item.quantity_on_truck,
                    "cleared_restock": was_restock and not item.restock_needed,
                    "from": previous,
                    "to": {
                        "lot_number": item.lot_number,
                        "expiration_date": (
                            item.expiration_date.isoformat()
                            if item.expiration_date
                            else None
                        ),
                    },
                },
            )

        await self.db.commit()

        return {
            "template_item_id": item.id,
            "lot_number": item.lot_number,
            "expiration_date": item.expiration_date,
            "remaining_quantity": lot.quantity,
            "restock_needed": bool(item.restock_needed),
            "quantity_on_truck": self._on_truck(item),
        }

    # ------------------------------------------------------------------
    # Catalog Linking (template setup)
    # ------------------------------------------------------------------

    # A header is a caption, not a thing on the truck, and a check position
    # with no name cannot be matched against anything.
    _UNLINKABLE_CHECK_TYPES = frozenset({"header"})

    async def _get_template_row(
        self, template_id: str, organization_id: str
    ) -> Optional[EquipmentCheckTemplate]:
        """Org-scoped template fetch without the compartment/item graph.

        ``get_template`` eager-loads every compartment, item and deployed lot
        and resolves unit labels; the linking paths only need to know the
        template is the caller's before they touch it.
        """
        result = await self.db.execute(
            select(EquipmentCheckTemplate).where(
                EquipmentCheckTemplate.id == template_id,
                EquipmentCheckTemplate.organization_id == organization_id,
            )
        )
        return result.scalars().first()

    async def _linkable_items(
        self, template_id: str, organization_id: str
    ) -> List[CheckTemplateItem]:
        """Every item on a template that could carry a catalog link."""
        result = await self.db.execute(
            select(CheckTemplateItem)
            .join(
                CheckTemplateCompartment,
                CheckTemplateCompartment.id == CheckTemplateItem.compartment_id,
            )
            .join(
                EquipmentCheckTemplate,
                EquipmentCheckTemplate.id == CheckTemplateCompartment.template_id,
            )
            .where(
                EquipmentCheckTemplate.id == template_id,
                EquipmentCheckTemplate.organization_id == organization_id,
            )
            .order_by(
                CheckTemplateCompartment.sort_order.asc(),
                CheckTemplateItem.sort_order.asc(),
            )
        )
        return [
            item
            for item in result.scalars().all()
            if (item.check_type or "") not in self._UNLINKABLE_CHECK_TYPES
            and (item.name or "").strip()
        ]

    async def get_link_coverage(
        self, template_id: str, organization_id: str
    ) -> Optional[Dict[str, int]]:
        """How much of this template is wired to the catalog.

        Expiration, lot and restock tracking all hang off the catalog link, so
        an unlinked position is one the supply side cannot see. Without a count
        the holes are invisible — a template can look complete and still track
        nothing.
        """
        template = await self._get_template_row(template_id, organization_id)
        if not template:
            return None

        items = await self._linkable_items(template_id, organization_id)
        linked = sum(1 for i in items if i.inventory_item_id)
        return {
            "linkable": len(items),
            "linked": linked,
            "unlinked": len(items) - linked,
        }

    async def suggest_inventory_matches(
        self,
        template_id: str,
        organization_id: str,
        limit_per_item: int = 3,
    ) -> Optional[Dict[str, Any]]:
        """Propose a catalog item for each unlinked position on a template.

        This is the rescue path for the checklists that already exist: they
        were typed as free text long before the catalog link existed, and
        linking them one item at a time through the picker is work nobody will
        do on a 200-line rig checklist.

        Suggests only — nothing is written. Scores come back with the proposal
        so the review screen can pre-select the exact matches and leave every
        judgement call to the person reading it.
        """
        template = await self._get_template_row(template_id, organization_id)
        if not template:
            return None

        items = await self._linkable_items(template_id, organization_id)
        unlinked = [i for i in items if not i.inventory_item_id]
        linked_count = len(items) - len(unlinked)

        coverage = {
            "linkable": len(items),
            "linked": linked_count,
            "unlinked": len(unlinked),
        }
        if not unlinked:
            return {"coverage": coverage, "matches": []}

        catalog = await self.db.execute(
            select(InventoryItem.id, InventoryItem.name).where(
                InventoryItem.organization_id == organization_id,
                InventoryItem.active.is_(True),
            )
        )
        candidates = [(cid, cname) for cid, cname in catalog.all() if cname]

        matches: List[Dict[str, Any]] = []
        for item in unlinked:
            suggestions = best_matches(item.name, candidates, limit=limit_per_item)
            matches.append(
                {
                    "template_item_id": item.id,
                    "item_name": item.name,
                    "check_type": item.check_type,
                    "suggestions": suggestions,
                }
            )

        return {"coverage": coverage, "matches": matches}

    async def link_inventory_items(
        self,
        template_id: str,
        organization_id: str,
        links: Dict[str, Optional[str]],
    ) -> Optional[int]:
        """Apply a reviewed set of catalog links in one transaction.

        All or nothing. A half-applied link pass leaves the reviewer with no
        way to tell which rows landed, and re-running it would re-propose the
        ones that already succeeded alongside the ones that did not.

        A ``None`` value unlinks — the review screen has to be able to undo a
        wrong match as cheaply as it made one.
        """
        if not links:
            return 0

        template = await self._get_template_row(template_id, organization_id)
        if not template:
            return None

        # XC-1: both sides are client-supplied ids. Resolving the template
        # items through the org-scoped template (rather than by id alone) is
        # what stops a caller pointing this at another department's checklist.
        items_by_id = {
            item.id: item
            for item in await self._linkable_items(template_id, organization_id)
        }
        unknown_items = set(links) - set(items_by_id)
        if unknown_items:
            raise ValueError(
                f"{len(unknown_items)} item(s) are not on this template "
                f"and were not linked"
            )

        wanted = {str(v) for v in links.values() if v}
        if wanted:
            found = await self.db.execute(
                select(InventoryItem.id).where(
                    InventoryItem.id.in_(wanted),
                    InventoryItem.organization_id == organization_id,
                )
            )
            known = set(found.scalars().all())
            missing = wanted - known
            if missing:
                raise ValueError(
                    f"{len(missing)} inventory item(s) are not in your "
                    f"inventory and were not linked"
                )

        changed = 0
        for item_id, inventory_item_id in links.items():
            item = items_by_id[item_id]
            new_value = str(inventory_item_id) if inventory_item_id else None
            if item.inventory_item_id == new_value:
                continue
            item.inventory_item_id = new_value
            changed += 1

        await self.db.commit()
        return changed

    # ------------------------------------------------------------------
    # Private Helpers
    # ------------------------------------------------------------------

    async def _resolve_templates(
        self,
        shift: Shift,
        organization_id: str,
        user_position: Optional[str],
    ) -> List[EquipmentCheckTemplate]:
        """Resolve applicable templates for a shift apparatus.

        Templates are defined either for one specific apparatus
        (``EquipmentCheckTemplate.apparatus_id``, an FK to ``apparatus.id``) or
        for an apparatus *type* (``apparatus_type``, a plain string). A
        department on ``BasicApparatus`` has no full apparatus records, so only
        the type-level route can ever match for it — which is why the shift's
        id has to be classified rather than assumed.
        """
        templates = []

        if shift.apparatus_id:
            ref = await resolve_apparatus_ref(
                self.db, shift.apparatus_id, organization_id
            )

            # Apparatus-specific templates, only meaningful when the shift's
            # apparatus is a full Apparatus record — the template FK targets
            # that table, so a BasicApparatus id could never match one.
            if ref.full is not None:
                templates = await self.list_templates(
                    organization_id, apparatus_id=ref.full_id
                )

            # Fall back to type-level templates. ApparatusRef.type_slug reads
            # the type from whichever table the id came from: the normalized
            # apparatus_types row for a full record, the inline string for a
            # BasicApparatus one.
            if not templates:
                type_slug = ref.type_slug
                if type_slug:
                    templates = await self.list_templates(
                        organization_id, apparatus_type=type_slug
                    )

        # Filter by active status
        templates = [t for t in templates if t.is_active]

        # Filter by user position if specified
        if user_position:
            filtered = []
            for tmpl in templates:
                positions = tmpl.assigned_positions or []
                if not positions or user_position in positions:
                    filtered.append(tmpl)
            templates = filtered

        return templates

    async def _create_compartment(
        self, template_id: str, data: Dict[str, Any]
    ) -> CheckTemplateCompartment:
        """Create a compartment with its items."""
        items_data = data.pop("items", None) or []
        compartment = CheckTemplateCompartment(
            id=generate_uuid(),
            template_id=template_id,
            **data,
        )
        self.db.add(compartment)
        await self.db.flush()

        for item_data in items_data:
            self._create_item(compartment.id, item_data)

        return compartment

    def _create_item(
        self, compartment_id: str, data: Dict[str, Any]
    ) -> CheckTemplateItem:
        """Create a single check template item."""
        item = CheckTemplateItem(
            id=generate_uuid(),
            compartment_id=compartment_id,
            **data,
        )
        self.db.add(item)
        return item

    async def _clone_compartment(
        self,
        template_id: str,
        source: CheckTemplateCompartment,
        parent_id: Optional[str],
    ) -> CheckTemplateCompartment:
        """Clone a compartment and its items."""
        compartment = CheckTemplateCompartment(
            id=generate_uuid(),
            template_id=template_id,
            name=source.name,
            description=source.description,
            sort_order=source.sort_order,
            image_url=source.image_url,
            is_header=source.is_header,
            container_type=source.container_type,
            parent_compartment_id=parent_id,
        )
        self.db.add(compartment)
        await self.db.flush()

        for item in source.items:
            new_item = CheckTemplateItem(
                id=generate_uuid(),
                compartment_id=compartment.id,
                equipment_id=item.equipment_id,
                # Without this the clone loses its catalog link, and with it
                # the ready-stock view and the ability to swap a fresh lot in —
                # cloning is how a department stands up the second engine.
                inventory_item_id=item.inventory_item_id,
                name=item.name,
                description=item.description,
                sort_order=item.sort_order,
                check_type=item.check_type,
                is_required=item.is_required,
                required_quantity=item.required_quantity,
                expected_quantity=item.expected_quantity,
                critical_minimum_quantity=item.critical_minimum_quantity,
                min_level=item.min_level,
                level_unit=item.level_unit,
                serial_number=item.serial_number,
                lot_number=item.lot_number,
                image_url=item.image_url,
                has_expiration=item.has_expiration,
                expiration_date=item.expiration_date,
                expiration_warning_days=(item.expiration_warning_days),
            )
            self.db.add(new_item)

        # Clone children
        for child in getattr(source, "children", []) or []:
            await self._clone_compartment(template_id, child, compartment.id)

        return compartment

    async def _get_compartment(
        self, compartment_id: str, organization_id: str
    ) -> Optional[CheckTemplateCompartment]:
        """Get a compartment by id, verifying org ownership."""
        result = await self.db.execute(
            select(CheckTemplateCompartment)
            .join(
                EquipmentCheckTemplate,
                EquipmentCheckTemplate.id == CheckTemplateCompartment.template_id,
            )
            .where(
                CheckTemplateCompartment.id == compartment_id,
                EquipmentCheckTemplate.organization_id == organization_id,
            )
            .options(selectinload(CheckTemplateCompartment.items))
        )
        return result.scalars().first()

    async def _get_item(
        self, item_id: str, organization_id: str
    ) -> Optional[CheckTemplateItem]:
        """Get an item by id, verifying org ownership."""
        result = await self.db.execute(
            select(CheckTemplateItem)
            .join(
                CheckTemplateCompartment,
                CheckTemplateCompartment.id == CheckTemplateItem.compartment_id,
            )
            .join(
                EquipmentCheckTemplate,
                EquipmentCheckTemplate.id == CheckTemplateCompartment.template_id,
            )
            .where(
                CheckTemplateItem.id == item_id,
                EquipmentCheckTemplate.organization_id == organization_id,
            )
        )
        return result.scalars().first()

    async def _get_user_name_map(self, user_ids: List[str]) -> Dict[str, str]:
        """Build a user_id → display name map."""
        if not user_ids:
            return {}

        result = await self.db.execute(select(User).where(User.id.in_(user_ids)))
        users = result.scalars().all()
        return {str(u.id): f"{u.first_name} {u.last_name}".strip() for u in users}

    # ============================================
    # Failure Notifications
    # ============================================

    async def _send_check_failure_notification(
        self,
        organization_id: str,
        shift: Any,
        checked_by: str,
        template_id: Optional[str],
        failed_count: int,
        total_count: int,
        critical_items: Optional[List[Dict[str, Any]]] = None,
        warning_items: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """Send in-app (and optionally email) notifications when an
        equipment check fails.

        Reads ``org.settings["equipment_check_alerts"]`` to decide
        who to notify and whether to send email.  When critical_items
        (below critical minimum threshold) are present, the notification
        is flagged as urgent.  Failures are logged but never propagated.
        """
        from loguru import logger

        try:
            org_result = await self.db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
            org = org_result.scalar_one_or_none()
            if not org:
                return

            cfg = (org.settings or {}).get("equipment_check_alerts", {})
            if not cfg.get("notify_on_failure", True):
                return

            # Resolve names
            checker_name = "Unknown"
            checker_result = await self.db.execute(
                select(User).where(User.id == str(checked_by))
            )
            checker = checker_result.scalar_one_or_none()
            if checker:
                first = checker.first_name or ""
                last = checker.last_name or ""
                checker_name = f"{first} {last}".strip() or "Unknown"

            template_name = "Unknown Template"
            if template_id:
                tmpl_result = await self.db.execute(
                    select(EquipmentCheckTemplate.name).where(
                        EquipmentCheckTemplate.id == template_id
                    )
                )
                tmpl_row = tmpl_result.scalar_one_or_none()
                if tmpl_row:
                    template_name = tmpl_row

            # Resolve from whichever apparatus table the shift's id belongs to,
            # so a BasicApparatus department gets its unit number in the alert
            # instead of a blank. Also org-scopes a lookup that previously did
            # not (XC-1).
            apparatus_name = (
                await resolve_apparatus_ref(
                    self.db, shift.apparatus_id, organization_id
                )
            ).unit_label

            # Collect recipients
            recipient_ids: set[str] = set()

            # Shift officer
            if cfg.get("notify_shift_officer", True):
                if shift.shift_officer_id:
                    recipient_ids.add(str(shift.shift_officer_id))

            # Users with matching roles
            notify_roles = cfg.get("notify_roles", [])
            if notify_roles:
                from app.models.user import Role, user_positions

                role_result = await self.db.execute(
                    select(user_positions.c.user_id)
                    .join(
                        Role,
                        Role.id == user_positions.c.position_id,
                    )
                    .where(
                        Role.organization_id == str(organization_id),
                        Role.slug.in_(notify_roles),
                    )
                )
                for row in role_result.all():
                    recipient_ids.add(str(row[0]))

            # Don't notify the person who did the check
            recipient_ids.discard(str(checked_by))
            if not recipient_ids:
                return

            from app.models.notification import NotificationLog

            shift_date_str = (
                shift.shift_date.isoformat() if shift.shift_date else "unknown date"
            )
            apparatus_label = f" on {apparatus_name}" if apparatus_name else ""
            has_critical = bool(critical_items)
            urgency = "CRITICAL: " if has_critical else ""
            message = (
                f'{urgency}Equipment check "{template_name}"'
                f"{apparatus_label} failed with "
                f"{failed_count} of {total_count} items. "
                f"Checked by {checker_name} "
                f"on {shift_date_str}."
            )

            # Build per-item detail lines for the message
            item_lines: list[str] = []
            for ci in critical_items or []:
                line = f"[CRITICAL] {ci['name']}"
                if "expected" in ci and "found" in ci:
                    line += f" — expected {ci['expected']}, found {ci['found']}"
                if "critical_minimum" in ci:
                    line += f" (critical min: {ci['critical_minimum']})"
                item_lines.append(line)
            for wi in warning_items or []:
                line = wi["name"]
                if "expected" in wi and "found" in wi:
                    line += f" — expected {wi['expected']}, found {wi['found']}"
                item_lines.append(line)
            if item_lines:
                message += "\n\nFailed items:\n" + "\n".join(
                    f"• {ln}" for ln in item_lines
                )

            notif_subject = (
                "CRITICAL: Equipment Check Failed"
                if has_critical
                else "Equipment Check Failed"
            )
            for rid in recipient_ids:
                notif = NotificationLog(
                    id=generate_uuid(),
                    organization_id=str(organization_id),
                    recipient_id=rid,
                    channel="in_app",
                    category="equipment_check",
                    subject=notif_subject,
                    message=message,
                    action_url=(f"/scheduling/shifts/{shift.id}"),
                    delivered=True,
                )
                self.db.add(notif)
            await self.db.flush()

            # Optional email
            if cfg.get("send_email", False):
                try:
                    from app.services.email_service import EmailService

                    recip_result = await self.db.execute(
                        select(User.email).where(
                            User.id.in_(list(recipient_ids)),
                            User.email.isnot(None),
                        )
                    )
                    to_emails = [r[0] for r in recip_result.all() if r[0]]
                    cc_emails = cfg.get("cc_emails", [])
                    if to_emails:
                        email_svc = EmailService(organization=org)
                        subject = (
                            f"{urgency}Equipment Check Failed"
                            f" \u2014 {template_name}"
                            f"{apparatus_label}"
                        )

                        # Build HTML item table for email
                        item_rows_html = ""
                        for ci in critical_items or []:
                            qty_info = ""
                            if "expected" in ci and "found" in ci:
                                qty_info = (
                                    f"Expected: {ci['expected']}, "
                                    f"Found: {ci['found']}"
                                )
                                if "critical_minimum" in ci:
                                    qty_info += (
                                        f" (Critical min: " f"{ci['critical_minimum']})"
                                    )
                            item_rows_html += (
                                "<tr style='background:#fef2f2'>"
                                f"<td style='padding:4px 8px'>"
                                f"<strong>{ci['name']}</strong>"
                                "</td>"
                                f"<td style='padding:4px 8px;"
                                f"color:#dc2626'>CRITICAL</td>"
                                f"<td style='padding:4px 8px'>"
                                f"{qty_info}</td></tr>"
                            )
                        for wi in warning_items or []:
                            qty_info = ""
                            if "expected" in wi and "found" in wi:
                                qty_info = (
                                    f"Expected: {wi['expected']}, "
                                    f"Found: {wi['found']}"
                                )
                            item_rows_html += (
                                "<tr>"
                                f"<td style='padding:4px 8px'>"
                                f"{wi['name']}</td>"
                                f"<td style='padding:4px 8px;"
                                f"color:#d97706'>Failed</td>"
                                f"<td style='padding:4px 8px'>"
                                f"{qty_info}</td></tr>"
                            )

                        items_table = ""
                        if item_rows_html:
                            items_table = (
                                "<table style='border-collapse:"
                                "collapse;width:100%;margin:12px 0'>"
                                "<tr style='background:#f3f4f6'>"
                                "<th style='padding:4px 8px;"
                                "text-align:left'>Item</th>"
                                "<th style='padding:4px 8px;"
                                "text-align:left'>Status</th>"
                                "<th style='padding:4px 8px;"
                                "text-align:left'>Details</th>"
                                f"</tr>{item_rows_html}</table>"
                            )

                        summary_line = (
                            f'Equipment check "{template_name}"'
                            f"{apparatus_label} failed with "
                            f"{failed_count} of {total_count} "
                            f"items. Checked by {checker_name} "
                            f"on {shift_date_str}."
                        )
                        html_body = (
                            f"<p>{summary_line}</p>"
                            f"{items_table}"
                            "<p>Please log in to review "
                            "the failed items and take "
                            "corrective action.</p>"
                        )
                        await email_svc.send_email(
                            to_emails=to_emails,
                            subject=subject,
                            html_body=html_body,
                            cc_emails=cc_emails or None,
                            db=self.db,
                            template_type=("equipment_check_failure"),
                        )
                except Exception as email_err:
                    logger.warning(
                        "Equipment check failure email " f"failed: {email_err}"
                    )

        except Exception as e:
            logger.warning("Equipment check failure notification " f"failed: {e}")

    # ============================================
    # Report Queries
    # ============================================

    async def get_compliance_report(
        self,
        organization_id: str,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
    ) -> Dict[str, Any]:
        """Aggregated compliance stats by apparatus + date range."""
        from datetime import timedelta

        if not date_from:
            date_from = date.today() - timedelta(days=30)
        if not date_to:
            date_to = date.today()

        date_to_end = datetime.combine(date_to, datetime.max.time()).replace(
            tzinfo=timezone.utc
        )
        date_from_start = datetime.combine(date_from, datetime.min.time()).replace(
            tzinfo=timezone.utc
        )

        # All checks in the date range
        checks_q = await self.db.execute(
            select(ShiftEquipmentCheck).where(
                ShiftEquipmentCheck.organization_id == organization_id,
                ShiftEquipmentCheck.checked_at >= date_from_start,
                ShiftEquipmentCheck.checked_at <= date_to_end,
            )
        )
        checks = checks_q.scalars().all()

        # All org apparatus drive the per-apparatus deficiency stats below;
        # this set already covers every apparatus referenced by the checks.
        all_app_q = await self.db.execute(
            select(Apparatus).where(
                Apparatus.organization_id == organization_id,
            )
        )
        all_apparatus = all_app_q.scalars().all()

        # Per-apparatus stats
        app_stats: Dict[str, Dict[str, Any]] = {}
        for a in all_apparatus:
            aid = str(a.id)
            app_stats[aid] = {
                "apparatus_id": aid,
                "apparatus_name": a.unit_number,
                "last_check_date": None,
                "last_checked_by": None,
                "last_status": None,
                "checks_completed": 0,
                "checks_expected": 0,
                "pass_count": 0,
                "fail_count": 0,
                "has_deficiency": bool(a.has_deficiency),
                "deficiency_since": a.deficiency_since,
            }

        total_items_sum = 0
        user_ids: set[str] = set()
        for c in checks:
            aid = str(c.apparatus_id) if c.apparatus_id else None
            if aid and aid in app_stats:
                stats = app_stats[aid]
                stats["checks_completed"] += 1
                if c.overall_status == "pass":
                    stats["pass_count"] += 1
                elif c.overall_status == "fail":
                    stats["fail_count"] += 1
                if stats["last_check_date"] is None or (
                    c.checked_at and c.checked_at > stats["last_check_date"]
                ):
                    stats["last_check_date"] = c.checked_at
                    stats["last_checked_by"] = c.checked_by
                    stats["last_status"] = c.overall_status
            total_items_sum += c.total_items or 0
            if c.checked_by:
                user_ids.add(str(c.checked_by))

        # Resolve user names for last_checked_by
        user_name_map = await self._get_user_name_map(list(user_ids))
        for stats in app_stats.values():
            uid = stats.get("last_checked_by")
            if uid and uid in user_name_map:
                stats["last_checked_by"] = user_name_map[uid]

        # Per-member stats
        member_stats: Dict[str, Dict[str, Any]] = {}
        for c in checks:
            uid = str(c.checked_by) if c.checked_by else None
            if not uid:
                continue
            if uid not in member_stats:
                member_stats[uid] = {
                    "user_id": uid,
                    "user_name": user_name_map.get(uid, "Unknown"),
                    "checks_completed": 0,
                    "pass_count": 0,
                    "fail_count": 0,
                }
            member_stats[uid]["checks_completed"] += 1
            if c.overall_status == "pass":
                member_stats[uid]["pass_count"] += 1
            elif c.overall_status == "fail":
                member_stats[uid]["fail_count"] += 1

        total_checks = len(checks)
        pass_count = sum(1 for c in checks if c.overall_status == "pass")
        pass_rate = (
            round(pass_count / total_checks * 100, 1) if total_checks > 0 else 0.0
        )
        avg_items = (
            round(total_items_sum / total_checks, 1) if total_checks > 0 else 0.0
        )

        return {
            "total_checks": total_checks,
            "pass_rate": pass_rate,
            "overdue_count": 0,
            "avg_items_per_check": avg_items,
            "apparatus": list(app_stats.values()),
            "members": list(member_stats.values()),
        }

    async def get_failure_log(
        self,
        organization_id: str,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        apparatus_id: Optional[str] = None,
        item_name: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """Paginated failure log with filters."""
        from datetime import timedelta

        if not date_from:
            date_from = date.today() - timedelta(days=30)
        if not date_to:
            date_to = date.today()

        date_to_end = datetime.combine(date_to, datetime.max.time()).replace(
            tzinfo=timezone.utc
        )
        date_from_start = datetime.combine(date_from, datetime.min.time()).replace(
            tzinfo=timezone.utc
        )

        base_q = (
            select(ShiftEquipmentCheckItem)
            .join(
                ShiftEquipmentCheck,
                ShiftEquipmentCheck.id == ShiftEquipmentCheckItem.check_id,
            )
            .where(
                ShiftEquipmentCheck.organization_id == organization_id,
                ShiftEquipmentCheckItem.status.in_(["fail", "out_of_service"]),
                ShiftEquipmentCheck.checked_at >= date_from_start,
                ShiftEquipmentCheck.checked_at <= date_to_end,
            )
        )
        if apparatus_id:
            base_q = base_q.where(ShiftEquipmentCheck.apparatus_id == apparatus_id)
        if item_name:
            # Escape LIKE wildcards so a literal % or _ in the filter doesn't
            # act as a wildcard (declare the escape char so it's honored).
            safe_item = (
                item_name.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            )
            base_q = base_q.where(
                ShiftEquipmentCheckItem.item_name.ilike(f"%{safe_item}%", escape="\\")
            )

        # Count
        from sqlalchemy import func as sa_func

        count_q = select(sa_func.count(ShiftEquipmentCheckItem.id)).select_from(
            base_q.subquery()
        )
        total_result = await self.db.execute(count_q)
        total = total_result.scalar() or 0

        # Fetch page, selecting the parent check alongside each item so the
        # check rows touched by the join are reused instead of re-queried.
        items_q = (
            base_q.add_columns(ShiftEquipmentCheck)
            .order_by(ShiftEquipmentCheck.checked_at.desc())
            .limit(limit)
            .offset(offset)
        )
        items_result = await self.db.execute(items_q)
        rows = items_result.all()
        failed_items = [row[0] for row in rows]

        checks_map: Dict[str, ShiftEquipmentCheck] = {}
        for _item, check in rows:
            checks_map[str(check.id)] = check

        user_ids_set: set[str] = set()
        apparatus_ids_set: set[str] = set()
        for c in checks_map.values():
            if c.checked_by:
                user_ids_set.add(str(c.checked_by))
            if c.apparatus_id:
                apparatus_ids_set.add(str(c.apparatus_id))

        user_map = await self._get_user_name_map(list(user_ids_set))
        app_name_map: Dict[str, str] = {}
        if apparatus_ids_set:
            aq = await self.db.execute(
                select(Apparatus.id, Apparatus.unit_number).where(
                    Apparatus.id.in_(list(apparatus_ids_set))
                )
            )
            for row in aq.all():
                app_name_map[str(row[0])] = row[1]

        records = []
        for fi in failed_items:
            check = checks_map.get(str(fi.check_id))
            records.append(
                {
                    "id": str(fi.id),
                    "check_id": str(fi.check_id),
                    "checked_at": (check.checked_at if check else None),
                    "apparatus_id": (
                        str(check.apparatus_id)
                        if check and check.apparatus_id
                        else None
                    ),
                    "apparatus_name": (
                        app_name_map.get(str(check.apparatus_id), "")
                        if check and check.apparatus_id
                        else None
                    ),
                    "compartment_name": fi.compartment_name,
                    "item_name": fi.item_name,
                    "check_type": fi.check_type,
                    "status": fi.status,
                    "notes": fi.notes,
                    "checked_by_name": (
                        user_map.get(str(check.checked_by), "Unknown")
                        if check and check.checked_by
                        else None
                    ),
                }
            )

        return {"items": records, "total": total}

    async def get_item_trends(
        self,
        organization_id: str,
        template_item_id: str,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        interval: str = "weekly",
    ) -> Dict[str, Any]:
        """Per-item pass/fail trend over time."""
        from datetime import timedelta

        if not date_from:
            date_from = date.today() - timedelta(days=90)
        if not date_to:
            date_to = date.today()

        date_to_end = datetime.combine(date_to, datetime.max.time()).replace(
            tzinfo=timezone.utc
        )
        date_from_start = datetime.combine(date_from, datetime.min.time()).replace(
            tzinfo=timezone.utc
        )

        # Get all check items for this template item, selecting the parent
        # check alongside each so we don't re-query the joined checks.
        q = await self.db.execute(
            select(ShiftEquipmentCheckItem, ShiftEquipmentCheck)
            .join(
                ShiftEquipmentCheck,
                ShiftEquipmentCheck.id == ShiftEquipmentCheckItem.check_id,
            )
            .where(
                ShiftEquipmentCheck.organization_id == organization_id,
                ShiftEquipmentCheckItem.template_item_id == template_item_id,
                ShiftEquipmentCheck.checked_at >= date_from_start,
                ShiftEquipmentCheck.checked_at <= date_to_end,
            )
            .order_by(ShiftEquipmentCheck.checked_at.asc())
        )
        rows = q.all()
        items = [row[0] for row in rows]
        checks_map: Dict[str, ShiftEquipmentCheck] = {}
        for _item, check in rows:
            checks_map[str(check.id)] = check

        # Resolve each check's shift date in one query (avoids a per-item
        # Shift lookup when building the history records below).
        shift_ids = {str(c.shift_id) for c in checks_map.values() if c.shift_id}
        shift_date_map: Dict[str, date] = {}
        if shift_ids:
            sdq = await self.db.execute(
                select(Shift.id, Shift.shift_date).where(Shift.id.in_(list(shift_ids)))
            )
            for sid, sdate in sdq.all():
                shift_date_map[str(sid)] = sdate

        user_ids_set: set[str] = set()
        for c in checks_map.values():
            if c.checked_by:
                user_ids_set.add(str(c.checked_by))
        user_map = await self._get_user_name_map(list(user_ids_set))

        # Build trend buckets
        from collections import defaultdict

        if interval == "daily":
            fmt = "%Y-%m-%d"
        elif interval == "monthly":
            fmt = "%Y-%m"
        else:
            fmt = "%Y-W%W"

        buckets: Dict[str, Dict[str, int]] = defaultdict(
            lambda: {
                "pass_count": 0,
                "fail_count": 0,
                "not_applicable_count": 0,
                "not_checked_count": 0,
            }
        )

        for item in items:
            check = checks_map.get(str(item.check_id))
            if not check or not check.checked_at:
                continue
            period_key = check.checked_at.strftime(fmt)
            bucket = self._trend_bucket_for_status(item.status)
            if bucket:
                buckets[period_key][bucket] += 1

        trends = [
            {
                "period": k,
                "pass_count": v["pass_count"],
                "fail_count": v["fail_count"],
                "not_applicable_count": v["not_applicable_count"],
                "not_checked_count": v["not_checked_count"],
            }
            for k, v in sorted(buckets.items())
        ]

        # Build history records
        history = []
        for item in items:
            check = checks_map.get(str(item.check_id))
            shift_date_val = None
            if check and check.shift_id:
                shift_date_val = shift_date_map.get(str(check.shift_id))
            history.append(
                {
                    "check_id": str(item.check_id),
                    "shift_id": (str(check.shift_id) if check else ""),
                    "shift_date": shift_date_val,
                    "status": item.status,
                    "quantity_found": item.quantity_found,
                    "level_reading": item.level_reading,
                    "serial_number": item.serial_number,
                    "lot_number": item.lot_number,
                    "is_expired": item.is_expired,
                    "notes": item.notes,
                    "checked_by_name": (
                        user_map.get(
                            str(check.checked_by),
                            "Unknown",
                        )
                        if check and check.checked_by
                        else None
                    ),
                    "checked_at": (check.checked_at if check else None),
                }
            )

        item_name = "Unknown"
        if items:
            item_name = items[0].item_name or "Unknown"

        return {
            "item_name": item_name,
            "trends": trends,
            "history": history,
        }

    # ============================================
    # Template Change Log
    # ============================================

    async def log_template_change(
        self,
        organization_id: str,
        template_id: str,
        user_id: str,
        user_name: str,
        action: str,
        entity_type: str,
        entity_id: Optional[str] = None,
        entity_name: Optional[str] = None,
        changes: Optional[Dict[str, Any]] = None,
    ) -> TemplateChangeLog:
        """Record a granular change to a template, compartment, or item."""
        entry = TemplateChangeLog(
            id=generate_uuid(),
            organization_id=organization_id,
            template_id=template_id,
            user_id=user_id,
            user_name=user_name,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_name=entity_name,
            changes=changes,
        )
        self.db.add(entry)
        await self.db.flush()
        return entry

    async def get_template_changelog(
        self,
        template_id: str,
        organization_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """Get paginated changelog entries for a template."""
        base_filter = [
            TemplateChangeLog.template_id == template_id,
            TemplateChangeLog.organization_id == organization_id,
        ]

        count_result = await self.db.execute(
            select(func.count(TemplateChangeLog.id)).where(*base_filter)
        )
        total = count_result.scalar() or 0

        result = await self.db.execute(
            select(TemplateChangeLog)
            .where(*base_filter)
            .order_by(TemplateChangeLog.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        items = list(result.scalars().all())

        return {"items": items, "total": total}

    @staticmethod
    def generate_csv_sample() -> str:
        """Return a sample CSV string for template import."""
        lines = [
            "Compartment,Item Name,Check Type,Expected Quantity,"
            "Critical Minimum,Level Unit",
            "Cab & Exterior,Lights & emergency warning system," "functional,,",
            "Cab & Exterior,Tire condition & pressure,pass_fail,,",
            "Engine Compartment,Oil level,level,,,quarts",
            "Medical Supplies,Tourniquets,quantity,4,2,",
            "Medical Supplies,Gauze / bandages,quantity,10,6,",
            "Medical Supplies,Nasal cannulas,quantity,8,4,",
        ]
        return "\n".join(lines)
