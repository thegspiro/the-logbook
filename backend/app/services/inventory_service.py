"""
Inventory Service

Business logic for inventory management including items, categories,
assignments, checkouts, maintenance, and reporting.
"""

from typing import List, Optional, Dict, Tuple, Any
from datetime import datetime, date, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, update, delete
from sqlalchemy.orm import selectinload, joinedload
from uuid import UUID
from decimal import Decimal

from app.models.inventory import (
    InventoryCategory,
    InventoryItem,
    ItemAssignment,
    CheckOutRecord,
    MaintenanceRecord,
    ItemType,
    ItemCondition,
    ItemStatus,
    MaintenanceType,
    AssignmentType,
)
from app.models.user import User


class InventoryService:
    """Service for inventory management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Category Management
    # ============================================

    async def create_category(
        self, organization_id: UUID, category_data: Dict[str, Any], created_by: UUID
    ) -> Tuple[Optional[InventoryCategory], Optional[str]]:
        """Create a new inventory category"""
        try:
            category = InventoryCategory(
                organization_id=organization_id,
                created_by=created_by,
                **category_data
            )
            self.db.add(category)
            await self.db.commit()
            await self.db.refresh(category)
            return category, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_categories(
        self, organization_id: UUID, item_type: Optional[ItemType] = None, active_only: bool = True
    ) -> List[InventoryCategory]:
        """Get all categories for an organization"""
        query = select(InventoryCategory).where(
            InventoryCategory.organization_id == organization_id
        )

        if item_type:
            query = query.where(InventoryCategory.item_type == item_type)

        if active_only:
            query = query.where(InventoryCategory.active == True)

        query = query.order_by(InventoryCategory.name)

        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_category_by_id(
        self, category_id: UUID, organization_id: UUID
    ) -> Optional[InventoryCategory]:
        """Get category by ID"""
        result = await self.db.execute(
            select(InventoryCategory)
            .where(InventoryCategory.id == str(category_id))
            .where(InventoryCategory.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    # ============================================
    # Item Management
    # ============================================

    async def create_item(
        self, organization_id: UUID, item_data: Dict[str, Any], created_by: UUID
    ) -> Tuple[Optional[InventoryItem], Optional[str]]:
        """Create a new inventory item"""
        try:
            # Calculate depreciation if purchase info provided
            if "purchase_price" in item_data and "expected_lifetime_years" in item_data:
                item_data["current_value"] = item_data["purchase_price"]  # Will be calculated over time

            item = InventoryItem(
                organization_id=organization_id,
                created_by=created_by,
                **item_data
            )
            self.db.add(item)
            await self.db.commit()
            await self.db.refresh(item)
            return item, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_items(
        self,
        organization_id: UUID,
        category_id: Optional[UUID] = None,
        status: Optional[ItemStatus] = None,
        assigned_to: Optional[UUID] = None,
        search: Optional[str] = None,
        active_only: bool = True,
        skip: int = 0,
        limit: int = 100,
    ) -> Tuple[List[InventoryItem], int]:
        """Get items with filtering and pagination"""
        query = (
            select(InventoryItem)
            .where(InventoryItem.organization_id == str(organization_id))
            .options(
                selectinload(InventoryItem.category),
                selectinload(InventoryItem.assigned_to_user),
            )
        )

        if category_id:
            query = query.where(InventoryItem.category_id == str(category_id))

        if status:
            query = query.where(InventoryItem.status == status)

        if assigned_to:
            query = query.where(InventoryItem.assigned_to_user_id == assigned_to)

        if search:
            search_term = f"%{search}%"
            query = query.where(
                or_(
                    InventoryItem.name.ilike(search_term),
                    InventoryItem.serial_number.ilike(search_term),
                    InventoryItem.asset_tag.ilike(search_term),
                    InventoryItem.description.ilike(search_term),
                )
            )

        if active_only:
            query = query.where(InventoryItem.active == True)

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar()

        # Get paginated results
        query = query.order_by(InventoryItem.name).offset(skip).limit(limit)
        result = await self.db.execute(query)
        items = result.scalars().all()

        return items, total

    async def get_item_by_id(
        self, item_id: UUID, organization_id: UUID
    ) -> Optional[InventoryItem]:
        """Get item by ID with all relationships"""
        result = await self.db.execute(
            select(InventoryItem)
            .where(InventoryItem.id == str(item_id))
            .where(InventoryItem.organization_id == str(organization_id))
            .options(
                selectinload(InventoryItem.category),
                selectinload(InventoryItem.assigned_to_user),
                selectinload(InventoryItem.checkout_records),
                selectinload(InventoryItem.maintenance_records),
                selectinload(InventoryItem.assignment_history),
            )
        )
        return result.scalar_one_or_none()

    async def update_item(
        self, item_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[InventoryItem], Optional[str]]:
        """Update an inventory item"""
        try:
            item = await self.get_item_by_id(item_id, organization_id)
            if not item:
                return None, "Item not found"

            for key, value in update_data.items():
                setattr(item, key, value)

            await self.db.commit()
            await self.db.refresh(item)
            return item, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def retire_item(
        self, item_id: UUID, organization_id: UUID, notes: Optional[str] = None
    ) -> Tuple[bool, Optional[str]]:
        """Retire an item (soft delete)"""
        try:
            item = await self.get_item_by_id(item_id, organization_id)
            if not item:
                return False, "Item not found"

            item.status = ItemStatus.RETIRED
            item.condition = ItemCondition.RETIRED
            item.active = False
            if notes:
                item.status_notes = notes

            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    # ============================================
    # Assignment Management
    # ============================================

    async def assign_item_to_user(
        self,
        item_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        assigned_by: UUID,
        assignment_type: AssignmentType = AssignmentType.PERMANENT,
        reason: Optional[str] = None,
        expected_return_date: Optional[datetime] = None,
    ) -> Tuple[Optional[ItemAssignment], Optional[str]]:
        """Assign an item to a user"""
        try:
            # Get the item
            item = await self.get_item_by_id(item_id, organization_id)
            if not item:
                return None, "Item not found"

            # Check if item is available
            if item.status not in [ItemStatus.AVAILABLE, ItemStatus.ASSIGNED]:
                return None, f"Item is not available (status: {item.status})"

            # Unassign from previous user if needed
            if item.assigned_to_user_id and item.assigned_to_user_id != user_id:
                await self.unassign_item(item_id, organization_id, assigned_by)

            # Create assignment record
            assignment = ItemAssignment(
                organization_id=organization_id,
                item_id=item_id,
                user_id=user_id,
                assignment_type=assignment_type,
                assigned_by=assigned_by,
                assignment_reason=reason,
                expected_return_date=expected_return_date,
                is_active=True,
            )
            self.db.add(assignment)

            # Update item
            item.assigned_to_user_id = user_id
            item.assigned_date = datetime.now()
            item.status = ItemStatus.ASSIGNED

            await self.db.commit()
            await self.db.refresh(assignment)
            return assignment, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def unassign_item(
        self,
        item_id: UUID,
        organization_id: UUID,
        returned_by: UUID,
        return_condition: Optional[ItemCondition] = None,
        return_notes: Optional[str] = None,
    ) -> Tuple[bool, Optional[str]]:
        """Unassign an item from its current user"""
        try:
            item = await self.get_item_by_id(item_id, organization_id)
            if not item:
                return False, "Item not found"

            if not item.assigned_to_user_id:
                return False, "Item is not currently assigned"

            # Capture user_id before clearing assignment (needed for auto-archive check)
            previous_user_id = str(item.assigned_to_user_id)

            # Update current active assignment
            result = await self.db.execute(
                select(ItemAssignment)
                .where(ItemAssignment.item_id == str(item_id))
                .where(ItemAssignment.is_active == True)
                .order_by(ItemAssignment.assigned_date.desc())
                .limit(1)
            )
            assignment = result.scalar_one_or_none()

            if assignment:
                assignment.is_active = False
                assignment.returned_date = datetime.now()
                assignment.returned_by = returned_by
                assignment.return_condition = return_condition
                assignment.return_notes = return_notes

            # Update item
            item.assigned_to_user_id = None
            item.assigned_date = None
            item.status = ItemStatus.AVAILABLE
            if return_condition:
                item.condition = return_condition

            await self.db.commit()

            # Check if the dropped member should be auto-archived
            from app.services.member_archive_service import check_and_auto_archive
            await check_and_auto_archive(self.db, previous_user_id, str(organization_id))

            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def get_user_assignments(
        self, user_id: UUID, organization_id: UUID, active_only: bool = True
    ) -> List[ItemAssignment]:
        """Get all items assigned to a user"""
        query = (
            select(ItemAssignment)
            .where(ItemAssignment.user_id == str(user_id))
            .where(ItemAssignment.organization_id == str(organization_id))
            .options(selectinload(ItemAssignment.item))
        )

        if active_only:
            query = query.where(ItemAssignment.is_active == True)

        query = query.order_by(ItemAssignment.assigned_date.desc())

        result = await self.db.execute(query)
        return result.scalars().all()

    # ============================================
    # Check-Out/Check-In Management
    # ============================================

    async def checkout_item(
        self,
        item_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        checked_out_by: UUID,
        expected_return_at: Optional[datetime] = None,
        reason: Optional[str] = None,
    ) -> Tuple[Optional[CheckOutRecord], Optional[str]]:
        """Check out an item to a user"""
        try:
            item = await self.get_item_by_id(item_id, organization_id)
            if not item:
                return None, "Item not found"

            if item.status != ItemStatus.AVAILABLE:
                return None, f"Item is not available for checkout (status: {item.status})"

            # Create checkout record
            checkout = CheckOutRecord(
                organization_id=organization_id,
                item_id=item_id,
                user_id=user_id,
                checked_out_by=checked_out_by,
                expected_return_at=expected_return_at,
                checkout_reason=reason,
                checkout_condition=item.condition,
                is_returned=False,
            )
            self.db.add(checkout)

            # Update item status
            item.status = ItemStatus.CHECKED_OUT

            await self.db.commit()
            await self.db.refresh(checkout)
            return checkout, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def checkin_item(
        self,
        checkout_id: UUID,
        organization_id: UUID,
        checked_in_by: UUID,
        return_condition: ItemCondition,
        damage_notes: Optional[str] = None,
    ) -> Tuple[bool, Optional[str]]:
        """Check in an item"""
        try:
            result = await self.db.execute(
                select(CheckOutRecord)
                .where(CheckOutRecord.id == str(checkout_id))
                .where(CheckOutRecord.organization_id == str(organization_id))
                .options(selectinload(CheckOutRecord.item))
            )
            checkout = result.scalar_one_or_none()

            if not checkout:
                return False, "Checkout record not found"

            if checkout.is_returned:
                return False, "Item already checked in"

            # Capture user_id before marking returned (needed for auto-archive check)
            checkout_user_id = str(checkout.user_id)

            # Update checkout record
            checkout.checked_in_at = datetime.now()
            checkout.checked_in_by = checked_in_by
            checkout.return_condition = return_condition
            checkout.damage_notes = damage_notes
            checkout.is_returned = True
            checkout.is_overdue = False

            # Update item
            item = checkout.item
            item.status = ItemStatus.AVAILABLE
            item.condition = return_condition

            await self.db.commit()

            # Check if the dropped member should be auto-archived
            from app.services.member_archive_service import check_and_auto_archive
            await check_and_auto_archive(self.db, checkout_user_id, str(organization_id))

            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def get_active_checkouts(
        self, organization_id: UUID, user_id: Optional[UUID] = None
    ) -> List[CheckOutRecord]:
        """Get all active (not returned) checkouts"""
        query = (
            select(CheckOutRecord)
            .where(CheckOutRecord.organization_id == str(organization_id))
            .where(CheckOutRecord.is_returned == False)
            .options(
                selectinload(CheckOutRecord.item),
                selectinload(CheckOutRecord.user),
            )
        )

        if user_id:
            query = query.where(CheckOutRecord.user_id == str(user_id))

        query = query.order_by(CheckOutRecord.checked_out_at.desc())

        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_overdue_checkouts(
        self, organization_id: UUID
    ) -> List[CheckOutRecord]:
        """Get all overdue checkouts"""
        now = datetime.now()

        # Update overdue status
        await self.db.execute(
            update(CheckOutRecord)
            .where(CheckOutRecord.organization_id == str(organization_id))
            .where(CheckOutRecord.is_returned == False)
            .where(CheckOutRecord.expected_return_at < now)
            .values(is_overdue=True)
        )
        await self.db.commit()

        # Get overdue items
        result = await self.db.execute(
            select(CheckOutRecord)
            .where(CheckOutRecord.organization_id == str(organization_id))
            .where(CheckOutRecord.is_overdue == True)
            .options(
                selectinload(CheckOutRecord.item),
                selectinload(CheckOutRecord.user),
            )
            .order_by(CheckOutRecord.expected_return_at)
        )
        return result.scalars().all()

    # ============================================
    # Maintenance Management
    # ============================================

    async def create_maintenance_record(
        self,
        item_id: UUID,
        organization_id: UUID,
        maintenance_data: Dict[str, Any],
        created_by: UUID,
    ) -> Tuple[Optional[MaintenanceRecord], Optional[str]]:
        """Create a maintenance record"""
        try:
            maintenance = MaintenanceRecord(
                organization_id=organization_id,
                item_id=item_id,
                created_by=created_by,
                **maintenance_data
            )
            self.db.add(maintenance)

            # If maintenance is completed, update item
            if maintenance_data.get("is_completed") and maintenance_data.get("condition_after"):
                item = await self.get_item_by_id(item_id, organization_id)
                if item:
                    item.condition = maintenance_data["condition_after"]
                    if maintenance_data.get("completed_date"):
                        item.last_inspection_date = maintenance_data["completed_date"]

            await self.db.commit()
            await self.db.refresh(maintenance)
            return maintenance, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_maintenance_due(
        self, organization_id: UUID, days_ahead: int = 30
    ) -> List[InventoryItem]:
        """Get items with maintenance due within specified days"""
        cutoff_date = date.today() + timedelta(days=days_ahead)

        result = await self.db.execute(
            select(InventoryItem)
            .where(InventoryItem.organization_id == str(organization_id))
            .where(InventoryItem.active == True)
            .where(InventoryItem.next_inspection_due <= cutoff_date)
            .options(selectinload(InventoryItem.category))
            .order_by(InventoryItem.next_inspection_due)
        )
        return result.scalars().all()

    async def get_item_maintenance_history(
        self, item_id: UUID, organization_id: UUID
    ) -> List[MaintenanceRecord]:
        """Get maintenance history for an item"""
        result = await self.db.execute(
            select(MaintenanceRecord)
            .where(MaintenanceRecord.item_id == str(item_id))
            .where(MaintenanceRecord.organization_id == str(organization_id))
            .options(selectinload(MaintenanceRecord.technician))
            .order_by(MaintenanceRecord.completed_date.desc())
        )
        return result.scalars().all()

    # ============================================
    # Reporting & Analytics
    # ============================================

    async def get_low_stock_items(
        self, organization_id: UUID
    ) -> List[Dict[str, Any]]:
        """Get categories with low stock"""
        result = await self.db.execute(
            select(
                InventoryCategory,
                func.count(InventoryItem.id).label("current_stock"),
            )
            .join(InventoryItem, InventoryCategory.id == InventoryItem.category_id)
            .where(InventoryCategory.organization_id == str(organization_id))
            .where(InventoryCategory.active == True)
            .where(InventoryItem.active == True)
            .where(InventoryCategory.low_stock_threshold.isnot(None))
            .group_by(InventoryCategory.id)
            .having(func.count(InventoryItem.id) <= InventoryCategory.low_stock_threshold)
        )

        low_stock_items = []
        for category, current_stock in result.all():
            low_stock_items.append({
                "category_id": category.id,
                "category_name": category.name,
                "item_type": category.item_type,
                "current_stock": current_stock,
                "threshold": category.low_stock_threshold,
            })

        return low_stock_items

    async def get_inventory_summary(
        self, organization_id: UUID
    ) -> Dict[str, Any]:
        """Get overall inventory summary statistics"""
        # Total items
        total_result = await self.db.execute(
            select(func.count(InventoryItem.id))
            .where(InventoryItem.organization_id == str(organization_id))
            .where(InventoryItem.active == True)
        )
        total_items = total_result.scalar()

        # Items by status
        status_result = await self.db.execute(
            select(
                InventoryItem.status,
                func.count(InventoryItem.id).label("count"),
            )
            .where(InventoryItem.organization_id == str(organization_id))
            .where(InventoryItem.active == True)
            .group_by(InventoryItem.status)
        )
        items_by_status = {row.status.value: row.count for row in status_result.all()}

        # Items by condition
        condition_result = await self.db.execute(
            select(
                InventoryItem.condition,
                func.count(InventoryItem.id).label("count"),
            )
            .where(InventoryItem.organization_id == str(organization_id))
            .where(InventoryItem.active == True)
            .group_by(InventoryItem.condition)
        )
        items_by_condition = {row.condition.value: row.count for row in condition_result.all()}

        # Total value
        value_result = await self.db.execute(
            select(func.sum(InventoryItem.current_value))
            .where(InventoryItem.organization_id == str(organization_id))
            .where(InventoryItem.active == True)
        )
        total_value = value_result.scalar() or Decimal("0.00")

        # Active checkouts
        checkout_result = await self.db.execute(
            select(func.count(CheckOutRecord.id))
            .where(CheckOutRecord.organization_id == str(organization_id))
            .where(CheckOutRecord.is_returned == False)
        )
        active_checkouts = checkout_result.scalar()

        # Overdue checkouts
        overdue_result = await self.db.execute(
            select(func.count(CheckOutRecord.id))
            .where(CheckOutRecord.organization_id == str(organization_id))
            .where(CheckOutRecord.is_overdue == True)
        )
        overdue_checkouts = overdue_result.scalar()

        # Maintenance due
        maintenance_due = await self.get_maintenance_due(organization_id, days_ahead=7)

        return {
            "total_items": total_items,
            "items_by_status": items_by_status,
            "items_by_condition": items_by_condition,
            "total_value": float(total_value),
            "active_checkouts": active_checkouts,
            "overdue_checkouts": overdue_checkouts,
            "maintenance_due_count": len(maintenance_due),
        }

    async def get_user_inventory(
        self, user_id: UUID, organization_id: UUID
    ) -> Dict[str, Any]:
        """Get all inventory items for a specific user (for dashboard)"""
        # Permanent assignments
        assignments = await self.get_user_assignments(user_id, organization_id, active_only=True)

        # Active checkouts
        checkouts = await self.get_active_checkouts(organization_id, user_id=user_id)

        return {
            "permanent_assignments": [
                {
                    "assignment_id": a.id,
                    "item_id": a.item.id,
                    "item_name": a.item.name,
                    "serial_number": a.item.serial_number,
                    "asset_tag": a.item.asset_tag,
                    "condition": a.item.condition.value,
                    "assigned_date": a.assigned_date,
                }
                for a in assignments
            ],
            "active_checkouts": [
                {
                    "checkout_id": c.id,
                    "item_id": c.item.id,
                    "item_name": c.item.name,
                    "checked_out_at": c.checked_out_at,
                    "expected_return_at": c.expected_return_at,
                    "is_overdue": c.is_overdue,
                }
                for c in checkouts
            ],
        }
