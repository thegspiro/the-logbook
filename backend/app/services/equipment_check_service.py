"""
Equipment Check Service

Business logic for equipment check template management, shift equipment
check submissions, checklist resolution by position, and item history.
"""

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.utils import generate_uuid
from app.models.apparatus import (
    Apparatus,
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
    TemplateChangeLog,
)
from app.models.training import (
    Shift,
    ShiftAssignment,
    ShiftEquipmentCheck,
    ShiftEquipmentCheckItem,
)
from app.models.user import Organization, User


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
        self, template_id: str, organization_id: str
    ) -> Optional[EquipmentCheckTemplate]:
        """Get a template with all compartments and items."""
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
        return result.scalars().first()

    async def list_templates(
        self,
        organization_id: str,
        apparatus_id: Optional[str] = None,
        apparatus_type: Optional[str] = None,
        check_timing: Optional[str] = None,
    ) -> List[EquipmentCheckTemplate]:
        """List templates with optional filters."""
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
        return list(result.scalars().all())

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

        # Look up apparatus to get name
        result = await self.db.execute(
            select(Apparatus).where(Apparatus.id == target_apparatus_id)
        )
        apparatus = result.scalars().first()
        apparatus_name = apparatus.name if apparatus else ""

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

        for key, value in data.items():
            if key not in self.PROTECTED_FIELDS and hasattr(item, key):
                setattr(item, key, value)

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

    async def get_checklists_for_shift(
        self,
        shift_id: str,
        user_id: str,
        organization_id: str,
    ) -> List[Dict[str, Any]]:
        """
        Resolve all applicable checklist templates for a shift and user.

        1. Find the shift's apparatus_id
        2. Look for apparatus-specific templates, fall back to type templates
        3. Filter by user's assigned position on this shift
        4. Return templates with completion status
        """
        # Get the shift
        result = await self.db.execute(
            select(Shift).where(
                Shift.id == shift_id,
                Shift.organization_id == organization_id,
            )
        )
        shift = result.scalars().first()
        if not shift:
            raise ValueError("Shift not found")

        # Get user's position on this shift
        result = await self.db.execute(
            select(ShiftAssignment).where(
                ShiftAssignment.shift_id == shift_id,
                ShiftAssignment.user_id == user_id,
            )
        )
        assignment = result.scalars().first()
        user_position = assignment.position if assignment else None

        # Find applicable templates
        templates = await self._resolve_templates(shift, organization_id, user_position)

        # Get existing checks for this shift
        result = await self.db.execute(
            select(ShiftEquipmentCheck).where(
                ShiftEquipmentCheck.shift_id == shift_id,
                ShiftEquipmentCheck.organization_id == organization_id,
            )
        )
        existing_checks = {c.template_id: c for c in result.scalars().all()}

        checklists = []
        for tmpl in templates:
            check = existing_checks.get(tmpl.id)
            checklists.append(
                {
                    "template": tmpl,
                    "is_completed": check is not None,
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
            item_count = sum(len(comp.items) for comp in tmpl.compartments)
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
    def _compute_check_status(
        items_data: List[Dict[str, Any]],
    ) -> tuple:
        """Auto-fail expired/under-quantity items and compute aggregate counts.

        Returns (total, completed, failed, overall_status).
        """
        for item in items_data:
            if item.get("is_expired"):
                item["status"] = "fail"
            req_qty = item.get("required_quantity")
            found_qty = item.get("quantity_found")
            if (
                req_qty is not None
                and found_qty is not None
                and found_qty < req_qty
            ):
                item["status"] = "fail"

        total = len(items_data)
        completed = sum(
            1
            for i in items_data
            if i.get("status") != "not_checked"
        )
        failed = sum(
            1
            for i in items_data
            if i.get("status") == "fail"
        )

        if completed < total:
            overall_status = "incomplete"
        elif failed > 0:
            overall_status = "fail"
        else:
            overall_status = "pass"

        return total, completed, failed, overall_status

    async def _create_check_items(
        self,
        check_id: str,
        items_data: List[Dict[str, Any]],
        template_items_map: Dict[str, CheckTemplateItem],
    ) -> List[ShiftEquipmentCheckItem]:
        """Create ORM check item records, updating template serials as needed."""
        created: List[ShiftEquipmentCheckItem] = []
        for item_data in items_data:
            tmpl_item_id = item_data.get("template_item_id")
            serial_found = item_data.get("serial_found")
            lot_found = item_data.get("lot_found")
            updated_serial = False

            if tmpl_item_id and (serial_found or lot_found):
                tmpl_item = template_items_map.get(tmpl_item_id)
                if tmpl_item:
                    serial_changed = serial_found and serial_found != (
                        tmpl_item.serial_number or ""
                    )
                    lot_changed = lot_found and lot_found != (
                        tmpl_item.lot_number or ""
                    )
                    if serial_changed or lot_changed:
                        updated_serial = True
                        if serial_found:
                            tmpl_item.serial_number = serial_found
                        if lot_found:
                            tmpl_item.lot_number = lot_found

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
                critical_minimum_quantity=item_data.get(
                    "critical_minimum_quantity"
                ),
                level_reading=item_data.get("level_reading"),
                level_unit=item_data.get("level_unit"),
                serial_number=item_data.get("serial_number"),
                lot_number=item_data.get("lot_number"),
                serial_found=serial_found,
                lot_found=lot_found,
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
        overall_status: str,
    ) -> None:
        """Update the deficiency flag on an apparatus after a check."""
        if not apparatus_id:
            return
        apparatus_result = await self.db.execute(
            select(Apparatus).where(Apparatus.id == apparatus_id)
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
    ) -> Dict[str, CheckTemplateItem]:
        """Load CheckTemplateItem records referenced by the submitted items."""
        template_item_ids = [
            i.get("template_item_id")
            for i in items_data
            if i.get("template_item_id")
        ]
        template_items_map: Dict[str, CheckTemplateItem] = {}
        if template_item_ids:
            tmpl_result = await self.db.execute(
                select(CheckTemplateItem).where(
                    CheckTemplateItem.id.in_(template_item_ids)
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

        items_data = data.pop("items", [])
        template_id = data.get("template_id")

        if not items_data:
            raise ValueError(
                "At least one checklist item is required"
            )

        # Prevent duplicate submission for same shift+template
        if template_id:
            existing = (
                await self.db.execute(
                    select(ShiftEquipmentCheck.id).where(
                        ShiftEquipmentCheck.shift_id
                        == shift_id,
                        ShiftEquipmentCheck.template_id
                        == template_id,
                    )
                )
            ).scalar_one_or_none()
            if existing:
                raise ValueError(
                    "A check for this template has already "
                    "been submitted for this shift"
                )

        total, completed, failed, overall_status = (
            self._compute_check_status(items_data)
        )

        check = ShiftEquipmentCheck(
            id=generate_uuid(),
            organization_id=organization_id,
            shift_id=shift_id,
            template_id=template_id,
            apparatus_id=shift.apparatus_id,
            checked_by=checked_by,
            checked_at=datetime.now(timezone.utc),
            check_timing=data.get(
                "check_timing", "start_of_shift"
            ),
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
            i.get("template_item_id")
            for i in items_data
            if i.get("template_item_id")
        }
        if template_id and submitted_ids:
            valid_result = await self.db.execute(
                select(CheckTemplateItem.id)
                .join(CheckTemplateCompartment)
                .where(
                    CheckTemplateCompartment.template_id
                    == template_id
                )
            )
            valid_ids = {
                str(r) for r in valid_result.scalars().all()
            }
            invalid = submitted_ids - valid_ids
            if invalid:
                raise ValueError(
                    f"Items do not belong to template: "
                    f"{', '.join(invalid)}"
                )

        template_items_map = await self._load_template_items_map(
            items_data
        )
        await self._create_check_items(
            check.id, items_data, template_items_map
        )

        await self._update_apparatus_deficiency(
            shift.apparatus_id, overall_status
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
        return await self.get_check(
            check.id, organization_id
        )

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
                EquipmentCheckTemplate.organization_id
                == organization_id,
            )
        )
        template = result.scalars().first()
        if not template:
            raise ValueError("Template not found")

        apparatus_id = data.get("apparatus_id") or template.apparatus_id

        items_data = data.pop("items", [])

        if not items_data:
            raise ValueError(
                "At least one checklist item is required"
            )

        total, completed, failed, overall_status = (
            self._compute_check_status(items_data)
        )

        check = ShiftEquipmentCheck(
            id=generate_uuid(),
            organization_id=organization_id,
            shift_id=None,
            template_id=template_id,
            apparatus_id=apparatus_id,
            checked_by=checked_by,
            checked_at=datetime.now(timezone.utc),
            check_timing=data.get(
                "check_timing", "start_of_shift"
            ),
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

        template_items_map = await self._load_template_items_map(
            items_data
        )
        await self._create_check_items(
            check.id, items_data, template_items_map
        )

        await self._update_apparatus_deficiency(
            apparatus_id, overall_status
        )

        try:
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            raise
        return await self.get_check(
            check.id, organization_id
        )

    async def complete_incomplete_check(
        self,
        check_id: str,
        organization_id: str,
        checked_by: str,
        data: Dict[str, Any],
    ) -> ShiftEquipmentCheck:
        """Complete remaining items on an incomplete check."""
        result = await self.db.execute(
            select(ShiftEquipmentCheck)
            .where(
                ShiftEquipmentCheck.id == check_id,
                ShiftEquipmentCheck.organization_id
                == organization_id,
            )
            .options(
                selectinload(ShiftEquipmentCheck.items)
            )
        )
        check = result.scalars().first()
        if not check:
            raise ValueError("Check not found")
        if check.overall_status != "incomplete":
            raise ValueError(
                "Only incomplete checks can be updated"
            )

        items_data = data.get("items", [])
        if not items_data:
            raise ValueError(
                "At least one item is required"
            )

        existing_map: Dict[str, ShiftEquipmentCheckItem] = {
            item.template_item_id: item
            for item in check.items
            if item.template_item_id
        }

        for item_data in items_data:
            tmpl_id = item_data.get("template_item_id")
            existing = existing_map.get(tmpl_id) if tmpl_id else None
            if existing and existing.status == "not_checked":
                existing.status = item_data.get(
                    "status", "not_checked"
                )
                existing.quantity_found = item_data.get(
                    "quantity_found", existing.quantity_found
                )
                existing.level_reading = item_data.get(
                    "level_reading", existing.level_reading
                )
                existing.notes = item_data.get(
                    "notes", existing.notes
                )
                existing.serial_found = item_data.get(
                    "serial_found", existing.serial_found
                )
                existing.lot_found = item_data.get(
                    "lot_found", existing.lot_found
                )
                existing.is_expired = item_data.get(
                    "is_expired", existing.is_expired
                )

        all_items = check.items
        total = len(all_items)
        completed = sum(
            1 for i in all_items
            if i.status != "not_checked"
        )
        failed = sum(
            1 for i in all_items if i.status == "fail"
        )

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
        return await self.get_check(
            check.id, organization_id
        )

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
        # Get user's active shift assignments
        result = await self.db.execute(
            select(ShiftAssignment)
            .join(Shift, Shift.id == ShiftAssignment.shift_id)
            .where(
                ShiftAssignment.user_id == user_id,
                Shift.organization_id == organization_id,
                Shift.shift_date >= date.today(),
            )
            .order_by(Shift.shift_date)
        )
        assignments = list(result.scalars().all())

        checklists = []
        for assignment in assignments:
            shift_checklists = await self.get_checklists_for_shift(
                assignment.shift_id, user_id, organization_id
            )
            for cl in shift_checklists:
                cl["shift_id"] = assignment.shift_id
                cl["shift_date"] = None  # Enriched by endpoint
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

    async def get_expiring_items(
        self, organization_id: str, days_ahead: int = 30
    ) -> List[CheckTemplateItem]:
        """Get items approaching expiration within N days."""
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
                EquipmentCheckTemplate.organization_id == organization_id,
                CheckTemplateItem.has_expiration.is_(True),
                CheckTemplateItem.expiration_date.isnot(None),
                CheckTemplateItem.expiration_date
                <= func.date_add(
                    func.current_date(),
                    func.text(f"INTERVAL {days_ahead} DAY"),
                ),
            )
        )
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # Private Helpers
    # ------------------------------------------------------------------

    async def _resolve_templates(
        self,
        shift: Shift,
        organization_id: str,
        user_position: Optional[str],
    ) -> List[EquipmentCheckTemplate]:
        """Resolve applicable templates for a shift apparatus."""
        templates = []

        if shift.apparatus_id:
            # First try apparatus-specific templates
            apparatus_templates = await self.list_templates(
                organization_id, apparatus_id=shift.apparatus_id
            )
            if apparatus_templates:
                templates = apparatus_templates
            else:
                # Fall back to apparatus-type templates
                result = await self.db.execute(
                    select(Apparatus).where(Apparatus.id == shift.apparatus_id)
                )
                apparatus = result.scalars().first()
                if apparatus and apparatus.type:
                    templates = await self.list_templates(
                        organization_id,
                        apparatus_type=(
                            apparatus.type.value
                            if hasattr(apparatus.type, "value")
                            else str(apparatus.type)
                        ),
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
            parent_compartment_id=parent_id,
        )
        self.db.add(compartment)
        await self.db.flush()

        for item in source.items:
            new_item = CheckTemplateItem(
                id=generate_uuid(),
                compartment_id=compartment.id,
                equipment_id=item.equipment_id,
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

            apparatus_name = ""
            if shift.apparatus_id:
                app_result = await self.db.execute(
                    select(Apparatus.unit_number).where(
                        Apparatus.id == shift.apparatus_id
                    )
                )
                app_row = app_result.scalar_one_or_none()
                if app_row:
                    apparatus_name = app_row

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
            for ci in (critical_items or []):
                line = f"[CRITICAL] {ci['name']}"
                if "expected" in ci and "found" in ci:
                    line += f" — expected {ci['expected']}, found {ci['found']}"
                if "critical_minimum" in ci:
                    line += f" (critical min: {ci['critical_minimum']})"
                item_lines.append(line)
            for wi in (warning_items or []):
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
                    from app.services.email_service import (
                        EmailService,
                    )

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
                        for ci in (critical_items or []):
                            qty_info = ""
                            if "expected" in ci and "found" in ci:
                                qty_info = (
                                    f"Expected: {ci['expected']}, "
                                    f"Found: {ci['found']}"
                                )
                                if "critical_minimum" in ci:
                                    qty_info += (
                                        f" (Critical min: "
                                        f"{ci['critical_minimum']})"
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
                        for wi in (warning_items or []):
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

        # Build apparatus map
        apparatus_ids = {c.apparatus_id for c in checks if c.apparatus_id}
        apparatus_map: Dict[str, Any] = {}
        if apparatus_ids:
            app_q = await self.db.execute(
                select(Apparatus).where(Apparatus.id.in_(list(apparatus_ids)))
            )
            for a in app_q.scalars().all():
                apparatus_map[str(a.id)] = a

        # Also get all org apparatus for deficiency status
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
                ShiftEquipmentCheckItem.status == "fail",
                ShiftEquipmentCheck.checked_at >= date_from_start,
                ShiftEquipmentCheck.checked_at <= date_to_end,
            )
        )
        if apparatus_id:
            base_q = base_q.where(ShiftEquipmentCheck.apparatus_id == apparatus_id)
        if item_name:
            base_q = base_q.where(
                ShiftEquipmentCheckItem.item_name.ilike(f"%{item_name}%")
            )

        # Count
        from sqlalchemy import func as sa_func

        count_q = select(sa_func.count(ShiftEquipmentCheckItem.id)).select_from(
            base_q.subquery()
        )
        total_result = await self.db.execute(count_q)
        total = total_result.scalar() or 0

        # Fetch page
        items_q = (
            base_q.order_by(ShiftEquipmentCheck.checked_at.desc())
            .limit(limit)
            .offset(offset)
        )
        items_result = await self.db.execute(items_q)
        failed_items = items_result.scalars().all()

        # Resolve check + apparatus data
        check_ids = {str(fi.check_id) for fi in failed_items}
        checks_map: Dict[str, ShiftEquipmentCheck] = {}
        if check_ids:
            cq = await self.db.execute(
                select(ShiftEquipmentCheck).where(
                    ShiftEquipmentCheck.id.in_(list(check_ids))
                )
            )
            for c in cq.scalars().all():
                checks_map[str(c.id)] = c

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

        # Get all check items for this template item
        q = await self.db.execute(
            select(ShiftEquipmentCheckItem)
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
        items = q.scalars().all()

        # Get check data for dates
        check_ids = {str(i.check_id) for i in items}
        checks_map: Dict[str, ShiftEquipmentCheck] = {}
        if check_ids:
            cq = await self.db.execute(
                select(ShiftEquipmentCheck).where(
                    ShiftEquipmentCheck.id.in_(list(check_ids))
                )
            )
            for c in cq.scalars().all():
                checks_map[str(c.id)] = c

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
                "not_checked_count": 0,
            }
        )

        for item in items:
            check = checks_map.get(str(item.check_id))
            if not check or not check.checked_at:
                continue
            period_key = check.checked_at.strftime(fmt)
            if item.status == "pass":
                buckets[period_key]["pass_count"] += 1
            elif item.status == "fail":
                buckets[period_key]["fail_count"] += 1
            else:
                buckets[period_key]["not_checked_count"] += 1

        trends = [
            {
                "period": k,
                "pass_count": v["pass_count"],
                "fail_count": v["fail_count"],
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
                sq = await self.db.execute(
                    select(Shift.shift_date).where(Shift.id == check.shift_id)
                )
                sd = sq.scalar_one_or_none()
                if sd:
                    shift_date_val = sd
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
            "Cab & Exterior,Lights & emergency warning system,"
            "functional,,",
            "Cab & Exterior,Tire condition & pressure,pass_fail,,",
            "Engine Compartment,Oil level,level,,,quarts",
            "Medical Supplies,Tourniquets,quantity,4,2,",
            "Medical Supplies,Gauze / bandages,quantity,10,6,",
            "Medical Supplies,Nasal cannulas,quantity,8,4,",
        ]
        return "\n".join(lines)
