"""
Inventory Service

Business logic for inventory management including items, categories,
assignments, checkouts, maintenance, and reporting.
"""

import copy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from io import BytesIO
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.sql import Select

from app.core.audit import log_audit_event
from app.models.inventory import (
    AssignmentType,
    CheckOutRecord,
    DepartureClearance,
    EquipmentKit,
    EquipmentKitItem,
    EquipmentRequest,
    InventoryActionType,
    InventoryCategory,
    InventoryImpactPlan,
    InventoryItem,
    InventoryLot,
    InventoryVendor,
    InventoryVendorContact,
    IssuanceAllowance,
    ItemAssignment,
    ItemCondition,
    ItemIssuance,
    ItemStatus,
    ItemType,
    ItemVariantGroup,
    MaintenanceRecord,
    MaintenanceType,
    MemberSizePreferences,
    NFPAInspectionDetail,
    NFPAItemCompliance,
    ReorderReceipt,
    ReorderRequest,
    ReorderStatus,
    RequestStatus,
    ReturnRequest,
    ReturnRequestStatus,
    ReturnRequestType,
    StorageArea,
    TrackingType,
    WriteOffReason,
    WriteOffRequest,
    WriteOffStatus,
)
from app.models.location import Location
from app.models.notification import NotificationLog
from app.models.operational_rank import OperationalRank
from app.models.user import (
    MembershipType,
    Organization,
    Position,
    User,
    UserStatus,
    user_positions,
)
from app.utils.impact_plan_pdf import render_impact_plan_pdf
from app.utils.label_renderer import LabelSpec, render_labels, sanitize_barcode_value
from app.utils.model_updates import apply_updates
from app.utils.name_matching import normalize_name
from app.utils.org_scoping import assert_in_org, is_in_org
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern

# Valid status→condition combinations.  If a status is listed here,
# only the listed conditions are allowed.
#
# AVAILABLE excludes POOR/DAMAGED/OUT_OF_SERVICE so an item cannot become
# distributable while unsafe -- assign/checkout/issue all gate on
# status == AVAILABLE, so this one entry closes that path everywhere.
# Mirrors the unsafe-condition check review_return_request already applies
# when receiving a physical return (it sets IN_MAINTENANCE rather than
# AVAILABLE for the same three conditions, via a direct attribute set that
# does not go through this validator).
_VALID_STATE_COMBOS: dict[ItemStatus, set[ItemCondition] | None] = {
    ItemStatus.RETIRED: {ItemCondition.RETIRED},
    ItemStatus.AVAILABLE: {
        ItemCondition.EXCELLENT,
        ItemCondition.GOOD,
        ItemCondition.FAIR,
    },
}

# Conditions that are forced when entering a status
_FORCED_CONDITION: dict[ItemStatus, ItemCondition] = {
    ItemStatus.RETIRED: ItemCondition.RETIRED,
}

# Statuses that require assigned_to_user_id to be set
_REQUIRES_ASSIGNED_USER = {ItemStatus.ASSIGNED}

# Inventory barcode scheme — a single rule used everywhere: a human-readable
# sequential number per organization, ``<prefix><zero-padded number>`` with a
# 6-digit minimum (e.g. INV-000001, INV-000002, ...). The prefix (default
# "INV-") and the running counter live in organization.settings["barcode"].
DEFAULT_BARCODE_PREFIX = "INV-"
BARCODE_MIN_DIGITS = 6

# Storage areas run their own series in the same format so a scanned code is
# unambiguous: "SA-000001" is a place, "INV-000001" is a thing that sits in
# one. Counter lives in organization.settings["storage_area_barcode"].
DEFAULT_STORAGE_AREA_BARCODE_PREFIX = "SA-"
STORAGE_AREA_BARCODE_SETTINGS_KEY = "storage_area_barcode"


def _format_sequential_barcode(prefix: str, number: int) -> str:
    """Render a sequential barcode, e.g. ``INV-000001``."""
    return f"{prefix}{number:0{BARCODE_MIN_DIGITS}d}"


# Sizes whose display form is not just the code upper-cased. Mirrors the
# frontend's STANDARD_SIZES labels so an item named here matches the label the
# member picked from.
_SIZE_LABELS = {
    "xxl": "XXL",
    "xxxl": "3XL",
    "xxxxl": "4XL",
    "one_size": "One Size",
    "custom": "Custom",
}


def _size_label(size: str) -> str:
    """Display form of a stored size code — ``l`` reads as ``L``.

    Numeric sizes (boot 10.5, waist 34) are returned unchanged; upper-casing
    them would be a no-op but the explicit path keeps that obvious.
    """
    code = (size or "").strip()
    if not code:
        return ""
    # Accept a value that has already been through here ("One Size") as well as
    # the stored code ("one_size").
    key = code.lower().replace(" ", "_")
    if key in _SIZE_LABELS:
        return _SIZE_LABELS[key]
    if any(character.isdigit() for character in code):
        return code
    if "_" in code or " " in code:
        return code.replace("_", " ").title()
    return code.upper()


