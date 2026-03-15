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
)
from app.models.training import (
    Shift,
    ShiftAssignment,
    ShiftEquipmentCheck,
    ShiftEquipmentCheckItem,
)
from app.models.user import User


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
            query = query.where(
                EquipmentCheckTemplate.apparatus_id == apparatus_id
            )
        if apparatus_type is not None:
            query = query.where(
                EquipmentCheckTemplate.apparatus_type == apparatus_type
            )
        if check_timing is not None:
            query = query.where(
                EquipmentCheckTemplate.check_timing == check_timing
            )

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

    async def delete_template(
        self, template_id: str, organization_id: str
    ) -> bool:
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
            f"{apparatus_name} - {source.name}"
            if apparatus_name
            else source.name
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
            await self._clone_compartment(
                new_template.id, compartment, parent_id=None
            )

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
        return compartment

    async def update_compartment(
        self,
        compartment_id: str,
        organization_id: str,
        data: Dict[str, Any],
    ) -> Optional[CheckTemplateCompartment]:
        """Update a compartment."""
        compartment = await self._get_compartment(
            compartment_id, organization_id
        )
        if not compartment:
            return None

        for key, value in data.items():
            if key not in self.PROTECTED_FIELDS and hasattr(compartment, key):
                setattr(compartment, key, value)

        await self.db.commit()
        return compartment

    async def delete_compartment(
        self, compartment_id: str, organization_id: str
    ) -> bool:
        """Delete a compartment and all its items."""
        compartment = await self._get_compartment(
            compartment_id, organization_id
        )
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
        compartment = await self._get_compartment(
            compartment_id, organization_id
        )
        if not compartment:
            return None

        item = CheckTemplateItem(
            id=generate_uuid(),
            compartment_id=compartment_id,
            **data,
        )
        self.db.add(item)
        await self.db.commit()
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
        return item

    async def delete_item(
        self, item_id: str, organization_id: str
    ) -> bool:
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
        compartment = await self._get_compartment(
            compartment_id, organization_id
        )
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
        templates = await self._resolve_templates(
            shift, organization_id, user_position
        )

        # Get existing checks for this shift
        result = await self.db.execute(
            select(ShiftEquipmentCheck).where(
                ShiftEquipmentCheck.shift_id == shift_id,
                ShiftEquipmentCheck.organization_id == organization_id,
            )
        )
        existing_checks = {
            c.template_id: c for c in result.scalars().all()
        }

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
        user_ids = [
            c.checked_by for c in checks.values() if c.checked_by
        ]
        user_map = await self._get_user_name_map(user_ids)

        summaries = []
        for tmpl in templates:
            check = checks.get(tmpl.id)
            item_count = sum(
                len(comp.items) for comp in tmpl.compartments
            )
            summaries.append(
                {
                    "template_id": tmpl.id,
                    "template_name": tmpl.name,
                    "check_timing": tmpl.check_timing,
                    "assigned_positions": tmpl.assigned_positions,
                    "is_completed": check is not None,
                    "overall_status": check.overall_status if check else None,
                    "checked_by_name": user_map.get(
                        check.checked_by, ""
                    )
                    if check and check.checked_by
                    else None,
                    "checked_at": check.checked_at if check else None,
                    "total_items": check.total_items if check else item_count,
                    "completed_items": check.completed_items if check else 0,
                    "failed_items": check.failed_items if check else 0,
                }
            )

        return summaries

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
        # Verify shift exists
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

        # Compute aggregate counts
        total = len(items_data)
        completed = sum(
            1 for i in items_data if i.get("status") != "not_checked"
        )
        failed = sum(1 for i in items_data if i.get("status") == "fail")

        # Auto-fail expired items and under-quantity items
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

        # Recount after auto-fail
        failed = sum(1 for i in items_data if i.get("status") == "fail")
        overall_status = "pass" if failed == 0 and completed == total else "fail"
        if completed < total:
            overall_status = "incomplete"

        check = ShiftEquipmentCheck(
            id=generate_uuid(),
            organization_id=organization_id,
            shift_id=shift_id,
            template_id=template_id,
            apparatus_id=shift.apparatus_id,
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
        await self.db.flush()

        for item_data in items_data:
            check_item = ShiftEquipmentCheckItem(
                id=generate_uuid(),
                check_id=check.id,
                template_item_id=item_data.get(
                    "template_item_id"
                ),
                compartment_name=item_data.get(
                    "compartment_name", ""
                ),
                item_name=item_data.get(
                    "item_name", ""
                ),
                check_type=item_data.get("check_type"),
                status=item_data.get(
                    "status", "not_checked"
                ),
                quantity_found=item_data.get(
                    "quantity_found"
                ),
                required_quantity=item_data.get(
                    "required_quantity"
                ),
                level_reading=item_data.get(
                    "level_reading"
                ),
                level_unit=item_data.get("level_unit"),
                serial_number=item_data.get(
                    "serial_number"
                ),
                lot_number=item_data.get("lot_number"),
                photo_urls=item_data.get("photo_urls"),
                is_expired=item_data.get(
                    "is_expired", False
                ),
                expiration_date=item_data.get(
                    "expiration_date"
                ),
                notes=item_data.get("notes"),
            )
            self.db.add(check_item)

        # Update apparatus deficiency flag
        if shift.apparatus_id:
            apparatus_result = await self.db.execute(
                select(Apparatus).where(
                    Apparatus.id == shift.apparatus_id
                )
            )
            apparatus = apparatus_result.scalars().first()
            if apparatus:
                if overall_status == "fail":
                    if not apparatus.has_deficiency:
                        apparatus.has_deficiency = True
                        apparatus.deficiency_since = (
                            datetime.now(timezone.utc)
                        )
                elif overall_status == "pass":
                    apparatus.has_deficiency = False
                    apparatus.deficiency_since = None

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
            query = query.where(
                ShiftEquipmentCheck.check_timing == check_timing
            )

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
                ShiftEquipmentCheck.checked_at >= datetime.combine(
                    start_date, datetime.min.time()
                ).replace(tzinfo=timezone.utc)
            )
        if end_date:
            query = query.where(
                ShiftEquipmentCheck.checked_at <= datetime.combine(
                    end_date, datetime.max.time()
                ).replace(tzinfo=timezone.utc)
            )

        result = await self.db.execute(query)
        return list(result.scalars().all())

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
            select(ShiftEquipmentCheck).where(
                ShiftEquipmentCheck.id.in_(check_ids)
            )
        )
        checks = {c.id: c for c in result.scalars().all()}

        user_ids = [
            c.checked_by for c in checks.values() if c.checked_by
        ]
        user_map = await self._get_user_name_map(user_ids)

        # Get shift dates
        shift_ids = [c.shift_id for c in checks.values()]
        result = await self.db.execute(
            select(Shift).where(Shift.id.in_(shift_ids))
        )
        shift_map = {s.id: s for s in result.scalars().all()}

        history = []
        for item in items:
            check = checks.get(item.check_id)
            shift = shift_map.get(check.shift_id) if check else None
            history.append(
                {
                    "check_id": item.check_id,
                    "shift_id": (
                        check.shift_id if check else None
                    ),
                    "shift_date": (
                        shift.shift_date
                        if shift
                        else None
                    ),
                    "status": item.status,
                    "quantity_found": item.quantity_found,
                    "level_reading": item.level_reading,
                    "serial_number": item.serial_number,
                    "lot_number": item.lot_number,
                    "is_expired": item.is_expired,
                    "notes": item.notes,
                    "checked_by_name": user_map.get(
                        check.checked_by, ""
                    )
                    if check and check.checked_by
                    else None,
                    "checked_at": (
                        check.checked_at
                        if check
                        else None
                    ),
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
                CheckTemplateCompartment.id
                == CheckTemplateItem.compartment_id,
            )
            .join(
                EquipmentCheckTemplate,
                EquipmentCheckTemplate.id
                == CheckTemplateCompartment.template_id,
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
        """Resolve applicable templates for a shift apparatus + user position."""
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
                    select(Apparatus).where(
                        Apparatus.id == shift.apparatus_id
                    )
                )
                apparatus = result.scalars().first()
                if apparatus and apparatus.type:
                    templates = await self.list_templates(
                        organization_id, apparatus_type=apparatus.type.value
                        if hasattr(apparatus.type, "value")
                        else str(apparatus.type)
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
                min_level=item.min_level,
                level_unit=item.level_unit,
                serial_number=item.serial_number,
                lot_number=item.lot_number,
                image_url=item.image_url,
                has_expiration=item.has_expiration,
                expiration_date=item.expiration_date,
                expiration_warning_days=(
                    item.expiration_warning_days
                ),
            )
            self.db.add(new_item)

        # Clone children
        for child in getattr(source, "children", []) or []:
            await self._clone_compartment(
                template_id, child, compartment.id
            )

        return compartment

    async def _get_compartment(
        self, compartment_id: str, organization_id: str
    ) -> Optional[CheckTemplateCompartment]:
        """Get a compartment by id, verifying org ownership."""
        result = await self.db.execute(
            select(CheckTemplateCompartment)
            .join(
                EquipmentCheckTemplate,
                EquipmentCheckTemplate.id
                == CheckTemplateCompartment.template_id,
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
                CheckTemplateCompartment.id
                == CheckTemplateItem.compartment_id,
            )
            .join(
                EquipmentCheckTemplate,
                EquipmentCheckTemplate.id
                == CheckTemplateCompartment.template_id,
            )
            .where(
                CheckTemplateItem.id == item_id,
                EquipmentCheckTemplate.organization_id == organization_id,
            )
        )
        return result.scalars().first()

    async def _get_user_name_map(
        self, user_ids: List[str]
    ) -> Dict[str, str]:
        """Build a user_id → display name map."""
        if not user_ids:
            return {}

        result = await self.db.execute(
            select(User).where(User.id.in_(user_ids))
        )
        users = result.scalars().all()
        return {
            str(u.id): f"{u.first_name} {u.last_name}".strip()
            for u in users
        }
