"""
Inventory Service

Business logic for inventory management including items, categories,
assignments, checkouts, maintenance, and reporting.
"""

from typing import List, Optional, Dict, Tuple, Any
from datetime import datetime, date, timedelta
from io import BytesIO
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, update, delete
from sqlalchemy.orm import selectinload, joinedload
from uuid import UUID
from decimal import Decimal

from app.models.inventory import (
    InventoryCategory,
    InventoryItem,
    ItemAssignment,
    ItemIssuance,
    CheckOutRecord,
    MaintenanceRecord,
    ItemType,
    ItemCondition,
    ItemStatus,
    MaintenanceType,
    AssignmentType,
    TrackingType,
)
from app.models.user import User


class InventoryService:
    """Service for inventory management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Notification helper
    # ------------------------------------------------------------------

    async def _queue_inventory_notification(
        self,
        organization_id,
        user_id,
        action_type,
        item: "InventoryItem",
        quantity: int = 1,
        performed_by=None,
    ) -> None:
        """Queue a delayed notification for an inventory change."""
        try:
            from app.services.inventory_notification_service import InventoryNotificationService
            from app.models.inventory import InventoryActionType
            svc = InventoryNotificationService(self.db)
            await svc.queue_notification(
                organization_id=str(organization_id),
                user_id=str(user_id),
                action_type=action_type,
                item=item,
                quantity=quantity,
                performed_by=str(performed_by) if performed_by else None,
            )
        except Exception as e:
            # Notification queue failure must not break the primary operation
            from loguru import logger
            logger.warning(f"Failed to queue inventory notification: {e}")

    # ============================================
    # Category Management
    # ============================================

    async def create_category(
        self, organization_id: UUID, category_data: Dict[str, Any], created_by: UUID
    ) -> Tuple[Optional[InventoryCategory], Optional[str]]:
        """Create a new inventory category"""
        try:
            # Rename "metadata" → "extra_data" (DB column name; "metadata" is reserved by SQLAlchemy)
            if "metadata" in category_data:
                category_data["extra_data"] = category_data.pop("metadata")
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

            # Queue notification
            from app.models.inventory import InventoryActionType
            await self._queue_inventory_notification(
                organization_id, user_id, InventoryActionType.ASSIGNED,
                item, performed_by=assigned_by,
            )

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

            # Queue notification
            from app.models.inventory import InventoryActionType
            await self._queue_inventory_notification(
                organization_id, previous_user_id, InventoryActionType.UNASSIGNED,
                item, performed_by=returned_by,
            )

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
    # Pool Item Issuance Management
    # ============================================

    async def issue_from_pool(
        self,
        item_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        issued_by: UUID,
        quantity: int = 1,
        reason: Optional[str] = None,
    ) -> Tuple[Optional["ItemIssuance"], Optional[str]]:
        """Issue units from a pool-tracked item to a member."""
        try:
            item = await self.get_item_by_id(item_id, organization_id)
            if not item:
                return None, "Item not found"

            if item.tracking_type != TrackingType.POOL:
                return None, "Item is not a pool-tracked item. Use assign for individual items."

            if not item.active:
                return None, "Item is retired or inactive"

            if item.quantity < quantity:
                return None, f"Insufficient stock: {item.quantity} available, {quantity} requested"

            # Decrement pool quantity, increment issued count
            item.quantity -= quantity
            item.quantity_issued = (item.quantity_issued or 0) + quantity

            # Create issuance record
            issuance = ItemIssuance(
                organization_id=organization_id,
                item_id=item_id,
                user_id=user_id,
                quantity_issued=quantity,
                issued_by=issued_by,
                issue_reason=reason,
                is_returned=False,
            )
            self.db.add(issuance)

            # Queue notification
            from app.models.inventory import InventoryActionType
            await self._queue_inventory_notification(
                organization_id, user_id, InventoryActionType.ISSUED,
                item, quantity=quantity, performed_by=issued_by,
            )

            await self.db.commit()
            await self.db.refresh(issuance)
            return issuance, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def return_to_pool(
        self,
        issuance_id: UUID,
        organization_id: UUID,
        returned_by: UUID,
        return_condition: Optional[ItemCondition] = None,
        return_notes: Optional[str] = None,
        quantity_returned: Optional[int] = None,
    ) -> Tuple[bool, Optional[str]]:
        """Return issued units back to the pool."""
        try:
            result = await self.db.execute(
                select(ItemIssuance)
                .where(ItemIssuance.id == str(issuance_id))
                .where(ItemIssuance.organization_id == str(organization_id))
                .options(selectinload(ItemIssuance.item))
            )
            issuance = result.scalar_one_or_none()

            if not issuance:
                return False, "Issuance record not found"

            if issuance.is_returned:
                return False, "These units have already been returned"

            qty = quantity_returned or issuance.quantity_issued
            if qty > issuance.quantity_issued:
                return False, f"Cannot return {qty} units; only {issuance.quantity_issued} were issued"

            # Capture user_id for auto-archive check
            issuance_user_id = str(issuance.user_id)

            # Update pool item counts
            item = issuance.item
            item.quantity += qty
            item.quantity_issued = max(0, (item.quantity_issued or 0) - qty)

            # Handle partial return: reduce issuance quantity_issued and leave open
            if qty < issuance.quantity_issued:
                issuance.quantity_issued -= qty
                # issuance stays open (is_returned=False) for the remaining units
            else:
                # Full return
                issuance.is_returned = True
                issuance.returned_at = datetime.now()
                issuance.returned_by = returned_by
                issuance.return_condition = return_condition
                issuance.return_notes = return_notes

            # Queue notification
            from app.models.inventory import InventoryActionType
            await self._queue_inventory_notification(
                organization_id, issuance_user_id, InventoryActionType.RETURNED,
                item, quantity=qty, performed_by=returned_by,
            )

            await self.db.commit()

            # Check if the dropped member should be auto-archived
            from app.services.member_archive_service import check_and_auto_archive
            await check_and_auto_archive(self.db, issuance_user_id, str(organization_id))

            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def get_item_issuances(
        self,
        item_id: UUID,
        organization_id: UUID,
        active_only: bool = True,
    ) -> List["ItemIssuance"]:
        """Get all issuance records for a pool item."""
        query = (
            select(ItemIssuance)
            .where(ItemIssuance.item_id == str(item_id))
            .where(ItemIssuance.organization_id == str(organization_id))
            .options(selectinload(ItemIssuance.user))
        )
        if active_only:
            query = query.where(ItemIssuance.is_returned == False)
        query = query.order_by(ItemIssuance.issued_at.desc())

        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_user_issuances(
        self,
        user_id: UUID,
        organization_id: UUID,
        active_only: bool = True,
    ) -> List["ItemIssuance"]:
        """Get all active issuances for a user."""
        query = (
            select(ItemIssuance)
            .where(ItemIssuance.user_id == str(user_id))
            .where(ItemIssuance.organization_id == str(organization_id))
            .options(selectinload(ItemIssuance.item))
        )
        if active_only:
            query = query.where(ItemIssuance.is_returned == False)
        query = query.order_by(ItemIssuance.issued_at.desc())

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

            # Queue notification
            from app.models.inventory import InventoryActionType
            await self._queue_inventory_notification(
                organization_id, user_id, InventoryActionType.CHECKED_OUT,
                item, performed_by=checked_out_by,
            )

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

            # Queue notification
            from app.models.inventory import InventoryActionType
            await self._queue_inventory_notification(
                organization_id, checkout_user_id, InventoryActionType.CHECKED_IN,
                item, performed_by=checked_in_by,
            )

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

        # Active pool issuances
        issuances = await self.get_user_issuances(user_id, organization_id, active_only=True)

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
            "issued_items": [
                {
                    "issuance_id": i.id,
                    "item_id": i.item.id,
                    "item_name": i.item.name,
                    "quantity_issued": i.quantity_issued,
                    "issued_at": i.issued_at,
                    "size": i.item.size,
                }
                for i in issuances
            ],
        }

    async def get_members_inventory_summary(
        self, organization_id: UUID, search: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Return every active member in the organization with counts of their
        permanent assignments, active checkouts, active issuances, and overdue items.
        """
        org_id = str(organization_id)

        # Base query: all active users in the organization
        user_q = (
            select(User)
            .where(User.organization_id == org_id)
            .where(User.status == "active")
        )
        if search:
            pattern = f"%{search}%"
            user_q = user_q.where(
                or_(
                    User.username.ilike(pattern),
                    User.first_name.ilike(pattern),
                    User.last_name.ilike(pattern),
                    User.membership_number.ilike(pattern),
                )
            )
        user_q = user_q.order_by(User.last_name, User.first_name)
        users_result = await self.db.execute(user_q)
        users = users_result.scalars().all()

        if not users:
            return []

        user_ids = [str(u.id) for u in users]

        # Count permanent assignments per user
        assign_q = await self.db.execute(
            select(
                ItemAssignment.user_id,
                func.count(ItemAssignment.id).label("cnt"),
            )
            .where(ItemAssignment.user_id.in_(user_ids))
            .where(ItemAssignment.is_active == True)
            .group_by(ItemAssignment.user_id)
        )
        assign_counts = {row.user_id: row.cnt for row in assign_q.all()}

        # Count active checkouts per user
        checkout_q = await self.db.execute(
            select(
                CheckOutRecord.user_id,
                func.count(CheckOutRecord.id).label("cnt"),
            )
            .where(CheckOutRecord.user_id.in_(user_ids))
            .where(CheckOutRecord.is_returned == False)
            .group_by(CheckOutRecord.user_id)
        )
        checkout_counts = {row.user_id: row.cnt for row in checkout_q.all()}

        # Count overdue checkouts per user
        overdue_q = await self.db.execute(
            select(
                CheckOutRecord.user_id,
                func.count(CheckOutRecord.id).label("cnt"),
            )
            .where(CheckOutRecord.user_id.in_(user_ids))
            .where(CheckOutRecord.is_returned == False)
            .where(CheckOutRecord.is_overdue == True)
            .group_by(CheckOutRecord.user_id)
        )
        overdue_counts = {row.user_id: row.cnt for row in overdue_q.all()}

        # Count active issuances per user
        issue_q = await self.db.execute(
            select(
                ItemIssuance.user_id,
                func.count(ItemIssuance.id).label("cnt"),
            )
            .where(ItemIssuance.user_id.in_(user_ids))
            .where(ItemIssuance.is_returned == False)
            .group_by(ItemIssuance.user_id)
        )
        issue_counts = {row.user_id: row.cnt for row in issue_q.all()}

        result = []
        for u in users:
            uid = str(u.id)
            perm = assign_counts.get(uid, 0)
            co = checkout_counts.get(uid, 0)
            iss = issue_counts.get(uid, 0)
            full_name = " ".join(filter(None, [u.first_name, u.last_name])) or None
            result.append({
                "user_id": u.id,
                "username": u.username,
                "first_name": u.first_name,
                "last_name": u.last_name,
                "full_name": full_name,
                "membership_number": u.membership_number,
                "permanent_count": perm,
                "checkout_count": co,
                "issued_count": iss,
                "overdue_count": overdue_counts.get(uid, 0),
                "total_items": perm + co + iss,
            })
        return result

    # ============================================
    # Barcode / Serial / Asset Tag Lookup
    # ============================================

    async def lookup_by_code(
        self, code: str, organization_id: UUID
    ) -> Optional[Tuple[InventoryItem, str, str]]:
        """
        Look up an item by barcode, serial number, or asset tag.
        Returns (item, matched_field, matched_value) or None.
        Checks barcode first, then serial_number, then asset_tag.
        """
        code = code.strip()
        if not code:
            return None

        org_id = str(organization_id)

        # Try barcode
        result = await self.db.execute(
            select(InventoryItem)
            .where(
                InventoryItem.organization_id == org_id,
                InventoryItem.barcode == code,
                InventoryItem.active == True,
            )
            .options(selectinload(InventoryItem.category))
        )
        item = result.scalar_one_or_none()
        if item:
            return item, "barcode", code

        # Try serial number
        result = await self.db.execute(
            select(InventoryItem)
            .where(
                InventoryItem.organization_id == org_id,
                InventoryItem.serial_number == code,
                InventoryItem.active == True,
            )
            .options(selectinload(InventoryItem.category))
        )
        item = result.scalar_one_or_none()
        if item:
            return item, "serial_number", code

        # Try asset tag
        result = await self.db.execute(
            select(InventoryItem)
            .where(
                InventoryItem.organization_id == org_id,
                InventoryItem.asset_tag == code,
                InventoryItem.active == True,
            )
            .options(selectinload(InventoryItem.category))
        )
        item = result.scalar_one_or_none()
        if item:
            return item, "asset_tag", code

        return None

    async def search_by_code(
        self,
        code: str,
        organization_id: UUID,
        limit: int = 20,
    ) -> List[Tuple[InventoryItem, str, str]]:
        """
        Search items by partial barcode, serial number, or asset tag.
        Returns a list of (item, matched_field, matched_value) tuples.
        Uses substring matching so partial codes return results.
        """
        code = code.strip()
        if not code:
            return []

        org_id = str(organization_id)
        search_term = f"%{code}%"
        results: List[Tuple[InventoryItem, str, str]] = []
        seen_ids: set = set()

        # Search barcode, serial_number, asset_tag in order of priority
        fields = [
            ("barcode", InventoryItem.barcode),
            ("serial_number", InventoryItem.serial_number),
            ("asset_tag", InventoryItem.asset_tag),
        ]

        for field_name, field_col in fields:
            if len(results) >= limit:
                break

            result = await self.db.execute(
                select(InventoryItem)
                .where(
                    InventoryItem.organization_id == org_id,
                    field_col.ilike(search_term),
                    InventoryItem.active == True,
                )
                .options(selectinload(InventoryItem.category))
                .limit(limit - len(results))
            )
            for item in result.scalars().all():
                if item.id not in seen_ids:
                    seen_ids.add(item.id)
                    matched_value = getattr(item, field_name) or ""
                    results.append((item, field_name, matched_value))

        return results

    # ============================================
    # Batch Checkout (scan-to-assign)
    # ============================================

    async def batch_checkout(
        self,
        user_id: UUID,
        organization_id: UUID,
        performed_by: UUID,
        items: List[Dict[str, Any]],
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Process a batch of scanned items: assign, checkout, or issue
        each one to the specified user based on the item's tracking type
        and current status.

        Returns a summary with per-item results.
        """
        results = []
        successful = 0
        failed = 0

        for scan in items:
            code = scan["code"]
            quantity = scan.get("quantity", 1)

            lookup = await self.lookup_by_code(code, organization_id)
            if not lookup:
                results.append({
                    "code": code,
                    "item_name": "Unknown",
                    "item_id": "",
                    "action": "none",
                    "success": False,
                    "error": f"No item found for code '{code}'",
                })
                failed += 1
                continue

            item, matched_field, matched_value = lookup

            try:
                if item.tracking_type == TrackingType.POOL:
                    # Pool item → issue
                    issuance, err = await self.issue_from_pool(
                        item_id=UUID(item.id),
                        user_id=user_id,
                        organization_id=organization_id,
                        issued_by=performed_by,
                        quantity=quantity,
                        reason=reason,
                    )
                    if err:
                        results.append({
                            "code": code, "item_name": item.name,
                            "item_id": item.id, "action": "issued",
                            "success": False, "error": err,
                        })
                        failed += 1
                    else:
                        results.append({
                            "code": code, "item_name": item.name,
                            "item_id": item.id, "action": "issued",
                            "success": True, "error": None,
                        })
                        successful += 1

                elif item.status in (ItemStatus.AVAILABLE, ItemStatus.ASSIGNED):
                    # Individual available/assigned item → (re)assign
                    assignment, err = await self.assign_item_to_user(
                        item_id=UUID(item.id),
                        user_id=user_id,
                        organization_id=organization_id,
                        assigned_by=performed_by,
                        assignment_type=AssignmentType.PERMANENT,
                        reason=reason,
                    )
                    if err:
                        results.append({
                            "code": code, "item_name": item.name,
                            "item_id": item.id, "action": "assigned",
                            "success": False, "error": err,
                        })
                        failed += 1
                    else:
                        results.append({
                            "code": code, "item_name": item.name,
                            "item_id": item.id, "action": "assigned",
                            "success": True, "error": None,
                        })
                        successful += 1

                else:
                    results.append({
                        "code": code, "item_name": item.name,
                        "item_id": item.id, "action": "none",
                        "success": False,
                        "error": f"Item is not available (status: {item.status.value})",
                    })
                    failed += 1

            except Exception as e:
                results.append({
                    "code": code, "item_name": item.name if item else "Unknown",
                    "item_id": item.id if item else "",
                    "action": "none", "success": False, "error": str(e),
                })
                failed += 1

        return {
            "user_id": str(user_id),
            "total_scanned": len(items),
            "successful": successful,
            "failed": failed,
            "results": results,
        }

    # ============================================
    # Batch Return (scan-to-return)
    # ============================================

    async def batch_return(
        self,
        user_id: UUID,
        organization_id: UUID,
        performed_by: UUID,
        items: List[Dict[str, Any]],
        notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Process a batch of scanned items being returned by a member.
        Determines the correct return operation (unassign, check-in,
        or pool return) based on how the item is currently held.
        """
        from app.models.inventory import ItemCondition as IC

        results = []
        successful = 0
        failed = 0
        user_id_str = str(user_id)

        for scan in items:
            code = scan["code"]
            condition_str = scan.get("return_condition", "good")
            damage_notes = scan.get("damage_notes")
            quantity = scan.get("quantity", 1)

            lookup = await self.lookup_by_code(code, organization_id)
            if not lookup:
                results.append({
                    "code": code, "item_name": "Unknown", "item_id": "",
                    "action": "none", "success": False,
                    "error": f"No item found for code '{code}'",
                })
                failed += 1
                continue

            item, _, _ = lookup

            try:
                condition = IC(condition_str)
            except ValueError:
                condition = IC.GOOD

            try:
                # Check if this item is assigned to the user
                if (
                    item.tracking_type == TrackingType.INDIVIDUAL
                    and item.assigned_to_user_id == user_id_str
                ):
                    success, err = await self.unassign_item(
                        item_id=UUID(item.id),
                        organization_id=organization_id,
                        returned_by=performed_by,
                        return_condition=condition,
                        return_notes=damage_notes or notes,
                    )
                    if err:
                        results.append({
                            "code": code, "item_name": item.name,
                            "item_id": item.id, "action": "unassigned",
                            "success": False, "error": err,
                        })
                        failed += 1
                    else:
                        results.append({
                            "code": code, "item_name": item.name,
                            "item_id": item.id, "action": "unassigned",
                            "success": True, "error": None,
                        })
                        successful += 1
                    continue

                # Check if checked out to this user
                checkout_result = await self.db.execute(
                    select(CheckOutRecord)
                    .where(
                        CheckOutRecord.organization_id == str(organization_id),
                        CheckOutRecord.item_id == str(item.id),
                        CheckOutRecord.user_id == user_id_str,
                        CheckOutRecord.is_returned == False,
                    )
                    .order_by(CheckOutRecord.checked_out_at.desc())
                    .limit(1)
                )
                checkout = checkout_result.scalar_one_or_none()
                if checkout:
                    success, err = await self.checkin_item(
                        checkout_id=UUID(checkout.id),
                        organization_id=organization_id,
                        checked_in_by=performed_by,
                        return_condition=condition,
                        damage_notes=damage_notes,
                    )
                    if err:
                        results.append({
                            "code": code, "item_name": item.name,
                            "item_id": item.id, "action": "checked_in",
                            "success": False, "error": err,
                        })
                        failed += 1
                    else:
                        results.append({
                            "code": code, "item_name": item.name,
                            "item_id": item.id, "action": "checked_in",
                            "success": True, "error": None,
                        })
                        successful += 1
                    continue

                # Check for pool issuance to this user
                if item.tracking_type == TrackingType.POOL:
                    issuance_result = await self.db.execute(
                        select(ItemIssuance)
                        .where(
                            ItemIssuance.organization_id == str(organization_id),
                            ItemIssuance.item_id == str(item.id),
                            ItemIssuance.user_id == user_id_str,
                            ItemIssuance.is_returned == False,
                        )
                        .order_by(ItemIssuance.issued_at.desc())
                        .limit(1)
                    )
                    issuance = issuance_result.scalar_one_or_none()
                    if issuance:
                        success, err = await self.return_to_pool(
                            issuance_id=UUID(issuance.id),
                            organization_id=organization_id,
                            returned_by=performed_by,
                            return_condition=condition,
                            return_notes=damage_notes or notes,
                            quantity_returned=quantity,
                        )
                        if err:
                            results.append({
                                "code": code, "item_name": item.name,
                                "item_id": item.id, "action": "returned_to_pool",
                                "success": False, "error": err,
                            })
                            failed += 1
                        else:
                            results.append({
                                "code": code, "item_name": item.name,
                                "item_id": item.id, "action": "returned_to_pool",
                                "success": True, "error": None,
                            })
                            successful += 1
                        continue

                # Item not held by this user
                results.append({
                    "code": code, "item_name": item.name,
                    "item_id": item.id, "action": "none",
                    "success": False,
                    "error": "Item is not assigned to, checked out by, or issued to this member",
                })
                failed += 1

            except Exception as e:
                results.append({
                    "code": code, "item_name": item.name if item else "Unknown",
                    "item_id": item.id if item else "",
                    "action": "none", "success": False, "error": str(e),
                })
                failed += 1

        return {
            "user_id": str(user_id),
            "total_scanned": len(items),
            "successful": successful,
            "failed": failed,
            "results": results,
        }

    # ============================================
    # Barcode Label Generation
    # ============================================

    async def generate_barcode_labels(
        self,
        item_ids: List[UUID],
        organization_id: UUID,
    ) -> BytesIO:
        """
        Generate a PDF containing barcode labels for the given items.
        Each label shows the item name, barcode value, and a Code128 barcode.
        Labels are laid out in a 2-column grid on letter-size pages.
        """
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import inch
        from reportlab.graphics.barcode import code128
        from reportlab.pdfgen import canvas

        items = []
        for item_id in item_ids:
            item = await self.get_item_by_id(item_id, organization_id)
            if item:
                items.append(item)

        if not items:
            raise ValueError("No valid items found for label generation")

        buf = BytesIO()
        c = canvas.Canvas(buf, pagesize=letter)
        page_w, page_h = letter

        # Label layout: 2 columns, 5 rows per page
        cols = 2
        rows = 5
        margin_x = 0.5 * inch
        margin_y = 0.5 * inch
        label_w = (page_w - 2 * margin_x) / cols
        label_h = (page_h - 2 * margin_y) / rows
        labels_per_page = cols * rows

        for idx, item in enumerate(items):
            if idx > 0 and idx % labels_per_page == 0:
                c.showPage()

            pos = idx % labels_per_page
            col = pos % cols
            row = pos // cols

            x = margin_x + col * label_w
            y = page_h - margin_y - (row + 1) * label_h

            # Label border (light gray)
            c.setStrokeColorRGB(0.8, 0.8, 0.8)
            c.setLineWidth(0.5)
            c.rect(x + 4, y + 4, label_w - 8, label_h - 8)

            # Barcode value — use barcode, then asset_tag, then serial_number
            barcode_value = item.barcode or item.asset_tag or item.serial_number or item.id[:12]

            # Item name (truncated)
            c.setFont("Helvetica-Bold", 9)
            name = item.name[:40] + ("..." if len(item.name) > 40 else "")
            c.drawString(x + 10, y + label_h - 22, name)

            # Secondary info line
            c.setFont("Helvetica", 7)
            info_parts = []
            if item.asset_tag:
                info_parts.append(f"Asset: {item.asset_tag}")
            if item.serial_number:
                info_parts.append(f"S/N: {item.serial_number}")
            if info_parts:
                c.drawString(x + 10, y + label_h - 34, "  |  ".join(info_parts))

            # Barcode
            barcode_obj = code128.Code128(
                barcode_value, barWidth=0.012 * inch, barHeight=0.45 * inch
            )
            barcode_width = barcode_obj.width
            # Center barcode horizontally in label
            barcode_x = x + (label_w - barcode_width) / 2
            barcode_obj.drawOn(c, barcode_x, y + 22)

            # Barcode text below
            c.setFont("Courier", 7)
            c.drawCentredString(x + label_w / 2, y + 12, barcode_value)

        c.save()
        buf.seek(0)
        return buf