# Starter categories offered by the guided setup workflow.
#
# A category is the switch that decides which fields the item form shows and
# which compliance machinery runs, so a department that starts from an empty
# list either invents its own scheme or (more often) files everything under one
# catch-all and loses maintenance and NFPA tracking. These presets are the
# fire-service defaults a new quartermaster would otherwise have to know to
# ask for; they are ordinary categories once created and can be edited or
# deleted like any other.
CATEGORY_PRESETS: List[Dict[str, Any]] = [
    {
        "key": "turnout_gear",
        "name": "Turnout Gear",
        "description": "Coats, pants, and liners issued to a member.",
        "item_type": ItemType.PPE,
        "requires_assignment": True,
        "requires_serial_number": True,
        "requires_maintenance": True,
        "nfpa_tracking_enabled": True,
        "low_stock_threshold": None,
    },
    {
        "key": "helmets",
        "name": "Helmets",
        "description": "Structural and wildland helmets, shields, and liners.",
        "item_type": ItemType.PPE,
        "requires_assignment": True,
        "requires_serial_number": True,
        "requires_maintenance": True,
        "nfpa_tracking_enabled": True,
        "low_stock_threshold": None,
    },
    {
        "key": "boots_gloves_hoods",
        "name": "Boots, Gloves & Hoods",
        "description": "Sized PPE issued per member and replaced on wear.",
        "item_type": ItemType.PPE,
        "requires_assignment": True,
        "requires_serial_number": False,
        "requires_maintenance": False,
        "nfpa_tracking_enabled": False,
        "low_stock_threshold": 10,
    },
    {
        "key": "scba",
        "name": "SCBA",
        "description": "Packs, masks, and cylinders on a flow-test cycle.",
        "item_type": ItemType.PPE,
        "requires_assignment": False,
        "requires_serial_number": True,
        "requires_maintenance": True,
        "nfpa_tracking_enabled": True,
        "low_stock_threshold": None,
    },
    {
        "key": "station_uniforms",
        "name": "Station Uniforms",
        "description": "Job shirts, t-shirts, and duty pants kept in sizes.",
        "item_type": ItemType.UNIFORM,
        "requires_assignment": True,
        "requires_serial_number": False,
        "requires_maintenance": False,
        "nfpa_tracking_enabled": False,
        "low_stock_threshold": 10,
    },
    {
        "key": "dress_uniforms",
        "name": "Dress Uniforms",
        "description": "Class A coats, trousers, covers, and insignia.",
        "item_type": ItemType.UNIFORM,
        "requires_assignment": True,
        "requires_serial_number": False,
        "requires_maintenance": False,
        "nfpa_tracking_enabled": False,
        "low_stock_threshold": None,
    },
    {
        "key": "hand_tools",
        "name": "Hand Tools",
        "description": "Irons, axes, hooks, and other truck-company tools.",
        "item_type": ItemType.TOOL,
        "requires_assignment": False,
        "requires_serial_number": False,
        "requires_maintenance": True,
        "nfpa_tracking_enabled": False,
        "low_stock_threshold": None,
    },
    {
        "key": "power_equipment",
        "name": "Power Equipment",
        "description": "Saws, fans, and extrication tools on a service cycle.",
        "item_type": ItemType.TOOL,
        "requires_assignment": False,
        "requires_serial_number": True,
        "requires_maintenance": True,
        "nfpa_tracking_enabled": False,
        "low_stock_threshold": None,
    },
    {
        "key": "hose_appliances",
        "name": "Hose & Appliances",
        "description": "Hose, nozzles, and adapters carried on apparatus.",
        "item_type": ItemType.EQUIPMENT,
        "requires_assignment": False,
        "requires_serial_number": False,
        "requires_maintenance": True,
        "nfpa_tracking_enabled": False,
        "low_stock_threshold": None,
    },
    {
        "key": "ladders",
        "name": "Ladders",
        "description": "Ground ladders on an annual test cycle.",
        "item_type": ItemType.EQUIPMENT,
        "requires_assignment": False,
        "requires_serial_number": True,
        "requires_maintenance": True,
        "nfpa_tracking_enabled": False,
        "low_stock_threshold": None,
    },
    {
        "key": "radios",
        "name": "Radios & Pagers",
        "description": "Portables, chargers, and pagers issued by serial.",
        "item_type": ItemType.ELECTRONICS,
        "requires_assignment": True,
        "requires_serial_number": True,
        "requires_maintenance": False,
        "nfpa_tracking_enabled": False,
        "low_stock_threshold": None,
    },
    {
        "key": "ems_supplies",
        "name": "EMS Supplies",
        "description": "Consumables restocked by quantity and expiration.",
        "item_type": ItemType.CONSUMABLE,
        "requires_assignment": False,
        "requires_serial_number": False,
        "requires_maintenance": False,
        "nfpa_tracking_enabled": False,
        "low_stock_threshold": 20,
    },
    {
        "key": "station_supplies",
        "name": "Station Supplies",
        "description": "Cleaning and household stock reordered by quantity.",
        "item_type": ItemType.CONSUMABLE,
        "requires_assignment": False,
        "requires_serial_number": False,
        "requires_maintenance": False,
        "nfpa_tracking_enabled": False,
        "low_stock_threshold": 15,
    },
]


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

    async def _next_barcode_in_series(
        self,
        organization_id,
        *,
        settings_key: str,
        default_prefix: str,
        exists,
    ) -> str:
        """Assign the next sequential barcode in one of the org's series.

        Format: ``<prefix><zero-padded number>`` (e.g. ``INV-000001``). The
        prefix and running counter live in ``organization.settings[settings_key]``
        (mirroring the membership-number scheme in OrganizationService).

        The organization row is locked ``FOR UPDATE`` for the read-increment so
        concurrent creates in the same org get distinct numbers. Any number
        already taken (e.g. a manually-entered barcode) is skipped, which
        *exists* answers for the series being drawn from.
        """
        org_id = str(organization_id)
        org = await self.db.scalar(
            select(Organization).where(Organization.id == org_id).with_for_update()
        )
        if org is None:
            raise ValueError("Organization not found")

        settings = copy.deepcopy(org.settings or {})
        barcode_cfg = settings.get(settings_key) or {}
        prefix = barcode_cfg.get("prefix", default_prefix)
        number = int(barcode_cfg.get("next_number", 1))

        barcode = _format_sequential_barcode(prefix, number)
        while await exists(org_id, barcode):
            number += 1
            barcode = _format_sequential_barcode(prefix, number)

        barcode_cfg["prefix"] = prefix
        barcode_cfg["next_number"] = number + 1
        settings[settings_key] = barcode_cfg
        # Reassign the whole dict so SQLAlchemy detects the nested change
        # (Organization.settings is a MutableDict; see CLAUDE.md Pitfall #12).
        org.settings = settings
        await self.db.flush()
        return barcode

    async def _next_sequential_barcode(self, organization_id) -> str:
        """Next item barcode for the organization (default ``INV-000001``).

        The per-org unique constraint on ``inventory_items.barcode`` is the
        final backstop behind the skip-if-taken loop.
        """
        return await self._next_barcode_in_series(
            organization_id,
            settings_key="barcode",
            default_prefix=DEFAULT_BARCODE_PREFIX,
            exists=self._barcode_exists,
        )

    async def next_storage_area_barcode(self, organization_id) -> str:
        """Next storage-area barcode for the organization (``SA-000001``).

        Every storage area carries a barcode so a shelf can be scanned the same
        way an item can; the caller assigns this at create time rather than
        leaving it to whoever remembers to type one in.
        """
        return await self._next_barcode_in_series(
            organization_id,
            settings_key=STORAGE_AREA_BARCODE_SETTINGS_KEY,
            default_prefix=DEFAULT_STORAGE_AREA_BARCODE_PREFIX,
            exists=self._storage_area_barcode_exists,
        )

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

    async def _storage_area_barcode_exists(self, org_id: str, barcode: str) -> bool:
        """Whether a barcode is already used by a storage area in the org.

        Inactive (soft-deleted) areas count as taken — their labels are still
        stuck to the physical shelf.
        """
        existing = await self.db.scalar(
            select(StorageArea.id)
            .where(
                StorageArea.organization_id == org_id,
                StorageArea.barcode == barcode,
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
                    ItemIssuance.is_returned.is_(False),
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
                .where(ItemAssignment.is_active.is_(True))
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
                    ItemIssuance.is_returned.is_(False),
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
        auto-quarantined to IN_MAINTENANCE; a retired one goes to RETIRED;
        all others go to AVAILABLE.

        This is the single mapping from condition to a safe status, and every
        write path that sets one from the other uses it. Omitting RETIRED here
        produced AVAILABLE + retired — a pair _VALID_STATE_COMBOS rejects, so
        the row became uneditable by the very validator meant to prevent it.
        """
        if return_condition and return_condition in (
            ItemCondition.POOR,
            ItemCondition.DAMAGED,
            ItemCondition.OUT_OF_SERVICE,
        ):
            return ItemStatus.IN_MAINTENANCE
        if return_condition == ItemCondition.RETIRED:
            return ItemStatus.RETIRED
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
        status_val: ItemStatus,
        condition_val: ItemCondition,
        assigned_to_user_id=None,
        *,
        check_combination: bool = True,
    ) -> Optional[str]:
        """Return an error string if the status/condition combination is invalid.

        ``check_combination=False`` skips only the status/condition pair rule,
        for an update that does not touch either field. The pair rule was
        introduced after rows carrying the forbidden combinations already
        existed, so applying it to the *resulting* state of every partial
        update made those rows permanently unsaveable — a quartermaster
        changing an item's storage location got "Invalid state" naming two
        fields the edit was not touching. The assigned-user rule always
        applies: it is about the resulting state, not about a transition.
        """
        allowed = _VALID_STATE_COMBOS.get(status_val) if check_combination else None
        if allowed is not None and condition_val not in allowed:
            return (
                f"Invalid state: status '{status_val.value}' requires condition "
                f"in {[c.value for c in allowed]}, got '{condition_val.value}'"
            )
        if status_val in _REQUIRES_ASSIGNED_USER and not assigned_to_user_id:
            return f"Status '{status_val.value}' requires an assigned user"
        return None

    @classmethod
    def _enforce_state_invariant(cls, item) -> None:
        """Quarantine an item whose stored status/condition pair is illegal.

        Write paths that set a condition without touching status can otherwise
        manufacture exactly the pair the validator forbids — AVAILABLE plus
        poor/damaged/out-of-service. That is not merely inconsistent: assign
        and checkout gate on status alone, so the item stays distributable
        while recorded as unsafe, and the item edit form can no longer save it.
        """
        if cls._validate_item_state(item.status, item.condition):
            item.status = cls._status_from_condition(item.condition)

    async def _validate_category_requirements(
        self, item_data: Dict[str, Any], organization_id
    ) -> Optional[str]:
        """Validate that item_data satisfies category requires_* flags."""
        cat_id = item_data.get("category_id")
        if not cat_id:
            return None
        category = await self.get_category_by_id(cat_id, organization_id)
        if not category:
            # Fail closed: a category_id that isn't in the caller's org must be
            # rejected, not silently accepted. Otherwise a foreign category_id
            # persists on the org-stamped item (XC-1) and its name leaks back
            # through the eager-loaded `category` relationship on export.
            return "Invalid category"
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
            # INV-4 (XC-1): a client-supplied parent must be in the caller's org.
            await assert_in_org(
                self.db,
                InventoryCategory,
                category_data.get("parent_category_id"),
                organization_id,
                allow_none=True,
                label="parent category",
            )
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
        item_types: Optional[Iterable[ItemType]] = None,
        exclude_item_types: Optional[Iterable[ItemType]] = None,
        active_only: bool = True,
        skip: int = 0,
        limit: int = 200,
    ) -> List[InventoryCategory]:
        """Get categories for an organization with pagination.

        ``item_types`` / ``exclude_item_types`` scope the result to a domain,
        so the medical-supply page's category picker never offers a uniform
        category and the gear page's never offers a medical one.
        """
        query = select(InventoryCategory).where(
            InventoryCategory.organization_id == str(organization_id)
        )

        include_types = set(item_types or ())
        if item_type:
            include_types.add(item_type)

        if include_types:
            query = query.where(InventoryCategory.item_type.in_(list(include_types)))

        if exclude_item_types:
            query = query.where(
                InventoryCategory.item_type.notin_(list(exclude_item_types))
            )

        if active_only:
            query = query.where(InventoryCategory.active.is_(True))

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

            # INV-4 (XC-1): a re-pointed parent must be in the caller's org.
            if "parent_category_id" in update_data:
                await assert_in_org(
                    self.db,
                    InventoryCategory,
                    update_data.get("parent_category_id"),
                    organization_id,
                    allow_none=True,
                    label="parent category",
                )

            apply_updates(category, update_data, skip={"id", "organization_id"})

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
                    InventoryItem.active.is_(True),
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
    # Vendor Management
    # ============================================

    async def _vendor_name_taken(
        self,
        organization_id: UUID,
        name: str,
        exclude_vendor_id: Optional[UUID] = None,
    ) -> Optional[InventoryVendor]:
        """Return the vendor already holding this name in the org, if any.

        Matched case-insensitively: "Galls" and "galls" are the same supplier,
        and the unique constraint that backs this would otherwise let both in
        (MySQL collations aside) and leave the picker showing two of them.
        """
        query = select(InventoryVendor).where(
            InventoryVendor.organization_id == str(organization_id),
            func.lower(InventoryVendor.name) == name.strip().lower(),
        )
        if exclude_vendor_id:
            query = query.where(InventoryVendor.id != str(exclude_vendor_id))
        result = await self.db.execute(query.limit(1))
        return result.scalars().first()

    async def get_vendor_stats(
        self, organization_id: UUID, vendor_ids: List[str]
    ) -> Dict[str, Dict[str, Any]]:
        """Per-vendor catalog and purchasing totals, keyed by vendor id.

        Two grouped queries rather than three per vendor: the vendor list is
        the landing screen and renders every vendor's counts at once.
        """
        stats: Dict[str, Dict[str, Any]] = {
            vid: {
                "item_count": 0,
                "open_reorder_count": 0,
                "total_purchase_value": None,
            }
            for vid in vendor_ids
        }
        if not vendor_ids:
            return stats

        # The two figures deliberately count different rows. "Items" means what
        # is in the catalog now, matching the filtered list the count links to.
        # Money spent does not un-spend when a coat is retired, so the total
        # sums every item ever bought from the vendor, active or not.
        item_rows = await self.db.execute(
            select(
                InventoryItem.vendor_id,
                func.sum(case((InventoryItem.active.is_(True), 1), else_=0)),
                func.sum(InventoryItem.purchase_price),
            )
            .where(
                InventoryItem.organization_id == str(organization_id),
                InventoryItem.vendor_id.in_(vendor_ids),
            )
            .group_by(InventoryItem.vendor_id)
        )
        for vendor_id, count, spend in item_rows.all():
            entry = stats.get(vendor_id)
            if entry is None:
                continue
            # SUM() comes back as Decimal on MySQL even over an integer CASE.
            # item_count is declared int on the response, and Pydantic warns
            # (rather than coercing quietly) when handed a Decimal for it.
            entry["item_count"] = int(count or 0)
            entry["total_purchase_value"] = spend

        reorder_rows = await self.db.execute(
            select(ReorderRequest.vendor_id, func.count(ReorderRequest.id))
            .where(
                ReorderRequest.organization_id == str(organization_id),
                ReorderRequest.vendor_id.in_(vendor_ids),
                ReorderRequest.status.in_(
                    [
                        ReorderStatus.PENDING,
                        ReorderStatus.APPROVED,
                        ReorderStatus.ORDERED,
                    ]
                ),
            )
            .group_by(ReorderRequest.vendor_id)
        )
        for vendor_id, count in reorder_rows.all():
            entry = stats.get(vendor_id)
            if entry is None:
                continue
            entry["open_reorder_count"] = count or 0

        return stats

    async def list_vendors(
        self,
        organization_id: UUID,
        search: Optional[str] = None,
        active_only: bool = True,
    ) -> List[InventoryVendor]:
        """List vendors for an organization, preferred ones first."""
        query = (
            select(InventoryVendor)
            .where(InventoryVendor.organization_id == str(organization_id))
            .options(selectinload(InventoryVendor.contacts))
            .order_by(InventoryVendor.is_preferred.desc(), InventoryVendor.name)
        )
        if active_only:
            query = query.where(InventoryVendor.is_active.is_(True))
        if search:
            term = like_pattern(search)
            query = query.where(
                or_(
                    InventoryVendor.name.ilike(term, escape=LIKE_ESCAPE_CHAR),
                    InventoryVendor.account_number.ilike(term, escape=LIKE_ESCAPE_CHAR),
                    InventoryVendor.email.ilike(term, escape=LIKE_ESCAPE_CHAR),
                    InventoryVendor.phone.ilike(term, escape=LIKE_ESCAPE_CHAR),
                )
            )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_vendor(
        self, vendor_id: UUID, organization_id: UUID
    ) -> Optional[InventoryVendor]:
        """Get one vendor with its contacts, scoped to the caller's org."""
        result = await self.db.execute(
            select(InventoryVendor)
            .where(InventoryVendor.id == str(vendor_id))
            .where(InventoryVendor.organization_id == str(organization_id))
            .options(selectinload(InventoryVendor.contacts))
        )
        return result.scalars().first()

    async def create_vendor(
        self,
        organization_id: UUID,
        data: Dict[str, Any],
        created_by: Optional[UUID] = None,
    ) -> Tuple[Optional[InventoryVendor], Optional[str]]:
        """Create a vendor, optionally with its contacts in the same call."""
        try:
            contacts = data.pop("contacts", None) or []
            name = (data.get("name") or "").strip()
            if not name:
                return None, "Vendor name is required"
            data["name"] = name

            existing = await self._vendor_name_taken(organization_id, name)
            if existing is not None:
                if not existing.is_active:
                    return None, (
                        f"'{existing.name}' already exists but is inactive. "
                        "Reactivate it instead of creating a duplicate."
                    )
                return None, f"A vendor named '{existing.name}' already exists"

            vendor = InventoryVendor(
                organization_id=str(organization_id),
                created_by=str(created_by) if created_by else None,
                **data,
            )
            self.db.add(vendor)
            await self.db.flush()

            # The first contact entered is the one to call unless the form said
            # otherwise — a vendor whose only contact is not flagged primary
            # would otherwise show none on its card.
            if contacts and not any(c.get("is_primary") for c in contacts):
                contacts[0]["is_primary"] = True
            for contact in contacts:
                self.db.add(
                    InventoryVendorContact(
                        organization_id=str(organization_id),
                        vendor_id=vendor.id,
                        **contact,
                    )
                )

            await self.db.flush()
            await self._normalize_primary_contact(vendor.id, str(organization_id))
            await self.db.commit()
            refreshed = await self.get_vendor(vendor.id, organization_id)
            return refreshed, None
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating vendor: {e}")
            return None, str(e)

    async def update_vendor(
        self,
        vendor_id: UUID,
        organization_id: UUID,
        data: Dict[str, Any],
    ) -> Tuple[Optional[InventoryVendor], Optional[str]]:
        """Update a vendor. Explicit nulls clear the field (see CLAUDE.md #1)."""
        try:
            vendor = await self.get_vendor(vendor_id, organization_id)
            if not vendor:
                return None, "Vendor not found"

            if data.get("name"):
                name = data["name"].strip()
                clash = await self._vendor_name_taken(
                    organization_id, name, exclude_vendor_id=vendor_id
                )
                if clash is not None:
                    return None, f"A vendor named '{clash.name}' already exists"
                data["name"] = name

            apply_updates(vendor, data, skip={"id", "organization_id", "created_by"})
            await self.db.commit()
            refreshed = await self.get_vendor(vendor_id, organization_id)
            return refreshed, None
        except ValueError as e:
            await self.db.rollback()
            return None, str(e)
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating vendor: {e}")
            return None, str(e)

    async def deactivate_vendor(
        self, vendor_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Deactivate a vendor, keeping its purchase history intact.

        Items and reorder requests keep pointing at it: "we don't buy from them
        anymore" must not erase where a helmet in service came from.
        """
        try:
            vendor = await self.get_vendor(vendor_id, organization_id)
            if not vendor:
                return False, "Vendor not found"
            vendor.is_active = False
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deactivating vendor: {e}")
            return False, str(e)

    async def _normalize_primary_contact(
        self,
        vendor_id: str,
        organization_id: str,
        keep_contact_id: Optional[str] = None,
    ) -> None:
        """Leave at most one primary contact on a vendor.

        ``keep_contact_id`` is the contact just flagged primary; every other
        contact on the vendor is demoted. With no id given, the flag is left
        alone unless nothing is flagged, in which case the first contact by
        name is promoted so a vendor card always has someone to call.
        """
        result = await self.db.execute(
            select(InventoryVendorContact)
            .where(InventoryVendorContact.vendor_id == vendor_id)
            .where(InventoryVendorContact.organization_id == organization_id)
            .order_by(InventoryVendorContact.name)
        )
        contacts = list(result.scalars().all())
        if not contacts:
            return

        if keep_contact_id:
            for contact in contacts:
                contact.is_primary = contact.id == keep_contact_id
            return

        flagged = [c for c in contacts if c.is_primary]
        if not flagged:
            contacts[0].is_primary = True
        elif len(flagged) > 1:
            for contact in flagged[1:]:
                contact.is_primary = False

    async def add_vendor_contact(
        self,
        vendor_id: UUID,
        organization_id: UUID,
        data: Dict[str, Any],
    ) -> Tuple[Optional[InventoryVendorContact], Optional[str]]:
        """Add a named contact to a vendor."""
        try:
            vendor = await self.get_vendor(vendor_id, organization_id)
            if not vendor:
                return None, "Vendor not found"

            contact = InventoryVendorContact(
                organization_id=str(organization_id),
                vendor_id=str(vendor_id),
                **data,
            )
            self.db.add(contact)
            await self.db.flush()
            await self._normalize_primary_contact(
                str(vendor_id),
                str(organization_id),
                keep_contact_id=contact.id if contact.is_primary else None,
            )
            await self.db.commit()
            await self.db.refresh(contact)
            return contact, None
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error adding vendor contact: {e}")
            return None, str(e)

    async def get_vendor_contact(
        self, contact_id: UUID, organization_id: UUID
    ) -> Optional[InventoryVendorContact]:
        """Get one vendor contact, scoped to the caller's org."""
        result = await self.db.execute(
            select(InventoryVendorContact)
            .where(InventoryVendorContact.id == str(contact_id))
            .where(InventoryVendorContact.organization_id == str(organization_id))
        )
        return result.scalars().first()

    async def update_vendor_contact(
        self,
        contact_id: UUID,
        organization_id: UUID,
        data: Dict[str, Any],
    ) -> Tuple[Optional[InventoryVendorContact], Optional[str]]:
        """Update a vendor contact."""
        try:
            contact = await self.get_vendor_contact(contact_id, organization_id)
            if not contact:
                return None, "Contact not found"

            apply_updates(contact, data, skip={"id", "organization_id", "vendor_id"})
            await self.db.flush()
            await self._normalize_primary_contact(
                contact.vendor_id,
                str(organization_id),
                keep_contact_id=contact.id if contact.is_primary else None,
            )
            await self.db.commit()
            await self.db.refresh(contact)
            return contact, None
        except ValueError as e:
            await self.db.rollback()
            return None, str(e)
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating vendor contact: {e}")
            return None, str(e)

    async def delete_vendor_contact(
        self, contact_id: UUID, organization_id: UUID
    ) -> Optional[str]:
        """Delete a vendor contact, promoting another to primary if needed."""
        try:
            contact = await self.get_vendor_contact(contact_id, organization_id)
            if not contact:
                return "Contact not found"
            vendor_id = contact.vendor_id
            await self.db.delete(contact)
            await self.db.flush()
            await self._normalize_primary_contact(vendor_id, str(organization_id))
            await self.db.commit()
            return None
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting vendor contact: {e}")
            return str(e)

    # ------------------------------------------------------------------
    # Cleaning up what the free-text era left behind
    # ------------------------------------------------------------------

    @staticmethod
    def _name_key(name: Optional[str]) -> str:
        """Fold a supplier name for comparison: trimmed and case-insensitive."""
        return (name or "").strip().lower()

    async def list_unlinked_vendor_names(
        self, organization_id: UUID
    ) -> List[Dict[str, Any]]:
        """Supplier names typed onto rows that were never attached to a vendor.

        These are the rows with nothing behind the name — no contact, no
        purchase history — so the screen can offer to attach them all at once
        rather than leaving someone to find them by eye.

        Grouped case-insensitively, because "Galls Inc." and "galls inc" are
        one supplier to whoever has to make the call. The first spelling seen
        is the one shown, and the rest fold into it.

        Retired items count too: attaching updates them, and the vendor's spend
        total includes them, so leaving them out here would strand historical
        purchases with no way to reach them from the screen.
        """
        org_id = str(organization_id)
        counts: Dict[str, Dict[str, Any]] = {}

        def tally(raw_name: Optional[str], field: str, count: int) -> None:
            key = self._name_key(raw_name)
            if not key:
                return
            entry = counts.setdefault(
                key,
                {"name": (raw_name or "").strip(), "item_count": 0, "reorder_count": 0},
            )
            entry[field] += count or 0

        item_rows = await self.db.execute(
            select(InventoryItem.vendor, func.count(InventoryItem.id))
            .where(
                InventoryItem.organization_id == org_id,
                InventoryItem.vendor_id.is_(None),
                InventoryItem.vendor.isnot(None),
            )
            .group_by(InventoryItem.vendor)
        )
        for name, count in item_rows.all():
            tally(name, "item_count", count)

        reorder_rows = await self.db.execute(
            select(ReorderRequest.vendor, func.count(ReorderRequest.id))
            .where(
                ReorderRequest.organization_id == org_id,
                ReorderRequest.vendor_id.is_(None),
                ReorderRequest.vendor.isnot(None),
            )
            .group_by(ReorderRequest.vendor)
        )
        for name, count in reorder_rows.all():
            tally(name, "reorder_count", count)

        # Busiest first: the name on forty items is the one worth attaching.
        return sorted(
            counts.values(),
            key=lambda e: (-(e["item_count"] + e["reorder_count"]), e["name"].lower()),
        )

    async def attach_vendor_name(
        self, vendor_id: UUID, organization_id: UUID, name: str
    ) -> Tuple[Optional[Dict[str, int]], Optional[str]]:
        """Point every row carrying this typed-in name at a real vendor.

        Only rows that are not already linked are touched: an item somebody
        attached to a different supplier by hand is a decision, not a leftover.
        """
        try:
            key = self._name_key(name)
            if not key:
                return None, "A supplier name is required"

            vendor = await self.get_vendor(vendor_id, organization_id)
            if not vendor:
                return None, "Vendor not found"

            org_id = str(organization_id)
            item_result = await self.db.execute(
                update(InventoryItem)
                .where(
                    InventoryItem.organization_id == org_id,
                    InventoryItem.vendor_id.is_(None),
                    func.lower(func.trim(InventoryItem.vendor)) == key,
                )
                .values(vendor_id=str(vendor_id))
            )
            reorder_result = await self.db.execute(
                update(ReorderRequest)
                .where(
                    ReorderRequest.organization_id == org_id,
                    ReorderRequest.vendor_id.is_(None),
                    func.lower(func.trim(ReorderRequest.vendor)) == key,
                )
                .values(vendor_id=str(vendor_id))
            )
            await self.db.commit()
            return (
                {
                    "items_linked": item_result.rowcount or 0,
                    "reorders_linked": reorder_result.rowcount or 0,
                },
                None,
            )
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error attaching vendor name: {e}")
            return None, str(e)

    async def merge_vendors(
        self, target_id: UUID, source_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """Fold one vendor into another: same supplier, entered twice.

        Everything that points at the source is repointed at the target — items,
        reorder requests, contacts — and the source row is then removed. It is
        removed rather than deactivated so the name is free again: a merged
        duplicate left on file keeps its name reserved by the unique
        constraint, and shows up forever under "show inactive".

        The target's own details win; nothing on it is overwritten.
        """
        try:
            if str(target_id) == str(source_id):
                return None, "A vendor cannot be merged into itself"

            org_id = str(organization_id)
            target = await self.get_vendor(target_id, organization_id)
            if not target:
                return None, "Vendor not found"
            source = await self.get_vendor(source_id, organization_id)
            if not source:
                return None, "The vendor to merge was not found"

            source_name = source.name

            item_result = await self.db.execute(
                update(InventoryItem)
                .where(
                    InventoryItem.organization_id == org_id,
                    InventoryItem.vendor_id == str(source_id),
                )
                .values(vendor_id=str(target_id))
            )
            reorder_result = await self.db.execute(
                update(ReorderRequest)
                .where(
                    ReorderRequest.organization_id == org_id,
                    ReorderRequest.vendor_id == str(source_id),
                )
                .values(vendor_id=str(target_id))
            )
            # Contacts move through the ORM, not a bulk UPDATE. `source.contacts`
            # is already loaded, and the relationship cascades delete-orphan: a
            # bulk UPDATE repoints the rows in the database but leaves them in
            # the loaded collection, so deleting the source would then cascade a
            # DELETE onto the contacts this merge just reported as moved.
            # Appending to the target re-parents each one on both sides.
            moved_contacts = list(source.contacts)
            for contact in moved_contacts:
                target.contacts.append(contact)

            await self.db.delete(source)
            await self.db.flush()
            # Both vendors may have had a primary; the target keeps one.
            await self._normalize_primary_contact(str(target_id), org_id)
            await self.db.commit()

            return (
                {
                    "items_moved": item_result.rowcount or 0,
                    "reorders_moved": reorder_result.rowcount or 0,
                    "contacts_moved": len(moved_contacts),
                    "merged_name": source_name,
                    "vendor_name": target.name,
                },
                None,
            )
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error merging vendors: {e}")
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
            InventoryItem.active.is_(True),
        )
        if exclude_item_id:
            query = query.where(InventoryItem.id != str(exclude_item_id))
        result = await self.db.execute(query)
        if result.scalar():
            return f"Serial number '{serial_number}' is already in use by another item in this organization"
        return None

    # INV-4 (XC-1): client-supplied FKs on an item, other than category_id
    # (validated separately via _validate_category_requirements). Only the keys
    # present in the payload are checked, so a partial update leaves unmentioned
    # FKs untouched; each is nullable, so allow_none.
    _ITEM_FK_CHECKS = (
        ("location_id", Location, "location"),
        ("storage_area_id", StorageArea, "storage area"),
        ("variant_group_id", ItemVariantGroup, "variant group"),
        ("assigned_to_user_id", User, "assignee"),
        ("vendor_id", InventoryVendor, "vendor"),
    )

    async def _assert_item_fks_in_org(
        self, data: Dict[str, Any], organization_id: UUID
    ) -> None:
        for field, model, label in self._ITEM_FK_CHECKS:
            if field in data:
                await assert_in_org(
                    self.db,
                    model,
                    data.get(field),
                    organization_id,
                    allow_none=True,
                    label=label,
                )

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

            # INV-4 (XC-1): location/storage/variant-group/assignee must be in-org.
            await self._assert_item_fks_in_org(item_data, organization_id)

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

    @staticmethod
    def _category_ids_of_type(
        organization_id: UUID, item_types: Set[ItemType]
    ) -> "Select":
        """Org-scoped select of category ids in the given domains.

        Org-scoped inside the subquery rather than relying on the outer
        query's filter: without it, an item could be matched against another
        organization's category of the same type.
        """
        return select(InventoryCategory.id).where(
            InventoryCategory.organization_id == str(organization_id),
            InventoryCategory.item_type.in_(list(item_types)),
        )

    async def get_items(
        self,
        organization_id: UUID,
        category_id: Optional[UUID] = None,
        status: Optional[ItemStatus] = None,
        condition: Optional[ItemCondition] = None,
        item_type: Optional[ItemType] = None,
        item_types: Optional[Iterable[ItemType]] = None,
        exclude_item_types: Optional[Iterable[ItemType]] = None,
        assigned_to: Optional[UUID] = None,
        location_id: Optional[UUID] = None,
        storage_area_id: Optional[UUID] = None,
        vendor_id: Optional[UUID] = None,
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
        """Get items with filtering, sorting, and pagination.

        ``item_types`` restricts to a domain, ``exclude_item_types`` carves one
        out — that pair is what keeps the medical-supply page and the
        gear-and-uniforms page from each listing the other's stock. Both are
        applied server-side from the caller's permissions, never from a query
        parameter, so a medical-only officer cannot widen their own view.
        """
        query = (
            select(InventoryItem)
            .where(InventoryItem.organization_id == str(organization_id))
            .options(
                selectinload(InventoryItem.category),
                selectinload(InventoryItem.assigned_to_user),
                selectinload(InventoryItem.vendor_record),
            )
        )

        if category_id:
            query = query.where(InventoryItem.category_id == str(category_id))

        if status:
            query = query.where(InventoryItem.status == status)

        if condition:
            query = query.where(InventoryItem.condition == condition)

        include_types = set(item_types or ())
        if item_type:
            include_types.add(item_type)

        if include_types:
            query = query.where(
                InventoryItem.category_id.in_(
                    self._category_ids_of_type(organization_id, include_types)
                )
            )

        if exclude_item_types:
            # An uncategorized item has no domain, so it is not the excluded
            # one — NOT IN would drop it along with the excluded rows because
            # NULL NOT IN (...) is NULL, and the gear page would quietly lose
            # every item nobody has filed yet.
            query = query.where(
                or_(
                    InventoryItem.category_id.is_(None),
                    InventoryItem.category_id.notin_(
                        self._category_ids_of_type(
                            organization_id, set(exclude_item_types)
                        )
                    ),
                )
            )

        if assigned_to:
            # str(): the column is String(36) and the parameter is a UUID, so
            # the comparison bound a UUID against a char column and matched
            # nothing at all — "everything issued to this member" answered
            # "nothing" for every member. Every other id filter here already
            # casts; this one was the exception.
            query = query.where(InventoryItem.assigned_to_user_id == str(assigned_to))

        if location_id:
            query = query.where(InventoryItem.location_id == str(location_id))

        if storage_area_id:
            query = query.where(InventoryItem.storage_area_id == str(storage_area_id))

        if vendor_id:
            query = query.where(InventoryItem.vendor_id == str(vendor_id))

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
            search_term = like_pattern(search)
            query = query.where(
                or_(
                    InventoryItem.name.ilike(search_term, escape=LIKE_ESCAPE_CHAR),
                    InventoryItem.serial_number.ilike(
                        search_term, escape=LIKE_ESCAPE_CHAR
                    ),
                    InventoryItem.asset_tag.ilike(search_term, escape=LIKE_ESCAPE_CHAR),
                    InventoryItem.barcode.ilike(search_term, escape=LIKE_ESCAPE_CHAR),
                    InventoryItem.description.ilike(
                        search_term, escape=LIKE_ESCAPE_CHAR
                    ),
                    InventoryItem.manufacturer.ilike(
                        search_term, escape=LIKE_ESCAPE_CHAR
                    ),
                    InventoryItem.model_number.ilike(
                        search_term, escape=LIKE_ESCAPE_CHAR
                    ),
                    InventoryItem.size.ilike(search_term, escape=LIKE_ESCAPE_CHAR),
                    InventoryItem.color.ilike(search_term, escape=LIKE_ESCAPE_CHAR),
                )
            )

        if active_only:
            query = query.where(InventoryItem.active.is_(True))

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

        await self._attach_lot_stock(str(organization_id), items)

        return items, total

    async def _attach_lot_stock(
        self, organization_id: str, items: List[InventoryItem]
    ) -> None:
        """Hang ready-lot figures on each item for the response schema.

        ``quantity`` and stock lots are separate ledgers: receiving a lot does
        not touch the column, and an equipment-check swap decrements only the
        lot. A grid that shows ``quantity`` alone therefore reports a stale
        number for every consumable a department keeps as dated stock, which is
        the same disagreement the reorder alert had to be taught about.

        Transient attributes rather than mapped columns — nothing is persisted
        and no flush is triggered; they exist to be read by
        ``InventoryItemResponse``.
        """
        if not items:
            return
        totals = await self._in_date_lot_totals(
            organization_id, [item.id for item in items]
        )
        for item in items:
            item.is_lot_stocked = item.id in totals
            item.lot_stock = totals.get(item.id)

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
                selectinload(InventoryItem.vendor_record),
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
            # Enforce the pair rule only when this update actually changes the
            # pair. A row stored with a combination that predates the rule must
            # stay editable for every unrelated field; the migration that
            # normalizes those rows is the place that fixes them, not a 400 on
            # a location change.
            pair_changed = (new_status, new_condition) != (item.status, item.condition)
            state_err = self._validate_item_state(
                new_status,
                new_condition,
                assigned_user,
                check_combination=pair_changed,
            )
            if state_err:
                return None, state_err

            # INV-4 (XC-1): a re-pointed location/storage/variant-group/assignee
            # must be in the caller's org.
            await self._assert_item_fks_in_org(update_data, organization_id)

            apply_updates(item, update_data, skip={"id", "organization_id"})

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
                .where(CheckOutRecord.is_returned.is_(False))
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
                    .where(ItemIssuance.is_returned.is_(False))
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

            # XC-1: the target member id is client-supplied. A foreign user_id
            # would be stored on the assignment and item, then surfaced by name in
            # get_assignments (which formats assignment.user) — a cross-tenant PII
            # leak, and a notification queued to another org's member. Validate
            # the member is in-org before assigning.
            if not await is_in_org(self.db, User, user_id, organization_id):
                return None, "Member not found"

            # Check if item is available
            # Reassignment is a chain-of-custody transfer, never an ordinary
            # assignment.  Callers must use transfer_item_holding so the old
            # record cannot be silently closed.
            if item.status != ItemStatus.AVAILABLE:
                return None, f"Item is not available (status: {item.status})"

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
                .where(ItemAssignment.is_active.is_(True))
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

            # From the condition the item actually ends up with, not the one
            # supplied. Unassign is reachable from the UI with no body at all,
            # so `return_condition` is routinely None while the stored
            # condition is damaged — which wrote AVAILABLE + damaged and put a
            # damaged coat straight back in the assignable pool.
            item.status = self._status_from_condition(item.condition)

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
            query = query.where(ItemAssignment.is_active.is_(True))

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

            # XC-1: validate the client-supplied member is in-org — a foreign
            # user_id is surfaced by name in the issuance and charge listings
            # (which format issuance.user). See assign_item_to_user.
            if not await is_in_org(self.db, User, user_id, organization_id):
                return None, "Member not found"

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
            query = query.where(ItemIssuance.is_returned.is_(False))
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
            query = query.where(ItemIssuance.is_returned.is_(False))
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

            # XC-1: validate the client-supplied member is in-org — a foreign
            # user_id is surfaced by name in the checkout listing (formats
            # checkout.user). See assign_item_to_user.
            if not await is_in_org(self.db, User, user_id, organization_id):
                return None, "Member not found"

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

            item.status = self._status_from_condition(item.condition)

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
            .where(CheckOutRecord.is_returned.is_(False))
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
                CheckOutRecord.is_returned.is_(False),
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

    @staticmethod
    def checkout_is_overdue(record: CheckOutRecord) -> bool:
        """Whether *record* is past its due date, decided at read time.

        ``CheckOutRecord.is_overdue`` is a stored column that only
        :meth:`mark_overdue_checkouts` writes, from a daily scheduled task.
        Between a checkout falling due and that task's next run the column
        still reads ``False`` — while :meth:`get_overdue_checkouts` compares
        ``expected_return_at`` live, so the same loan appeared under the
        Overdue tab and wore a green "Active" badge on the Active tab at the
        same time. Every read path answers through this so they agree; the
        stored flag remains the fallback for a record with no due date on file.
        """
        if record.is_returned or record.expected_return_at is None:
            return bool(record.is_overdue)
        due = record.expected_return_at
        if due.tzinfo is None:
            # MySQL hands back naive datetimes; every stored value is UTC.
            due = due.replace(tzinfo=timezone.utc)
        return due < datetime.now(timezone.utc)

    async def mark_overdue_checkouts(self, organization_id: UUID) -> int:
        """Batch-mark overdue checkouts.  Call from a scheduled task, not from
        read endpoints, to avoid write-on-read overhead.
        """
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            update(CheckOutRecord)
            .where(
                CheckOutRecord.organization_id == str(organization_id),
                CheckOutRecord.is_returned.is_(False),
                CheckOutRecord.expected_return_at < now,
                CheckOutRecord.is_overdue.is_(False),
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
            # INV-3 (XC-1 + silent no-op): item_id is client-supplied. Validate
            # it is in-org before writing. Without this, a foreign item_id was
            # stored on the org-stamped record, and — worse — a record created
            # with is_completed=True against a foreign/missing item hit the
            # `if item:` guard below, so _get_item_locked returned None and the
            # condition/inspection-date update was silently skipped: a
            # "completed" maintenance record that updated nothing and reported
            # success.
            exists = await self.db.execute(
                select(InventoryItem.id).where(
                    InventoryItem.id == str(item_id),
                    InventoryItem.organization_id == str(organization_id),
                )
            )
            if exists.scalar_one_or_none() is None:
                return None, "Item not found"

            safe_data = {
                k: v
                for k, v in maintenance_data.items()
                if k in self._MAINTENANCE_ALLOWED_FIELDS
            }
            # INV-4 (XC-1): a client-supplied performed_by must be an in-org user.
            await assert_in_org(
                self.db,
                User,
                safe_data.get("performed_by"),
                organization_id,
                allow_none=True,
                label="performed_by",
            )
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

                    # Completion never silently returns equipment to service. A
                    # failed inspection must remain unavailable; successful work
                    # has a separate, deliberate "Return to service" action.
                    if maintenance_data.get("passed") is False:
                        item.status = ItemStatus.IN_MAINTENANCE
                        item.condition = ItemCondition.OUT_OF_SERVICE
                    # `passed` is absent on a plain repair log, so the branch
                    # above does not fire and an unsafe condition_after would
                    # otherwise be written against an AVAILABLE item.
                    self._enforce_state_invariant(item)
            elif maintenance_data.get("maintenance_type") == "repair":
                item = await self._get_item_locked(item_id, organization_id)
                if item:
                    item.status = ItemStatus.IN_MAINTENANCE

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

            # INV-4 (XC-1): a re-pointed performed_by must be an in-org user.
            if "performed_by" in safe_data:
                await assert_in_org(
                    self.db,
                    User,
                    safe_data.get("performed_by"),
                    organization_id,
                    allow_none=True,
                    label="performed_by",
                )

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
                    self._enforce_state_invariant(item)

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
            .where(InventoryItem.active.is_(True))
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
            .where(InventoryCategory.active.is_(True))
            .where(InventoryItem.active.is_(True))
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
                .where(InventoryItem.active.is_(True))
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
            .where(InventoryItem.active.is_(True))
        )
        total_items = total_result.scalar()

        # Items by status
        status_result = await self.db.execute(
            select(
                InventoryItem.status,
                func.count(InventoryItem.id).label("count"),
            )
            .where(InventoryItem.organization_id == str(organization_id))
            .where(InventoryItem.active.is_(True))
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
            .where(InventoryItem.active.is_(True))
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
            .where(InventoryItem.active.is_(True))
        )
        total_value = value_result.scalar() or Decimal("0.00")

        # Active checkouts
        checkout_result = await self.db.execute(
            select(func.count(CheckOutRecord.id))
            .where(CheckOutRecord.organization_id == str(organization_id))
            .where(CheckOutRecord.is_returned.is_(False))
        )
        active_checkouts = checkout_result.scalar()

        # Overdue checkouts
        overdue_result = await self.db.execute(
            select(func.count(CheckOutRecord.id))
            .where(CheckOutRecord.organization_id == str(organization_id))
            .where(CheckOutRecord.is_overdue.is_(True))
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
            .where(CheckOutRecord.is_returned.is_(False))
        )
        checkout_item_ids_result = await self.db.execute(checkout_items_q)
        checkout_item_ids = {row[0] for row in checkout_item_ids_result.all()}

        # Item IDs permanently assigned to the user
        assignment_items_q = (
            select(ItemAssignment.item_id)
            .where(ItemAssignment.organization_id == org_id)
            .where(ItemAssignment.user_id == user_id)
            .where(ItemAssignment.is_active.is_(True))
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
            .where(InventoryItem.active.is_(True))
        )
        total_items = total_result.scalar()

        # Items by status
        status_result = await self.db.execute(
            select(
                InventoryItem.status,
                func.count(InventoryItem.id).label("count"),
            )
            .where(InventoryItem.id.in_(user_item_ids))
            .where(InventoryItem.active.is_(True))
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
            .where(InventoryItem.active.is_(True))
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
            .where(InventoryItem.active.is_(True))
        )
        total_value = value_result.scalar() or Decimal("0.00")

        # User's active checkouts
        active_checkouts = len(checkout_item_ids)

        # User's overdue checkouts
        overdue_result = await self.db.execute(
            select(func.count(CheckOutRecord.id))
            .where(CheckOutRecord.organization_id == org_id)
            .where(CheckOutRecord.user_id == user_id)
            .where(CheckOutRecord.is_returned.is_(False))
            .where(CheckOutRecord.is_overdue.is_(True))
        )
        overdue_checkouts = overdue_result.scalar() or 0

        # Maintenance due on user's items
        cutoff_date = date.today() + timedelta(days=7)
        maint_result = await self.db.execute(
            select(func.count(InventoryItem.id))
            .where(InventoryItem.id.in_(user_item_ids))
            .where(InventoryItem.active.is_(True))
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
                    InventoryItem.active.is_(True),
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
                InventoryItem.active.is_(True),
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
                    # ItemAssignment has no per-assignment quantity column: a
                    # permanent assignment is one physical unit (serialized
                    # gear). a.item.quantity is the catalog's on-hand stock,
                    # which inflated dashboard counts — one assignment of an
                    # item with 50 units in stock displayed as 50.
                    "quantity": 1,
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
                    "is_overdue": self.checkout_is_overdue(c),
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
            .where(ItemAssignment.is_active.is_(True))
            .group_by(ItemAssignment.user_id)
        ).subquery("a_sub")

        checkout_sub = (
            select(
                CheckOutRecord.user_id.label("uid"),
                func.count(CheckOutRecord.id).label("cnt"),
            )
            .where(CheckOutRecord.organization_id == org_id)
            .where(CheckOutRecord.is_returned.is_(False))
            .group_by(CheckOutRecord.user_id)
        ).subquery("co_sub")

        overdue_sub = (
            select(
                CheckOutRecord.user_id.label("uid"),
                func.count(CheckOutRecord.id).label("cnt"),
            )
            .where(CheckOutRecord.organization_id == org_id)
            .where(CheckOutRecord.is_returned.is_(False))
            .where(CheckOutRecord.is_overdue.is_(True))
            .group_by(CheckOutRecord.user_id)
        ).subquery("od_sub")

        issue_sub = (
            select(
                ItemIssuance.user_id.label("uid"),
                func.coalesce(func.sum(ItemIssuance.quantity_issued), 0).label("cnt"),
            )
            .where(ItemIssuance.organization_id == org_id)
            .where(ItemIssuance.is_returned.is_(False))
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
            pattern = like_pattern(search)
            query = query.where(
                or_(
                    User.username.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                    User.first_name.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                    User.last_name.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                    User.membership_number.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
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
                InventoryItem.active.is_(True),
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
                InventoryItem.active.is_(True),
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
        search_term = like_pattern(code)

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
                InventoryItem.active.is_(True),
                or_(
                    *[
                        col.ilike(search_term, escape=LIKE_ESCAPE_CHAR)
                        for col in field_cols
                    ]
                ),
            )
            .options(selectinload(InventoryItem.category))
            .limit(limit * 2)  # fetch extra to allow dedup headroom
        )
        items = result.scalars().all()

        # Determine the highest-priority matched field for each item.
        # Compare against the RAW code, not the LIKE-escaped pattern: a search
        # for "50%" escapes to "50\\%", which never matches the stored value,
        # so every hit would fall through to the "name" default.
        results: List[Tuple[InventoryItem, str, str]] = []
        safe_lower = code.lower()
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
    # Item distribution (scan-to-assign or loan)
    # ============================================

    async def distribute_items(
        self,
        user_id: UUID,
        organization_id: UUID,
        performed_by: UUID,
        items: List[Dict[str, Any]],
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Distribute scanned items using the explicitly requested operation for
        individual gear. Quantity-tracked stock always follows pool issuance
        policy, independently of the requested duration.

        Returns a summary with per-item results.
        """
        results = []
        successful = 0
        failed = 0

        for scan in items:
            code = scan["code"]
            quantity = scan.get("quantity", 1)
            scan_item_id = scan.get("item_id")
            operation = scan["operation"]
            expected_return_at = scan.get("expected_return_at")

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

                elif (
                    operation == "permanent_assignment"
                    and item.status == ItemStatus.AVAILABLE
                ):
                    # AVAILABLE only, deliberately. `assign_item_to_user`
                    # refuses anything else outright -- "reassignment is a
                    # chain-of-custody transfer, never an ordinary assignment"
                    # -- so admitting ASSIGNED here only produced a failed
                    # result with no custody data attached. An item someone
                    # already holds falls to the conflict branch below, which
                    # reports who holds it so the scanner can offer the
                    # transfer endpoint; that path closes the old record and
                    # opens its successor atomically, which a bare scan cannot.
                    assignment, err = await self.assign_item_to_user(
                        item_id=UUID(item.id),
                        user_id=user_id,
                        organization_id=organization_id,
                        assigned_by=performed_by,
                        assignment_type=AssignmentType.PERMANENT,
                        reason=reason,
                    )
                    results.append(
                        self._batch_result(
                            code, item, "permanent_assignment", not err, err
                        )
                    )
                    successful, failed = (
                        (successful + 1, failed)
                        if not err
                        else (successful, failed + 1)
                    )

                elif (
                    operation == "temporary_loan"
                    and item.status == ItemStatus.AVAILABLE
                ):
                    checkout, err = await self.checkout_item(
                        item_id=UUID(item.id),
                        user_id=user_id,
                        organization_id=organization_id,
                        checked_out_by=performed_by,
                        expected_return_at=expected_return_at,
                        reason=reason,
                    )
                    results.append(
                        self._batch_result(code, item, "temporary_loan", not err, err)
                    )
                    successful, failed = (
                        (successful + 1, failed)
                        if not err
                        else (successful, failed + 1)
                    )

                else:
                    conflict = await self._active_holding_conflict(
                        item, organization_id
                    )
                    results.append(
                        self._batch_result(
                            code,
                            item,
                            "none",
                            False,
                            f"Item is not available (status: {item.status.value})",
                            conflict=conflict,
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
        conflict: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Build a single result entry for distribution/return operations."""
        return {
            "code": code,
            "item_name": item.name if item else "Unknown",
            "item_id": item.id if item else "",
            "action": action,
            "success": success,
            "error": error,
            "conflict": conflict,
        }

    async def _active_holding_conflict(
        self, item: InventoryItem, organization_id: UUID
    ) -> Optional[Dict[str, Any]]:
        """Return structured custody data for an active individual holding."""
        assignment_result = await self.db.execute(
            select(ItemAssignment, User)
            .join(User, User.id == ItemAssignment.user_id)
            .where(ItemAssignment.organization_id == str(organization_id))
            .where(ItemAssignment.item_id == str(item.id))
            .where(ItemAssignment.is_active.is_(True))
            .order_by(ItemAssignment.assigned_date.desc())
            .limit(1)
        )
        row = assignment_result.first()
        if row:
            holding, holder = row
            return {
                "holder_id": holding.user_id,
                "holder_name": holder.full_name,
                "holding_type": "assignment",
                "record_id": holding.id,
                "held_since": holding.assigned_date,
                "expected_return_date": holding.expected_return_date,
            }
        checkout_result = await self.db.execute(
            select(CheckOutRecord, User)
            .join(User, User.id == CheckOutRecord.user_id)
            .where(CheckOutRecord.organization_id == str(organization_id))
            .where(CheckOutRecord.item_id == str(item.id))
            .where(CheckOutRecord.is_returned.is_(False))
            .order_by(CheckOutRecord.checked_out_at.desc())
            .limit(1)
        )
        row = checkout_result.first()
        if row:
            holding, holder = row
            return {
                "holder_id": holding.user_id,
                "holder_name": holder.full_name,
                "holding_type": "checkout",
                "record_id": holding.id,
                "held_since": holding.checked_out_at,
                "expected_return_date": holding.expected_return_at,
            }
        return None

    async def transfer_item_holding(
        self,
        *,
        item_id: UUID,
        new_holder_id: UUID,
        current_holder_id: UUID,
        current_record_id: UUID,
        holding_type: str,
        return_condition: ItemCondition,
        transfer_reason: str,
        immediate: bool,
        organization_id: UUID,
        performed_by: UUID,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """Atomically close one custody record and open its successor."""
        try:
            item = await self._get_item_locked(item_id, organization_id)
            if not item or item.tracking_type != TrackingType.INDIVIDUAL:
                return None, "Individual item not found"
            if not await is_in_org(self.db, User, new_holder_id, organization_id):
                return None, "New holder not found"
            if str(new_holder_id) == str(current_holder_id):
                return None, "New holder must be different from current holder"

            now = datetime.now(timezone.utc)
            if holding_type == "assignment":
                result = await self.db.execute(
                    select(ItemAssignment)
                    .where(
                        ItemAssignment.id == str(current_record_id),
                        ItemAssignment.organization_id == str(organization_id),
                        ItemAssignment.item_id == str(item_id),
                        ItemAssignment.user_id == str(current_holder_id),
                        ItemAssignment.is_active.is_(True),
                    )
                    .with_for_update()
                )
                old = result.scalar_one_or_none()
                if not old:
                    return None, "Holding changed; rescan the item"
                old.is_active = False
                old.returned_date = now
                old.returned_by = str(performed_by)
                old.return_condition = return_condition
                old.return_notes = transfer_reason
                new = ItemAssignment(
                    organization_id=str(organization_id),
                    item_id=str(item_id),
                    user_id=str(new_holder_id),
                    assigned_by=str(performed_by),
                    assignment_type=old.assignment_type,
                    assignment_reason=transfer_reason,
                    expected_return_date=old.expected_return_date,
                    is_active=True,
                )
                item.status = ItemStatus.ASSIGNED
            else:
                result = await self.db.execute(
                    select(CheckOutRecord)
                    .where(
                        CheckOutRecord.id == str(current_record_id),
                        CheckOutRecord.organization_id == str(organization_id),
                        CheckOutRecord.item_id == str(item_id),
                        CheckOutRecord.user_id == str(current_holder_id),
                        CheckOutRecord.is_returned.is_(False),
                    )
                    .with_for_update()
                )
                old = result.scalar_one_or_none()
                if not old:
                    return None, "Holding changed; rescan the item"
                old.is_returned = True
                old.checked_in_at = now
                old.checked_in_by = str(performed_by)
                old.return_condition = return_condition
                old.damage_notes = transfer_reason
                new = CheckOutRecord(
                    organization_id=str(organization_id),
                    item_id=str(item_id),
                    user_id=str(new_holder_id),
                    checked_out_by=str(performed_by),
                    expected_return_at=old.expected_return_at,
                    checkout_reason=transfer_reason,
                    checkout_condition=return_condition,
                    is_returned=False,
                )
                item.status = ItemStatus.CHECKED_OUT
            self.db.add(new)
            item.assigned_to_user_id = (
                str(new_holder_id) if holding_type == "assignment" else None
            )
            item.assigned_date = now if holding_type == "assignment" else None
            await self.db.flush()
            await log_audit_event(
                db=self.db,
                event_type="inventory_item_transferred",
                event_category="inventory",
                severity="warning",
                event_data={
                    "item_id": str(item_id),
                    "old_record_id": old.id,
                    "new_record_id": new.id,
                    "old_holder_id": str(current_holder_id),
                    "new_holder_id": str(new_holder_id),
                    "holding_type": holding_type,
                    "return_condition": return_condition.value,
                    "reason": transfer_reason,
                    "immediate": immediate,
                },
                user_id=str(performed_by),
                organization_id=str(organization_id),
            )
            await self.db.commit()
            return {
                "item_id": str(item_id),
                "old_record_id": old.id,
                "new_record_id": new.id,
                "old_holder_id": str(current_holder_id),
                "new_holder_id": str(new_holder_id),
                "holding_type": holding_type,
            }, None
        except Exception as exc:
            await self.db.rollback()
            return None, str(exc)

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
                        CheckOutRecord.is_returned.is_(False),
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
                            ItemIssuance.is_returned.is_(False),
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
                "Label generation: {} of {} items not found or inaccessible: {}",
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
                if not item.barcode or not sanitize_barcode_value(item.barcode):
                    item.barcode = await self._next_sequential_barcode(
                        item.organization_id
                    )
                    auto_populated += 1
            if auto_populated > 0:
                await self.db.commit()

        def printable_value(item) -> str:
            """Resolve the first non-empty Code128-compatible identifier."""
            candidates = (item.barcode, item.asset_tag, item.serial_number)
            for candidate in candidates:
                if candidate:
                    value = sanitize_barcode_value(str(candidate))
                    if value:
                        return value
            raise ValueError(f"Item {item.id} has no printable barcode identifier")

        specs = [
            LabelSpec(
                name=item.name,
                barcode_value=printable_value(item),
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

            # INV-4 (XC-1): a client-supplied clearance must be in the caller's
            # org. clearance_item_id has no DB FK (a plain id column), so it can't
            # be validated by model here — it is bounded by the clearance's org.
            await assert_in_org(
                self.db,
                DepartureClearance,
                clearance_id,
                organization_id,
                allow_none=True,
                label="clearance",
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

            detail = await self._write_off_item_detail(wo, organization_id)
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
                    **detail,
                }
            )
        return requests

    async def _write_off_item_detail(
        self, wo: WriteOffRequest, organization_id: str
    ) -> Dict[str, Any]:
        """Return the live, safety-critical facts shown by the review dialog."""
        if not wo.item_id:
            return {}
        item = (
            await self.db.execute(
                select(InventoryItem).where(
                    InventoryItem.id == wo.item_id,
                    InventoryItem.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if not item:
            return {"current_status": "deleted", "holder_signature": "deleted"}

        assignments = (
            (
                await self.db.execute(
                    select(ItemAssignment)
                    .where(
                        ItemAssignment.item_id == item.id,
                        ItemAssignment.is_active.is_(True),
                    )
                    .options(selectinload(ItemAssignment.user))
                )
            )
            .scalars()
            .all()
        )
        checkouts = (
            (
                await self.db.execute(
                    select(CheckOutRecord)
                    .where(
                        CheckOutRecord.item_id == item.id,
                        CheckOutRecord.is_returned.is_(False),
                    )
                    .options(selectinload(CheckOutRecord.user))
                )
            )
            .scalars()
            .all()
        )
        issuances = (
            (
                await self.db.execute(
                    select(ItemIssuance)
                    .where(
                        ItemIssuance.item_id == item.id,
                        ItemIssuance.is_returned.is_(False),
                    )
                    .options(selectinload(ItemIssuance.user))
                )
            )
            .scalars()
            .all()
        )
        holders = [r.user for r in [*assignments, *checkouts, *issuances] if r.user]
        if item.assigned_to_user_id and not holders:
            holder = (
                await self.db.execute(
                    select(User).where(User.id == item.assigned_to_user_id)
                )
            ).scalar_one_or_none()
            if holder:
                holders.append(holder)
        holder_names = sorted(
            {self._format_user_name(user) or user.username for user in holders}
        )
        signature = ":".join(
            [
                # assigned_to_user_id is a String column, but an assignment made
                # earlier in the same session still holds the UUID object the
                # caller passed, so join() would raise on it.
                str(item.assigned_to_user_id) if item.assigned_to_user_id else "none",
                *(sorted(str(r.id) for r in assignments)),
                *(sorted(str(r.id) for r in checkouts)),
                *(sorted(str(r.id) for r in issuances)),
            ]
        )
        maintenance = (
            await self.db.execute(
                select(MaintenanceRecord)
                .where(
                    MaintenanceRecord.item_id == item.id,
                    MaintenanceRecord.is_completed.is_(False),
                )
                .order_by(MaintenanceRecord.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        charged = next(
            (
                r
                for r in issuances
                if getattr(r.charge_status, "value", r.charge_status) != "none"
            ),
            None,
        )
        org = (
            await self.db.execute(
                select(Organization).where(Organization.id == organization_id)
            )
        ).scalar_one()
        inventory_settings = (org.settings or {}).get("inventory", {})
        threshold = float(
            inventory_settings.get(
                "write_off_acknowledgement_threshold",
                (org.settings or {}).get("write_off_acknowledgement_threshold", 1000),
            )
        )
        replacement_value = (
            item.replacement_cost or item.current_value or item.purchase_price
        )
        replacement_float = (
            float(replacement_value) if replacement_value is not None else None
        )
        held = bool(assignments or checkouts or issuances or item.assigned_to_user_id)
        return {
            "current_holder": ", ".join(holder_names) if holder_names else None,
            "current_status": item.status.value,
            "replacement_value": replacement_float,
            "clearance_record": (
                f"Clearance {wo.clearance_id}" if wo.clearance_id else None
            ),
            "linked_charge_record": (
                f"Issuance {charged.id} ({charged.charge_status.value})"
                if charged
                else None
            ),
            "open_maintenance_record": (
                f"{maintenance.maintenance_type.value} — {maintenance.description or 'No description'}"
                if maintenance
                else None
            ),
            "active_assignment_count": len(assignments),
            "active_checkout_count": len(checkouts),
            "active_issuance_count": len(issuances),
            "acknowledgement_required": held
            or (replacement_float is not None and replacement_float > threshold),
            "acknowledgement_threshold": threshold,
            "holder_signature": signature,
        }

    async def review_write_off(
        self,
        write_off_id: str,
        organization_id: str,
        reviewed_by: str,
        decision: str,
        review_notes: Optional[str] = None,
        acknowledgement: bool = False,
        expected_item_status: Optional[str] = None,
        expected_holder_signature: Optional[str] = None,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """Approve or deny a write-off request. On approval, retire the item."""
        try:
            if decision not in ("approved", "denied"):
                return None, "Decision must be 'approved' or 'denied'"
            if not review_notes or not review_notes.strip():
                return None, "A review note is required"

            result = await self.db.execute(
                select(WriteOffRequest)
                .where(
                    WriteOffRequest.id == write_off_id,
                    WriteOffRequest.organization_id == organization_id,
                )
                .with_for_update()
            )
            wo = result.scalar_one_or_none()
            if not wo:
                return None, "Write-off request not found"

            if wo.status != WriteOffStatus.PENDING:
                return None, f"Request already {wo.status.value}"

            if decision == "approved":
                # Serialize approval with item mutations; the client snapshot below
                # then acts as an optimistic precondition rather than stale UI data.
                if wo.item_id:
                    await self.db.execute(
                        select(InventoryItem)
                        .where(
                            InventoryItem.id == wo.item_id,
                            InventoryItem.organization_id == organization_id,
                        )
                        .with_for_update()
                    )
                live = await self._write_off_item_detail(wo, organization_id)
                if expected_item_status != live.get(
                    "current_status"
                ) or expected_holder_signature != live.get("holder_signature"):
                    return (
                        None,
                        "Item status or holder changed; refresh and review again",
                    )
                if live.get("acknowledgement_required") and not acknowledgement:
                    return (
                        None,
                        "Acknowledgement is required for a held or high-value item",
                    )

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
                        "is_overdue": self.checkout_is_overdue(c),
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
                    "summary": f"Issued {i.quantity_issued} to {user_name}",
                    "details": {
                        "user_name": user_name,
                        "quantity": i.quantity_issued,
                        "reason": i.issue_reason,
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
                        "summary": f"{user_name} returned {i.quantity_issued}",
                        "details": {
                            "user_name": user_name,
                            "quantity": i.quantity_issued,
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
        now = datetime.now(timezone.utc)
        period_start = None
        if allowance.period_type == "annual":
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

        # INV-4 (XC-1): the category/location/storage applied to every generated
        # item must belong to the caller's org (each is optional).
        await assert_in_org(
            self.db,
            InventoryCategory,
            kwargs.get("category_id"),
            organization_id,
            allow_none=True,
            label="category",
        )
        await assert_in_org(
            self.db,
            Location,
            kwargs.get("location_id"),
            organization_id,
            allow_none=True,
            label="location",
        )
        await assert_in_org(
            self.db,
            StorageArea,
            kwargs.get("storage_area_id"),
            organization_id,
            allow_none=True,
            label="storage area",
        )

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
            # Sizes arrive as the stored codes ("l", "xxl", "one_size") because
            # that is what the size picker submits. Styles were already being
            # humanised here; sizes were not, so a coat came out named
            # "Structural Coat — l" everywhere the item name is shown.
            name_parts = [base_name, _size_label(size)]
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

        # Bound client-supplied holding identifiers to this tenant before any
        # ownership lookup (and before reporting whether a holding is active).
        for model, value, label in (
            (ItemAssignment, assignment_id, "assignment"),
            (ItemIssuance, issuance_id, "issuance"),
            (CheckOutRecord, checkout_id, "checkout"),
        ):
            await assert_in_org(
                self.db, model, value, organization_id, allow_none=True, label=label
            )

        # Only a member who still physically holds this specific record may
        # notify the quartermaster.  Do not trust an item id by itself.
        holding = None
        if return_type == "assignment" and assignment_id:
            holding = (
                await self.db.execute(
                    select(ItemAssignment).where(
                        ItemAssignment.id == str(assignment_id),
                        ItemAssignment.item_id == str(item_id),
                        ItemAssignment.user_id == str(requester_id),
                        ItemAssignment.is_active.is_(True),
                    )
                )
            ).scalar_one_or_none()
        elif return_type == "issuance" and issuance_id:
            holding = (
                await self.db.execute(
                    select(ItemIssuance).where(
                        ItemIssuance.id == str(issuance_id),
                        ItemIssuance.item_id == str(item_id),
                        ItemIssuance.user_id == str(requester_id),
                        ItemIssuance.is_returned.is_(False),
                    )
                )
            ).scalar_one_or_none()
            if holding and quantity_returning > holding.quantity_issued:
                return (
                    None,
                    f"Cannot return {quantity_returning}; only {holding.quantity_issued} remain issued",
                )
        elif return_type == "checkout" and checkout_id:
            holding = (
                await self.db.execute(
                    select(CheckOutRecord).where(
                        CheckOutRecord.id == str(checkout_id),
                        CheckOutRecord.item_id == str(item_id),
                        CheckOutRecord.user_id == str(requester_id),
                        CheckOutRecord.is_returned.is_(False),
                    )
                )
            ).scalar_one_or_none()
        if not holding:
            return None, "No matching active holding was found for this member"

        # Check for duplicate requested return requests
        dupe_query = (
            select(ReturnRequest)
            .where(ReturnRequest.organization_id == str(organization_id))
            .where(ReturnRequest.requester_id == str(requester_id))
            .where(ReturnRequest.item_id == str(item_id))
            .where(ReturnRequest.status == ReturnRequestStatus.REQUESTED)
        )
        dupe_result = await self.db.execute(dupe_query)
        if dupe_result.scalar_one_or_none():
            return None, "You already notified the quartermaster about this item"

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
            status=ReturnRequestStatus.REQUESTED,
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
        observed_condition: Optional[str] = None,
        verified_identifier: Optional[str] = None,
        received_quantity: Optional[int] = None,
        follow_up: str = "auto",
    ) -> Tuple[bool, Optional[str]]:
        """
        Deny a request or receive the item in one atomic transaction.

        A receipt is only accepted with an independent condition observation and,
        for serialized gear, a matching barcode/asset/serial identifier.  The hold,
        inventory state, inspection result, and follow-up are committed together.
        """
        # Lock the request row itself: without this, a denial and a physical
        # receipt racing on the same REQUESTED request can both pass this
        # status check before either commits, so one review silently
        # overwrites the other's outcome (Pitfall #27).
        result = await self.db.execute(
            select(ReturnRequest)
            .where(ReturnRequest.id == str(request_id))
            .where(ReturnRequest.organization_id == str(organization_id))
            .with_for_update()
        )
        req = result.scalar_one_or_none()
        if not req:
            return False, "Return request not found"

        if req.status != ReturnRequestStatus.REQUESTED:
            return False, f"Request is already {req.status.value}"

        req.reviewed_by = str(reviewer_id)
        req.reviewed_at = datetime.now(timezone.utc)
        req.review_notes = review_notes

        if status == "denied":
            req.status = ReturnRequestStatus.DENIED
            await self.db.commit()
            return True, None

        if not observed_condition:
            return False, "Observed condition is required during physical receipt"
        condition = ItemCondition(observed_condition)
        now = datetime.now(timezone.utc)
        item = await self._get_item_locked(UUID(str(req.item_id)), organization_id)
        if not item:
            return False, "Item not found"

        if item.tracking_type == TrackingType.INDIVIDUAL:
            entered = (verified_identifier or "").strip()
            valid = {
                str(v).strip()
                for v in (item.barcode, item.asset_tag, item.serial_number)
                if v
            }
            if not entered:
                return (
                    False,
                    "Barcode or asset verification is required for serialized items",
                )
            if entered not in valid:
                return (
                    False,
                    "Scanned barcode or asset identifier does not match this item",
                )
            qty = 1
        else:
            qty = received_quantity
            if qty is None:
                return False, "Received quantity is required for pool items"
            if qty != req.quantity_returning:
                return False, "Received quantity must match the quantity being returned"

        req.status = ReturnRequestStatus.RECEIVED
        req.observed_condition = condition
        req.verified_identifier = verified_identifier
        req.received_quantity = qty
        note = f"Return request #{req.id[:8]} — {review_notes or ''}".strip()

        try:
            if req.return_type == ReturnRequestType.ASSIGNMENT:
                assignment = (
                    await self.db.execute(
                        select(ItemAssignment)
                        .where(
                            ItemAssignment.id == str(req.assignment_id),
                            ItemAssignment.organization_id == str(organization_id),
                            ItemAssignment.user_id == str(req.requester_id),
                            ItemAssignment.is_active.is_(True),
                        )
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if not assignment:
                    raise ValueError("Active assignment not found")
                assignment.is_active = False
                assignment.returned_date, assignment.returned_by = now, str(reviewer_id)
                assignment.return_condition, assignment.return_notes = condition, note
                item.assigned_to_user_id, item.assigned_date = None, None
            elif req.return_type == ReturnRequestType.CHECKOUT:
                checkout = (
                    await self.db.execute(
                        select(CheckOutRecord)
                        .where(
                            CheckOutRecord.id == str(req.checkout_id),
                            CheckOutRecord.organization_id == str(organization_id),
                            CheckOutRecord.user_id == str(req.requester_id),
                            CheckOutRecord.is_returned.is_(False),
                        )
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if not checkout:
                    raise ValueError("Active checkout not found")
                checkout.is_returned, checkout.is_overdue = True, False
                checkout.checked_in_at, checkout.checked_in_by = now, str(reviewer_id)
                checkout.return_condition, checkout.damage_notes = condition, note
            else:
                issuance = (
                    await self.db.execute(
                        select(ItemIssuance)
                        .where(
                            ItemIssuance.id == str(req.issuance_id),
                            ItemIssuance.organization_id == str(organization_id),
                            ItemIssuance.user_id == str(req.requester_id),
                            ItemIssuance.is_returned.is_(False),
                        )
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if not issuance:
                    raise ValueError("Active issuance not found")
                if qty > issuance.quantity_issued:
                    raise ValueError(
                        f"Cannot receive {qty}; only {issuance.quantity_issued} remain issued"
                    )
                item.quantity = (item.quantity or 0) + qty
                item.quantity_issued = max(0, (item.quantity_issued or 0) - qty)
                if qty == issuance.quantity_issued:
                    issuance.is_returned = True
                    issuance.returned_at, issuance.returned_by = now, str(reviewer_id)
                    issuance.return_condition, issuance.return_notes = condition, note
                else:
                    issuance.quantity_issued -= qty
                    issuance.return_notes = (
                        (issuance.return_notes or "")
                        + f"\nPartial return: {qty} — {note}"
                    ).strip()

            req.status = ReturnRequestStatus.INSPECTED
            item.condition = condition
            unsafe = condition in {
                ItemCondition.POOR,
                ItemCondition.DAMAGED,
                ItemCondition.OUT_OF_SERVICE,
            }
            item.status = ItemStatus.IN_MAINTENANCE if unsafe else ItemStatus.AVAILABLE

            chosen = follow_up
            if chosen == "auto":
                chosen = (
                    "write_off"
                    if condition == ItemCondition.OUT_OF_SERVICE
                    else ("maintenance" if unsafe else "none")
                )
            if unsafe and chosen == "none":
                raise ValueError(
                    "Damaged, poor, or out-of-service gear requires a follow-up"
                )
            follow = None
            if chosen == "maintenance":
                follow = MaintenanceRecord(
                    organization_id=str(organization_id),
                    item_id=str(item.id),
                    maintenance_type=MaintenanceType.REPAIR,
                    scheduled_date=now.date(),
                    condition_before=condition,
                    description=note,
                    notes=f"Member reported {req.reported_condition.value}; quartermaster observed {condition.value}",
                    is_completed=False,
                    created_by=str(reviewer_id),
                )
            elif chosen == "write_off":
                follow = WriteOffRequest(
                    organization_id=str(organization_id),
                    item_id=str(item.id),
                    item_name=item.name,
                    item_serial_number=item.serial_number,
                    item_asset_tag=item.asset_tag,
                    item_value=item.purchase_price,
                    reason=WriteOffReason.DAMAGED_BEYOND_REPAIR,
                    description=note,
                    status=WriteOffStatus.PENDING,
                    requested_by=str(reviewer_id),
                )
            elif chosen == "charge_review":
                if req.return_type != ReturnRequestType.ISSUANCE:
                    raise ValueError(
                        "Charge review is only available for pool issuances"
                    )
                issuance.charge_status = "pending"
            if follow:
                self.db.add(follow)
                await self.db.flush()
                req.follow_up_id = follow.id
            req.follow_up_type = None if chosen == "none" else chosen
            req.status = ReturnRequestStatus.COMPLETED
            await self.db.commit()
            return True, None
        except (ValueError, SQLAlchemyError) as exc:
            await self.db.rollback()
            return False, str(exc)

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

    async def _in_date_lot_totals(
        self, organization_id: str, item_ids: List[str]
    ) -> Dict[str, int]:
        """Ready units per item, counting only lots that have not expired.

        One row per item that has *any* lot at all, so membership in the result
        is what marks an item as lot-stocked. That distinction carries the
        weight: an item whose lots have all expired must read as zero ready
        units, not fall back to an ``InventoryItem.quantity`` column that lot
        bookkeeping never touches.

        Expired lots are excluded because the equipment-check swap refuses
        them — they are not stock anyone can put on a truck, and counting them
        would paper over the shortage.
        """
        if not item_ids:
            return {}
        today = date.today()
        result = await self.db.execute(
            select(
                InventoryLot.inventory_item_id,
                func.coalesce(
                    func.sum(
                        case(
                            (
                                or_(
                                    InventoryLot.expiration_date.is_(None),
                                    InventoryLot.expiration_date >= today,
                                ),
                                InventoryLot.quantity,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
            )
            .where(
                InventoryLot.organization_id == organization_id,
                InventoryLot.inventory_item_id.in_(item_ids),
            )
            .group_by(InventoryLot.inventory_item_id)
        )
        return {item_id: int(total) for item_id, total in result.all()}

    async def get_low_stock_items_for_alerts(
        self,
        organization_id: UUID,
    ) -> List[Tuple[InventoryItem, int, bool]]:
        """Items at or below their reorder point, as (item, on_hand, from_lots).

        On-hand is read from stock lots for any item that has them, and from
        ``InventoryItem.quantity`` for the rest. The two are separate ledgers —
        adding a lot does not touch ``quantity`` — so a consumable stocked
        purely through lots (which is what the supply-officer screens create)
        could sit at zero ready units without ever tripping this alert, and one
        whose ``quantity`` was never maintained could trip it every day.

        Lots past their expiration do not count toward on-hand: the swap
        refuses them, so they are not stock anyone can use, and counting them
        would hide exactly the shortage that most needs ordering.

        ``from_lots`` tells the caller which ledger the number came from, so an
        alert can say so rather than appear to contradict the item's own
        quantity field.
        """
        result = await self.db.execute(
            select(InventoryItem)
            .where(InventoryItem.organization_id == str(organization_id))
            .where(InventoryItem.active.is_(True))
            .where(InventoryItem.reorder_point.isnot(None))
            .options(selectinload(InventoryItem.category))
        )
        candidates = list(result.scalars().all())
        if not candidates:
            return []

        lot_totals = await self._in_date_lot_totals(
            str(organization_id), [i.id for i in candidates]
        )

        low: List[Tuple[InventoryItem, int, bool]] = []
        for item in candidates:
            from_lots = item.id in lot_totals
            on_hand = lot_totals[item.id] if from_lots else (item.quantity or 0)
            if on_hand <= (item.reorder_point or 0):
                low.append((item, on_hand, from_lots))

        low.sort(key=lambda row: row[1])
        return low

    # ------------------------------------------------------------------
    # Stock Lots (ready replacement stock with lot # + expiration)
    # ------------------------------------------------------------------

    async def _get_item(
        self, item_id: str, organization_id: str
    ) -> Optional[InventoryItem]:
        """Fetch an item scoped to the organization."""
        return await self.db.scalar(
            select(InventoryItem).where(
                InventoryItem.id == item_id,
                InventoryItem.organization_id == organization_id,
            )
        )

    async def category_in_domain(
        self,
        category_id: Optional[str],
        organization_id: str,
        item_types: Iterable[ItemType],
    ) -> bool:
        """Is this category one of ``item_types``, in this organization?

        Fails closed: an unresolvable or uncategorized id is not in the
        domain. A medical-only officer reaching for a uniform category must be
        refused, and so must one reaching for a category that does not exist.
        """
        if not category_id:
            return False
        found = await self.db.scalar(
            select(InventoryCategory.id).where(
                InventoryCategory.id == str(category_id),
                InventoryCategory.organization_id == organization_id,
                InventoryCategory.item_type.in_(list(item_types)),
            )
        )
        return found is not None

    async def item_in_domain(
        self,
        item_id: str,
        organization_id: str,
        item_types: Iterable[ItemType],
    ) -> bool:
        """Is this item filed under a category in ``item_types``?"""
        found = await self.db.scalar(
            select(InventoryItem.id)
            .join(
                InventoryCategory,
                InventoryCategory.id == InventoryItem.category_id,
            )
            .where(
                InventoryItem.id == str(item_id),
                InventoryItem.organization_id == organization_id,
                InventoryCategory.organization_id == organization_id,
                InventoryCategory.item_type.in_(list(item_types)),
            )
        )
        return found is not None

    async def lot_in_domain(
        self,
        lot_id: str,
        organization_id: str,
        item_types: Iterable[ItemType],
    ) -> bool:
        """Is this stock lot attached to an item in ``item_types``?"""
        lot = await self._get_lot(lot_id, organization_id)
        if not lot:
            return False
        return await self.item_in_domain(
            lot.inventory_item_id, organization_id, item_types
        )

    async def _get_lot(
        self, lot_id: str, organization_id: str
    ) -> Optional[InventoryLot]:
        """Fetch a lot scoped to the organization."""
        return await self.db.scalar(
            select(InventoryLot).where(
                InventoryLot.id == lot_id,
                InventoryLot.organization_id == organization_id,
            )
        )

    async def list_lots(self, item_id: str, organization_id: str) -> List[InventoryLot]:
        """List all stock lots for an item, soonest-to-expire first."""
        result = await self.db.execute(
            select(InventoryLot)
            .where(
                InventoryLot.inventory_item_id == item_id,
                InventoryLot.organization_id == organization_id,
            )
            .order_by(
                InventoryLot.expiration_date.is_(None),
                InventoryLot.expiration_date.asc(),
            )
        )
        return list(result.scalars().all())

    async def add_lot(
        self,
        item_id: str,
        organization_id: str,
        data: Dict[str, Any],
        created_by: Optional[str] = None,
    ) -> Optional[InventoryLot]:
        """Add a ready-stock lot to an item."""
        item = await self._get_item(item_id, organization_id)
        if not item:
            return None

        lot = InventoryLot(
            organization_id=organization_id,
            inventory_item_id=item_id,
            created_by=created_by,
            **data,
        )
        self.db.add(lot)
        await self.db.commit()
        await self.db.refresh(lot)
        return lot

    async def add_lots_bulk(
        self,
        organization_id: str,
        entries: List[Dict[str, Any]],
        created_by: Optional[str] = None,
    ) -> List[InventoryLot]:
        """Record a whole delivery at once — one lot per item line.

        Pre-stocking is how dated stock reaches the crews: a lot added here is
        immediately offered in the check screen's swap picker, so a member
        pulling an expired or used unit has a replacement to select. Entering a
        shipment one item-detail page at a time was the friction that kept that
        stock from existing.

        All or nothing. A partially-applied delivery is worse than a rejected
        one: the officer has no way to tell which lines landed, and re-entering
        the shipment would double-count whatever did.
        """
        if not entries:
            return []

        # XC-1: every inventory_item_id here is client-supplied. Resolve them
        # in one org-scoped query rather than trusting the ids — an unchecked
        # one would file a lot against another department's item.
        item_ids = {str(e["inventory_item_id"]) for e in entries}
        result = await self.db.execute(
            select(InventoryItem.id).where(
                InventoryItem.id.in_(item_ids),
                InventoryItem.organization_id == organization_id,
            )
        )
        known = {row for row in result.scalars().all()}
        missing = item_ids - known
        if missing:
            raise ValueError(
                f"{len(missing)} item(s) in this delivery are not in your "
                f"inventory and were not received"
            )

        lots: List[InventoryLot] = []
        for entry in entries:
            data = {k: v for k, v in entry.items() if k != "inventory_item_id"}
            lot = InventoryLot(
                organization_id=organization_id,
                inventory_item_id=str(entry["inventory_item_id"]),
                created_by=created_by,
                **data,
            )
            self.db.add(lot)
            lots.append(lot)

        await self.db.commit()
        for lot in lots:
            await self.db.refresh(lot)
        return lots

    async def create_items_bulk(
        self,
        organization_id,
        entries: List[Dict[str, Any]],
        created_by,
    ) -> Tuple[List[InventoryItem], List[str]]:
        """Create many catalog items at once, skipping names already on file.

        Stocking a catalog is a list-shaped job — a department types up its
        consumables once, thirty lines at a time — and the one-item-per-modal
        form is what leaves that catalog half-built. A half-built catalog is
        what leaves checklist positions unlinked, which is what leaves
        expirations untracked.

        Returns ``(created, skipped_names)``. A name that already exists is
        skipped rather than rejected: re-pasting a list after adding two lines
        to it is the normal way this gets used, and failing the whole batch for
        the twenty-eight that already landed would punish exactly that.

        All or nothing on *errors*, though — a validation failure writes
        nothing, because a partially-applied paste gives the officer no way to
        tell where the list stopped.
        """
        if not entries:
            return [], []

        existing = await self.db.execute(
            select(InventoryItem.name).where(
                InventoryItem.organization_id == organization_id
            )
        )
        seen = {normalize_name(n) for n in existing.scalars().all() if n}

        items: List[InventoryItem] = []
        skipped: List[str] = []

        for entry in entries:
            data = dict(entry)
            name = (data.get("name") or "").strip()
            if not name:
                raise ValueError("Every item needs a name")

            key = normalize_name(name)
            # Guards against duplicates already on file *and* repeats within
            # this paste, which is where a copied spreadsheet column usually
            # goes wrong.
            if key in seen:
                skipped.append(name)
                continue
            seen.add(key)

            data["name"] = name
            cat_err = await self._validate_category_requirements(data, organization_id)
            if cat_err:
                raise ValueError(f"{name}: {cat_err}")

            # INV-4 (XC-1): category/location/storage ids arrive from the
            # client on every row of the paste, not just the first.
            await self._assert_item_fks_in_org(data, organization_id)

            if data.get("tracking_type") == "pool" and data.get("quantity", 1) < 1:
                raise ValueError(
                    f"{name}: pool items must have a quantity of 1 or more"
                )

            if not data.get("barcode"):
                data["barcode"] = await self._next_sequential_barcode(organization_id)

            item = InventoryItem(
                organization_id=organization_id, created_by=created_by, **data
            )
            self.db.add(item)
            items.append(item)

        await self.db.commit()
        for item in items:
            await self.db.refresh(item)
        return items, skipped

    async def update_lot(
        self,
        lot_id: str,
        organization_id: str,
        data: Dict[str, Any],
    ) -> Optional[InventoryLot]:
        """Update a stock lot.

        Raises ``ValueError`` if `data` sends an explicit null against a
        NOT NULL column (`quantity`) — callers already catch `ValueError`
        from the sibling `add_lots_bulk` on this same router and convert it
        to a 400.
        """
        lot = await self._get_lot(lot_id, organization_id)
        if not lot:
            return None
        apply_updates(lot, data, skip={"id", "organization_id", "inventory_item_id"})
        await self.db.commit()
        await self.db.refresh(lot)
        return lot

    async def delete_lot(self, lot_id: str, organization_id: str) -> bool:
        """Delete a stock lot."""
        lot = await self._get_lot(lot_id, organization_id)
        if not lot:
            return False
        await self.db.delete(lot)
        await self.db.commit()
        return True

    async def get_lots_for_items(
        self, organization_id: str, item_ids: List[str]
    ) -> Dict[str, List[InventoryLot]]:
        """Map each item id to its in-stock lots (quantity > 0)."""
        if not item_ids:
            return {}
        result = await self.db.execute(
            select(InventoryLot)
            .where(
                InventoryLot.organization_id == organization_id,
                InventoryLot.inventory_item_id.in_(item_ids),
                InventoryLot.quantity > 0,
            )
            .order_by(
                InventoryLot.expiration_date.is_(None),
                InventoryLot.expiration_date.asc(),
            )
        )
        by_item: Dict[str, List[InventoryLot]] = {}
        for lot in result.scalars().all():
            by_item.setdefault(lot.inventory_item_id, []).append(lot)
        return by_item

    async def get_expiring_lots(
        self,
        organization_id: str,
        days_ahead: int = 30,
        item_types: Optional[Iterable[ItemType]] = None,
    ) -> List[Tuple[InventoryLot, str]]:
        """Get in-stock lots expiring within N days, with the item name.

        ``item_types`` narrows the result to one domain so the medical-supply
        page reports its own expiring stock and not the whole department's.
        """
        cutoff = date.today() + timedelta(days=days_ahead)
        query = (
            select(InventoryLot, InventoryItem.name)
            .join(InventoryItem, InventoryItem.id == InventoryLot.inventory_item_id)
            .where(
                InventoryLot.organization_id == organization_id,
                InventoryLot.quantity > 0,
                InventoryLot.expiration_date.isnot(None),
                InventoryLot.expiration_date <= cutoff,
            )
        )
        if item_types:
            query = query.where(
                InventoryItem.category_id.in_(
                    self._category_ids_of_type(organization_id, set(item_types))
                )
            )
        result = await self.db.execute(
            query.order_by(InventoryLot.expiration_date.asc())
        )
        return [(row[0], row[1]) for row in result.all()]

    async def get_overdue_checkouts_for_alerts(
        self,
        organization_id: UUID,
    ) -> List[CheckOutRecord]:
        """Get overdue checkouts for email alerts."""
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            select(CheckOutRecord)
            .where(CheckOutRecord.organization_id == str(organization_id))
            .where(CheckOutRecord.is_returned.is_(False))
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
            .where(NFPAItemCompliance.is_retired_by_age.is_(False))
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
            # INV-5: escape LIKE wildcards, matching the other search methods —
            # otherwise a literal % or _ in the box is treated as a wildcard.
            q = q.where(
                ReorderRequest.item_name.ilike(
                    like_pattern(search), escape=LIKE_ESCAPE_CHAR
                )
            )
        q = q.options(
            selectinload(ReorderRequest.requester),
            selectinload(ReorderRequest.approver),
            selectinload(ReorderRequest.vendor_record),
        )
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def get_reorder_request(
        self,
        request_id: UUID,
        organization_id: UUID,
        refresh_loaded: bool = False,
    ) -> Optional[ReorderRequest]:
        """Get a single reorder request.

        ``refresh_loaded`` re-reads relationships the session already holds.
        A second query returns the same identity-mapped instance and leaves
        loaded relationships alone, so after an update changes ``vendor_id``
        the row would otherwise be serialized with the *previous* vendor's
        name still attached.
        """
        query = (
            select(ReorderRequest)
            .where(ReorderRequest.id == str(request_id))
            .where(ReorderRequest.organization_id == str(organization_id))
            .options(
                selectinload(ReorderRequest.requester),
                selectinload(ReorderRequest.approver),
                selectinload(ReorderRequest.vendor_record),
            )
        )
        if refresh_loaded:
            query = query.execution_options(populate_existing=True)
        result = await self.db.execute(query)
        return result.scalars().first()

    async def _assert_reorder_fks_in_org(
        self, data: Dict[str, Any], organization_id: UUID
    ) -> None:
        # INV-4 (XC-1): a reorder can name a specific item and/or category; each
        # is optional and must belong to the caller's org. Only keys present are
        # checked, so a partial update leaves the others untouched.
        if "item_id" in data:
            await assert_in_org(
                self.db,
                InventoryItem,
                data.get("item_id"),
                organization_id,
                allow_none=True,
                label="item",
            )
        if "category_id" in data:
            await assert_in_org(
                self.db,
                InventoryCategory,
                data.get("category_id"),
                organization_id,
                allow_none=True,
                label="category",
            )
        if "vendor_id" in data:
            await assert_in_org(
                self.db,
                InventoryVendor,
                data.get("vendor_id"),
                organization_id,
                allow_none=True,
                label="vendor",
            )

    async def create_reorder_request(
        self,
        organization_id: UUID,
        data: Dict[str, Any],
        requested_by: str,
    ) -> Tuple[Optional[ReorderRequest], Optional[str]]:
        """Create a new reorder request."""
        try:
            await self._assert_reorder_fks_in_org(data, organization_id)
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

            if "quantity_received" in data:
                return None, "Received quantity changes require the receiving workflow"

            await self._assert_reorder_fks_in_org(data, organization_id)

            new_status = data.get("status")
            if new_status and new_status != reorder.status.value:
                return None, "Status changes require a workflow action"

            for key, value in data.items():
                setattr(reorder, key, value)

            await self.db.flush()
            # Re-fetch rather than refresh: refresh expires the relationships
            # the response needs (requester, approver, vendor), and reloading
            # them lazily is not an option under asyncio. populate_existing so a
            # changed vendor_id does not come back beside the old vendor's name.
            reorder = await self.get_reorder_request(
                request_id, organization_id, refresh_loaded=True
            )
            return reorder, None
        except Exception as e:
            logger.error(f"Error updating reorder request: {e}")
            return None, str(e)

    async def transition_reorder_request(
        self, request_id, organization_id, data, current_user_id
    ):
        """Apply only an allowed forward/cancellation edge under a row lock."""
        row = await self.db.scalar(
            select(ReorderRequest)
            .where(
                ReorderRequest.id == str(request_id),
                ReorderRequest.organization_id == str(organization_id),
            )
            .with_for_update()
        )
        if not row:
            return None, "Reorder request not found"
        if row.version != data["expected_version"]:
            return None, "Reorder request was updated by another user; reload and retry"
        current = row.status.value
        action = data["action"]
        edges = {
            ("pending", "approve"): "approved",
            ("approved", "mark_ordered"): "ordered",
        }
        target = edges.get((current, action))
        if action == "cancel" and current in {"pending", "approved", "ordered"}:
            target = "cancelled"
        if not target:
            return None, f"Action {action} is not allowed from {current}"
        now = datetime.now(timezone.utc)
        if target == "approved":
            row.approved_by, row.approved_at = current_user_id, now
        if target == "ordered":
            if "vendor_id" in data:
                await self._assert_reorder_fks_in_org(
                    {"vendor_id": data.get("vendor_id")}, organization_id
                )
                row.vendor_id = (
                    str(data["vendor_id"]) if data.get("vendor_id") else None
                )
            if data.get("vendor"):
                row.vendor = data["vendor"].strip()
            if data.get("purchase_order_number"):
                row.purchase_order_number = data["purchase_order_number"].strip()
            org = await self.db.get(Organization, str(organization_id))
            if org.reorder_vendor_required and not (
                row.vendor_id or (row.vendor and row.vendor.strip())
            ):
                return None, "Department policy requires a vendor before ordering"
            if org.reorder_po_required and not (
                row.purchase_order_number and row.purchase_order_number.strip()
            ):
                return (
                    None,
                    "Department policy requires a purchase-order reference before ordering",
                )
            row.ordered_at = now
        row.status = ReorderStatus(target)
        row.version += 1
        await self.db.flush()
        return row, None

    async def correct_reorder_status(self, request_id, organization_id, data):
        row = await self.db.scalar(
            select(ReorderRequest)
            .where(
                ReorderRequest.id == str(request_id),
                ReorderRequest.organization_id == str(organization_id),
            )
            .with_for_update()
        )
        if not row:
            return None, "Reorder request not found"
        if row.version != data["expected_version"]:
            return None, "Reorder request was updated by another user; reload and retry"
        row.status = ReorderStatus(data["status"])
        row.version += 1
        await self.db.flush()
        return row, None

    async def receive_reorder(self, request_id, organization_id, data, current_user_id):
        """Atomically append receipt history, create stock, and advance status."""
        row = await self.db.scalar(
            select(ReorderRequest)
            .where(
                ReorderRequest.id == str(request_id),
                ReorderRequest.organization_id == str(organization_id),
            )
            .with_for_update()
        )
        if not row:
            return None, "Reorder request not found"
        prior = await self.db.scalar(
            select(ReorderReceipt).where(
                ReorderReceipt.reorder_request_id == row.id,
                ReorderReceipt.idempotency_key == data["idempotency_key"],
            )
        )
        if prior:
            return None, "This receipt has already been recorded"
        if row.version != data["expected_version"]:
            return None, "Reorder request was updated by another user; reload and retry"
        if row.status not in {ReorderStatus.ORDERED, ReorderStatus.PARTIALLY_RECEIVED}:
            return None, f"Stock cannot be received from {row.status.value}"
        if not row.item_id:
            return None, "Link an inventory item before receiving stock"
        outstanding = row.quantity_requested - row.quantity_received
        if data["quantity"] > outstanding and not data.get("confirm_over_receipt"):
            return (
                None,
                f"Quantity exceeds the outstanding quantity ({outstanding}); confirm over-receipt",
            )
        # Lock the item row before crediting on-hand stock: without this,
        # a concurrent issuance's read-modify-write of the same `quantity`
        # column can be silently overwritten by this one (Pitfall #27).
        item = await self._get_item_locked(UUID(str(row.item_id)), organization_id)
        if not item:
            return None, "Linked inventory item not found"
        lot = InventoryLot(
            organization_id=str(organization_id),
            inventory_item_id=row.item_id,
            lot_number=data.get("lot_number"),
            expiration_date=data.get("expiration_date"),
            quantity=data["quantity"],
            received_date=date.today(),
            storage_location=data["storage_location"],
            unit_cost=data["unit_cost"],
            created_by=current_user_id,
        )
        self.db.add(lot)
        await self.db.flush()
        receipt = ReorderReceipt(
            organization_id=str(organization_id),
            reorder_request_id=row.id,
            inventory_lot_id=lot.id,
            idempotency_key=data["idempotency_key"],
            quantity=data["quantity"],
            unit_cost=data["unit_cost"],
            storage_location=data["storage_location"],
            received_by=current_user_id,
        )
        self.db.add(receipt)
        item.quantity = (item.quantity or 0) + data["quantity"]
        row.quantity_received += data["quantity"]
        row.actual_unit_cost = data["unit_cost"]
        row.status = (
            ReorderStatus.RECEIVED
            if row.quantity_received >= row.quantity_requested
            else ReorderStatus.PARTIALLY_RECEIVED
        )
        row.received_at = (
            datetime.now(timezone.utc) if row.status == ReorderStatus.RECEIVED else None
        )
        row.version += 1
        await self.db.flush()
        return row, None

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
            # XC-1: category_id is client-supplied. The group itself is
            # org-stamped, so a foreign id cannot be read back directly — but it
            # persists a reference to another org's category, which then follows
            # the group's items into the detail response.
            await assert_in_org(
                self.db,
                InventoryCategory,
                data.get("category_id"),
                organization_id,
                allow_none=True,
                label="category",
            )
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
            # XC-1: the loop below is a blind setattr over client keys, so
            # category_id must be validated before it lands. The schema bounds
            # which keys can arrive (organization_id is not among them), but it
            # does not bound which *org* the category belongs to.
            if "category_id" in data:
                await assert_in_org(
                    self.db,
                    InventoryCategory,
                    data.get("category_id"),
                    organization_id,
                    allow_none=True,
                    label="category",
                )
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
                # INV-4 (XC-1): EquipmentKitItem has no organization_id (it is
                # org-scoped only through its parent kit), so validate its
                # client-supplied child FKs against the caller's org directly.
                await assert_in_org(
                    self.db,
                    InventoryItem,
                    item_data.get("item_id"),
                    organization_id,
                    allow_none=True,
                    label="item",
                )
                await assert_in_org(
                    self.db,
                    InventoryCategory,
                    item_data.get("category_id"),
                    organization_id,
                    allow_none=True,
                    label="category",
                )
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
                    optional=item_data.get("optional", False),
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
        """List equipment kits for an organization.

        Line items are eager-loaded so the caller can report how many each kit
        holds — the list card shows that count, and without them every kit read
        "0 items".
        """
        query = select(EquipmentKit).where(
            EquipmentKit.organization_id == str(organization_id)
        )
        if active_only:
            query = query.where(EquipmentKit.active.is_(True))
        query = query.order_by(EquipmentKit.name).options(
            selectinload(EquipmentKit.line_items)
        )
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
        """Update a kit's metadata and, when supplied, replace its line items."""
        try:
            kit = await self.get_equipment_kit_by_id(kit_id, organization_id)
            if not kit:
                return None, "Equipment kit not found"
            line_items_data = data.pop("line_items", None)
            for key, value in data.items():
                setattr(kit, key, value)
            if line_items_data is not None:
                replacement_items = []
                for idx, item_data in enumerate(line_items_data):
                    await assert_in_org(
                        self.db,
                        InventoryItem,
                        item_data.get("item_id"),
                        organization_id,
                        allow_none=True,
                        label="item",
                    )
                    await assert_in_org(
                        self.db,
                        InventoryCategory,
                        item_data.get("category_id"),
                        organization_id,
                        allow_none=True,
                        label="category",
                    )
                    replacement_items.append(
                        EquipmentKitItem(
                            kit_id=kit.id,
                            item_id=(
                                str(item_data["item_id"])
                                if item_data.get("item_id")
                                else None
                            ),
                            category_id=(
                                str(item_data["category_id"])
                                if item_data.get("category_id")
                                else None
                            ),
                            item_name=item_data["item_name"],
                            quantity=item_data.get("quantity", 1),
                            size_selectable=item_data.get("size_selectable", False),
                            optional=item_data.get("optional", False),
                            sort_order=idx,
                        )
                    )
                kit.line_items = replacement_items
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

            # XC-1: validate the member once up front (the per-item issue/assign
            # calls below each re-check, but this fails fast with a clear message
            # before any item is issued).
            if not await is_in_org(self.db, User, user_id, organization_id):
                return None, "Member not found"

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
        fulfillment_type: str,
        item_id: Optional[UUID] = None,
        quantity: Optional[int] = None,
        expected_return_at: Optional[datetime] = None,
        override_allowance: bool = False,
        substitution_override_reason: Optional[str] = None,
    ) -> Tuple[Optional[EquipmentRequest], Optional[str]]:
        """Turn an approved equipment request into a real issuance, checkout,
        or assignment, then mark the request fulfilled and link it back to the
        record that satisfied it.

        Pool items must be issued; individual items use the quartermaster's
        explicit checkout or assignment choice. The created record's id
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

            is_substitute = bool(req.item_id and str(target_item_id) != req.item_id)
            wrong_category = bool(
                not req.item_id
                and req.category_id
                and item.category_id != req.category_id
            )
            if (is_substitute or wrong_category) and not (
                substitution_override_reason and substitution_override_reason.strip()
            ):
                await self._revert_fulfillment_claim(request_id, organization_id)
                return None, (
                    "Selected substitute is incompatible with the requested item/category; "
                    "a documented substitution override is required"
                )

            qty = quantity or req.quantity or 1
            requester_id = UUID(req.requester_id)
            chosen_fulfillment = self._enum_value(fulfillment_type)
            if chosen_fulfillment not in {"checkout", "assignment", "issuance"}:
                await self._revert_fulfillment_claim(request_id, organization_id)
                return None, "A valid fulfillment type is required"
            if (
                item.tracking_type == TrackingType.POOL
                and chosen_fulfillment != "issuance"
            ):
                await self._revert_fulfillment_claim(request_id, organization_id)
                return None, "Pool-tracked stock must be fulfilled through an issuance"
            if (
                item.tracking_type != TrackingType.POOL
                and chosen_fulfillment == "issuance"
            ):
                await self._revert_fulfillment_claim(request_id, organization_id)
                return (
                    None,
                    "Individual items must be fulfilled through a checkout or assignment",
                )

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
                    actual_fulfillment_type = "issuance"
                    reference_id = str(issuance.id) if issuance else ""
                elif chosen_fulfillment == "checkout":
                    checkout, err = await self.checkout_item(
                        item_id=target_item_id,
                        user_id=requester_id,
                        organization_id=organization_id,
                        checked_out_by=fulfilled_by,
                        expected_return_at=expected_return_at,
                        reason="Equipment request fulfillment",
                    )
                    actual_fulfillment_type = "checkout"
                    reference_id = str(checkout.id) if checkout else ""
                else:
                    assignment, err = await self.assign_item_to_user(
                        item_id=target_item_id,
                        user_id=requester_id,
                        organization_id=organization_id,
                        assigned_by=fulfilled_by,
                        # A return date makes this a loan, not a permanent
                        # issue. The pool branch above already honours the date
                        # by creating a checkout; on this branch both arguments
                        # were omitted, so a date entered on the fulfil form was
                        # silently dropped and the item was issued for good.
                        assignment_type=(
                            AssignmentType.TEMPORARY
                            if expected_return_at
                            else AssignmentType.PERMANENT
                        ),
                        expected_return_date=expected_return_at,
                        reason="Equipment request fulfillment",
                    )
                    actual_fulfillment_type = "assignment"
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
                    fulfillment_type=actual_fulfillment_type,
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
            cond_val = condition.value if hasattr(condition, "value") else condition
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
                ItemAssignment.is_active.is_(True)
                if is_assignment
                else ItemIssuance.is_returned.is_(False)
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
          items contribute their on-hand ``quantity`` — issuing already
          decrements it and a return adds it back, so subtracting
          ``quantity_issued`` again would count every issued unit twice;
          individually-tracked items contribute one unit when ``available``.
        - ``unit_cost_by_size``: mean unit cost of priced items at each size,
          used to estimate per-size purchase cost.
        - ``avg_unit_cost``: mean unit cost across the whole category, used as
          a fallback for sizes with no priced items (or unknown sizes).

        Retired items are ignored. Keys are normalized via
        :meth:`_normalize_size_key`.
        """
        items = (
            (
                await self.db.execute(
                    select(InventoryItem)
                    .where(InventoryItem.organization_id == organization_id)
                    .where(InventoryItem.category_id == category_id)
                    .where(InventoryItem.status != ItemStatus.RETIRED)
                )
            )
            .scalars()
            .all()
        )

        stock: Dict[str, int] = {}
        cost_sums: Dict[str, float] = {}
        cost_counts: Dict[str, int] = {}
        all_cost_sum = 0.0
        all_cost_count = 0
        for item in items:
            key = self._normalize_size_key(self._item_stock_size_value(item))

            if item.tracking_type == TrackingType.POOL:
                avail = max(0, item.quantity or 0)
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
            (
                await self.db.execute(
                    select(InventoryItem)
                    .where(InventoryItem.organization_id == organization_id)
                    .where(InventoryItem.category_id == category_id)
                    .where(InventoryItem.status != ItemStatus.RETIRED)
                    .where(InventoryItem.tracking_type == TrackingType.POOL)
                )
            )
            .scalars()
            .all()
        )

        by_size: Dict[str, List[Dict[str, Any]]] = {}
        for item in items:
            # On-hand is `quantity` alone; see _get_stock_and_cost_by_size.
            avail = item.quantity or 0
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
        applicable allowance is the role-specific one matching the member's
        highest-priority position, else the org-wide one. This mirrors actual
        issuance enforcement. Computed in batch (a query per distinct
        allowance) to avoid per-member round-trips.
        """
        if not (category_id and user_ids):
            return set()

        allowances = (
            (
                await self.db.execute(
                    select(IssuanceAllowance)
                    .where(IssuanceAllowance.organization_id == organization_id)
                    .where(IssuanceAllowance.category_id == category_id)
                    .where(IssuanceAllowance.is_active.is_(True))
                )
            )
            .scalars()
            .all()
        )
        if not allowances:
            return set()

        # Resolve the same single highest-priority position used by issuance
        # enforcement. Ordering lets setdefault retain only that first role.
        primary_positions: Dict[str, str] = {}
        for uid, pid in (
            await self.db.execute(
                select(user_positions.c.user_id, user_positions.c.position_id)
                .join(Position, Position.id == user_positions.c.position_id)
                .where(
                    user_positions.c.user_id.in_(user_ids),
                    Position.organization_id == organization_id,
                )
                .order_by(user_positions.c.user_id, Position.priority.desc())
            )
        ).all():
            primary_positions.setdefault(uid, pid)

        role_allowances = {a.role_id: a for a in allowances if a.role_id}
        org_wide = next((a for a in allowances if not a.role_id), None)

        def _pick(uid):
            role_allowance = role_allowances.get(primary_positions.get(uid))
            if role_allowance is not None:
                return role_allowance
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
            now = datetime.now(timezone.utc)
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

        related_category_id = str(related_category_id) if related_category_id else None
        stock_category_id = str(stock_category_id) if stock_category_id else None

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
                (
                    await self.db.execute(
                        select(MemberSizePreferences).where(
                            MemberSizePreferences.user_id.in_(user_ids)
                        )
                    )
                )
                .scalars()
                .all()
            )
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
                bucket = size_buckets.setdefault(bucket_key, {"total": 0, "needing": 0})
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

        analysis = await self.analyze_impact(org_id, filters, include_contact=False)
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
        # INV-4 (XC-1): fail closed on a foreign/missing stock category rather
        # than stamping the client id onto the generated reorders as a dangling
        # FK. A legitimate in-org category always resolves here.
        if category is None:
            raise ValueError("Stock category not found")
        base_name = category.name
        size_label = self._SIZE_FIELD_LABELS.get(filters.get("size_field"), "")

        vendor = reorder_meta.get("vendor")
        vendor_id = reorder_meta.get("vendor_id")
        # XC-1: the vendor id comes from the client, so it must be in-org before
        # it is stamped onto every generated reorder.
        await assert_in_org(
            self.db,
            InventoryVendor,
            vendor_id,
            organization_id,
            allow_none=True,
            label="vendor",
        )
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
                vendor_id=str(vendor_id) if vendor_id else None,
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
                    {
                        "user_id": member["user_id"],
                        "name": name,
                        "reason": "No size on file",
                    }
                )
                continue

            candidates = pool_by_size.get(self._normalize_size_key(size), [])
            chosen = next((c for c in candidates if c["remaining"] > 0), None)
            if chosen is None:
                skipped.append(
                    {
                        "user_id": member["user_id"],
                        "name": name,
                        "reason": f"No {size} stock available",
                    }
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
                    {"user_id": member["user_id"], "name": name, "reason": error}
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

    async def list_impact_plans(self, organization_id) -> List[InventoryImpactPlan]:
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
            raise ValueError("Select a size field to identify members missing sizes.")

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

    async def get_impact_planner_options(self, organization_id) -> Dict[str, Any]:
        """Return the selectable filter options for the impact planner.

        Centralises the distinct ranks, stations, positions, and categories
        that exist for the organization so the planner UI can populate its
        filters from a single request.
        """
        org_id = str(organization_id)

        def _humanize(value: str) -> str:
            return value.replace("_", " ").title()

        statuses = [{"value": s.value, "label": _humanize(s.value)} for s in UserStatus]
        membership_types = [
            {"value": m.value, "label": _humanize(m.value)} for m in MembershipType
        ]

        # Ranks: prefer the org's configured operational ranks (code →
        # display name); fall back to any free-text rank values still in use.
        rank_rows = (
            (
                await self.db.execute(
                    select(OperationalRank)
                    .where(OperationalRank.organization_id == org_id)
                    .where(OperationalRank.is_active.is_(True))
                    .order_by(OperationalRank.sort_order, OperationalRank.display_name)
                )
            )
            .scalars()
            .all()
        )
        ranks = [
            {"value": r.rank_code, "label": r.display_name or _humanize(r.rank_code)}
            for r in rank_rows
        ]
        known_rank_codes = {r["value"] for r in ranks}
        distinct_ranks = (
            (
                await self.db.execute(
                    select(User.rank)
                    .where(User.organization_id == org_id)
                    .where(User.deleted_at.is_(None))
                    .where(User.rank.isnot(None))
                    .distinct()
                )
            )
            .scalars()
            .all()
        )
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
            )
            .scalars()
            .all()
            if s
        ]

        position_rows = (
            (
                await self.db.execute(
                    select(Position)
                    .where(Position.organization_id == org_id)
                    .order_by(Position.name)
                )
            )
            .scalars()
            .all()
        )
        positions = [{"id": p.id, "name": p.name} for p in position_rows]

        category_rows = (
            (
                await self.db.execute(
                    select(InventoryCategory)
                    .where(InventoryCategory.organization_id == org_id)
                    .where(InventoryCategory.active.is_(True))
                    .order_by(InventoryCategory.name)
                )
            )
            .scalars()
            .all()
        )
        categories = [
            {
                "id": c.id,
                "name": c.name,
                "item_type": (
                    c.item_type.value if hasattr(c.item_type, "value") else c.item_type
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

    # ============================================
    # Guided Setup
    # ============================================

    async def get_setup_status(self, organization_id: UUID) -> Dict[str, Any]:
        """Counts of the records the guided setup workflow walks through.

        Each count is what the corresponding step of the workflow produces, in
        the order an item needs them: a room holds storage areas, a storage
        area holds items, and a category decides which fields an item has.
        Retired items are excluded so a department that retired its way back to
        an empty catalog is offered the workflow again.
        """
        org_id = str(organization_id)

        rooms = await self.db.scalar(
            select(func.count())
            .select_from(Location)
            .where(
                Location.organization_id == org_id,
                Location.is_active.is_(True),
            )
        )
        storage_areas = await self.db.scalar(
            select(func.count())
            .select_from(StorageArea)
            .where(
                StorageArea.organization_id == org_id,
                StorageArea.is_active.is_(True),
            )
        )
        categories = await self.db.scalar(
            select(func.count())
            .select_from(InventoryCategory)
            .where(
                InventoryCategory.organization_id == org_id,
                InventoryCategory.active.is_(True),
            )
        )
        items = await self.db.scalar(
            select(func.count())
            .select_from(InventoryItem)
            .where(
                InventoryItem.organization_id == org_id,
                InventoryItem.status != ItemStatus.RETIRED,
            )
        )

        counts = {
            "rooms": rooms or 0,
            "storage_areas": storage_areas or 0,
            "categories": categories or 0,
            "items": items or 0,
        }
        return {**counts, "is_complete": all(value > 0 for value in counts.values())}

    async def _taken_category_names(self, organization_id: UUID) -> set[str]:
        """Case-folded names of the org's *active* categories.

        Active only: `delete_category` deactivates rather than deleting, so
        matching every row would let one retired "Turnout Gear" mark the preset
        as already-added forever — shown as done in the workflow, absent from
        the category list beside it, and impossible to re-create from here.
        """
        existing = await self.db.execute(
            select(InventoryCategory.name).where(
                InventoryCategory.organization_id == str(organization_id),
                InventoryCategory.active.is_(True),
            )
        )
        return {name.strip().lower() for name in existing.scalars().all() if name}

    async def get_category_presets(self, organization_id: UUID) -> List[Dict[str, Any]]:
        """Starter categories, each flagged with whether the org already has it.

        The flag is matched on case-insensitive name rather than on a stored
        key: a department that already typed "Turnout Gear" by hand should not
        be offered a second one, and presets carry no identity of their own
        once created.
        """
        taken = await self._taken_category_names(organization_id)

        return [
            {
                **preset,
                "item_type": preset["item_type"].value,
                "exists": preset["name"].strip().lower() in taken,
            }
            for preset in CATEGORY_PRESETS
        ]

    async def apply_category_presets(
        self, organization_id: UUID, keys: List[str], created_by: UUID
    ) -> Tuple[List[InventoryCategory], List[str], Optional[str]]:
        """Create the named starter categories, skipping ones already present.

        Returns ``(created, skipped_names, error)``. Skipping rather than
        failing keeps the workflow re-runnable: a quartermaster who applies a
        second batch later gets only what is missing, and a double-submitted
        form does not duplicate the catalog.
        """
        requested = [key for key in dict.fromkeys(keys) if key]
        by_key = {preset["key"]: preset for preset in CATEGORY_PRESETS}
        unknown = [key for key in requested if key not in by_key]
        if unknown:
            return [], [], f"Unknown category preset: {unknown[0]}"

        taken = await self._taken_category_names(organization_id)

        created: List[InventoryCategory] = []
        skipped: List[str] = []
        try:
            for key in requested:
                preset = by_key[key]
                if preset["name"].strip().lower() in taken:
                    skipped.append(preset["name"])
                    continue
                category = InventoryCategory(
                    organization_id=str(organization_id),
                    created_by=str(created_by),
                    name=preset["name"],
                    description=preset["description"],
                    item_type=preset["item_type"],
                    requires_assignment=preset["requires_assignment"],
                    requires_serial_number=preset["requires_serial_number"],
                    requires_maintenance=preset["requires_maintenance"],
                    nfpa_tracking_enabled=preset["nfpa_tracking_enabled"],
                    low_stock_threshold=preset["low_stock_threshold"],
                )
                self.db.add(category)
                created.append(category)
                taken.add(preset["name"].strip().lower())

            if created:
                await self.db.commit()
                for category in created:
                    await self.db.refresh(category)
            return created, skipped, None
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to apply category presets: {e}")
            return [], [], str(e)
