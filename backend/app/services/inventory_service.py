"""
Inventory Service

Business logic for inventory management including items, categories,
assignments, checkouts, maintenance, and reporting.
"""

import copy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit_event
from app.models.notification import NotificationLog
from app.utils.impact_plan_pdf import render_impact_plan_pdf
from app.utils.label_renderer import LabelSpec, render_labels
from app.models.inventory import (
    AssignmentType,
    CheckOutRecord,
    EquipmentKit,
    EquipmentKitItem,
    EquipmentRequest,
    InventoryActionType,
    InventoryCategory,
    InventoryImpactPlan,
    InventoryItem,
    IssuanceAllowance,
    ItemAssignment,
    ItemCondition,
    ItemIssuance,
    ItemStatus,
    ItemType,
    ItemVariantGroup,
    MaintenanceRecord,
    MemberSizePreferences,
    NFPAInspectionDetail,
    NFPAItemCompliance,
    ReorderRequest,
    ReorderStatus,
    RequestStatus,
    RequestType,
    ReturnRequest,
    ReturnRequestStatus,
    ReturnRequestType,
    TrackingType,
    WriteOffRequest,
    WriteOffStatus,
)
from app.models.operational_rank import OperationalRank
from app.models.user import (
    MembershipType,
    Organization,
    Position,
    User,
    UserStatus,
    user_positions,
)

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

# ISO/IEC 15417 minimum module (bar) width for Code128: 0.191 mm ≈ 0.0075 in.
# At 203 DPI (standard thermal printers) this is ~1.5 dots — the minimum for
# reliable scanning.  The scaling loops in label generators must not go below
# this floor.
_MIN_BAR_WIDTH_INCH = 0.0075


def _sanitize_barcode_value(raw: str) -> str:
    """Strip non-ASCII characters that Code128 cannot encode."""
    return "".join(ch for ch in raw if ord(ch) < 128)


# Inventory barcode scheme — a single rule used everywhere: a human-readable
# sequential number per organization, ``<prefix><zero-padded number>`` with a
# 6-digit minimum (e.g. INV-000001, INV-000002, ...). The prefix (default
# "INV-") and the running counter live in organization.settings["barcode"].
DEFAULT_BARCODE_PREFIX = "INV-"
BARCODE_MIN_DIGITS = 6


def _format_sequential_barcode(prefix: str, number: int) -> str:
    """Render a sequential barcode, e.g. ``INV-000001``."""
    return f"{prefix}{number:0{BARCODE_MIN_DIGITS}d}"


# Supported extra-line field keys that can be requested on labels.
_EXTRA_LINE_FIELDS = {"location", "category", "condition", "custom"}


def _build_extra_lines(item, extra_lines: Optional[List[str]]) -> str:
    """Build a single extra info string from requested fields.

    *extra_lines* is a list of field keys the user wants printed below
    the identifier line (e.g. ``["location", "category"]``).
    Only fields that have a non-empty value on the item are included.
    """
    if not extra_lines:
        return ""
    parts: list[str] = []
    for key in extra_lines:
        if key == "location":
            # Prefer the resolved relationship name over the raw UUID.
            loc = getattr(item, "location", None)
            val = getattr(loc, "name", None) if loc else None
            if not val:
                val = getattr(item, "location_id", None)
            if val:
                parts.append(str(val))
        elif key == "category":
            cat = getattr(item, "category", None)
            if cat and getattr(cat, "name", None):
                parts.append(cat.name)
            elif getattr(item, "category_id", None):
                parts.append(str(item.category_id)[:8])
        elif key == "condition":
            cond = getattr(item, "condition", None)
            if cond:
                val = cond.value if hasattr(cond, "value") else str(cond)
                parts.append(val.replace("_", " ").title())
        elif key.startswith("custom:"):
            parts.append(key.split(":", 1)[1])
    return " | ".join(parts)


