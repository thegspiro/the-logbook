"""
Inventory Service

Business logic for inventory management including items, categories,
assignments, checkouts, maintenance, and reporting.
"""

import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.inventory import (
    AssignmentType,
    CheckOutRecord,
    InventoryActionType,
    InventoryCategory,
    InventoryItem,
    ItemAssignment,
    ItemCondition,
    ItemIssuance,
    ItemStatus,
    ItemType,
    MaintenanceRecord,
    TrackingType,
    WriteOffRequest,
    WriteOffStatus,
)
from app.models.user import User

logger = logging.getLogger(__name__)

# Valid status→condition combinations.  If a status is listed here,
# only the listed conditions are allowed.
_VALID_STATE_COMBOS: dict[ItemStatus, set[ItemCondition] | None] = {
    ItemStatus.RETIRED: {ItemCondition.RETIRED},
}

# Conditions that are forced when entering a status
_FORCED_CONDITION: dict[ItemStatus, ItemCondition] = {
    ItemStatus.RETIRED: ItemCondition.RETIRED,
}

# Statuses that require assigned_to_user_id to be set
_REQUIRES_ASSIGNED_USER = {ItemStatus.ASSIGNED}


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
            from app.services.inventory_notification_service import (
                InventoryNotificationService,
            )

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

    # ------------------------------------------------------------------
    # State validation helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_item_state(
        status_val: ItemStatus, condition_val: ItemCondition, assigned_to_user_id=None
    ) -> Optional[str]:
        """Return an error string if the status/condition combination is invalid."""
        allowed = _VALID_STATE_COMBOS.get(status_val)
        if allowed is not None and condition_val not in allowed:
            return (
                f"Invalid state: status '{status_val.value}' requires condition "
                f"in {[c.value for c in allowed]}, got '{condition_val.value}'"
            )
        if status_val in _REQUIRES_ASSIGNED_USER and not assigned_to_user_id:
            return f"Status '{status_val.value}' requires an assigned user"
        return None

    async def _validate_category_requirements(
        self, item_data: Dict[str, Any], organization_id
    ) -> Optional[str]:
        """Validate that item_data satisfies category requires_* flags."""
        cat_id = item_data.get("category_id")
        if not cat_id:
            return None
        category = await self.get_category_by_id(cat_id, organization_id)
        if not category:
            return None
        if category.requires_serial_number and not item_data.get("serial_number"):
            return f"Category '{category.name}' requires a serial number"
        if category.requires_maintenance and not item_data.get(
            "inspection_interval_days"
        ):
            return f"Category '{category.name}' requires an inspection interval"
        return None

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
                organization_id=organization_id, created_by=created_by, **category_data
            )
            self.db.add(category)
            await self.db.commit()
            await self.db.refresh(category)
            return category, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_categories(
        self,
        organization_id: UUID,
        item_type: Optional[ItemType] = None,
        active_only: bool = True,
        skip: int = 0,
        limit: int = 200,
    ) -> List[InventoryCategory]:
        """Get categories for an organization with pagination"""
        query = select(InventoryCategory).where(
            InventoryCategory.organization_id == organization_id
        )

        if item_type:
            query = query.where(InventoryCategory.item_type == item_type)

        if active_only:
            query = query.where(InventoryCategory.active == True)  # noqa: E712

        query = query.order_by(InventoryCategory.name).offset(skip).limit(limit)

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

    async def update_category(
        self,
        category_id: UUID,
        organization_id: UUID,
        update_data: Dict[str, Any],
    ) -> Tuple[Optional[InventoryCategory], Optional[str]]:
        """Update an inventory category"""
        try:
            category = await self.get_category_by_id(category_id, organization_id)
            if not category:
                return None, "Category not found"

            # Rename "metadata" → "extra_data" (DB column name)
            if "metadata" in update_data:
                update_data["extra_data"] = update_data.pop("metadata")

            for key, value in update_data.items():
                if hasattr(category, key):
                    setattr(category, key, value)

            await self.db.commit()
            await self.db.refresh(category)
            return category, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    # ============================================
    # Item Management
    # ============================================

    async def _check_serial_number_unique(
        self,
        serial_number: str,
        organization_id: UUID,
        exclude_item_id: Optional[UUID] = None,
    ) -> Optional[str]:
        """Check that serial_number is unique within the organization."""
        if not serial_number:
            return None
        query = select(func.count(InventoryItem.id)).where(
            InventoryItem.organization_id == str(organization_id),
            InventoryItem.serial_number == serial_number,
            InventoryItem.active == True,  # noqa: E712
        )
        if exclude_item_id:
            query = query.where(InventoryItem.id != str(exclude_item_id))
        result = await self.db.execute(query)
        if result.scalar():
            return f"Serial number '{serial_number}' is already in use by another item in this organization"
        return None

    async def create_item(
        self, organization_id: UUID, item_data: Dict[str, Any], created_by: UUID
    ) -> Tuple[Optional[InventoryItem], Optional[str]]:
        """Create a new inventory item"""
        try:
            # Validate category requirements
            cat_err = await self._validate_category_requirements(
                item_data, organization_id
            )
            if cat_err:
                return None, cat_err

            # Validate pool items have quantity >= 1
            tracking = item_data.get("tracking_type", "individual")
            if tracking == "pool" and item_data.get("quantity", 1) < 1:
                return None, "Pool items must have a quantity of at least 1"

            # Validate serial number uniqueness within the organization
            sn_err = await self._check_serial_number_unique(
                item_data.get("serial_number", ""), organization_id
            )
            if sn_err:
                return None, sn_err

            # Validate status/condition state
            status_val = ItemStatus(item_data.get("status", "available"))
            condition_val = ItemCondition(item_data.get("condition", "good"))
            state_err = self._validate_item_state(status_val, condition_val)
            if state_err:
                return None, state_err

            # Initialize current_value from purchase_price so it counts in Total Value
            if "purchase_price" in item_data and "current_value" not in item_data:
                item_data["current_value"] = item_data["purchase_price"]

            # Auto-generate a barcode if none was provided.  Format: INV-XXXXXXXX
            # (8 uppercase alphanumeric chars derived from the item's UUID).
            if not item_data.get("barcode"):
                from app.core.utils import generate_uuid as _gen

                raw_id = _gen().replace("-", "").upper()[:8]
                item_data["barcode"] = f"INV-{raw_id}"

            item = InventoryItem(
                organization_id=organization_id, created_by=created_by, **item_data
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
        storage_area_id: Optional[UUID] = None,
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

        if storage_area_id:
            query = query.where(InventoryItem.storage_area_id == str(storage_area_id))

        if search:
            safe_search = (
                search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            )
            search_term = f"%{safe_search}%"
            query = query.where(
                or_(
                    InventoryItem.name.ilike(search_term),
                    InventoryItem.serial_number.ilike(search_term),
                    InventoryItem.asset_tag.ilike(search_term),
                    InventoryItem.barcode.ilike(search_term),
                    InventoryItem.description.ilike(search_term),
                    InventoryItem.manufacturer.ilike(search_term),
                    InventoryItem.model_number.ilike(search_term),
                    InventoryItem.size.ilike(search_term),
                    InventoryItem.color.ilike(search_term),
                )
            )

        if active_only:
            query = query.where(InventoryItem.active == True)  # noqa: E712

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

    async def _get_item_locked(
        self, item_id: UUID, organization_id: UUID
    ) -> Optional[InventoryItem]:
        """Get item by ID with a row-level lock (SELECT FOR UPDATE).

        Use this instead of get_item_by_id when the caller intends to
        mutate the item's status, condition, quantity, or assignment
        fields, to prevent concurrent-modification races.
        """
        result = await self.db.execute(
            select(InventoryItem)
            .where(InventoryItem.id == str(item_id))
            .where(InventoryItem.organization_id == str(organization_id))
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def update_item(
        self, item_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[InventoryItem], Optional[str]]:
        """Update an inventory item"""
        try:
            # Lock the row when status, condition, or assignment changes to
            # prevent concurrent mutations from creating inconsistent state.
            needs_lock = bool(
                {
                    "status",
                    "condition",
                    "assigned_to_user_id",
                    "quantity",
                    "quantity_issued",
                }
                & update_data.keys()
            )
            if needs_lock:
                item = await self._get_item_locked(item_id, organization_id)
            else:
                item = await self.get_item_by_id(item_id, organization_id)
            if not item:
                return None, "Item not found"

            # Validate category requirements if category is changing
            if "category_id" in update_data:
                merged = {
                    **{
                        "serial_number": item.serial_number,
                        "inspection_interval_days": item.inspection_interval_days,
                    },
                    **update_data,
                }
                cat_err = await self._validate_category_requirements(
                    merged, organization_id
                )
                if cat_err:
                    return None, cat_err

            # Validate serial number uniqueness if changing
            if (
                "serial_number" in update_data
                and update_data["serial_number"] != item.serial_number
            ):
                sn_err = await self._check_serial_number_unique(
                    update_data["serial_number"],
                    organization_id,
                    exclude_item_id=item_id,
                )
                if sn_err:
                    return None, sn_err

            # Validate pool quantity constraints
            if item.tracking_type == TrackingType.POOL and "quantity" in update_data:
                new_qty = update_data["quantity"]
                if new_qty < 0:
                    return None, "Pool item quantity cannot be negative"

            # Validate resulting state
            new_status = (
                ItemStatus(update_data["status"])
                if "status" in update_data
                else item.status
            )
            new_condition = (
                ItemCondition(update_data["condition"])
                if "condition" in update_data
                else item.condition
            )
            assigned_user = update_data.get(
                "assigned_to_user_id", item.assigned_to_user_id
            )
            state_err = self._validate_item_state(
                new_status, new_condition, assigned_user
            )
            if state_err:
                return None, state_err

            for key, value in update_data.items():
                setattr(item, key, value)

            # Keep current_value in sync when purchase_price changes
            if "purchase_price" in update_data and "current_value" not in update_data:
                item.current_value = update_data["purchase_price"]

            await self.db.commit()
            await self.db.refresh(item)
            return item, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def retire_item(
        self, item_id: UUID, organization_id: UUID, notes: Optional[str] = None
    ) -> Tuple[bool, Optional[str]]:
        """Retire an item (soft delete). Blocks if item has active checkouts or assignments."""
        try:
            item = await self.get_item_by_id(item_id, organization_id)
            if not item:
                return False, "Item not found"

            # Block retirement if item has active assignments
            if item.assigned_to_user_id:
                return (
                    False,
                    "Cannot retire: item is currently assigned. Unassign it first.",
                )

            # Block if item has active (unreturned) checkouts
            active_co = await self.db.execute(
                select(func.count(CheckOutRecord.id))
                .where(CheckOutRecord.item_id == str(item_id))
                .where(CheckOutRecord.is_returned == False)  # noqa: E712
            )
            if active_co.scalar():
                return (
                    False,
                    "Cannot retire: item has active checkouts. Check it in first.",
                )

            # Block if pool item has unreturned issuances
            if item.tracking_type == TrackingType.POOL:
                active_iss = await self.db.execute(
                    select(func.count(ItemIssuance.id))
                    .where(ItemIssuance.item_id == str(item_id))
                    .where(ItemIssuance.is_returned == False)  # noqa: E712
                )
                if active_iss.scalar():
                    return False, "Cannot retire: item has unreturned pool issuances."

            item.status = ItemStatus.RETIRED
            item.condition = ItemCondition.RETIRED
            item.active = False
            if notes:
                item.status_notes = notes

            # Log audit event for retirement within the service transaction
            from app.core.audit import log_audit_event

            await log_audit_event(
                db=self.db,
                event_type="inventory_item_retired",
                event_category="inventory",
                severity="warning",
                event_data={
                    "item_id": str(item_id),
                    "item_name": item.name,
                    "notes": notes,
                },
            )

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
            # Lock the item row to prevent concurrent modifications
            lock_result = await self.db.execute(
                select(InventoryItem)
                .where(InventoryItem.id == str(item_id))
                .where(InventoryItem.organization_id == str(organization_id))
                .with_for_update()
            )
            item = lock_result.scalar_one_or_none()
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
            item.assigned_date = datetime.now(timezone.utc)
            item.status = ItemStatus.ASSIGNED

            # Queue notification
            await self._queue_inventory_notification(
                organization_id,
                user_id,
                InventoryActionType.ASSIGNED,
                item,
                performed_by=assigned_by,
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
        expected_user_id: Optional[UUID] = None,
    ) -> Tuple[bool, Optional[str]]:
        """Unassign an item from its current user.

        If *expected_user_id* is provided, the operation will fail when the
        item is assigned to a different user — preventing stale-read races
        in batch operations.
        """
        try:
            # Lock the item row to prevent concurrent assign/unassign races
            item = await self._get_item_locked(item_id, organization_id)
            if not item:
                return False, "Item not found"

            if not item.assigned_to_user_id:
                return False, "Item is not currently assigned"

            if expected_user_id and str(item.assigned_to_user_id) != str(
                expected_user_id
            ):
                return False, "Item is not assigned to the expected user"

            # Capture user_id before clearing assignment (needed for auto-archive check)
            previous_user_id = str(item.assigned_to_user_id)

            # Update current active assignment
            result = await self.db.execute(
                select(ItemAssignment)
                .where(ItemAssignment.item_id == str(item_id))
                .where(ItemAssignment.is_active == True)  # noqa: E712
                .order_by(ItemAssignment.assigned_date.desc())
                .limit(1)
            )
            assignment = result.scalar_one_or_none()

            if assignment:
                assignment.is_active = False
                assignment.returned_date = datetime.now(timezone.utc)
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
            await self._queue_inventory_notification(
                organization_id,
                previous_user_id,
                InventoryActionType.UNASSIGNED,
                item,
                performed_by=returned_by,
            )

            await self.db.commit()

            # Check if the dropped member should be auto-archived.
            # Wrapped in try/except so a failure here doesn't mask
            # the already-committed unassign operation.
            try:
                from app.services.member_archive_service import check_and_auto_archive

                await check_and_auto_archive(
                    self.db, previous_user_id, str(organization_id)
                )
            except Exception as e:
                logger.warning(f"Auto-archive check failed after unassign: {e}")

            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def get_user_assignments(
        self,
        user_id: UUID,
        organization_id: UUID,
        active_only: bool = True,
        skip: int = 0,
        limit: int = 200,
    ) -> List[ItemAssignment]:
        """Get items assigned to a user with pagination"""
        query = (
            select(ItemAssignment)
            .where(ItemAssignment.user_id == str(user_id))
            .where(ItemAssignment.organization_id == str(organization_id))
            .options(
                selectinload(ItemAssignment.item).selectinload(InventoryItem.category),
            )
        )

        if active_only:
            query = query.where(ItemAssignment.is_active == True)  # noqa: E712

        query = (
            query.order_by(ItemAssignment.assigned_date.desc())
            .offset(skip)
            .limit(limit)
        )

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
            # Lock the item row to prevent concurrent issuance race conditions
            lock_result = await self.db.execute(
                select(InventoryItem)
                .where(InventoryItem.id == str(item_id))
                .where(InventoryItem.organization_id == str(organization_id))
                .with_for_update()
            )
            item = lock_result.scalar_one_or_none()
            if not item:
                return None, "Item not found"

            if item.tracking_type != TrackingType.POOL:
                return (
                    None,
                    "Item is not a pool-tracked item. Use assign for individual items.",
                )

            if not item.active:
                return None, "Item is retired or inactive"

            if item.quantity < quantity:
                return (
                    None,
                    f"Insufficient stock: {item.quantity} available, {quantity} requested",
                )

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
            await self._queue_inventory_notification(
                organization_id,
                user_id,
                InventoryActionType.ISSUED,
                item,
                quantity=quantity,
                performed_by=issued_by,
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
            )
            issuance = result.scalar_one_or_none()

            if not issuance:
                return False, "Issuance record not found"

            if issuance.is_returned:
                return False, "These units have already been returned"

            qty = quantity_returned or issuance.quantity_issued
            if qty > issuance.quantity_issued:
                return (
                    False,
                    f"Cannot return {qty} units; only {issuance.quantity_issued} were issued",
                )

            # Capture user_id for auto-archive check
            issuance_user_id = str(issuance.user_id)

            # Lock the item row before modifying pool counts to prevent
            # concurrent returns from losing updates via read-modify-write
            item = await self._get_item_locked(
                UUID(str(issuance.item_id)), UUID(str(organization_id))
            )
            if not item:
                return False, "Associated pool item not found"

            item.quantity += qty
            item.quantity_issued = max(0, (item.quantity_issued or 0) - qty)

            # Handle partial return: reduce issuance quantity_issued and leave open
            if qty < issuance.quantity_issued:
                issuance.quantity_issued -= qty
                # Record partial return details so they aren't lost
                partial_note = f"Partial return: {qty} unit(s) returned"
                if return_condition:
                    partial_note += f" in {return_condition.value} condition"
                if return_notes:
                    partial_note += f" — {return_notes}"
                existing = issuance.return_notes or ""
                issuance.return_notes = (existing + "\n" + partial_note).strip()
                # issuance stays open (is_returned=False) for the remaining units
            else:
                # Full return
                issuance.is_returned = True
                issuance.returned_at = datetime.now(timezone.utc)
                issuance.returned_by = returned_by
                issuance.return_condition = return_condition
                issuance.return_notes = return_notes

            # Queue notification
            await self._queue_inventory_notification(
                organization_id,
                issuance_user_id,
                InventoryActionType.RETURNED,
                item,
                quantity=qty,
                performed_by=returned_by,
            )

            await self.db.commit()

            # Check if the dropped member should be auto-archived.
            # Wrapped in try/except so a failure here doesn't mask
            # the already-committed pool return operation.
            try:
                from app.services.member_archive_service import check_and_auto_archive

                await check_and_auto_archive(
                    self.db, issuance_user_id, str(organization_id)
                )
            except Exception as e:
                logger.warning(f"Auto-archive check failed after pool return: {e}")

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
            query = query.where(ItemIssuance.is_returned == False)  # noqa: E712
        query = query.order_by(ItemIssuance.issued_at.desc())

        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_user_issuances(
        self,
        user_id: UUID,
        organization_id: UUID,
        active_only: bool = True,
        skip: int = 0,
        limit: int = 200,
    ) -> List["ItemIssuance"]:
        """Get all active issuances for a user with pagination."""
        query = (
            select(ItemIssuance)
            .where(ItemIssuance.user_id == str(user_id))
            .where(ItemIssuance.organization_id == str(organization_id))
            .options(
                selectinload(ItemIssuance.item).selectinload(InventoryItem.category),
            )
        )
        if active_only:
            query = query.where(ItemIssuance.is_returned == False)  # noqa: E712
        query = query.order_by(ItemIssuance.issued_at.desc()).offset(skip).limit(limit)

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
            # Lock the item row to prevent concurrent checkouts
            lock_result = await self.db.execute(
                select(InventoryItem)
                .where(InventoryItem.id == str(item_id))
                .where(InventoryItem.organization_id == str(organization_id))
                .with_for_update()
            )
            item = lock_result.scalar_one_or_none()
            if not item:
                return None, "Item not found"

            if item.status != ItemStatus.AVAILABLE:
                return (
                    None,
                    f"Item is not available for checkout (status: {item.status})",
                )

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
            await self._queue_inventory_notification(
                organization_id,
                user_id,
                InventoryActionType.CHECKED_OUT,
                item,
                performed_by=checked_out_by,
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
            )
            checkout = result.scalar_one_or_none()

            if not checkout:
                return False, "Checkout record not found"

            if checkout.is_returned:
                return False, "Item already checked in"

            # Capture user_id before marking returned (needed for auto-archive check)
            checkout_user_id = str(checkout.user_id)

            # Update checkout record
            checkout.checked_in_at = datetime.now(timezone.utc)
            checkout.checked_in_by = checked_in_by
            checkout.return_condition = return_condition
            checkout.damage_notes = damage_notes
            checkout.is_returned = True
            checkout.is_overdue = False

            # Lock the item row before mutating status/condition to prevent
            # concurrent checkout/checkin from creating inconsistent state
            item = await self._get_item_locked(
                UUID(str(checkout.item_id)), organization_id
            )
            if not item:
                return False, "Associated item not found"
            item.status = ItemStatus.AVAILABLE
            item.condition = return_condition

            # Queue notification
            await self._queue_inventory_notification(
                organization_id,
                checkout_user_id,
                InventoryActionType.CHECKED_IN,
                item,
                performed_by=checked_in_by,
            )

            await self.db.commit()

            # Check if the dropped member should be auto-archived.
            # Wrapped in try/except so a failure here doesn't mask
            # the already-committed checkin operation.
            try:
                from app.services.member_archive_service import check_and_auto_archive

                await check_and_auto_archive(
                    self.db, checkout_user_id, str(organization_id)
                )
            except Exception as e:
                logger.warning(f"Auto-archive check failed after checkin: {e}")

            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def get_active_checkouts(
        self,
        organization_id: UUID,
        user_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 200,
    ) -> List[CheckOutRecord]:
        """Get active (not returned) checkouts with pagination"""
        query = (
            select(CheckOutRecord)
            .where(CheckOutRecord.organization_id == str(organization_id))
            .where(CheckOutRecord.is_returned == False)  # noqa: E712
            .options(
                selectinload(CheckOutRecord.item),
                selectinload(CheckOutRecord.user),
            )
        )

        if user_id:
            query = query.where(CheckOutRecord.user_id == str(user_id))

        query = (
            query.order_by(CheckOutRecord.checked_out_at.desc())
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_overdue_checkouts(
        self,
        organization_id: UUID,
        skip: int = 0,
        limit: int = 200,
    ) -> List[CheckOutRecord]:
        """Get all overdue checkouts with pagination.

        Computes overdue status at read time using the expected_return_at
        date instead of performing a bulk UPDATE on every call.
        """
        now = datetime.now(timezone.utc)

        result = await self.db.execute(
            select(CheckOutRecord)
            .where(
                CheckOutRecord.organization_id == str(organization_id),
                CheckOutRecord.is_returned == False,  # noqa: E712
                CheckOutRecord.expected_return_at < now,
            )
            .options(
                selectinload(CheckOutRecord.item),
                selectinload(CheckOutRecord.user),
            )
            .order_by(CheckOutRecord.expected_return_at)
            .offset(skip)
            .limit(limit)
        )
        return result.scalars().all()

    async def mark_overdue_checkouts(self, organization_id: UUID) -> int:
        """Batch-mark overdue checkouts.  Call from a scheduled task, not from
        read endpoints, to avoid write-on-read overhead.
        """
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            update(CheckOutRecord)
            .where(
                CheckOutRecord.organization_id == str(organization_id),
                CheckOutRecord.is_returned == False,  # noqa: E712
                CheckOutRecord.expected_return_at < now,
                CheckOutRecord.is_overdue == False,  # noqa: E712
            )
            .values(is_overdue=True)
        )
        await self.db.commit()
        return result.rowcount

    # ============================================
    # Maintenance Management
    # ============================================

    # Fields allowed via kwargs when creating a maintenance record.
    # Prevents callers from overwriting id, organization_id, etc.
    _MAINTENANCE_ALLOWED_FIELDS = {
        "maintenance_type",
        "scheduled_date",
        "completed_date",
        "next_due_date",
        "performed_by",
        "vendor_name",
        "cost",
        "condition_before",
        "condition_after",
        "description",
        "parts_replaced",
        "parts_cost",
        "labor_hours",
        "passed",
        "notes",
        "issues_found",
        "attachments",
        "is_completed",
    }

    async def create_maintenance_record(
        self,
        item_id: UUID,
        organization_id: UUID,
        maintenance_data: Dict[str, Any],
        created_by: UUID,
    ) -> Tuple[Optional[MaintenanceRecord], Optional[str]]:
        """Create a maintenance record"""
        try:
            safe_data = {
                k: v
                for k, v in maintenance_data.items()
                if k in self._MAINTENANCE_ALLOWED_FIELDS
            }
            maintenance = MaintenanceRecord(
                organization_id=organization_id,
                item_id=item_id,
                created_by=created_by,
                **safe_data,
            )
            self.db.add(maintenance)

            # If maintenance is completed, update item condition and schedule.
            # Lock the item row to prevent concurrent maintenance from
            # creating a lost-update race on condition/inspection dates.
            if maintenance_data.get("is_completed"):
                item = await self._get_item_locked(item_id, organization_id)
                if item:
                    if maintenance_data.get("condition_after"):
                        item.condition = maintenance_data["condition_after"]
                    completed = maintenance_data.get("completed_date")
                    if completed:
                        item.last_inspection_date = completed
                        # Auto-calculate next_inspection_due from interval
                        if item.inspection_interval_days:
                            if isinstance(completed, str):
                                completed = date.fromisoformat(completed)
                            item.next_inspection_due = completed + timedelta(
                                days=item.inspection_interval_days
                            )
                        elif maintenance_data.get("next_due_date"):
                            item.next_inspection_due = maintenance_data["next_due_date"]

            await self.db.commit()
            await self.db.refresh(maintenance)
            return maintenance, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def update_maintenance_record(
        self,
        record_id: UUID,
        item_id: UUID,
        organization_id: UUID,
        update_data: Dict[str, Any],
    ) -> Tuple[Optional[MaintenanceRecord], Optional[str]]:
        """Update an existing maintenance record"""
        try:
            result = await self.db.execute(
                select(MaintenanceRecord)
                .where(MaintenanceRecord.id == str(record_id))
                .where(MaintenanceRecord.item_id == str(item_id))
                .where(MaintenanceRecord.organization_id == str(organization_id))
            )
            record = result.scalar_one_or_none()

            if not record:
                return None, "Maintenance record not found"

            # Only allow updating known safe fields
            safe_data = {
                k: v
                for k, v in update_data.items()
                if k in self._MAINTENANCE_ALLOWED_FIELDS
            }

            was_completed_before = record.is_completed

            for key, value in safe_data.items():
                setattr(record, key, value)

            # If is_completed just changed to True, update item inspection dates.
            # Lock the item row to prevent concurrent updates from racing.
            if safe_data.get("is_completed") and not was_completed_before:
                item = await self._get_item_locked(item_id, organization_id)
                if item:
                    if safe_data.get("condition_after"):
                        item.condition = safe_data["condition_after"]
                    completed = safe_data.get("completed_date") or record.completed_date
                    if completed:
                        item.last_inspection_date = completed
                        if item.inspection_interval_days:
                            if isinstance(completed, str):
                                completed = date.fromisoformat(completed)
                            item.next_inspection_due = completed + timedelta(
                                days=item.inspection_interval_days
                            )
                        elif safe_data.get("next_due_date") or record.next_due_date:
                            item.next_inspection_due = (
                                safe_data.get("next_due_date") or record.next_due_date
                            )

            await self.db.commit()
            await self.db.refresh(record)
            return record, None
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
            .where(InventoryItem.active == True)  # noqa: E712
            .where(InventoryItem.next_inspection_due <= cutoff_date)
            .options(selectinload(InventoryItem.category))
            .order_by(InventoryItem.next_inspection_due)
        )
        return result.scalars().all()

    async def get_item_maintenance_history(
        self,
        item_id: UUID,
        organization_id: UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> List[MaintenanceRecord]:
        """Get maintenance history for an item with pagination"""
        result = await self.db.execute(
            select(MaintenanceRecord)
            .where(MaintenanceRecord.item_id == str(item_id))
            .where(MaintenanceRecord.organization_id == str(organization_id))
            .options(selectinload(MaintenanceRecord.technician))
            .order_by(MaintenanceRecord.completed_date.desc())
            .offset(skip)
            .limit(limit)
        )
        return result.scalars().all()

    # ============================================
    # Reporting & Analytics
    # ============================================

    async def get_low_stock_items(self, organization_id: UUID) -> List[Dict[str, Any]]:
        """Get categories with low stock, using the sum of item quantities
        rather than a simple row count, and include the names of low-stock items."""
        org_id = str(organization_id)

        # Sum the quantity field per category (handles pool items correctly)
        result = await self.db.execute(
            select(
                InventoryCategory,
                func.coalesce(func.sum(InventoryItem.quantity), 0).label(
                    "current_stock"
                ),
            )
            .join(InventoryItem, InventoryCategory.id == InventoryItem.category_id)
            .where(InventoryCategory.organization_id == org_id)
            .where(InventoryCategory.active == True)  # noqa: E712
            .where(InventoryItem.active == True)  # noqa: E712
            .where(InventoryCategory.low_stock_threshold.isnot(None))
            .group_by(InventoryCategory.id)
            .having(
                func.coalesce(func.sum(InventoryItem.quantity), 0)
                <= InventoryCategory.low_stock_threshold
            )
        )

        low_stock_items = []
        for category, current_stock in result.all():
            # Fetch item names in this low-stock category
            items_result = await self.db.execute(
                select(InventoryItem.name, InventoryItem.quantity)
                .where(InventoryItem.category_id == category.id)
                .where(InventoryItem.active == True)  # noqa: E712
                .order_by(InventoryItem.quantity.asc())
                .limit(5)
            )
            item_details = [
                {"name": row.name, "quantity": row.quantity}
                for row in items_result.all()
            ]
            low_stock_items.append(
                {
                    "category_id": category.id,
                    "category_name": category.name,
                    "item_type": category.item_type,
                    "current_stock": int(current_stock),
                    "threshold": category.low_stock_threshold,
                    "items": item_details,
                }
            )

        return low_stock_items

    async def get_inventory_summary(self, organization_id: UUID) -> Dict[str, Any]:
        """Get overall inventory summary statistics"""
        # Total items (sum quantities so pool items with quantity > 1 are counted correctly)
        total_result = await self.db.execute(
            select(func.coalesce(func.sum(InventoryItem.quantity), 0))
            .where(InventoryItem.organization_id == str(organization_id))
            .where(InventoryItem.active == True)  # noqa: E712
        )
        total_items = total_result.scalar()

        # Items by status
        status_result = await self.db.execute(
            select(
                InventoryItem.status,
                func.count(InventoryItem.id).label("count"),
            )
            .where(InventoryItem.organization_id == str(organization_id))
            .where(InventoryItem.active == True)  # noqa: E712
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
            .where(InventoryItem.active == True)  # noqa: E712
            .group_by(InventoryItem.condition)
        )
        items_by_condition = {
            row.condition.value: row.count for row in condition_result.all()
        }

        # Total value (multiply per-unit value by quantity for accurate totals)
        value_result = await self.db.execute(
            select(func.coalesce(func.sum(InventoryItem.current_value * InventoryItem.quantity), 0))
            .where(InventoryItem.organization_id == str(organization_id))
            .where(InventoryItem.active == True)  # noqa: E712
        )
        total_value = value_result.scalar() or Decimal("0.00")

        # Active checkouts
        checkout_result = await self.db.execute(
            select(func.count(CheckOutRecord.id))
            .where(CheckOutRecord.organization_id == str(organization_id))
            .where(CheckOutRecord.is_returned == False)  # noqa: E712
        )
        active_checkouts = checkout_result.scalar()

        # Overdue checkouts
        overdue_result = await self.db.execute(
            select(func.count(CheckOutRecord.id))
            .where(CheckOutRecord.organization_id == str(organization_id))
            .where(CheckOutRecord.is_overdue == True)  # noqa: E712
        )
        overdue_checkouts = overdue_result.scalar()

        # Maintenance due
        maintenance_due = await self.get_maintenance_due(organization_id, days_ahead=7)

        # Use the larger of checkout records vs items with checked_out status
        # to ensure the dashboard reflects reality regardless of sync state
        items_checked_out = items_by_status.get("checked_out", 0)
        effective_checkouts = max(active_checkouts or 0, items_checked_out)

        # Items currently in maintenance status
        items_in_maintenance = items_by_status.get("in_maintenance", 0)

        return {
            "total_items": total_items,
            "items_by_status": items_by_status,
            "items_by_condition": items_by_condition,
            "total_value": float(total_value),
            "active_checkouts": effective_checkouts,
            "overdue_checkouts": overdue_checkouts or 0,
            "maintenance_due_count": len(maintenance_due) + items_in_maintenance,
        }

    async def get_user_inventory(
        self, user_id: UUID, organization_id: UUID
    ) -> Dict[str, Any]:
        """Get all inventory items for a specific user (for dashboard)"""
        # Permanent assignments
        assignments = await self.get_user_assignments(
            user_id, organization_id, active_only=True
        )

        # Active checkouts
        checkouts = await self.get_active_checkouts(organization_id, user_id=user_id)

        # Active pool issuances
        issuances = await self.get_user_issuances(
            user_id, organization_id, active_only=True
        )

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
                    "category_name": a.item.category.name if a.item.category else None,
                    "quantity": a.item.quantity,
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
                    "category_name": i.item.category.name if i.item.category else None,
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

        Uses subquery aggregation to produce the result in a single round-trip.
        """
        org_id = str(organization_id)

        # Subqueries for per-user counts
        assign_sub = (
            select(
                ItemAssignment.user_id.label("uid"),
                func.count(ItemAssignment.id).label("cnt"),
            )
            .where(ItemAssignment.organization_id == org_id)
            .where(ItemAssignment.is_active == True)  # noqa: E712
            .group_by(ItemAssignment.user_id)
        ).subquery("a_sub")

        checkout_sub = (
            select(
                CheckOutRecord.user_id.label("uid"),
                func.count(CheckOutRecord.id).label("cnt"),
            )
            .where(CheckOutRecord.organization_id == org_id)
            .where(CheckOutRecord.is_returned == False)  # noqa: E712
            .group_by(CheckOutRecord.user_id)
        ).subquery("co_sub")

        overdue_sub = (
            select(
                CheckOutRecord.user_id.label("uid"),
                func.count(CheckOutRecord.id).label("cnt"),
            )
            .where(CheckOutRecord.organization_id == org_id)
            .where(CheckOutRecord.is_returned == False)  # noqa: E712
            .where(CheckOutRecord.is_overdue == True)  # noqa: E712
            .group_by(CheckOutRecord.user_id)
        ).subquery("od_sub")

        issue_sub = (
            select(
                ItemIssuance.user_id.label("uid"),
                func.coalesce(func.sum(ItemIssuance.quantity_issued), 0).label("cnt"),
            )
            .where(ItemIssuance.organization_id == org_id)
            .where(ItemIssuance.is_returned == False)  # noqa: E712
            .group_by(ItemIssuance.user_id)
        ).subquery("i_sub")

        # Main query: LEFT JOIN user to each subquery
        query = (
            select(
                User.id,
                User.username,
                User.first_name,
                User.last_name,
                User.membership_number,
                func.coalesce(assign_sub.c.cnt, 0).label("permanent_count"),
                func.coalesce(checkout_sub.c.cnt, 0).label("checkout_count"),
                func.coalesce(overdue_sub.c.cnt, 0).label("overdue_count"),
                func.coalesce(issue_sub.c.cnt, 0).label("issued_count"),
            )
            .outerjoin(assign_sub, User.id == assign_sub.c.uid)
            .outerjoin(checkout_sub, User.id == checkout_sub.c.uid)
            .outerjoin(overdue_sub, User.id == overdue_sub.c.uid)
            .outerjoin(issue_sub, User.id == issue_sub.c.uid)
            .where(User.organization_id == org_id)
            .where(User.status == "active")
        )

        if search:
            safe = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{safe}%"
            query = query.where(
                or_(
                    User.username.ilike(pattern),
                    User.first_name.ilike(pattern),
                    User.last_name.ilike(pattern),
                    User.membership_number.ilike(pattern),
                )
            )

        query = query.order_by(User.last_name, User.first_name)
        rows = await self.db.execute(query)

        result = []
        for row in rows.all():
            perm = row.permanent_count
            co = row.checkout_count
            iss = row.issued_count
            full_name = " ".join(filter(None, [row.first_name, row.last_name])) or None
            result.append(
                {
                    "user_id": row.id,
                    "username": row.username,
                    "first_name": row.first_name,
                    "last_name": row.last_name,
                    "full_name": full_name,
                    "membership_number": row.membership_number,
                    "permanent_count": perm,
                    "checkout_count": co,
                    "issued_count": iss,
                    "overdue_count": row.overdue_count,
                    "total_items": perm + co + iss,
                }
            )
        return result

    # ============================================
    # Barcode / Serial / Asset Tag Lookup
    # ============================================

    async def _lookup_by_item_id(
        self, item_id: str, organization_id: UUID
    ) -> Optional[Tuple[InventoryItem, str, str]]:
        """
        Look up an item directly by its ID.
        Returns (item, matched_field, matched_value) or None.
        Used by batch operations when the frontend already knows the item ID.
        """
        org_id = str(organization_id)
        result = await self.db.execute(
            select(InventoryItem)
            .where(
                InventoryItem.id == str(item_id),
                InventoryItem.organization_id == org_id,
                InventoryItem.active == True,  # noqa: E712
            )
            .options(selectinload(InventoryItem.category))
            .limit(1)
        )
        item = result.scalar_one_or_none()
        if not item:
            return None

        # Return the best identifier for the matched_field
        if item.barcode:
            return item, "barcode", item.barcode
        if item.serial_number:
            return item, "serial_number", item.serial_number
        if item.asset_tag:
            return item, "asset_tag", item.asset_tag
        return item, "name", item.name

    async def lookup_by_code(
        self, code: str, organization_id: UUID
    ) -> Optional[Tuple[InventoryItem, str, str]]:
        """
        Look up an item by barcode, serial number, or asset tag.
        Returns (item, matched_field, matched_value) or None.

        Uses a single query with OR to avoid up to 3 round-trips,
        then determines the matched field from the result.
        """
        code = code.strip()
        if not code:
            return None

        org_id = str(organization_id)

        result = await self.db.execute(
            select(InventoryItem)
            .where(
                InventoryItem.organization_id == org_id,
                InventoryItem.active == True,  # noqa: E712
                or_(
                    InventoryItem.barcode == code,
                    InventoryItem.serial_number == code,
                    InventoryItem.asset_tag == code,
                ),
            )
            .options(selectinload(InventoryItem.category))
            .limit(3)  # at most one per field in a well-constrained DB
        )
        items = result.scalars().all()

        if not items:
            return None

        # Return the best match by priority: barcode > serial > asset_tag
        for field in ("barcode", "serial_number", "asset_tag"):
            for item in items:
                if getattr(item, field) == code:
                    return item, field, code

        # Fallback (shouldn't happen if query is correct)
        return items[0], "barcode", code

    async def search_by_code(
        self,
        code: str,
        organization_id: UUID,
        limit: int = 20,
    ) -> List[Tuple[InventoryItem, str, str]]:
        """
        Search items by partial barcode, serial number, asset tag, or name.
        Returns a list of (item, matched_field, matched_value) tuples.
        Uses substring matching so partial codes return results.
        """
        code = code.strip()
        if not code:
            return []

        org_id = str(organization_id)
        safe_code = code.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        search_term = f"%{safe_code}%"
        results: List[Tuple[InventoryItem, str, str]] = []
        seen_ids: set = set()

        # Search barcode, serial_number, asset_tag, then name in order of priority
        fields = [
            ("barcode", InventoryItem.barcode),
            ("serial_number", InventoryItem.serial_number),
            ("asset_tag", InventoryItem.asset_tag),
            ("name", InventoryItem.name),
        ]

        for field_name, field_col in fields:
            if len(results) >= limit:
                break

            result = await self.db.execute(
                select(InventoryItem)
                .where(
                    InventoryItem.organization_id == org_id,
                    field_col.ilike(search_term),
                    InventoryItem.active == True,  # noqa: E712
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
            scan_item_id = scan.get("item_id")

            # Prefer direct item_id lookup when available (avoids
            # mismatch when item was found by name search)
            lookup = None
            if scan_item_id:
                lookup = await self._lookup_by_item_id(scan_item_id, organization_id)
            if not lookup:
                lookup = await self.lookup_by_code(code, organization_id)
            if not lookup:
                results.append(
                    {
                        "code": code,
                        "item_name": "Unknown",
                        "item_id": "",
                        "action": "none",
                        "success": False,
                        "error": f"No item found for code '{code}'",
                    }
                )
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
                        results.append(
                            {
                                "code": code,
                                "item_name": item.name,
                                "item_id": item.id,
                                "action": "issued",
                                "success": False,
                                "error": err,
                            }
                        )
                        failed += 1
                    else:
                        results.append(
                            {
                                "code": code,
                                "item_name": item.name,
                                "item_id": item.id,
                                "action": "issued",
                                "success": True,
                                "error": None,
                            }
                        )
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
                        results.append(
                            {
                                "code": code,
                                "item_name": item.name,
                                "item_id": item.id,
                                "action": "assigned",
                                "success": False,
                                "error": err,
                            }
                        )
                        failed += 1
                    else:
                        results.append(
                            {
                                "code": code,
                                "item_name": item.name,
                                "item_id": item.id,
                                "action": "assigned",
                                "success": True,
                                "error": None,
                            }
                        )
                        successful += 1

                else:
                    results.append(
                        {
                            "code": code,
                            "item_name": item.name,
                            "item_id": item.id,
                            "action": "none",
                            "success": False,
                            "error": f"Item is not available (status: {item.status.value})",
                        }
                    )
                    failed += 1

            except Exception as e:
                results.append(
                    {
                        "code": code,
                        "item_name": item.name if item else "Unknown",
                        "item_id": item.id if item else "",
                        "action": "none",
                        "success": False,
                        "error": str(e),
                    }
                )
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
            scan_item_id = scan.get("item_id")

            # Prefer direct item_id lookup when available
            lookup = None
            if scan_item_id:
                lookup = await self._lookup_by_item_id(scan_item_id, organization_id)
            if not lookup:
                lookup = await self.lookup_by_code(code, organization_id)
            if not lookup:
                results.append(
                    {
                        "code": code,
                        "item_name": "Unknown",
                        "item_id": "",
                        "action": "none",
                        "success": False,
                        "error": f"No item found for code '{code}'",
                    }
                )
                failed += 1
                continue

            item, _, _ = lookup

            try:
                condition = IC(condition_str)
            except ValueError:
                results.append(
                    {
                        "code": code,
                        "item_name": item.name if item else "Unknown",
                        "item_id": item.id if item else "",
                        "action": "none",
                        "success": False,
                        "error": f"Invalid return condition: '{condition_str}'",
                    }
                )
                failed += 1
                continue

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
                        expected_user_id=user_id,
                    )
                    if err:
                        results.append(
                            {
                                "code": code,
                                "item_name": item.name,
                                "item_id": item.id,
                                "action": "unassigned",
                                "success": False,
                                "error": err,
                            }
                        )
                        failed += 1
                    else:
                        results.append(
                            {
                                "code": code,
                                "item_name": item.name,
                                "item_id": item.id,
                                "action": "unassigned",
                                "success": True,
                                "error": None,
                            }
                        )
                        successful += 1
                    continue

                # Check if checked out to this user
                checkout_result = await self.db.execute(
                    select(CheckOutRecord)
                    .where(
                        CheckOutRecord.organization_id == str(organization_id),
                        CheckOutRecord.item_id == str(item.id),
                        CheckOutRecord.user_id == user_id_str,
                        CheckOutRecord.is_returned == False,  # noqa: E712
                    )
                    .order_by(CheckOutRecord.checked_out_at.desc())
                    .limit(1)
                    .with_for_update()
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
                        results.append(
                            {
                                "code": code,
                                "item_name": item.name,
                                "item_id": item.id,
                                "action": "checked_in",
                                "success": False,
                                "error": err,
                            }
                        )
                        failed += 1
                    else:
                        results.append(
                            {
                                "code": code,
                                "item_name": item.name,
                                "item_id": item.id,
                                "action": "checked_in",
                                "success": True,
                                "error": None,
                            }
                        )
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
                            ItemIssuance.is_returned == False,  # noqa: E712
                        )
                        .order_by(ItemIssuance.issued_at.desc())
                        .limit(1)
                        .with_for_update()
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
                            results.append(
                                {
                                    "code": code,
                                    "item_name": item.name,
                                    "item_id": item.id,
                                    "action": "returned_to_pool",
                                    "success": False,
                                    "error": err,
                                }
                            )
                            failed += 1
                        else:
                            results.append(
                                {
                                    "code": code,
                                    "item_name": item.name,
                                    "item_id": item.id,
                                    "action": "returned_to_pool",
                                    "success": True,
                                    "error": None,
                                }
                            )
                            successful += 1
                        continue

                # Item not held by this user
                results.append(
                    {
                        "code": code,
                        "item_name": item.name,
                        "item_id": item.id,
                        "action": "none",
                        "success": False,
                        "error": "Item is not assigned to, checked out by, or issued to this member",
                    }
                )
                failed += 1

            except Exception as e:
                results.append(
                    {
                        "code": code,
                        "item_name": item.name if item else "Unknown",
                        "item_id": item.id if item else "",
                        "action": "none",
                        "success": False,
                        "error": str(e),
                    }
                )
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

    # Predefined label formats: (width_inches, height_inches, description)
    LABEL_FORMATS: Dict[str, Dict[str, Any]] = {
        "letter": {
            "description": "Standard letter (8.5x11) - 2x5 grid",
            "type": "sheet",
        },
        "dymo_30252": {
            "description": "Dymo 30252 Address Label (1.125 x 3.5 in)",
            "width": 3.5,
            "height": 1.125,
            "type": "thermal",
        },
        "dymo_30256": {
            "description": "Dymo 30256 Shipping Label (2.3125 x 4 in)",
            "width": 4.0,
            "height": 2.3125,
            "type": "thermal",
        },
        "dymo_30334": {
            "description": "Dymo 30334 Multi-Purpose Label (2.25 x 1.25 in)",
            "width": 2.25,
            "height": 1.25,
            "type": "thermal",
        },
        "rollo_4x6": {
            "description": "Rollo 4x6 Shipping Label",
            "width": 4.0,
            "height": 6.0,
            "type": "thermal",
        },
    }

    async def generate_barcode_labels(
        self,
        item_ids: List[UUID],
        organization_id: UUID,
        label_format: str = "letter",
        custom_width: Optional[float] = None,
        custom_height: Optional[float] = None,
    ) -> BytesIO:
        """
        Generate a PDF containing barcode labels for the given items.

        Supports multiple label formats:
        - "letter": Standard 8.5x11 sheet with 2x5 grid (for standard printers)
        - "dymo_30252": Dymo 30252 address labels (1.125 x 3.5 in)
        - "dymo_30256": Dymo 30256 shipping labels (2.3125 x 4 in)
        - "dymo_30334": Dymo 30334 multi-purpose labels (2.25 x 1.25 in)
        - "rollo_4x6": Rollo 4x6 shipping labels
        - "custom": Custom dimensions via custom_width/custom_height (in inches)

        Thermal formats produce one label per page, sized exactly to the label.
        """

        items = []
        for item_id in item_ids:
            item = await self.get_item_by_id(item_id, organization_id)
            if item:
                items.append(item)

        if not items:
            raise ValueError("No valid items found for label generation")

        # Auto-populate the barcode field for items that don't have one yet,
        # using the same fallback logic the label renderer uses.  This ensures
        # the barcode printed on the label is stored on the item and visible
        # when the user opens the edit form.
        dirty = False
        for item in items:
            if not item.barcode:
                effective = item.asset_tag or item.serial_number or item.id[:12]
                item.barcode = effective
                dirty = True
        if dirty:
            await self.db.commit()

        if label_format == "custom":
            if not custom_width or not custom_height:
                raise ValueError(
                    "custom_width and custom_height are required for custom label format"
                )
            return self._generate_thermal_labels(items, custom_width, custom_height)

        fmt = self.LABEL_FORMATS.get(label_format)
        if not fmt:
            raise ValueError(
                f"Unknown label format: {label_format}. Available: {', '.join(self.LABEL_FORMATS.keys())}, custom"
            )

        if fmt["type"] == "sheet":
            return self._generate_sheet_labels(items)
        else:
            return self._generate_thermal_labels(items, fmt["width"], fmt["height"])

    @staticmethod
    def _generate_sheet_labels(items: list) -> BytesIO:
        """Generate labels on standard letter-size sheets in a 2x5 grid."""
        from reportlab.graphics.barcode import code128
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import inch
        from reportlab.pdfgen import canvas

        buf = BytesIO()
        c = canvas.Canvas(buf, pagesize=letter)
        page_w, page_h = letter

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

            barcode_value = (
                item.barcode or item.asset_tag or item.serial_number or item.id[:12]
            )

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
            barcode_x = x + (label_w - barcode_width) / 2
            barcode_obj.drawOn(c, barcode_x, y + 22)

            # Barcode text below
            c.setFont("Courier", 7)
            c.drawCentredString(x + label_w / 2, y + 12, barcode_value)

        c.save()
        buf.seek(0)
        return buf

    @staticmethod
    def _generate_thermal_labels(
        items: list, width_in: float, height_in: float
    ) -> BytesIO:
        """
        Generate labels sized for thermal printers (Dymo, Rollo, etc).
        Each item gets its own page at the exact label dimensions.
        """
        from reportlab.graphics.barcode import code128
        from reportlab.lib.units import inch
        from reportlab.pdfgen import canvas

        label_w = width_in * inch
        label_h = height_in * inch
        page_size = (label_w, label_h)

        buf = BytesIO()
        c = canvas.Canvas(buf, pagesize=page_size)

        # Determine layout based on label aspect ratio
        is_landscape = width_in > height_in  # wider than tall (e.g., Dymo 30252)
        padding = 0.08 * inch  # tight padding for small labels

        for idx, item in enumerate(items):
            if idx > 0:
                c.showPage()

            barcode_value = (
                item.barcode or item.asset_tag or item.serial_number or item.id[:12]
            )

            if is_landscape:
                # Landscape: text on left, barcode on right or text top barcode bottom
                self_w = label_w - 2 * padding
                self_h = label_h - 2 * padding

                # Scale fonts based on label height
                name_font_size = min(8, max(5, self_h / (0.2 * inch)))
                info_font_size = max(4, name_font_size - 2)
                barcode_text_size = max(4, info_font_size)

                # Barcode sizing — fit within label
                max_barcode_width = self_w * 0.85
                bar_height = min(0.4 * inch, self_h * 0.4)
                bar_width_unit = 0.01 * inch

                barcode_obj = code128.Code128(
                    barcode_value, barWidth=bar_width_unit, barHeight=bar_height
                )
                # Scale down barWidth if barcode doesn't fit
                while (
                    barcode_obj.width > max_barcode_width
                    and bar_width_unit > 0.005 * inch
                ):
                    bar_width_unit -= 0.001 * inch
                    barcode_obj = code128.Code128(
                        barcode_value, barWidth=bar_width_unit, barHeight=bar_height
                    )

                # Layout: name at top, info line, barcode centered, text below
                y_cursor = label_h - padding

                # Item name
                c.setFont("Helvetica-Bold", name_font_size)
                name_max_chars = int(self_w / (name_font_size * 0.5))
                name = item.name[:name_max_chars] + (
                    "..." if len(item.name) > name_max_chars else ""
                )
                y_cursor -= name_font_size
                c.drawString(padding, y_cursor, name)

                # Secondary info
                info_parts = []
                if item.asset_tag:
                    info_parts.append(f"Asset: {item.asset_tag}")
                if item.serial_number:
                    info_parts.append(f"S/N: {item.serial_number}")
                if info_parts:
                    y_cursor -= info_font_size + 2
                    c.setFont("Helvetica", info_font_size)
                    c.drawString(padding, y_cursor, " | ".join(info_parts))

                # Barcode — centered horizontally
                barcode_x = padding + (self_w - barcode_obj.width) / 2
                barcode_y = padding + barcode_text_size + 4
                barcode_obj.drawOn(c, barcode_x, barcode_y)

                # Barcode text below barcode
                c.setFont("Courier", barcode_text_size)
                c.drawCentredString(label_w / 2, padding + 1, barcode_value)

            else:
                # Portrait / square: text at top, barcode in middle, text at bottom
                self_w = label_w - 2 * padding
                self_h = label_h - 2 * padding

                name_font_size = min(10, max(6, self_w / (0.4 * inch)))
                info_font_size = max(5, name_font_size - 2)
                barcode_text_size = max(5, info_font_size)

                # Barcode sizing
                max_barcode_width = self_w * 0.9
                bar_height = min(0.8 * inch, self_h * 0.3)
                bar_width_unit = 0.012 * inch

                barcode_obj = code128.Code128(
                    barcode_value, barWidth=bar_width_unit, barHeight=bar_height
                )
                while (
                    barcode_obj.width > max_barcode_width
                    and bar_width_unit > 0.005 * inch
                ):
                    bar_width_unit -= 0.001 * inch
                    barcode_obj = code128.Code128(
                        barcode_value, barWidth=bar_width_unit, barHeight=bar_height
                    )

                # Item name at top
                c.setFont("Helvetica-Bold", name_font_size)
                name_max_chars = int(self_w / (name_font_size * 0.52))
                name = item.name[:name_max_chars] + (
                    "..." if len(item.name) > name_max_chars else ""
                )
                y_cursor = label_h - padding - name_font_size
                c.drawCentredString(label_w / 2, y_cursor, name)

                # Secondary info
                info_parts = []
                if item.asset_tag:
                    info_parts.append(f"Asset: {item.asset_tag}")
                if item.serial_number:
                    info_parts.append(f"S/N: {item.serial_number}")
                if info_parts:
                    y_cursor -= info_font_size + 4
                    c.setFont("Helvetica", info_font_size)
                    c.drawCentredString(label_w / 2, y_cursor, " | ".join(info_parts))

                # Barcode — centered
                barcode_x = padding + (self_w - barcode_obj.width) / 2
                barcode_y = padding + barcode_text_size + 8
                barcode_obj.drawOn(c, barcode_x, barcode_y)

                # Barcode text
                c.setFont("Courier", barcode_text_size)
                c.drawCentredString(label_w / 2, padding + 2, barcode_value)

        c.save()
        buf.seek(0)
        return buf

    # ------------------------------------------------------------------
    # Write-off requests
    # ------------------------------------------------------------------

    async def create_write_off_request(
        self,
        item_id: str,
        organization_id: str,
        requested_by: str,
        reason: str,
        description: str,
        clearance_id: Optional[str] = None,
        clearance_item_id: Optional[str] = None,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """Create a write-off request for an inventory item."""
        try:
            result = await self.db.execute(
                select(InventoryItem).where(
                    InventoryItem.id == item_id,
                    InventoryItem.organization_id == organization_id,
                )
            )
            item = result.scalar_one_or_none()
            if not item:
                return None, "Item not found"

            if item.status == ItemStatus.RETIRED:
                return None, "Item is already retired"

            valid_reasons = {
                "lost",
                "damaged_beyond_repair",
                "obsolete",
                "stolen",
                "other",
            }
            if reason not in valid_reasons:
                return (
                    None,
                    f"Invalid reason. Must be one of: {', '.join(sorted(valid_reasons))}",
                )

            write_off = WriteOffRequest(
                organization_id=organization_id,
                item_id=item_id,
                item_name=item.name,
                item_serial_number=item.serial_number,
                item_asset_tag=item.asset_tag,
                item_value=item.purchase_price,
                reason=reason,
                description=description,
                status=WriteOffStatus.PENDING,
                requested_by=requested_by,
                clearance_id=clearance_id,
                clearance_item_id=clearance_item_id,
            )
            self.db.add(write_off)
            await self.db.commit()
            await self.db.refresh(write_off)

            return {
                "id": write_off.id,
                "item_id": write_off.item_id,
                "item_name": write_off.item_name,
                "item_value": (
                    float(write_off.item_value) if write_off.item_value else None
                ),
                "reason": write_off.reason,
                "description": write_off.description,
                "status": write_off.status.value,
                "created_at": (
                    write_off.created_at.isoformat() if write_off.created_at else None
                ),
            }, None

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to create write-off request: {e}")
            return None, str(e)

    async def get_write_off_requests(
        self,
        organization_id: str,
        status_filter: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """List write-off requests for the organization."""
        query = (
            select(WriteOffRequest)
            .where(WriteOffRequest.organization_id == organization_id)
            .order_by(WriteOffRequest.created_at.desc())
        )
        if status_filter:
            query = query.where(WriteOffRequest.status == WriteOffStatus(status_filter))

        result = await self.db.execute(query)
        rows = result.scalars().all()

        requests = []
        for wo in rows:
            # Load requester name
            requester_name = None
            if wo.requested_by:
                u = await self.db.execute(
                    select(User).where(User.id == wo.requested_by)
                )
                user = u.scalar_one_or_none()
                if user:
                    requester_name = (
                        f"{user.first_name or ''} {user.last_name or ''}".strip()
                        or user.username
                    )

            reviewer_name = None
            if wo.reviewed_by:
                u = await self.db.execute(select(User).where(User.id == wo.reviewed_by))
                user = u.scalar_one_or_none()
                if user:
                    reviewer_name = (
                        f"{user.first_name or ''} {user.last_name or ''}".strip()
                        or user.username
                    )

            requests.append(
                {
                    "id": wo.id,
                    "item_id": wo.item_id,
                    "item_name": wo.item_name,
                    "item_serial_number": wo.item_serial_number,
                    "item_asset_tag": wo.item_asset_tag,
                    "item_value": float(wo.item_value) if wo.item_value else None,
                    "reason": wo.reason,
                    "description": wo.description,
                    "status": wo.status.value,
                    "requested_by": wo.requested_by,
                    "requester_name": requester_name,
                    "reviewed_by": wo.reviewed_by,
                    "reviewer_name": reviewer_name,
                    "reviewed_at": (
                        wo.reviewed_at.isoformat() if wo.reviewed_at else None
                    ),
                    "review_notes": wo.review_notes,
                    "clearance_id": wo.clearance_id,
                    "created_at": wo.created_at.isoformat() if wo.created_at else None,
                }
            )
        return requests

    async def review_write_off(
        self,
        write_off_id: str,
        organization_id: str,
        reviewed_by: str,
        decision: str,
        review_notes: Optional[str] = None,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """Approve or deny a write-off request. On approval, retire the item."""
        try:
            if decision not in ("approved", "denied"):
                return None, "Decision must be 'approved' or 'denied'"

            result = await self.db.execute(
                select(WriteOffRequest).where(
                    WriteOffRequest.id == write_off_id,
                    WriteOffRequest.organization_id == organization_id,
                )
            )
            wo = result.scalar_one_or_none()
            if not wo:
                return None, "Write-off request not found"

            if wo.status != WriteOffStatus.PENDING:
                return None, f"Request already {wo.status.value}"

            now = datetime.now(timezone.utc)
            wo.status = WriteOffStatus(decision)
            wo.reviewed_by = reviewed_by
            wo.reviewed_at = now
            wo.review_notes = review_notes

            # On approval, mark the item as lost/retired
            if decision == "approved" and wo.item_id:
                item_result = await self.db.execute(
                    select(InventoryItem).where(
                        InventoryItem.id == wo.item_id,
                        InventoryItem.organization_id == organization_id,
                    )
                )
                item = item_result.scalar_one_or_none()
                if item and item.status != ItemStatus.RETIRED:
                    if wo.reason in ("lost", "stolen"):
                        item.status = (
                            ItemStatus.LOST
                            if wo.reason == "lost"
                            else ItemStatus.STOLEN
                        )
                    else:
                        item.status = ItemStatus.RETIRED
                        item.condition = ItemCondition.RETIRED
                    item.notes = (
                        item.notes or ""
                    ) + f"\n[Write-off approved: {wo.reason}] {wo.description}"

            await self.db.commit()
            await self.db.refresh(wo)

            return {
                "id": wo.id,
                "item_id": wo.item_id,
                "item_name": wo.item_name,
                "status": wo.status.value,
                "reviewed_by": wo.reviewed_by,
                "reviewed_at": wo.reviewed_at.isoformat() if wo.reviewed_at else None,
                "review_notes": wo.review_notes,
            }, None

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to review write-off: {e}")
            return None, str(e)