class InventoryService:
    """Service for inventory management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _next_sequential_barcode(self, organization_id) -> str:
        """Assign the next sequential barcode for the organization.

        Format: ``<prefix><zero-padded number>`` (default ``INV-000001``). The
        prefix and running counter live in ``organization.settings["barcode"]``
        (mirroring the membership-number scheme in OrganizationService).

        The organization row is locked ``FOR UPDATE`` for the read-increment so
        concurrent item creates in the same org get distinct numbers; the
        per-org unique constraint on ``inventory_items.barcode`` is the final
        backstop. Any number already taken (e.g. a manually-entered barcode) is
        skipped.
        """
        org_id = str(organization_id)
        org = await self.db.scalar(
            select(Organization).where(Organization.id == org_id).with_for_update()
        )
        if org is None:
            raise ValueError("Organization not found")

        settings = copy.deepcopy(org.settings or {})
        barcode_cfg = settings.get("barcode") or {}
        prefix = barcode_cfg.get("prefix", DEFAULT_BARCODE_PREFIX)
        number = int(barcode_cfg.get("next_number", 1))

        barcode = _format_sequential_barcode(prefix, number)
        while await self._barcode_exists(org_id, barcode):
            number += 1
            barcode = _format_sequential_barcode(prefix, number)

        barcode_cfg["prefix"] = prefix
        barcode_cfg["next_number"] = number + 1
        settings["barcode"] = barcode_cfg
        # Reassign the whole dict so SQLAlchemy detects the nested change
        # (Organization.settings is a MutableDict; see CLAUDE.md Pitfall #12).
        org.settings = settings
        await self.db.flush()
        return barcode

    async def _barcode_exists(self, org_id: str, barcode: str) -> bool:
        """Whether a barcode is already used by an item in the organization."""
        existing = await self.db.scalar(
            select(InventoryItem.id)
            .where(
                InventoryItem.organization_id == org_id,
                InventoryItem.barcode == barcode,
            )
            .limit(1)
        )
        return existing is not None

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
            logger.warning(f"Failed to queue inventory notification: {e}")

    async def _queue_retirement_notifications(
        self, item: "InventoryItem", organization_id, performed_by=None
    ) -> None:
        """Notify every member currently holding *item* that it has been
        retired/written off out of their possession.

        Covers both individual items (the assigned holder) and pool items
        (everyone with an open issuance). Without this, a member's assigned
        gear can vanish from inventory with no notice.
        """
        if item.assigned_to_user_id:
            await self._queue_inventory_notification(
                organization_id,
                item.assigned_to_user_id,
                InventoryActionType.RETIRED,
                item,
                performed_by=performed_by,
            )

        if item.tracking_type == TrackingType.POOL:
            result = await self.db.execute(
                select(ItemIssuance).where(
                    ItemIssuance.item_id == item.id,
                    ItemIssuance.organization_id == str(organization_id),
                    ItemIssuance.is_returned == False,  # noqa: E712
                )
            )
            for issuance in result.scalars().all():
                await self._queue_inventory_notification(
                    organization_id,
                    issuance.user_id,
                    InventoryActionType.RETIRED,
                    item,
                    quantity=issuance.quantity_issued,
                    performed_by=performed_by,
                )

    async def _release_item_holders(
        self, item: "InventoryItem", organization_id
    ) -> None:
        """Close out a written-off item's outstanding records so it no longer
        appears in any member's equipment list.

        For individual items the active assignment is ended and the item is
        unassigned. For pool items every open issuance is marked returned and
        ``quantity_issued`` is reduced — but the units are NOT added back to
        ``quantity`` because written-off stock is gone, not recovered.
        """
        now = datetime.now(timezone.utc)

        if item.assigned_to_user_id:
            asgn_result = await self.db.execute(
                select(ItemAssignment)
                .where(ItemAssignment.item_id == item.id)
                .where(ItemAssignment.is_active == True)  # noqa: E712
            )
            for assignment in asgn_result.scalars().all():
                assignment.is_active = False
                assignment.returned_date = now
                assignment.return_condition = ItemCondition.OUT_OF_SERVICE
            item.assigned_to_user_id = None
            item.assigned_date = None

        if item.tracking_type == TrackingType.POOL:
            iss_result = await self.db.execute(
                select(ItemIssuance).where(
                    ItemIssuance.item_id == item.id,
                    ItemIssuance.organization_id == str(organization_id),
                    ItemIssuance.is_returned == False,  # noqa: E712
                )
            )
            for issuance in iss_result.scalars().all():
                issuance.is_returned = True
                issuance.returned_at = now
                item.quantity_issued = max(
                    0, (item.quantity_issued or 0) - issuance.quantity_issued
                )

    # ------------------------------------------------------------------
    # Shared helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _status_from_condition(
        return_condition: Optional[ItemCondition],
    ) -> ItemStatus:
        """Determine item status after return based on condition.

        Items returned in poor/damaged/out-of-service condition are
        auto-quarantined to IN_MAINTENANCE; all others go to AVAILABLE.
        """
        if return_condition and return_condition in (
            ItemCondition.POOR,
            ItemCondition.DAMAGED,
            ItemCondition.OUT_OF_SERVICE,
        ):
            return ItemStatus.IN_MAINTENANCE
        return ItemStatus.AVAILABLE

    @staticmethod
    def _format_user_name(user) -> str:
        """Build 'First Last' display name, falling back to username."""
        if not user:
            return ""
        return (
            f"{user.first_name or ''} {user.last_name or ''}".strip()
            or user.username
            or ""
        )

    @staticmethod
    def _enum_value(obj) -> Any:
        """Return .value for enum instances, or the raw value otherwise."""
        return obj.value if obj and hasattr(obj, "value") else obj

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

    async def delete_category(
        self, category_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Soft-delete (deactivate) a category.

        Blocked while active items still reference it, so deleting a category
        can't orphan live inventory.
        """
        try:
            category = await self.get_category_by_id(category_id, organization_id)
            if not category:
                return False, "Category not found"

            count_result = await self.db.execute(
                select(func.count(InventoryItem.id)).where(
                    InventoryItem.category_id == str(category_id),
                    InventoryItem.organization_id == str(organization_id),
                    InventoryItem.active == True,  # noqa: E712
                )
            )
            if count_result.scalar():
                return (
                    False,
                    "Cannot delete: category still has active items. "
                    "Reassign or retire them first.",
                )

            category.active = False
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

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

            # Auto-assign the next sequential barcode if none was provided.
            if not item_data.get("barcode"):
                item_data["barcode"] = await self._next_sequential_barcode(
                    organization_id
                )

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

    # Columns allowed for sort_by parameter
    _SORTABLE_COLUMNS = {
        "name": InventoryItem.name,
        "condition": InventoryItem.condition,
        "status": InventoryItem.status,
        "quantity": InventoryItem.quantity,
        "purchase_price": InventoryItem.purchase_price,
        "created_at": InventoryItem.created_at,
        "updated_at": InventoryItem.updated_at,
    }

    async def get_items(
        self,
        organization_id: UUID,
        category_id: Optional[UUID] = None,
        status: Optional[ItemStatus] = None,
        condition: Optional[ItemCondition] = None,
        item_type: Optional[ItemType] = None,
        assigned_to: Optional[UUID] = None,
        location_id: Optional[UUID] = None,
        storage_area_id: Optional[UUID] = None,
        search: Optional[str] = None,
        size: Optional[str] = None,
        color: Optional[str] = None,
        style: Optional[str] = None,
        active_only: bool = True,
        sort_by: Optional[str] = None,
        sort_order: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> Tuple[List[InventoryItem], int]:
        """Get items with filtering, sorting, and pagination"""
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

        if condition:
            query = query.where(InventoryItem.condition == condition)

        if item_type:
            # Filter by item_type via the category relationship
            cat_subq = (
                select(InventoryCategory.id)
                .where(
                    InventoryCategory.organization_id == str(organization_id),
                    InventoryCategory.item_type == item_type,
                )
                .subquery()
            )
            query = query.where(InventoryItem.category_id.in_(select(cat_subq)))

        if assigned_to:
            query = query.where(InventoryItem.assigned_to_user_id == assigned_to)

        if location_id:
            query = query.where(InventoryItem.location_id == str(location_id))

        if storage_area_id:
            query = query.where(InventoryItem.storage_area_id == str(storage_area_id))

        if size:
            query = query.where(
                or_(
                    InventoryItem.standard_size == size,
                    InventoryItem.size == size,
                )
            )

        if color:
            query = query.where(InventoryItem.color == color)

        if style:
            query = query.where(InventoryItem.style == style)

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

        # Apply sorting
        col = self._SORTABLE_COLUMNS.get(sort_by or "name", InventoryItem.name)
        if sort_order == "desc":
            query = query.order_by(col.desc())
        else:
            query = query.order_by(col.asc())

        query = query.offset(skip).limit(limit)
        result = await self.db.execute(query)
        items = list(result.scalars().all())

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
                selectinload(InventoryItem.location),
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
            if return_condition:
                item.condition = return_condition

            item.status = self._status_from_condition(return_condition)

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
        override_allowance: bool = False,
    ) -> Tuple[Optional["ItemIssuance"], Optional[str]]:
        """Issue units from a pool-tracked item to a member.

        Enforces the member's per-category issuance allowance (e.g. "3 polos
        per year") unless *override_allowance* is set, which lets a
        quartermaster intentionally exceed the cap.
        """
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

            if not override_allowance:
                allowance_error = await self._enforce_issuance_allowance(
                    user_id, item.category_id, organization_id, quantity
                )
                if allowance_error:
                    return None, allowance_error

            # Decrement pool quantity, increment issued count
            item.quantity -= quantity
            item.quantity_issued = (item.quantity_issued or 0) + quantity

            # Snapshot the replacement cost at issuance time for cost recovery
            unit_cost = (
                item.replacement_cost
                if item.replacement_cost is not None
                else item.purchase_price
            )

            # Create issuance record
            issuance = ItemIssuance(
                organization_id=organization_id,
                item_id=item_id,
                user_id=user_id,
                quantity_issued=quantity,
                issued_by=issued_by,
                issue_reason=reason,
                is_returned=False,
                unit_cost_at_issuance=unit_cost,
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
        skip: int = 0,
        limit: int = 200,
    ) -> List["ItemIssuance"]:
        """Get issuance records for a pool item with pagination."""
        query = (
            select(ItemIssuance)
            .where(ItemIssuance.item_id == str(item_id))
            .where(ItemIssuance.organization_id == str(organization_id))
            .options(selectinload(ItemIssuance.user))
        )
        if active_only:
            query = query.where(ItemIssuance.is_returned == False)  # noqa: E712
        query = query.order_by(ItemIssuance.issued_at.desc()).offset(skip).limit(limit)

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
            item.condition = return_condition

            item.status = self._status_from_condition(return_condition)

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
            await self.db.flush()  # assign maintenance.id for the NFPA detail FK

            # Persist structured NFPA 1851 inspection results when supplied.
            # This is filtered out of _MAINTENANCE_ALLOWED_FIELDS because it
            # belongs in its own table, not on the maintenance record.
            nfpa_inspection = maintenance_data.get("nfpa_inspection")
            if nfpa_inspection:
                self.db.add(
                    NFPAInspectionDetail(
                        maintenance_record_id=maintenance.id,
                        organization_id=organization_id,
                        **nfpa_inspection,
                    )
                )

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
            select(
                func.coalesce(
                    func.sum(InventoryItem.current_value * InventoryItem.quantity), 0
                )
            )
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

    async def get_user_inventory_summary(
        self, organization_id: UUID, user_id: str
    ) -> Dict[str, Any]:
        """Get inventory summary scoped to a single user's checkouts and
        assignments."""
        org_id = str(organization_id)

        # Item IDs the user currently has checked out
        checkout_items_q = (
            select(CheckOutRecord.item_id)
            .where(CheckOutRecord.organization_id == org_id)
            .where(CheckOutRecord.user_id == user_id)
            .where(CheckOutRecord.is_returned == False)  # noqa: E712
        )
        checkout_item_ids_result = await self.db.execute(checkout_items_q)
        checkout_item_ids = {row[0] for row in checkout_item_ids_result.all()}

        # Item IDs permanently assigned to the user
        assignment_items_q = (
            select(ItemAssignment.item_id)
            .where(ItemAssignment.organization_id == org_id)
            .where(ItemAssignment.user_id == user_id)
            .where(ItemAssignment.is_active == True)  # noqa: E712
        )
        assignment_item_ids_result = await self.db.execute(assignment_items_q)
        assignment_item_ids = {row[0] for row in assignment_item_ids_result.all()}

        user_item_ids = checkout_item_ids | assignment_item_ids

        if not user_item_ids:
            return {
                "total_items": 0,
                "items_by_status": {},
                "items_by_condition": {},
                "total_value": 0.0,
                "active_checkouts": 0,
                "overdue_checkouts": 0,
                "maintenance_due_count": 0,
            }

        # Total items (sum quantities)
        total_result = await self.db.execute(
            select(func.coalesce(func.sum(InventoryItem.quantity), 0))
            .where(InventoryItem.id.in_(user_item_ids))
            .where(InventoryItem.active == True)  # noqa: E712
        )
        total_items = total_result.scalar()

        # Items by status
        status_result = await self.db.execute(
            select(
                InventoryItem.status,
                func.count(InventoryItem.id).label("count"),
            )
            .where(InventoryItem.id.in_(user_item_ids))
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
            .where(InventoryItem.id.in_(user_item_ids))
            .where(InventoryItem.active == True)  # noqa: E712
            .group_by(InventoryItem.condition)
        )
        items_by_condition = {
            row.condition.value: row.count for row in condition_result.all()
        }

        # Total value
        value_result = await self.db.execute(
            select(
                func.coalesce(
                    func.sum(InventoryItem.current_value * InventoryItem.quantity),
                    0,
                )
            )
            .where(InventoryItem.id.in_(user_item_ids))
            .where(InventoryItem.active == True)  # noqa: E712
        )
        total_value = value_result.scalar() or Decimal("0.00")

        # User's active checkouts
        active_checkouts = len(checkout_item_ids)

        # User's overdue checkouts
        overdue_result = await self.db.execute(
            select(func.count(CheckOutRecord.id))
            .where(CheckOutRecord.organization_id == org_id)
            .where(CheckOutRecord.user_id == user_id)
            .where(CheckOutRecord.is_returned == False)  # noqa: E712
            .where(CheckOutRecord.is_overdue == True)  # noqa: E712
        )
        overdue_checkouts = overdue_result.scalar() or 0

        # Maintenance due on user's items
        cutoff_date = date.today() + timedelta(days=7)
        maint_result = await self.db.execute(
            select(func.count(InventoryItem.id))
            .where(InventoryItem.id.in_(user_item_ids))
            .where(InventoryItem.active == True)  # noqa: E712
            .where(InventoryItem.next_inspection_due <= cutoff_date)
        )
        maintenance_due_count = maint_result.scalar() or 0

        items_in_maintenance = items_by_status.get("in_maintenance", 0)

        return {
            "total_items": total_items,
            "items_by_status": items_by_status,
            "items_by_condition": items_by_condition,
            "total_value": float(total_value),
            "active_checkouts": active_checkouts,
            "overdue_checkouts": overdue_checkouts,
            "maintenance_due_count": maintenance_due_count + items_in_maintenance,
        }

    async def get_summary_by_location(
        self, organization_id: UUID
    ) -> List[Dict[str, Any]]:
        """Get inventory summary grouped by location"""
        from app.models.location import Location

        result = await self.db.execute(
            select(
                Location.id,
                Location.name,
                func.count(InventoryItem.id).label("item_count"),
                func.coalesce(func.sum(InventoryItem.quantity), 0).label(
                    "total_quantity"
                ),
                func.coalesce(
                    func.sum(InventoryItem.current_value * InventoryItem.quantity), 0
                ).label("total_value"),
            )
            .join(
                InventoryItem,
                and_(
                    InventoryItem.location_id == Location.id,
                    InventoryItem.organization_id == str(organization_id),
                    InventoryItem.active == True,  # noqa: E712
                ),
            )
            .where(Location.organization_id == str(organization_id))
            .group_by(Location.id, Location.name)
            .order_by(func.count(InventoryItem.id).desc())
        )
        rows = result.all()

        # Also get items with no location
        unassigned_result = await self.db.execute(
            select(
                func.count(InventoryItem.id).label("item_count"),
                func.coalesce(func.sum(InventoryItem.quantity), 0).label(
                    "total_quantity"
                ),
                func.coalesce(
                    func.sum(InventoryItem.current_value * InventoryItem.quantity), 0
                ).label("total_value"),
            ).where(
                InventoryItem.organization_id == str(organization_id),
                InventoryItem.active == True,  # noqa: E712
                InventoryItem.location_id.is_(None),
            )
        )
        unassigned = unassigned_result.one()

        locations = [
            {
                "location_id": row.id,
                "location_name": row.name,
                "item_count": row.item_count,
                "total_quantity": row.total_quantity,
                "total_value": float(row.total_value),
            }
            for row in rows
        ]

        if unassigned.item_count > 0:
            locations.append(
                {
                    "location_id": None,
                    "location_name": "Unassigned",
                    "item_count": unassigned.item_count,
                    "total_quantity": unassigned.total_quantity,
                    "total_value": float(unassigned.total_value),
                }
            )

        return locations

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

        Runs a single DB query with OR across all searchable fields, then
        assigns the best matched_field in Python based on priority order:
        barcode > serial_number > asset_tag > name > size > color.
        """
        code = code.strip()
        if not code:
            return []

        org_id = str(organization_id)
        safe_code = code.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        search_term = f"%{safe_code}%"

        # Priority-ordered fields to search
        field_names = ["barcode", "serial_number", "asset_tag", "name", "size", "color"]
        field_cols = [
            InventoryItem.barcode,
            InventoryItem.serial_number,
            InventoryItem.asset_tag,
            InventoryItem.name,
            InventoryItem.size,
            InventoryItem.color,
        ]

        # Single query: match any of the fields
        result = await self.db.execute(
            select(InventoryItem)
            .where(
                InventoryItem.organization_id == org_id,
                InventoryItem.active == True,  # noqa: E712
                or_(*[col.ilike(search_term) for col in field_cols]),
            )
            .options(selectinload(InventoryItem.category))
            .limit(limit * 2)  # fetch extra to allow dedup headroom
        )
        items = result.scalars().all()

        # Determine the highest-priority matched field for each item
        results: List[Tuple[InventoryItem, str, str]] = []
        safe_lower = safe_code.lower()
        for item in items:
            matched_field = "name"
            matched_value = item.name or ""
            for fname in field_names:
                val = getattr(item, fname) or ""
                if val and safe_lower in val.lower():
                    matched_field = fname
                    matched_value = val
                    break
            results.append((item, matched_field, matched_value))

        # Sort by field priority so barcode matches come first
        priority = {name: i for i, name in enumerate(field_names)}
        results.sort(key=lambda r: priority.get(r[1], 99))

        return results[:limit]

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
                    self._batch_result(
                        code, None, "none", False, f"No item found for code '{code}'"
                    )
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
                    results.append(
                        self._batch_result(code, item, "issued", not err, err)
                    )
                    successful, failed = (
                        (successful + 1, failed)
                        if not err
                        else (successful, failed + 1)
                    )

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
                    results.append(
                        self._batch_result(code, item, "assigned", not err, err)
                    )
                    successful, failed = (
                        (successful + 1, failed)
                        if not err
                        else (successful, failed + 1)
                    )

                else:
                    results.append(
                        self._batch_result(
                            code,
                            item,
                            "none",
                            False,
                            f"Item is not available (status: {item.status.value})",
                        )
                    )
                    failed += 1

            except Exception as e:
                results.append(self._batch_result(code, item, "none", False, str(e)))
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

    @staticmethod
    def _batch_result(
        code: str,
        item,
        action: str,
        success: bool,
        error: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Build a single result entry for batch checkout/return operations."""
        return {
            "code": code,
            "item_name": item.name if item else "Unknown",
            "item_id": item.id if item else "",
            "action": action,
            "success": success,
            "error": error,
        }

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
                    self._batch_result(
                        code, None, "none", False, f"No item found for code '{code}'"
                    )
                )
                failed += 1
                continue

            item, _, _ = lookup

            try:
                condition = ItemCondition(condition_str)
            except ValueError:
                results.append(
                    self._batch_result(
                        code,
                        item,
                        "none",
                        False,
                        f"Invalid return condition: '{condition_str}'",
                    )
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
                    results.append(
                        self._batch_result(code, item, "unassigned", not err, err)
                    )
                    successful, failed = (
                        (successful + 1, failed)
                        if not err
                        else (successful, failed + 1)
                    )
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
                    results.append(
                        self._batch_result(code, item, "checked_in", not err, err)
                    )
                    successful, failed = (
                        (successful + 1, failed)
                        if not err
                        else (successful, failed + 1)
                    )
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
                        results.append(
                            self._batch_result(
                                code, item, "returned_to_pool", not err, err
                            )
                        )
                        successful, failed = (
                            (successful + 1, failed)
                            if not err
                            else (successful, failed + 1)
                        )
                        continue

                # Item not held by this user
                results.append(
                    self._batch_result(
                        code,
                        item,
                        "none",
                        False,
                        "Item is not assigned to, checked out by, or issued to this member",
                    )
                )
                failed += 1

            except Exception as e:
                results.append(self._batch_result(code, item, "none", False, str(e)))
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

    async def build_label_specs(
        self,
        item_ids: List,
        organization_id,
        extra_lines: Optional[List[str]] = None,
        persist: bool = True,
    ) -> Tuple[List[LabelSpec], int]:
        """Fetch inventory items and map them to neutral ``LabelSpec`` objects
        for the shared renderer.

        When ``persist`` (the print path), any item still missing a barcode is
        assigned a canonical sequential one and committed, so the printed label
        matches what is stored. When ``persist`` is False (preview / the generic
        read-only path) nothing is written — a fallback identifier is shown.

        Returns (specs, auto_populated_count)."""
        items = []
        missing_ids = []
        for item_id in item_ids:
            item = await self.get_item_by_id(
                UUID(str(item_id)), UUID(str(organization_id))
            )
            if item:
                items.append(item)
            else:
                missing_ids.append(str(item_id))

        if missing_ids:
            logger.warning(
                "Label generation: %d of %d items not found or inaccessible: %s",
                len(missing_ids),
                len(item_ids),
                ", ".join(missing_ids[:10]),
            )

        if not items:
            raise ValueError("No valid items found for label generation")

        # Persist a canonical barcode for any straggler that still lacks one,
        # so the printed label matches what is stored on the item.
        auto_populated = 0
        if persist:
            for item in items:
                if not item.barcode:
                    item.barcode = await self._next_sequential_barcode(
                        item.organization_id
                    )
                    auto_populated += 1
            if auto_populated > 0:
                await self.db.commit()

        specs = [
            LabelSpec(
                name=item.name,
                barcode_value=(
                    item.barcode or item.asset_tag or item.serial_number or item.id[:12]
                ),
                asset_tag=item.asset_tag,
                serial_number=item.serial_number,
                extra=_build_extra_lines(item, extra_lines) or None,
            )
            for item in items
        ]
        return specs, auto_populated

    async def generate_barcode_labels(
        self,
        item_ids: List[UUID],
        organization_id: UUID,
        label_format: str = "letter",
        custom_width: Optional[float] = None,
        custom_height: Optional[float] = None,
        auto_rotate: Optional[bool] = None,
        extra_lines: Optional[List[str]] = None,
    ) -> Tuple[BytesIO, int]:
        """Generate a PDF of barcode labels for the given inventory items.

        Delegates rendering to the shared renderer (app.utils.label_renderer;
        the cross-module system lives in app.services.label_service). Returns
        (pdf_buffer, auto_populated_count)."""
        specs, auto_populated = await self.build_label_specs(
            item_ids, organization_id, extra_lines
        )
        pdf = render_labels(
            specs, label_format, custom_width, custom_height, auto_rotate
        )
        return pdf, auto_populated

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
            .options(
                selectinload(WriteOffRequest.requester),
                selectinload(WriteOffRequest.reviewer),
            )
            .order_by(WriteOffRequest.created_at.desc())
        )
        if status_filter:
            query = query.where(WriteOffRequest.status == WriteOffStatus(status_filter))

        result = await self.db.execute(query)
        rows = result.scalars().all()

        requests = []
        for wo in rows:
            requester_name = self._format_user_name(wo.requester) or None
            reviewer_name = self._format_user_name(wo.reviewer) or None

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
                    # Notify holders before the item leaves their possession,
                    # then close out their assignment/issuance records so the
                    # written-off item disappears from their equipment list.
                    await self._queue_retirement_notifications(
                        item, organization_id, performed_by=reviewed_by
                    )
                    await self._release_item_holders(item, organization_id)
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

    async def get_item_history(
        self,
        item_id: UUID,
        organization_id: UUID,
    ) -> List[Dict[str, Any]]:
        """Get unified history/activity timeline for an item.

        Merges assignment history, checkout records, pool issuances, and
        maintenance records into a single chronologically sorted list.
        """
        events: List[Dict[str, Any]] = []

        # --- Assignments ---
        asgn_result = await self.db.execute(
            select(ItemAssignment)
            .options(selectinload(ItemAssignment.user))
            .where(
                ItemAssignment.item_id == str(item_id),
                ItemAssignment.organization_id == str(organization_id),
            )
            .order_by(ItemAssignment.assigned_date.desc())
        )
        for a in asgn_result.scalars().all():
            user_name = self._format_user_name(a.user)
            events.append(
                {
                    "type": "assignment",
                    "id": a.id,
                    "date": (
                        a.assigned_date.isoformat()
                        if a.assigned_date
                        else a.created_at.isoformat()
                    ),
                    "summary": (
                        f"Assigned to {user_name}"
                        if a.is_active
                        else f"Returned by {user_name}"
                    ),
                    "details": {
                        "user_name": user_name,
                        "assignment_type": self._enum_value(a.assignment_type),
                        "reason": a.assignment_reason,
                        "is_active": a.is_active,
                        "returned_at": (
                            a.returned_date.isoformat() if a.returned_date else None
                        ),
                        "return_condition": self._enum_value(a.return_condition),
                        "return_notes": a.return_notes,
                    },
                }
            )
            # If returned, add a separate return event
            if a.returned_date:
                events.append(
                    {
                        "type": "return",
                        "id": f"{a.id}_return",
                        "date": a.returned_date.isoformat(),
                        "summary": f"Returned by {user_name}",
                        "details": {
                            "user_name": user_name,
                            "return_condition": self._enum_value(a.return_condition),
                            "return_notes": a.return_notes,
                        },
                    }
                )

        # --- Checkouts ---
        co_result = await self.db.execute(
            select(CheckOutRecord)
            .options(selectinload(CheckOutRecord.user))
            .where(
                CheckOutRecord.item_id == str(item_id),
                CheckOutRecord.organization_id == str(organization_id),
            )
            .order_by(CheckOutRecord.checked_out_at.desc())
        )
        for c in co_result.scalars().all():
            user_name = self._format_user_name(c.user)
            events.append(
                {
                    "type": "checkout",
                    "id": c.id,
                    "date": (
                        c.checked_out_at.isoformat()
                        if c.checked_out_at
                        else c.created_at.isoformat()
                    ),
                    "summary": f"Checked out by {user_name}",
                    "details": {
                        "user_name": user_name,
                        "reason": c.checkout_reason,
                        "expected_return": (
                            c.expected_return_at.isoformat()
                            if c.expected_return_at
                            else None
                        ),
                        "is_returned": c.is_returned,
                        "is_overdue": c.is_overdue,
                    },
                }
            )
            if c.checked_in_at:
                events.append(
                    {
                        "type": "checkin",
                        "id": f"{c.id}_checkin",
                        "date": c.checked_in_at.isoformat(),
                        "summary": f"Checked in by {user_name}",
                        "details": {
                            "user_name": user_name,
                            "return_condition": self._enum_value(c.return_condition),
                            "damage_notes": c.damage_notes,
                        },
                    }
                )

        # --- Pool issuances ---
        iss_result = await self.db.execute(
            select(ItemIssuance)
            .options(selectinload(ItemIssuance.user))
            .where(
                ItemIssuance.item_id == str(item_id),
                ItemIssuance.organization_id == str(organization_id),
            )
            .order_by(ItemIssuance.issued_at.desc())
        )
        for i in iss_result.scalars().all():
            user_name = self._format_user_name(i.user)
            events.append(
                {
                    "type": "issuance",
                    "id": i.id,
                    "date": (
                        i.issued_at.isoformat()
                        if i.issued_at
                        else i.created_at.isoformat()
                    ),
                    "summary": f"Issued {i.quantity} to {user_name}",
                    "details": {
                        "user_name": user_name,
                        "quantity": i.quantity,
                        "reason": i.reason,
                        "is_returned": i.is_returned,
                    },
                }
            )
            if i.returned_at:
                events.append(
                    {
                        "type": "issuance_return",
                        "id": f"{i.id}_return",
                        "date": i.returned_at.isoformat(),
                        "summary": f"{user_name} returned {i.quantity}",
                        "details": {
                            "user_name": user_name,
                            "quantity": i.quantity,
                            "return_condition": self._enum_value(i.return_condition),
                            "return_notes": i.return_notes,
                        },
                    }
                )

        # --- Maintenance records ---
        maint_result = await self.db.execute(
            select(MaintenanceRecord)
            .where(
                MaintenanceRecord.item_id == str(item_id),
                MaintenanceRecord.organization_id == str(organization_id),
            )
            .order_by(MaintenanceRecord.created_at.desc())
        )
        for m in maint_result.scalars().all():
            mtype = self._enum_value(m.maintenance_type)
            events.append(
                {
                    "type": "maintenance",
                    "id": m.id,
                    "date": (
                        (
                            m.completed_date or m.scheduled_date or m.created_at
                        ).isoformat()
                        if (m.completed_date or m.scheduled_date)
                        else m.created_at.isoformat()
                    ),
                    "summary": (
                        f"{mtype.replace('_', ' ').title()}"
                        f"{' — completed' if m.is_completed else ' — scheduled'}"
                    ),
                    "details": {
                        "maintenance_type": mtype,
                        "description": m.description,
                        "is_completed": m.is_completed,
                        "passed": m.passed,
                        "condition_after": self._enum_value(m.condition_after),
                        "notes": m.notes,
                    },
                }
            )

        # Sort all events by date descending
        events.sort(key=lambda e: e["date"], reverse=True)
        return events

    # ------------------------------------------------------------------
    # Issuance Allowances
    # ------------------------------------------------------------------

    async def check_allowance(
        self,
        user_id: UUID,
        category_id: UUID,
        organization_id: UUID,
        role_id: Optional[UUID] = None,
    ) -> Dict[str, Any]:
        """Check how many more units a member can receive for a category."""
        # Find applicable allowance — role-specific first, then org-wide
        q = (
            select(IssuanceAllowance)
            .where(IssuanceAllowance.organization_id == str(organization_id))
            .where(IssuanceAllowance.category_id == str(category_id))
            .where(IssuanceAllowance.is_active.is_(True))
        )
        result = await self.db.execute(q)
        allowances = result.scalars().all()

        if not allowances:
            return {
                "max_quantity": -1,  # -1 means unlimited
                "issued_this_period": 0,
                "remaining": -1,
                "period_type": "none",
            }

        # Pick the most specific allowance (role match first)
        allowance = None
        for a in allowances:
            if role_id and a.role_id == str(role_id):
                allowance = a
                break
        if not allowance:
            for a in allowances:
                if not a.role_id:
                    allowance = a
                    break
        if not allowance:
            return {
                "max_quantity": -1,
                "issued_this_period": 0,
                "remaining": -1,
                "period_type": "none",
            }

        # Count issued this period
        period_start = None
        if allowance.period_type == "annual":
            now = datetime.now(timezone.utc)
            period_start = datetime(now.year, 1, 1, tzinfo=timezone.utc)
        # "career" and "one_time" count all time

        # Get items in this category
        cat_items = await self.db.execute(
            select(InventoryItem.id).where(
                InventoryItem.organization_id == str(organization_id),
                InventoryItem.category_id == str(category_id),
                InventoryItem.tracking_type == TrackingType.POOL,
            )
        )
        item_ids = [r[0] for r in cat_items.fetchall()]

        if not item_ids:
            return {
                "max_quantity": allowance.max_quantity,
                "issued_this_period": 0,
                "remaining": allowance.max_quantity,
                "period_type": allowance.period_type,
            }

        issued_q = select(
            func.coalesce(func.sum(ItemIssuance.quantity_issued), 0)
        ).where(
            ItemIssuance.organization_id == str(organization_id),
            ItemIssuance.user_id == str(user_id),
            ItemIssuance.item_id.in_(item_ids),
        )
        if period_start:
            issued_q = issued_q.where(ItemIssuance.issued_at >= period_start)

        issued_result = await self.db.execute(issued_q)
        issued_count = int(issued_result.scalar() or 0)

        remaining = max(0, allowance.max_quantity - issued_count)
        return {
            "max_quantity": allowance.max_quantity,
            "issued_this_period": issued_count,
            "remaining": remaining,
            "period_type": allowance.period_type,
        }

    async def _get_primary_role_id(self, user_id, organization_id) -> Optional[UUID]:
        """Return the member's highest-priority position id, used to resolve
        which issuance allowance applies. Positions carry a ``priority`` so a
        member holding several roles is evaluated against their most senior
        one, giving deterministic allowance lookups.
        """
        from app.models.user import Position, user_roles

        result = await self.db.execute(
            select(Position.id)
            .join(user_roles, Position.id == user_roles.c.position_id)
            .where(user_roles.c.user_id == str(user_id))
            .where(Position.organization_id == str(organization_id))
            .order_by(Position.priority.desc())
            .limit(1)
        )
        row = result.scalar_one_or_none()
        return UUID(row) if row else None

    async def _enforce_issuance_allowance(
        self, user_id, category_id, organization_id, quantity: int
    ) -> Optional[str]:
        """Return an error string if issuing *quantity* would exceed the
        member's allowance for the item's category, else None.

        A ``max_quantity`` of -1 from :meth:`check_allowance` means no cap is
        configured for the category, so issuance is unrestricted.
        """
        if not category_id:
            return None
        role_id = await self._get_primary_role_id(user_id, organization_id)
        info = await self.check_allowance(
            user_id, category_id, organization_id, role_id
        )
        if info["max_quantity"] == -1:
            return None
        if quantity > info["remaining"]:
            return (
                f"Issuance exceeds allowance: member has {info['remaining']} of "
                f"{info['max_quantity']} remaining for this category "
                f"({info['period_type']}), but {quantity} requested. "
                "An administrator can override this limit."
            )
        return None

    # ------------------------------------------------------------------
    # Bulk Issuance
    # ------------------------------------------------------------------

    async def bulk_issue_from_pool(
        self,
        item_id: UUID,
        targets: List[Dict[str, Any]],
        organization_id: UUID,
        issued_by: UUID,
    ) -> List[Dict[str, Any]]:
        """Issue a pool item to multiple members at once."""
        results = []
        for target in targets:
            user_id = target["user_id"]
            qty = target.get("quantity", 1)
            reason = target.get("issue_reason")

            issuance, error = await self.issue_from_pool(
                item_id=item_id,
                user_id=user_id,
                organization_id=organization_id,
                issued_by=issued_by,
                quantity=qty,
                reason=reason,
            )
            if error:
                results.append({"user_id": user_id, "success": False, "error": error})
            else:
                results.append(
                    {
                        "user_id": user_id,
                        "success": True,
                        "issuance_id": issuance.id if issuance else None,
                    }
                )
        return results

    # ------------------------------------------------------------------
    # Size Variant Quick-Create
    # ------------------------------------------------------------------

    async def create_size_variants(
        self,
        organization_id: UUID,
        created_by: UUID,
        base_name: str,
        sizes: List[str],
        colors: Optional[List[str]] = None,
        styles: Optional[List[str]] = None,
        create_variant_group: bool = True,
        **kwargs: Any,
    ) -> Tuple[List["InventoryItem"], Optional[str]]:
        """Create pool items from a base name × sizes × colors × styles matrix.

        Returns a tuple of (items_created, variant_group_id_or_None).
        """
        from app.models.inventory import GarmentStyle, StandardSize

        # Build the combination matrix: (size, color|None, style|None)
        combos: List[Tuple[str, Optional[str], Optional[str]]] = []

        style_list = styles or [None]  # type: ignore[list-item]
        color_list = colors or [None]  # type: ignore[list-item]

        for size in sizes:
            for color in color_list:
                for style in style_list:
                    combos.append((size, color, style))

        # Optionally create a variant group to link all items
        variant_group_id: Optional[str] = None
        if create_variant_group:
            group = ItemVariantGroup(
                organization_id=str(organization_id),
                name=base_name,
                category_id=(
                    str(kwargs["category_id"]) if kwargs.get("category_id") else None
                ),
                base_price=kwargs.get("purchase_price"),
                base_replacement_cost=kwargs.get("replacement_cost"),
                unit_of_measure=kwargs.get("unit_of_measure"),
                created_by=str(created_by),
                active=True,
            )
            self.db.add(group)
            await self.db.flush()
            variant_group_id = group.id

        items_created: List[InventoryItem] = []

        for size, color, style in combos:
            name_parts = [base_name, size]
            if color:
                name_parts.append(color)
            if style:
                # Human-readable style label for the name
                style_label = style.replace("_", " ").title()
                name_parts.append(style_label)
            item_name = " — ".join(name_parts)

            # Map size string to StandardSize enum if it matches
            std_size = None
            size_lower = size.lower()
            for member in StandardSize:
                if member.value == size_lower:
                    std_size = member
                    break

            # Map style string to GarmentStyle enum if it matches
            garment_style = None
            if style:
                for member in GarmentStyle:
                    if member.value == style:
                        garment_style = member
                        break

            barcode = await self._next_sequential_barcode(organization_id)

            item = InventoryItem(
                organization_id=str(organization_id),
                name=item_name,
                barcode=barcode,
                size=size,
                standard_size=std_size,
                color=color,
                style=garment_style,
                tracking_type=TrackingType.POOL,
                quantity=kwargs.get("quantity_per_variant", 0),
                quantity_issued=0,
                condition=ItemCondition.GOOD,
                status=ItemStatus.AVAILABLE,
                category_id=(
                    str(kwargs["category_id"]) if kwargs.get("category_id") else None
                ),
                replacement_cost=kwargs.get("replacement_cost"),
                purchase_price=kwargs.get("purchase_price"),
                unit_of_measure=kwargs.get("unit_of_measure"),
                location_id=(
                    str(kwargs["location_id"]) if kwargs.get("location_id") else None
                ),
                storage_area_id=(
                    str(kwargs["storage_area_id"])
                    if kwargs.get("storage_area_id")
                    else None
                ),
                station=kwargs.get("station"),
                notes=kwargs.get("notes"),
                variant_group_id=variant_group_id,
                created_by=str(created_by),
                active=True,
            )
            self.db.add(item)
            items_created.append(item)

        await self.db.commit()
        for item in items_created:
            await self.db.refresh(item)

        return items_created, variant_group_id

    # ------------------------------------------------------------------
    # Cost Recovery
    # ------------------------------------------------------------------

    async def update_issuance_charge(
        self,
        issuance_id: UUID,
        organization_id: UUID,
        charge_status: str,
        charge_amount: Optional[Decimal] = None,
    ) -> Tuple[bool, Optional[str]]:
        """Update the charge status and amount on an issuance record."""
        result = await self.db.execute(
            select(ItemIssuance)
            .where(ItemIssuance.id == str(issuance_id))
            .where(ItemIssuance.organization_id == str(organization_id))
        )
        issuance = result.scalar_one_or_none()
        if not issuance:
            return False, "Issuance record not found"

        issuance.charge_status = charge_status
        if charge_amount is not None:
            issuance.charge_amount = charge_amount
        elif charge_status == "charged" and issuance.unit_cost_at_issuance:
            # Default to the cost snapshot × quantity
            issuance.charge_amount = (
                issuance.unit_cost_at_issuance * issuance.quantity_issued
            )

        await self.db.commit()
        return True, None

    async def get_charges(
        self,
        organization_id: UUID,
        charge_status_filter: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List issuances with charge-relevant info for admin charge management."""
        query = (
            select(ItemIssuance)
            .where(ItemIssuance.organization_id == str(organization_id))
            .where(ItemIssuance.charge_status != "none")
            .options(selectinload(ItemIssuance.item), selectinload(ItemIssuance.user))
            .order_by(ItemIssuance.created_at.desc())
        )

        if charge_status_filter:
            query = query.where(ItemIssuance.charge_status == charge_status_filter)

        result = await self.db.execute(query)
        issuances = list(result.scalars().all())

        items = []
        total_pending = Decimal("0.00")
        total_charged = Decimal("0.00")
        total_waived = 0

        for iss in issuances:
            user_name = self._format_user_name(iss.user)
            item_name = iss.item.name if iss.item else "Unknown"

            cost = iss.charge_amount or (
                (iss.unit_cost_at_issuance or Decimal("0")) * iss.quantity_issued
            )

            if iss.charge_status == "pending":
                total_pending += cost
            elif iss.charge_status == "charged":
                total_charged += iss.charge_amount or Decimal("0")
            elif iss.charge_status == "waived":
                total_waived += 1

            items.append(
                {
                    "issuance_id": iss.id,
                    "item_id": iss.item_id,
                    "item_name": item_name,
                    "user_id": iss.user_id,
                    "user_name": user_name,
                    "quantity_issued": iss.quantity_issued,
                    "issued_at": iss.issued_at,
                    "returned_at": iss.returned_at,
                    "is_returned": iss.is_returned,
                    "return_condition": (
                        iss.return_condition.value if iss.return_condition else None
                    ),
                    "unit_cost_at_issuance": iss.unit_cost_at_issuance,
                    "charge_status": iss.charge_status,
                    "charge_amount": iss.charge_amount,
                }
            )

        return {
            "items": items,
            "total": len(items),
            "total_pending": total_pending,
            "total_charged": total_charged,
            "total_waived": total_waived,
        }

    # ------------------------------------------------------------------
    # Return Requests (member-initiated, QM-approved)
    # ------------------------------------------------------------------

    async def create_return_request(
        self,
        organization_id: UUID,
        requester_id: UUID,
        return_type: str,
        item_id: UUID,
        assignment_id: Optional[UUID] = None,
        issuance_id: Optional[UUID] = None,
        checkout_id: Optional[UUID] = None,
        quantity_returning: int = 1,
        reported_condition: str = "good",
        member_notes: Optional[str] = None,
    ) -> Tuple[Optional[ReturnRequest], Optional[str]]:
        """Create a member-initiated return request for quartermaster review."""
        # Validate the item exists and belongs to this org
        item_result = await self.db.execute(
            select(InventoryItem)
            .where(InventoryItem.id == str(item_id))
            .where(InventoryItem.organization_id == str(organization_id))
        )
        item = item_result.scalar_one_or_none()
        if not item:
            return None, "Item not found"

        # Check for duplicate pending return requests
        dupe_query = (
            select(ReturnRequest)
            .where(ReturnRequest.organization_id == str(organization_id))
            .where(ReturnRequest.requester_id == str(requester_id))
            .where(ReturnRequest.item_id == str(item_id))
            .where(ReturnRequest.status == ReturnRequestStatus.PENDING)
        )
        dupe_result = await self.db.execute(dupe_query)
        if dupe_result.scalar_one_or_none():
            return None, "You already have a pending return request for this item"

        condition_enum = (
            ItemCondition(reported_condition)
            if reported_condition
            else ItemCondition.GOOD
        )
        type_enum = ReturnRequestType(return_type)

        request = ReturnRequest(
            organization_id=str(organization_id),
            requester_id=str(requester_id),
            return_type=type_enum,
            item_id=str(item_id),
            item_name=item.name,
            assignment_id=str(assignment_id) if assignment_id else None,
            issuance_id=str(issuance_id) if issuance_id else None,
            checkout_id=str(checkout_id) if checkout_id else None,
            quantity_returning=quantity_returning,
            reported_condition=condition_enum,
            member_notes=member_notes,
            status=ReturnRequestStatus.PENDING,
        )
        self.db.add(request)
        await self.db.commit()
        await self.db.refresh(request)
        return request, None

    async def get_return_requests(
        self,
        organization_id: UUID,
        status_filter: Optional[str] = None,
        requester_id: Optional[UUID] = None,
    ) -> List[ReturnRequest]:
        """List return requests, optionally filtered by status or requester."""
        query = (
            select(ReturnRequest)
            .where(ReturnRequest.organization_id == str(organization_id))
            .options(
                selectinload(ReturnRequest.requester),
                selectinload(ReturnRequest.reviewer),
            )
            .order_by(ReturnRequest.created_at.desc())
        )
        if status_filter:
            query = query.where(
                ReturnRequest.status == ReturnRequestStatus(status_filter)
            )
        if requester_id:
            query = query.where(ReturnRequest.requester_id == str(requester_id))

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def review_return_request(
        self,
        request_id: UUID,
        organization_id: UUID,
        reviewer_id: UUID,
        status: str,
        review_notes: Optional[str] = None,
        override_condition: Optional[str] = None,
    ) -> Tuple[bool, Optional[str]]:
        """
        Approve or deny a return request.

        On approval, executes the actual return operation (unassign, return to pool,
        or check-in) using the appropriate service method.
        """
        result = await self.db.execute(
            select(ReturnRequest)
            .where(ReturnRequest.id == str(request_id))
            .where(ReturnRequest.organization_id == str(organization_id))
        )
        req = result.scalar_one_or_none()
        if not req:
            return False, "Return request not found"

        if req.status != ReturnRequestStatus.PENDING:
            return False, f"Request is already {req.status.value}"

        req.reviewed_by = str(reviewer_id)
        req.reviewed_at = datetime.now(timezone.utc)
        req.review_notes = review_notes

        if status == "denied":
            req.status = ReturnRequestStatus.DENIED
            await self.db.commit()
            return True, None

        # Approved — execute the actual return
        condition_str = override_condition or req.reported_condition.value
        condition_enum = ItemCondition(condition_str)

        req.status = ReturnRequestStatus.APPROVED

        if req.return_type == ReturnRequestType.ASSIGNMENT:
            success, error = await self.unassign_item(
                item_id=UUID(str(req.item_id)),
                organization_id=organization_id,
                returned_by=reviewer_id,
                return_condition=condition_enum,
                return_notes=f"Return request #{req.id[:8]} — {review_notes or ''}".strip(),
                expected_user_id=UUID(str(req.requester_id)),
            )
            if not success:
                req.status = ReturnRequestStatus.PENDING
                req.reviewed_by = None
                req.reviewed_at = None
                await self.db.commit()
                return False, f"Failed to unassign: {error}"

        elif req.return_type == ReturnRequestType.ISSUANCE:
            if not req.issuance_id:
                return False, "No issuance ID on this request"
            success, error = await self.return_to_pool(
                issuance_id=UUID(str(req.issuance_id)),
                organization_id=organization_id,
                returned_by=reviewer_id,
                return_condition=condition_enum,
                return_notes=f"Return request #{req.id[:8]} — {review_notes or ''}".strip(),
                quantity_returned=req.quantity_returning,
            )
            if not success:
                req.status = ReturnRequestStatus.PENDING
                req.reviewed_by = None
                req.reviewed_at = None
                await self.db.commit()
                return False, f"Failed to return to pool: {error}"

        elif req.return_type == ReturnRequestType.CHECKOUT:
            if not req.checkout_id:
                return False, "No checkout ID on this request"
            success, error = await self.checkin_item(
                checkout_id=UUID(str(req.checkout_id)),
                organization_id=organization_id,
                checked_in_by=reviewer_id,
                return_condition=condition_enum,
                damage_notes=f"Return request #{req.id[:8]} — {req.member_notes or ''}".strip(),
            )
            if not success:
                req.status = ReturnRequestStatus.PENDING
                req.reviewed_by = None
                req.reviewed_at = None
                await self.db.commit()
                return False, f"Failed to check in: {error}"

        req.status = ReturnRequestStatus.COMPLETED
        await self.db.commit()
        return True, None

    # ------------------------------------------------------------------
    # Issuance History (all issuances for a member, active + returned)
    # ------------------------------------------------------------------

    async def get_user_issuance_history(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> List[ItemIssuance]:
        """Get all issuance records (active + returned) for a user."""
        result = await self.db.execute(
            select(ItemIssuance)
            .where(ItemIssuance.user_id == str(user_id))
            .where(ItemIssuance.organization_id == str(organization_id))
            .options(selectinload(ItemIssuance.item))
            .order_by(ItemIssuance.issued_at.desc())
        )
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # Low Stock & Overdue Alerts
    # ------------------------------------------------------------------

    async def get_low_stock_items_for_alerts(
        self,
        organization_id: UUID,
    ) -> List[InventoryItem]:
        """Get items below their reorder point for email alerts."""
        result = await self.db.execute(
            select(InventoryItem)
            .where(InventoryItem.organization_id == str(organization_id))
            .where(InventoryItem.active == True)  # noqa: E712
            .where(InventoryItem.reorder_point.isnot(None))
            .where(InventoryItem.quantity <= InventoryItem.reorder_point)
            .options(selectinload(InventoryItem.category))
            .order_by(InventoryItem.quantity.asc())
        )
        return list(result.scalars().all())

    async def get_overdue_checkouts_for_alerts(
        self,
        organization_id: UUID,
    ) -> List[CheckOutRecord]:
        """Get overdue checkouts for email alerts."""
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            select(CheckOutRecord)
            .where(CheckOutRecord.organization_id == str(organization_id))
            .where(CheckOutRecord.is_returned == False)  # noqa: E712
            .where(CheckOutRecord.expected_return_at.isnot(None))
            .where(CheckOutRecord.expected_return_at < now)
            .options(
                selectinload(CheckOutRecord.item),
                selectinload(CheckOutRecord.user),
            )
            .order_by(CheckOutRecord.expected_return_at.asc())
        )
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # NFPA Retirement Due Alerts
    # ------------------------------------------------------------------

    async def get_nfpa_retirement_due_items(
        self,
        organization_id: UUID,
        days_ahead: int = 180,
    ) -> List[Dict[str, Any]]:
        """Get PPE items approaching NFPA 10-year retirement date."""
        from app.models.inventory import NFPAItemCompliance

        cutoff = date.today() + timedelta(days=days_ahead)

        result = await self.db.execute(
            select(NFPAItemCompliance)
            .where(NFPAItemCompliance.organization_id == str(organization_id))
            .where(NFPAItemCompliance.expected_retirement_date.isnot(None))
            .where(NFPAItemCompliance.expected_retirement_date <= cutoff)
            .where(NFPAItemCompliance.is_retired_by_age == False)  # noqa: E712
        )
        records = list(result.scalars().all())

        items_due = []
        for rec in records:
            item_result = await self.db.execute(
                select(InventoryItem).where(InventoryItem.id == rec.item_id)
            )
            item = item_result.scalar_one_or_none()
            if item and item.active:
                days_until = (rec.expected_retirement_date - date.today()).days
                items_due.append(
                    {
                        "item_id": item.id,
                        "item_name": item.name,
                        "serial_number": item.serial_number,
                        "asset_tag": item.asset_tag,
                        "retirement_date": rec.expected_retirement_date.isoformat(),
                        "days_until_retirement": days_until,
                        "assigned_to": item.assigned_to_user_id,
                    }
                )

        return items_due

    # ------------------------------------------------------------------
    # Reorder Requests
    # ------------------------------------------------------------------

    async def list_reorder_requests(
        self,
        organization_id: UUID,
        status: Optional[str] = None,
        urgency: Optional[str] = None,
        search: Optional[str] = None,
    ) -> List[ReorderRequest]:
        """List reorder requests for an organization with optional filters."""
        q = (
            select(ReorderRequest)
            .where(ReorderRequest.organization_id == str(organization_id))
            .order_by(ReorderRequest.created_at.desc())
        )
        if status:
            q = q.where(ReorderRequest.status == status)
        if urgency:
            q = q.where(ReorderRequest.urgency == urgency)
        if search:
            q = q.where(ReorderRequest.item_name.ilike(f"%{search}%"))
        q = q.options(
            selectinload(ReorderRequest.requester),
            selectinload(ReorderRequest.approver),
        )
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def get_reorder_request(
        self, request_id: UUID, organization_id: UUID
    ) -> Optional[ReorderRequest]:
        """Get a single reorder request."""
        result = await self.db.execute(
            select(ReorderRequest)
            .where(ReorderRequest.id == str(request_id))
            .where(ReorderRequest.organization_id == str(organization_id))
            .options(
                selectinload(ReorderRequest.requester),
                selectinload(ReorderRequest.approver),
            )
        )
        return result.scalars().first()

    async def create_reorder_request(
        self,
        organization_id: UUID,
        data: Dict[str, Any],
        requested_by: str,
    ) -> Tuple[Optional[ReorderRequest], Optional[str]]:
        """Create a new reorder request."""
        try:
            reorder = ReorderRequest(
                organization_id=str(organization_id),
                requested_by=requested_by,
                **data,
            )
            self.db.add(reorder)
            await self.db.flush()
            await self.db.refresh(reorder)
            return reorder, None
        except Exception as e:
            logger.error(f"Error creating reorder request: {e}")
            return None, str(e)

    async def update_reorder_request(
        self,
        request_id: UUID,
        organization_id: UUID,
        data: Dict[str, Any],
        current_user_id: str,
    ) -> Tuple[Optional[ReorderRequest], Optional[str]]:
        """Update a reorder request and handle status transitions."""
        try:
            reorder = await self.get_reorder_request(request_id, organization_id)
            if not reorder:
                return None, "Reorder request not found"

            now = datetime.now(timezone.utc)
            new_status = data.get("status")

            # Handle status transitions
            if new_status and new_status != reorder.status.value:
                if new_status == "approved":
                    data["approved_by"] = current_user_id
                    data["approved_at"] = now
                elif new_status == "ordered":
                    data["ordered_at"] = now
                elif new_status == "received":
                    data["received_at"] = now

            for key, value in data.items():
                setattr(reorder, key, value)

            await self.db.flush()
            await self.db.refresh(reorder)
            return reorder, None
        except Exception as e:
            logger.error(f"Error updating reorder request: {e}")
            return None, str(e)

    async def delete_reorder_request(
        self, request_id: UUID, organization_id: UUID
    ) -> Optional[str]:
        """Delete a reorder request (only if pending)."""
        reorder = await self.get_reorder_request(request_id, organization_id)
        if not reorder:
            return "Reorder request not found"
        if reorder.status != ReorderStatus.PENDING:
            return "Only pending reorder requests can be deleted"
        await self.db.delete(reorder)
        await self.db.flush()
        return None

    # ============================================
    # Variant Group Methods
    # ============================================

    async def create_variant_group(
        self,
        organization_id: UUID,
        data: dict,
        created_by: Optional[UUID] = None,
    ) -> Tuple[Optional[ItemVariantGroup], Optional[str]]:
        """Create a variant group for grouping pool item variants."""
        try:
            group = ItemVariantGroup(
                organization_id=str(organization_id),
                name=data["name"],
                description=data.get("description"),
                category_id=(
                    str(data["category_id"]) if data.get("category_id") else None
                ),
                base_price=data.get("base_price"),
                base_replacement_cost=data.get("base_replacement_cost"),
                unit_of_measure=data.get("unit_of_measure"),
                created_by=str(created_by) if created_by else None,
            )
            self.db.add(group)
            await self.db.flush()
            await self.db.refresh(group)
            return group, None
        except Exception as e:
            logger.error(f"Error creating variant group: {e}")
            return None, str(e)

    async def get_variant_groups(
        self, organization_id: UUID, active_only: bool = True
    ) -> List[ItemVariantGroup]:
        """List variant groups for an organization."""
        query = select(ItemVariantGroup).where(
            ItemVariantGroup.organization_id == str(organization_id)
        )
        if active_only:
            query = query.where(ItemVariantGroup.active.is_(True))
        query = query.order_by(ItemVariantGroup.name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_variant_group_by_id(
        self, group_id: UUID, organization_id: UUID
    ) -> Optional[ItemVariantGroup]:
        """Get a variant group with its member items."""
        query = (
            select(ItemVariantGroup)
            .where(
                ItemVariantGroup.id == str(group_id),
                ItemVariantGroup.organization_id == str(organization_id),
            )
            .options(selectinload(ItemVariantGroup.items))
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def update_variant_group(
        self, group_id: UUID, organization_id: UUID, data: dict
    ) -> Tuple[Optional[ItemVariantGroup], Optional[str]]:
        """Update a variant group."""
        try:
            group = await self.get_variant_group_by_id(group_id, organization_id)
            if not group:
                return None, "Variant group not found"
            for key, value in data.items():
                setattr(group, key, value)
            await self.db.flush()
            await self.db.refresh(group)
            return group, None
        except Exception as e:
            logger.error(f"Error updating variant group: {e}")
            return None, str(e)

    async def delete_variant_group(
        self, group_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Soft-delete (deactivate) a variant group."""
        try:
            group = await self.get_variant_group_by_id(group_id, organization_id)
            if not group:
                return False, "Variant group not found"
            group.active = False
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting variant group: {e}")
            return False, str(e)

    # ============================================
    # Equipment Kit Methods
    # ============================================

    async def create_equipment_kit(
        self,
        organization_id: UUID,
        data: dict,
        created_by: Optional[UUID] = None,
    ) -> Tuple[Optional[EquipmentKit], Optional[str]]:
        """Create an equipment kit template with its items."""
        try:
            kit = EquipmentKit(
                organization_id=str(organization_id),
                name=data["name"],
                description=data.get("description"),
                restricted_to_roles=data.get("restricted_to_roles"),
                min_rank_order=data.get("min_rank_order"),
                created_by=str(created_by) if created_by else None,
            )
            self.db.add(kit)
            await self.db.flush()

            line_items_data = data.get("line_items", [])
            for idx, item_data in enumerate(line_items_data):
                kit_item = EquipmentKitItem(
                    kit_id=kit.id,
                    item_id=(
                        str(item_data["item_id"]) if item_data.get("item_id") else None
                    ),
                    category_id=(
                        str(item_data["category_id"])
                        if item_data.get("category_id")
                        else None
                    ),
                    item_name=item_data["item_name"],
                    quantity=item_data.get("quantity", 1),
                    size_selectable=item_data.get("size_selectable", False),
                    sort_order=idx,
                )
                self.db.add(kit_item)

            await self.db.flush()
            await self.db.refresh(kit)
            return kit, None
        except Exception as e:
            logger.error(f"Error creating equipment kit: {e}")
            return None, str(e)

    async def get_equipment_kits(
        self, organization_id: UUID, active_only: bool = True
    ) -> List[EquipmentKit]:
        """List equipment kits for an organization."""
        query = select(EquipmentKit).where(
            EquipmentKit.organization_id == str(organization_id)
        )
        if active_only:
            query = query.where(EquipmentKit.active.is_(True))
        query = query.order_by(EquipmentKit.name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_equipment_kit_by_id(
        self, kit_id: UUID, organization_id: UUID
    ) -> Optional[EquipmentKit]:
        """Get a kit with its items."""
        query = (
            select(EquipmentKit)
            .where(
                EquipmentKit.id == str(kit_id),
                EquipmentKit.organization_id == str(organization_id),
            )
            .options(selectinload(EquipmentKit.line_items))
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def update_equipment_kit(
        self, kit_id: UUID, organization_id: UUID, data: dict
    ) -> Tuple[Optional[EquipmentKit], Optional[str]]:
        """Update a kit's metadata (not its items)."""
        try:
            kit = await self.get_equipment_kit_by_id(kit_id, organization_id)
            if not kit:
                return None, "Equipment kit not found"
            for key, value in data.items():
                setattr(kit, key, value)
            await self.db.flush()
            await self.db.refresh(kit)
            return kit, None
        except Exception as e:
            logger.error(f"Error updating equipment kit: {e}")
            return None, str(e)

    async def delete_equipment_kit(
        self, kit_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Soft-delete (deactivate) an equipment kit template."""
        try:
            kit = await self.get_equipment_kit_by_id(kit_id, organization_id)
            if not kit:
                return False, "Equipment kit not found"
            kit.active = False
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting equipment kit: {e}")
            return False, str(e)

    async def issue_kit_to_member(
        self,
        kit_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        issued_by: Optional[UUID] = None,
    ) -> Tuple[Optional[List[ItemIssuance]], Optional[str]]:
        """Issue all items in a kit to a member."""
        try:
            kit = await self.get_equipment_kit_by_id(kit_id, organization_id)
            if not kit:
                return None, "Equipment kit not found"

            issuances = []
            for kit_item in kit.line_items:
                if kit_item.item_id:
                    item = await self.get_item_by_id(
                        UUID(kit_item.item_id), organization_id
                    )
                    if not item:
                        if not kit_item.optional:
                            return (
                                None,
                                f"Required kit item not found: {kit_item.item_id}",
                            )
                        continue

                    if item.tracking_type == TrackingType.POOL:
                        result, err = await self.issue_from_pool(
                            item_id=UUID(item.id),
                            user_id=user_id,
                            organization_id=organization_id,
                            quantity=kit_item.quantity,
                            issued_by=issued_by,
                        )
                    else:
                        result, err = await self.assign_item_to_user(
                            item_id=UUID(item.id),
                            user_id=user_id,
                            organization_id=organization_id,
                            assigned_by=issued_by,
                        )

                    if err and not kit_item.optional:
                        return None, f"Failed to issue kit item: {err}"
                    if result:
                        issuances.append(result)

            return issuances, None
        except Exception as e:
            logger.error(f"Error issuing kit: {e}")
            return None, str(e)

    # ============================================
    # Equipment Request Fulfillment
    # ============================================

    async def fulfill_equipment_request(
        self,
        request_id: UUID,
        organization_id: UUID,
        fulfilled_by: UUID,
        item_id: Optional[UUID] = None,
        quantity: Optional[int] = None,
        expected_return_at: Optional[datetime] = None,
        override_allowance: bool = False,
    ) -> Tuple[Optional[EquipmentRequest], Optional[str]]:
        """Turn an approved equipment request into a real issuance, checkout,
        or assignment, then mark the request fulfilled and link it back to the
        record that satisfied it.

        Pool items are issued; individual items are checked out (for CHECKOUT
        requests) or permanently assigned (otherwise). The created record's id
        is stored on the request so the two are traceable to each other.
        """
        try:
            # Read the request (row-locked) to validate it and pull the fields
            # needed to build the fulfillment.
            result = await self.db.execute(
                select(EquipmentRequest)
                .where(
                    EquipmentRequest.id == str(request_id),
                    EquipmentRequest.organization_id == str(organization_id),
                )
                .with_for_update()
            )
            req = result.scalar_one_or_none()
            if not req:
                return None, "Request not found"

            status_val = self._enum_value(req.status)
            if status_val != RequestStatus.APPROVED.value:
                return None, "Only approved requests can be fulfilled"

            # Atomically claim the request before creating any issuance. The
            # issue/checkout/assign calls below each commit, which releases the
            # row lock taken above; the FOR UPDATE lock alone therefore leaves a
            # window in which a concurrent fulfill could pass the APPROVED check
            # and double-issue. A single-statement APPROVED -> FULFILLED flip is
            # the real guard: rowcount == 0 means another caller already claimed
            # it (or it is no longer APPROVED), so this caller must stop.
            claim = await self.db.execute(
                update(EquipmentRequest)
                .where(
                    EquipmentRequest.id == str(request_id),
                    EquipmentRequest.organization_id == str(organization_id),
                    EquipmentRequest.status == RequestStatus.APPROVED,
                )
                .values(
                    status=RequestStatus.FULFILLED,
                    fulfilled_by=str(fulfilled_by),
                    fulfilled_at=datetime.now(timezone.utc),
                )
            )
            await self.db.commit()
            if claim.rowcount == 0:
                return None, "Only approved requests can be fulfilled"

            # From here the request is claimed (FULFILLED). Any validation or
            # issuance failure must release the claim back to APPROVED so the
            # request can be fulfilled again.
            target_item_id = item_id or (UUID(req.item_id) if req.item_id else None)
            if not target_item_id:
                await self._revert_fulfillment_claim(request_id, organization_id)
                return None, "An item must be selected to fulfill this request"

            item = await self.get_item_by_id(target_item_id, organization_id)
            if not item:
                await self._revert_fulfillment_claim(request_id, organization_id)
                return None, "Selected item not found"

            qty = quantity or req.quantity or 1
            requester_id = UUID(req.requester_id)
            request_type = self._enum_value(req.request_type)

            fulfillment_type: str
            reference_id: str
            try:
                if item.tracking_type == TrackingType.POOL:
                    issuance, err = await self.issue_from_pool(
                        item_id=target_item_id,
                        user_id=requester_id,
                        organization_id=organization_id,
                        issued_by=fulfilled_by,
                        quantity=qty,
                        reason="Equipment request fulfillment",
                        override_allowance=override_allowance,
                    )
                    fulfillment_type = "issuance"
                    reference_id = str(issuance.id) if issuance else ""
                elif request_type == RequestType.CHECKOUT.value:
                    checkout, err = await self.checkout_item(
                        item_id=target_item_id,
                        user_id=requester_id,
                        organization_id=organization_id,
                        checked_out_by=fulfilled_by,
                        expected_return_at=expected_return_at,
                        reason="Equipment request fulfillment",
                    )
                    fulfillment_type = "checkout"
                    reference_id = str(checkout.id) if checkout else ""
                else:
                    assignment, err = await self.assign_item_to_user(
                        item_id=target_item_id,
                        user_id=requester_id,
                        organization_id=organization_id,
                        assigned_by=fulfilled_by,
                        reason="Equipment request fulfillment",
                    )
                    fulfillment_type = "assignment"
                    reference_id = str(assignment.id) if assignment else ""
            except Exception:
                await self._revert_fulfillment_claim(request_id, organization_id)
                raise

            if err:
                await self._revert_fulfillment_claim(request_id, organization_id)
                return None, err

            # Issuance succeeded — stamp the fulfillment linkage on the request
            # that we already flipped to FULFILLED.
            await self.db.execute(
                update(EquipmentRequest)
                .where(
                    EquipmentRequest.id == str(request_id),
                    EquipmentRequest.organization_id == str(organization_id),
                )
                .values(
                    fulfillment_type=fulfillment_type,
                    fulfillment_reference_id=reference_id,
                )
            )
            await self.db.commit()

            refreshed = await self.db.execute(
                select(EquipmentRequest).where(
                    EquipmentRequest.id == str(request_id),
                    EquipmentRequest.organization_id == str(organization_id),
                )
            )
            return refreshed.scalar_one_or_none(), None
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error fulfilling equipment request: {e}")
            return None, str(e)

    async def _revert_fulfillment_claim(
        self, request_id: UUID, organization_id: UUID
    ) -> None:
        """Release a FULFILLED claim back to APPROVED.

        Called when the issuance/checkout/assignment that was supposed to
        satisfy an atomically-claimed request fails, so the request does not
        get stuck in FULFILLED with no fulfillment record behind it.
        """
        await self.db.execute(
            update(EquipmentRequest)
            .where(
                EquipmentRequest.id == str(request_id),
                EquipmentRequest.organization_id == str(organization_id),
                EquipmentRequest.status == RequestStatus.FULFILLED,
            )
            .values(
                status=RequestStatus.APPROVED,
                fulfilled_by=None,
                fulfilled_at=None,
            )
        )
        await self.db.commit()

    # ============================================
    # Member Size Preferences Methods
    # ============================================

    async def get_member_size_preferences(
        self, user_id: UUID, organization_id: UUID
    ) -> Optional[MemberSizePreferences]:
        """Get a member's size preferences."""
        query = select(MemberSizePreferences).where(
            MemberSizePreferences.user_id == str(user_id),
            MemberSizePreferences.organization_id == str(organization_id),
        )
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def upsert_member_size_preferences(
        self,
        user_id: UUID,
        organization_id: UUID,
        data: dict,
    ) -> Tuple[Optional[MemberSizePreferences], Optional[str]]:
        """Create or update a member's size preferences."""
        try:
            prefs = await self.get_member_size_preferences(user_id, organization_id)
            if prefs:
                for key, value in data.items():
                    setattr(prefs, key, value)
            else:
                prefs = MemberSizePreferences(
                    user_id=str(user_id),
                    organization_id=str(organization_id),
                    **data,
                )
                self.db.add(prefs)
            await self.db.flush()
            await self.db.refresh(prefs)
            return prefs, None
        except Exception as e:
            logger.error(f"Error upserting member size preferences: {e}")
            return None, str(e)

    # ============================================
    # Impact Planner
    # ============================================

    # Maps a requested size_field to the MemberSizePreferences attributes that
    # compose the displayed/bucketed size value.
    _SIZE_FIELD_LABELS = {
        "shirt": "Shirt",
        "pant": "Pants",
        "jacket": "Jacket",
        "boot": "Boots",
        "glove": "Gloves",
        "hat": "Hat",
    }

    # Canonicalises common alpha-size spellings so member preferences and
    # on-hand item sizes match even when entered differently (e.g. "3XL" vs
    # "XXXL", "Medium" vs "M"). Keys/values are already lowercased/trimmed.
    _SIZE_ALIASES = {
        "2xs": "xxs",
        "xxs": "xxs",
        "xs": "xs",
        "extra small": "xs",
        "s": "s",
        "sm": "s",
        "small": "s",
        "m": "m",
        "med": "m",
        "medium": "m",
        "l": "l",
        "lg": "l",
        "large": "l",
        "xl": "xl",
        "1xl": "xl",
        "extra large": "xl",
        "xxl": "xxl",
        "2xl": "xxl",
        "xxxl": "xxxl",
        "3xl": "xxxl",
        "xxxxl": "xxxxl",
        "4xl": "xxxxl",
    }

    @classmethod
    def _normalize_size_key(cls, value: Optional[str]) -> str:
        """Normalize a size string into a key for matching demand to stock.

        Drops any parenthetical qualifier (e.g. boot width), collapses
        whitespace, lowercases, then maps common alpha-size aliases to a
        canonical form. Best-effort: matching is only as reliable as the
        consistency of the entered sizes.
        """
        if not value:
            return ""
        base = value.split("(")[0]
        key = " ".join(base.lower().split())
        return cls._SIZE_ALIASES.get(key, key)

    @classmethod
    def _item_stock_size_value(cls, item: InventoryItem) -> Optional[str]:
        """The size string to bucket an item's on-hand stock by.

        Prefers the structured ``standard_size`` (skipping the ``custom``
        sentinel, which signals the real value lives in free-text ``size``)
        and falls back to the free-text ``size`` field.
        """
        ss = item.standard_size
        if ss is not None:
            val = ss.value if hasattr(ss, "value") else ss
            if val and val != "custom":
                return val
        return item.size

    # Conditions that mark a held item as no longer serviceable — a member
    # holding only these still needs a replacement.
    _WORN_CONDITION_VALUES = {"poor", "damaged", "out_of_service"}

    async def _get_related_holdings(
        self,
        organization_id: str,
        related_category_id: Optional[str],
        user_ids: List[str],
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Active items each member holds in the related category.

        Returns ``{user_id: [{"name", "unserviceable"}, ...]}`` over both
        permanent assignments and pool issuances. An item is *unserviceable*
        when its condition is worn (poor/damaged/out-of-service) or it is past
        its NFPA retirement (expected retirement date reached, or retired by
        age).
        """
        holdings: Dict[str, List[Dict[str, Any]]] = {}
        if not (related_category_id and user_ids):
            return holdings

        today = date.today()

        def _record(uid, name, condition, ret_date, retired_by_age):
            cond_val = (
                condition.value if hasattr(condition, "value") else condition
            )
            worn = cond_val in self._WORN_CONDITION_VALUES
            expired = bool(retired_by_age) or (
                ret_date is not None and ret_date <= today
            )
            holdings.setdefault(uid, []).append(
                {"name": name, "unserviceable": worn or expired}
            )

        for source_user, source_item in (
            (ItemAssignment.user_id, ItemAssignment.item_id),
            (ItemIssuance.user_id, ItemIssuance.item_id),
        ):
            is_assignment = source_user is ItemAssignment.user_id
            active_clause = (
                ItemAssignment.is_active == True  # noqa: E712
                if is_assignment
                else ItemIssuance.is_returned == False  # noqa: E712
            )
            org_clause = (
                ItemAssignment.organization_id == organization_id
                if is_assignment
                else ItemIssuance.organization_id == organization_id
            )
            rows = await self.db.execute(
                select(
                    source_user,
                    InventoryItem.name,
                    InventoryItem.condition,
                    NFPAItemCompliance.expected_retirement_date,
                    NFPAItemCompliance.is_retired_by_age,
                )
                .join(InventoryItem, source_item == InventoryItem.id)
                .outerjoin(
                    NFPAItemCompliance,
                    NFPAItemCompliance.item_id == InventoryItem.id,
                )
                .where(org_clause)
                .where(active_clause)
                .where(source_user.in_(user_ids))
                .where(InventoryItem.category_id == related_category_id)
            )
            for uid, name, condition, ret_date, retired_by_age in rows.all():
                _record(uid, name, condition, ret_date, retired_by_age)

        return holdings

    @staticmethod
    def _item_unit_cost(item: InventoryItem) -> Optional[float]:
        """Best estimate of an item's unit cost for budgeting.

        Prefers ``replacement_cost`` (what it costs to buy a new one today)
        and falls back to the original ``purchase_price``.
        """
        for attr in ("replacement_cost", "purchase_price"):
            val = getattr(item, attr, None)
            if val is not None:
                try:
                    return float(val)
                except (TypeError, ValueError):
                    continue
        return None

    async def _get_stock_and_cost_by_size(
        self, organization_id: str, category_id: str
    ) -> Tuple[Dict[str, int], Dict[str, float], Optional[float]]:
        """Return available stock and unit-cost estimates for a category.

        Returns ``(stock_by_size, unit_cost_by_size, avg_unit_cost)``:

        - ``stock_by_size``: available units keyed by normalized size. Pool
          items contribute unissued quantity (``quantity - quantity_issued``);
          individually-tracked items contribute one unit when ``available``.
        - ``unit_cost_by_size``: mean unit cost of priced items at each size,
          used to estimate per-size purchase cost.
        - ``avg_unit_cost``: mean unit cost across the whole category, used as
          a fallback for sizes with no priced items (or unknown sizes).

        Retired items are ignored. Keys are normalized via
        :meth:`_normalize_size_key`.
        """
        items = (
            await self.db.execute(
                select(InventoryItem)
                .where(InventoryItem.organization_id == organization_id)
                .where(InventoryItem.category_id == category_id)
                .where(InventoryItem.status != ItemStatus.RETIRED)
            )
        ).scalars().all()

        stock: Dict[str, int] = {}
        cost_sums: Dict[str, float] = {}
        cost_counts: Dict[str, int] = {}
        all_cost_sum = 0.0
        all_cost_count = 0
        for item in items:
            key = self._normalize_size_key(self._item_stock_size_value(item))

            if item.tracking_type == TrackingType.POOL:
                avail = (item.quantity or 0) - (item.quantity_issued or 0)
                if avail < 0:
                    avail = 0
            else:
                avail = 1 if item.status == ItemStatus.AVAILABLE else 0
            if avail > 0:
                stock[key] = stock.get(key, 0) + avail

            unit_cost = self._item_unit_cost(item)
            if unit_cost is not None:
                cost_sums[key] = cost_sums.get(key, 0.0) + unit_cost
                cost_counts[key] = cost_counts.get(key, 0) + 1
                all_cost_sum += unit_cost
                all_cost_count += 1

        unit_cost_by_size = {
            key: round(cost_sums[key] / cost_counts[key], 2) for key in cost_sums
        }
        avg_unit_cost = (
            round(all_cost_sum / all_cost_count, 2) if all_cost_count else None
        )
        return stock, unit_cost_by_size, avg_unit_cost

    async def _get_available_pool_items_by_size(
        self, organization_id: str, category_id: str
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Available pool items in a category, grouped by normalized size.

        Returns ``{size_key: [{"item_id", "name", "remaining"}, ...]}`` for
        pool-tracked items with unissued stock — the candidates a bulk issue
        draws from. Only pool items are returned; individually-tracked items
        are assigned through a different flow.
        """
        items = (
            await self.db.execute(
                select(InventoryItem)
                .where(InventoryItem.organization_id == organization_id)
                .where(InventoryItem.category_id == category_id)
                .where(InventoryItem.status != ItemStatus.RETIRED)
                .where(InventoryItem.tracking_type == TrackingType.POOL)
            )
        ).scalars().all()

        by_size: Dict[str, List[Dict[str, Any]]] = {}
        for item in items:
            avail = (item.quantity or 0) - (item.quantity_issued or 0)
            if avail <= 0:
                continue
            key = self._normalize_size_key(self._item_stock_size_value(item))
            by_size.setdefault(key, []).append(
                {"item_id": item.id, "name": item.name, "remaining": avail}
            )
        return by_size

    @staticmethod
    def _format_needed_size(
        prefs: Optional[MemberSizePreferences], size_field: Optional[str]
    ) -> Optional[str]:
        """Render a member's stored size for *size_field* as a display string.

        Returns ``None`` when no size is on file so callers can bucket those
        members separately (they must be measured before purchasing).
        """
        if prefs is None or not size_field:
            return None
        if size_field == "shirt":
            return prefs.shirt_size or None
        if size_field == "jacket":
            return prefs.jacket_size or None
        if size_field == "glove":
            return prefs.glove_size or None
        if size_field == "hat":
            return prefs.hat_size or None
        if size_field == "boot":
            if not prefs.boot_size:
                return None
            if prefs.boot_width:
                return f"{prefs.boot_size} ({prefs.boot_width})"
            return prefs.boot_size
        if size_field == "pant":
            waist = prefs.pant_waist
            inseam = prefs.pant_inseam
            if waist and inseam:
                return f"{waist} x {inseam}"
            return waist or inseam or None
        return None

    async def _get_over_allowance_uids(
        self, organization_id: str, category_id: str, user_ids: List[str]
    ) -> set:
        """User IDs who are at/over their issuance allowance for a category.

        Issuing one more unit would exceed the member's per-category cap. The
        applicable allowance is the role-specific one matching any of the
        member's positions, else the org-wide one. Computed in batch (a query
        per distinct allowance) to avoid per-member round-trips.
        """
        if not (category_id and user_ids):
            return set()

        allowances = (
            await self.db.execute(
                select(IssuanceAllowance)
                .where(IssuanceAllowance.organization_id == organization_id)
                .where(IssuanceAllowance.category_id == category_id)
                .where(IssuanceAllowance.is_active.is_(True))
            )
        ).scalars().all()
        if not allowances:
            return set()

        # Member -> set of position ids, for role-specific allowance matching.
        pos_map: Dict[str, set] = {}
        for uid, pid in (
            await self.db.execute(
                select(user_positions.c.user_id, user_positions.c.position_id)
                .where(user_positions.c.user_id.in_(user_ids))
            )
        ).all():
            pos_map.setdefault(uid, set()).add(pid)

        role_allowances = {a.role_id: a for a in allowances if a.role_id}
        org_wide = next((a for a in allowances if not a.role_id), None)

        def _pick(uid):
            for pid in pos_map.get(uid, ()):  # role-specific wins
                if pid in role_allowances:
                    return role_allowances[pid]
            return org_wide

        chosen = {uid: _pick(uid) for uid in user_ids}

        # Pool item ids in the category (issuances are tracked against items).
        item_ids = [
            r[0]
            for r in (
                await self.db.execute(
                    select(InventoryItem.id).where(
                        InventoryItem.organization_id == organization_id,
                        InventoryItem.category_id == category_id,
                        InventoryItem.tracking_type == TrackingType.POOL,
                    )
                )
            ).all()
        ]

        # Batch issued-this-period counts, grouped by the chosen allowance
        # (period differs per allowance).
        issued: Dict[str, int] = {}
        if item_ids:
            groups: Dict[str, List[str]] = {}
            for uid, allowance in chosen.items():
                if allowance is not None:
                    groups.setdefault(allowance.id, []).append(uid)
            by_id = {a.id: a for a in allowances}
            for aid, uids in groups.items():
                allowance = by_id[aid]
                q = (
                    select(
                        ItemIssuance.user_id,
                        func.coalesce(func.sum(ItemIssuance.quantity_issued), 0),
                    )
                    .where(ItemIssuance.organization_id == organization_id)
                    .where(ItemIssuance.user_id.in_(uids))
                    .where(ItemIssuance.item_id.in_(item_ids))
                    .group_by(ItemIssuance.user_id)
                )
                if allowance.period_type == "annual":
                    now = datetime.now(timezone.utc)
                    q = q.where(
                        ItemIssuance.issued_at
                        >= datetime(now.year, 1, 1, tzinfo=timezone.utc)
                    )
                for uid, cnt in (await self.db.execute(q)).all():
                    issued[uid] = int(cnt or 0)

        over = set()
        for uid in user_ids:
            allowance = chosen.get(uid)
            if allowance is None:
                continue
            if issued.get(uid, 0) >= allowance.max_quantity:
                over.add(uid)
        return over

    async def analyze_impact(
        self,
        organization_id,
        filters: Dict[str, Any],
        include_contact: bool = False,
        contact_visibility: Optional[Dict[str, bool]] = None,
    ) -> Dict[str, Any]:
        """Analyze how many members a prospective new issue would impact.

        Filters the member roster by the supplied criteria, then annotates
        each member with the size they need (when *size_field* is given) and
        whether they already hold a comparable item (when
        *related_category_id* is given). Returns the per-member list plus
        aggregate counts and a per-size breakdown for purchase planning.

        Contact fields honour the organization's contact-visibility settings:
        *contact_visibility* is a ``{"show_email", "show_phone",
        "show_mobile"}`` dict (as resolved from org settings). When it is not
        supplied, *include_contact* is used as a blanket on/off for all three
        fields (kept for internal callers/tests).
        """
        org_id = str(organization_id)
        if contact_visibility is None:
            contact_visibility = {
                "show_email": include_contact,
                "show_phone": include_contact,
                "show_mobile": include_contact,
            }

        statuses = filters.get("statuses")
        membership_types = filters.get("membership_types")
        ranks = filters.get("ranks")
        stations = filters.get("stations")
        position_ids = filters.get("position_ids")
        related_category_id = filters.get("related_category_id")
        size_field = filters.get("size_field")
        stock_category_id = filters.get("stock_category_id")
        replacement_aware = bool(filters.get("replacement_aware"))
        allowance_aware = bool(filters.get("allowance_aware"))

        related_category_id = (
            str(related_category_id) if related_category_id else None
        )
        stock_category_id = (
            str(stock_category_id) if stock_category_id else None
        )

        query = (
            select(User)
            .where(User.organization_id == org_id)
            .where(User.deleted_at.is_(None))
        )

        # Default to the active roster — planning a new issue targets members
        # currently in service unless the caller explicitly broadens the scope.
        if statuses:
            query = query.where(User.status.in_(statuses))
        else:
            query = query.where(User.status == UserStatus.ACTIVE.value)

        if membership_types:
            query = query.where(User.membership_type.in_(membership_types))
        if ranks:
            query = query.where(User.rank.in_(ranks))
        if stations:
            query = query.where(User.station.in_(stations))
        if position_ids:
            pos_ids = [str(pid) for pid in position_ids]
            query = query.where(User.positions.any(Position.id.in_(pos_ids)))

        query = query.order_by(User.last_name, User.first_name)
        users = (await self.db.execute(query)).scalars().all()
        user_ids = [u.id for u in users]

        # Size preferences for the matched members (one-to-one per member).
        size_map: Dict[str, MemberSizePreferences] = {}
        if size_field and user_ids:
            prefs_rows = (
                await self.db.execute(
                    select(MemberSizePreferences).where(
                        MemberSizePreferences.user_id.in_(user_ids)
                    )
                )
            ).scalars().all()
            size_map = {p.user_id: p for p in prefs_rows}

        # Members who already hold an active item in the related category —
        # via permanent assignment or pool issuance. Each held item's condition
        # and NFPA retirement are captured so that, when replacement_aware is
        # set, worn-out or expired gear counts as "needs replacement" rather
        # than excluding the member from the purchase counts.
        related_map = await self._get_related_holdings(
            org_id, related_category_id, user_ids
        )

        # Members at/over their issuance allowance for the category being
        # issued (the stock category), so the plan can warn before a bulk issue
        # would skip them.
        over_allowance_uids = set()
        if allowance_aware and stock_category_id:
            over_allowance_uids = await self._get_over_allowance_uids(
                org_id, stock_category_id, user_ids
            )

        members: List[Dict[str, Any]] = []
        size_buckets: Dict[str, Dict[str, int]] = {}
        with_related = 0
        missing_sizes = 0
        needing_replacement = 0
        over_allowance_count = 0

        for u in users:
            holdings = related_map.get(u.id, [])
            names = [h["name"] for h in holdings if h["name"]]
            has_any = bool(holdings)
            serviceable = sum(1 for h in holdings if not h["unserviceable"])

            if replacement_aware:
                # "Already covered" means they hold a serviceable item; a member
                # whose only items are worn/expired still needs a replacement.
                has_related = serviceable > 0
                needs_replacement = has_any and serviceable == 0
            else:
                has_related = has_any
                needs_replacement = False

            if has_related:
                with_related += 1
            if needs_replacement:
                needing_replacement += 1

            needed_size = self._format_needed_size(size_map.get(u.id), size_field)
            has_size = needed_size is not None
            if size_field and not has_related and not has_size:
                missing_sizes += 1

            # Only members who'd actually be issued (need the item) are flagged.
            over_allowance = (not has_related) and (u.id in over_allowance_uids)
            if over_allowance:
                over_allowance_count += 1

            members.append(
                {
                    "user_id": u.id,
                    "full_name": u.full_name or None,
                    "membership_number": u.membership_number,
                    "rank": u.rank,
                    "station": u.station,
                    "status": (
                        u.status.value if hasattr(u.status, "value") else u.status
                    ),
                    "membership_type": u.membership_type,
                    "email": (
                        u.email if contact_visibility.get("show_email") else None
                    ),
                    "phone": (
                        u.phone
                        if contact_visibility.get("show_phone") and u.phone
                        else (
                            u.mobile
                            if contact_visibility.get("show_mobile") and u.mobile
                            else None
                        )
                    ),
                    "needed_size": needed_size,
                    "has_size_on_file": has_size,
                    "has_related_item": has_related,
                    "needs_replacement": needs_replacement,
                    "over_allowance": over_allowance,
                    "related_item_names": names,
                }
            )

            if size_field:
                bucket_key = needed_size or "Unknown"
                bucket = size_buckets.setdefault(
                    bucket_key, {"total": 0, "needing": 0}
                )
                bucket["total"] += 1
                if not has_related:
                    bucket["needing"] += 1

        # Net per-size demand against currently available stock so the
        # breakdown shows the real purchase quantity (need − on-hand), and
        # estimate the purchase cost from the stock category's item prices.
        # Members with no size on file ("Unknown") can't be matched to stock,
        # so their full demand carries to the shortfall.
        stock_checked = bool(stock_category_id and size_field)
        stock_map: Dict[str, int] = {}
        unit_cost_map: Dict[str, float] = {}
        avg_unit_cost: Optional[float] = None
        if stock_checked:
            (
                stock_map,
                unit_cost_map,
                avg_unit_cost,
            ) = await self._get_stock_and_cost_by_size(org_id, stock_category_id)
        cost_estimated = stock_checked and avg_unit_cost is not None

        # Sort the breakdown so "Unknown" (members lacking a size) sorts last
        # and the rest are alphabetical for a stable, readable table.
        size_breakdown = []
        total_to_purchase = 0
        total_cost = 0.0
        for key, vals in sorted(
            size_buckets.items(), key=lambda kv: (kv[0] == "Unknown", kv[0])
        ):
            entry = {"size": key, "total": vals["total"], "needing": vals["needing"]}
            if stock_checked:
                norm_key = self._normalize_size_key(key)
                on_hand = 0 if key == "Unknown" else stock_map.get(norm_key, 0)
                shortfall = max(0, vals["needing"] - on_hand)
                entry["on_hand"] = on_hand
                entry["shortfall"] = shortfall
                total_to_purchase += shortfall
                if cost_estimated:
                    unit_cost = unit_cost_map.get(norm_key, avg_unit_cost)
                    entry["unit_cost"] = unit_cost
                    line_cost = (
                        round(unit_cost * shortfall, 2)
                        if unit_cost is not None
                        else None
                    )
                    entry["estimated_cost"] = line_cost
                    if line_cost:
                        total_cost += line_cost
            size_breakdown.append(entry)

        total = len(members)
        return {
            "total_members": total,
            "members_with_related_item": with_related,
            "members_needing_item": total - with_related,
            "members_needing_replacement": needing_replacement,
            "members_missing_sizes": missing_sizes,
            "members_over_allowance": over_allowance_count,
            "replacement_aware": replacement_aware,
            "allowance_aware": allowance_aware,
            "size_field": size_field,
            "size_breakdown": size_breakdown,
            "stock_checked": stock_checked,
            "total_to_purchase": total_to_purchase if stock_checked else None,
            "cost_estimated": cost_estimated,
            "estimated_total_cost": round(total_cost, 2) if cost_estimated else None,
            "members": members,
        }

    async def create_reorder_from_plan(
        self,
        organization_id,
        filters: Dict[str, Any],
        reorder_meta: Dict[str, Any],
        requested_by: str,
    ) -> Dict[str, Any]:
        """Create reorder requests from an impact plan's per-size shortfall.

        Re-runs the analysis server-side (so quantities can't be tampered with
        or go stale) and creates one PENDING reorder per size with a positive
        shortfall, all scoped to the plan's stock category. Sizes with unknown
        member sizes can't be ordered and are reported back, not created.
        """
        org_id = str(organization_id)

        analysis = await self.analyze_impact(
            org_id, filters, include_contact=False
        )
        if not analysis["stock_checked"]:
            raise ValueError(
                "Select a size field and a stock category before "
                "generating reorder requests."
            )

        stock_category_id = str(filters.get("stock_category_id"))
        category = await self.db.scalar(
            select(InventoryCategory)
            .where(InventoryCategory.id == stock_category_id)
            .where(InventoryCategory.organization_id == org_id)
        )
        base_name = category.name if category else "Item"
        size_label = self._SIZE_FIELD_LABELS.get(filters.get("size_field"), "")

        vendor = reorder_meta.get("vendor")
        urgency = reorder_meta.get("urgency") or "normal"
        extra_notes = reorder_meta.get("notes")

        created: List[Tuple[ReorderRequest, str]] = []
        total_qty = 0
        skipped_unknown = 0

        for entry in analysis["size_breakdown"]:
            if entry["size"] == "Unknown":
                skipped_unknown += entry.get("needing", 0)
                continue
            shortfall = entry.get("shortfall") or 0
            if shortfall <= 0:
                continue

            note = (
                f"Generated from impact plan ({size_label} {entry['size']}): "
                f"{entry['needing']} needed, {entry.get('on_hand', 0)} on hand."
            )
            if extra_notes:
                note = f"{note} {extra_notes}"

            reorder = ReorderRequest(
                organization_id=org_id,
                category_id=stock_category_id,
                item_name=f"{base_name} — {entry['size']}"[:255],
                quantity_requested=shortfall,
                vendor=vendor,
                # Carry the plan's per-size cost estimate onto the PO so the
                # reorder is pre-priced when it lands in the reorder queue.
                estimated_unit_cost=entry.get("unit_cost"),
                urgency=urgency,
                notes=note,
                requested_by=requested_by,
            )
            self.db.add(reorder)
            created.append((reorder, entry["size"]))
            total_qty += shortfall

        await self.db.flush()
        for reorder, _ in created:
            await self.db.refresh(reorder)

        return {
            "created_count": len(created),
            "total_quantity": total_qty,
            "skipped_unknown_size": skipped_unknown,
            "reorder_requests": [
                {
                    "id": reorder.id,
                    "item_name": reorder.item_name,
                    "size": size,
                    "quantity_requested": reorder.quantity_requested,
                }
                for reorder, size in created
            ],
        }

    async def bulk_issue_from_plan(
        self,
        organization_id,
        filters: Dict[str, Any],
        issued_by: str,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Issue on-hand pool stock to the members a plan says still need it.

        Re-runs the analysis, then for each member who needs the item (and,
        when replacement-aware, those whose gear is worn/expired) issues one
        unit of a matching-size pool item from the stock category. Members are
        skipped — with a reason — when they have no size on file, no matching
        stock remains, or issuance is blocked (e.g. allowance). Stock is drawn
        down across members so the same units aren't issued twice.
        """
        org_id = str(organization_id)
        size_field = filters.get("size_field")
        stock_category_id = filters.get("stock_category_id")
        if not (size_field and stock_category_id):
            raise ValueError(
                "Select a size field and a stock category before bulk issuing."
            )
        stock_category_id = str(stock_category_id)

        analysis = await self.analyze_impact(org_id, filters, include_contact=False)
        pool_by_size = await self._get_available_pool_items_by_size(
            org_id, stock_category_id
        )

        issued: List[Dict[str, Any]] = []
        skipped: List[Dict[str, Any]] = []

        for member in analysis["members"]:
            if member["has_related_item"]:
                continue  # already covered — not a target

            name = member.get("full_name")
            size = member.get("needed_size")
            if not size:
                skipped.append(
                    {"user_id": member["user_id"], "name": name,
                     "reason": "No size on file"}
                )
                continue

            candidates = pool_by_size.get(self._normalize_size_key(size), [])
            chosen = next((c for c in candidates if c["remaining"] > 0), None)
            if chosen is None:
                skipped.append(
                    {"user_id": member["user_id"], "name": name,
                     "reason": f"No {size} stock available"}
                )
                continue

            issuance, error = await self.issue_from_pool(
                item_id=chosen["item_id"],
                user_id=member["user_id"],
                organization_id=org_id,
                issued_by=issued_by,
                quantity=1,
                reason=reason or "Bulk issue from impact plan",
            )
            if error:
                skipped.append(
                    {"user_id": member["user_id"], "name": name,
                     "reason": error}
                )
                continue

            chosen["remaining"] -= 1
            issued.append(
                {
                    "user_id": member["user_id"],
                    "name": name,
                    "item_name": chosen["name"],
                    "size": size,
                }
            )

        return {
            "issued_count": len(issued),
            "skipped_count": len(skipped),
            "issued": issued,
            "skipped": skipped,
        }

    async def list_impact_plans(
        self, organization_id
    ) -> List[InventoryImpactPlan]:
        """List the organization's saved impact-planner scenarios."""
        rows = await self.db.execute(
            select(InventoryImpactPlan)
            .where(InventoryImpactPlan.organization_id == str(organization_id))
            .order_by(InventoryImpactPlan.name)
        )
        return list(rows.scalars().all())

    async def get_impact_plan(
        self, plan_id, organization_id
    ) -> Optional[InventoryImpactPlan]:
        """Fetch a single saved plan scoped to the organization."""
        return await self.db.scalar(
            select(InventoryImpactPlan)
            .where(InventoryImpactPlan.id == str(plan_id))
            .where(InventoryImpactPlan.organization_id == str(organization_id))
        )

    async def create_impact_plan(
        self, organization_id, data: Dict[str, Any], created_by: str
    ) -> InventoryImpactPlan:
        """Create a saved impact-planner scenario."""
        plan = InventoryImpactPlan(
            organization_id=str(organization_id),
            name=data["name"],
            description=data.get("description"),
            filters=data.get("filters") or {},
            created_by=created_by,
        )
        self.db.add(plan)
        await self.db.flush()
        await self.db.refresh(plan)
        return plan

    async def update_impact_plan(
        self, plan_id, organization_id, data: Dict[str, Any]
    ) -> Tuple[Optional[InventoryImpactPlan], Optional[str]]:
        """Update a saved plan's name, description, or filters."""
        plan = await self.get_impact_plan(plan_id, organization_id)
        if not plan:
            return None, "Impact plan not found"
        for key in ("name", "description", "filters"):
            if key in data and data[key] is not None:
                setattr(plan, key, data[key])
        await self.db.flush()
        await self.db.refresh(plan)
        return plan, None

    async def delete_impact_plan(self, plan_id, organization_id) -> bool:
        """Delete a saved plan; returns False when not found."""
        plan = await self.get_impact_plan(plan_id, organization_id)
        if not plan:
            return False
        await self.db.delete(plan)
        await self.db.flush()
        return True

    async def request_member_sizes(
        self, organization_id, filters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Notify members who need the item but have no size on file.

        Sends an in-app notification asking each such member to add their
        equipment sizes (self-service), so the next run of the plan can size
        and cost them. Requires a size field to know which size is missing.
        """
        org_id = str(organization_id)
        size_field = filters.get("size_field")
        if not size_field:
            raise ValueError(
                "Select a size field to identify members missing sizes."
            )

        analysis = await self.analyze_impact(org_id, filters)
        size_label = self._SIZE_FIELD_LABELS.get(size_field, "equipment")
        subject = "Equipment sizes needed"
        message = (
            f"Your {size_label.lower()} size isn't on file. Please add your "
            "equipment sizes so the quartermaster can issue your gear."
        )

        notified: List[Dict[str, Any]] = []
        for member in analysis["members"]:
            if member["has_related_item"] or member["has_size_on_file"]:
                continue
            self.db.add(
                NotificationLog(
                    organization_id=org_id,
                    recipient_id=str(member["user_id"]),
                    channel="in_app",
                    category="inventory",
                    subject=subject,
                    message=message,
                    action_url="/inventory/my-equipment",
                    delivered=True,
                )
            )
            notified.append(
                {"user_id": member["user_id"], "name": member.get("full_name")}
            )

        await self.db.flush()
        return {"notified_count": len(notified), "members": notified}

    async def generate_impact_plan_pdf(
        self,
        organization_id,
        filters: Dict[str, Any],
        contact_visibility: Optional[Dict[str, bool]] = None,
    ) -> BytesIO:
        """Render the impact-plan analysis to a print-ready PDF.

        Runs the analysis, resolves organization and category names for the
        report header, then delegates layout to ``render_impact_plan_pdf``.
        Contact columns honour *contact_visibility* (org settings).
        """
        org_id = str(organization_id)
        data = await self.analyze_impact(
            org_id, filters, contact_visibility=contact_visibility
        )
        show_contact = bool(contact_visibility and any(contact_visibility.values()))

        org = await self.db.scalar(
            select(Organization).where(Organization.id == org_id)
        )
        org_name = org.name if org else ""

        async def _cat_name(cat_id) -> Optional[str]:
            if not cat_id:
                return None
            cat = await self.db.scalar(
                select(InventoryCategory)
                .where(InventoryCategory.id == str(cat_id))
                .where(InventoryCategory.organization_id == org_id)
            )
            return cat.name if cat else None

        related_name = await _cat_name(filters.get("related_category_id"))
        stock_name = await _cat_name(filters.get("stock_category_id"))

        parameters: List[str] = []
        size_field = filters.get("size_field")
        if size_field:
            parameters.append(
                f"Size: {self._SIZE_FIELD_LABELS.get(size_field, size_field)}"
            )
        if related_name:
            parameters.append(f"Existing item: {related_name}")
            if filters.get("replacement_aware"):
                parameters.append("Replacement-aware")
        if stock_name:
            parameters.append(f"Stock source: {stock_name}")

        meta = {
            "org_name": org_name,
            "generated_at": datetime.now(timezone.utc),
            "parameters": parameters,
            "show_size": bool(size_field),
            "show_existing": bool(filters.get("related_category_id")),
            "show_contact": show_contact,
        }
        return render_impact_plan_pdf(data, meta)

    async def get_impact_planner_options(
        self, organization_id
    ) -> Dict[str, Any]:
        """Return the selectable filter options for the impact planner.

        Centralises the distinct ranks, stations, positions, and categories
        that exist for the organization so the planner UI can populate its
        filters from a single request.
        """
        org_id = str(organization_id)

        def _humanize(value: str) -> str:
            return value.replace("_", " ").title()

        statuses = [
            {"value": s.value, "label": _humanize(s.value)} for s in UserStatus
        ]
        membership_types = [
            {"value": m.value, "label": _humanize(m.value)} for m in MembershipType
        ]

        # Ranks: prefer the org's configured operational ranks (code →
        # display name); fall back to any free-text rank values still in use.
        rank_rows = (
            await self.db.execute(
                select(OperationalRank)
                .where(OperationalRank.organization_id == org_id)
                .where(OperationalRank.is_active == True)  # noqa: E712
                .order_by(OperationalRank.sort_order, OperationalRank.display_name)
            )
        ).scalars().all()
        ranks = [
            {"value": r.rank_code, "label": r.display_name or _humanize(r.rank_code)}
            for r in rank_rows
        ]
        known_rank_codes = {r["value"] for r in ranks}
        distinct_ranks = (
            await self.db.execute(
                select(User.rank)
                .where(User.organization_id == org_id)
                .where(User.deleted_at.is_(None))
                .where(User.rank.isnot(None))
                .distinct()
            )
        ).scalars().all()
        for code in distinct_ranks:
            if code and code not in known_rank_codes:
                ranks.append({"value": code, "label": _humanize(code)})
                known_rank_codes.add(code)

        stations = [
            s
            for s in (
                await self.db.execute(
                    select(User.station)
                    .where(User.organization_id == org_id)
                    .where(User.deleted_at.is_(None))
                    .where(User.station.isnot(None))
                    .distinct()
                    .order_by(User.station)
                )
            ).scalars().all()
            if s
        ]

        position_rows = (
            await self.db.execute(
                select(Position)
                .where(Position.organization_id == org_id)
                .order_by(Position.name)
            )
        ).scalars().all()
        positions = [{"id": p.id, "name": p.name} for p in position_rows]

        category_rows = (
            await self.db.execute(
                select(InventoryCategory)
                .where(InventoryCategory.organization_id == org_id)
                .where(InventoryCategory.active == True)  # noqa: E712
                .order_by(InventoryCategory.name)
            )
        ).scalars().all()
        categories = [
            {
                "id": c.id,
                "name": c.name,
                "item_type": (
                    c.item_type.value
                    if hasattr(c.item_type, "value")
                    else c.item_type
                ),
            }
            for c in category_rows
        ]

        size_fields = [
            {"value": key, "label": label}
            for key, label in self._SIZE_FIELD_LABELS.items()
        ]

        return {
            "statuses": statuses,
            "membership_types": membership_types,
            "ranks": ranks,
            "stations": stations,
            "positions": positions,
            "categories": categories,
            "size_fields": size_fields,
        }
