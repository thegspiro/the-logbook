"""
Cross-module barcode-label service.

One place to:
- store/read the per-position, per-module label-printer preset
  (``positions.settings["label_presets"][module]``), so a role's printer
  choice follows whoever fills it, on any computer, and can differ by module;
- turn a list of record ids in a given module into a printable PDF, via a
  small per-module *builder* that maps that module's records onto neutral
  :class:`~app.utils.label_renderer.LabelSpec` objects.

Each module is registered in :data:`MODULE_LABELS` with the builder and the
permissions accepted to print it (the module's view or manage grant). The
actual PDF rendering is shared (:mod:`app.utils.label_renderer`).
"""

import copy
from io import BytesIO
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.label_renderer import (
    SYMBOLOGY_CODE128,
    LabelSpec,
    is_known_label_format,
    render_labels,
    sanitize_barcode_value,
    validate_symbology,
)

# A builder fetches the module's records (org-scoped) for the given ids and
# returns (label specs, count of records whose barcode was auto-populated).
SpecBuilder = Callable[
    [AsyncSession, str, List[str], Optional[List[str]]],
    Awaitable[Tuple[List[LabelSpec], int]],
]


def _short_id(value: str, length: int = 12) -> str:
    return value.replace("-", "")[:length].upper()


def _first_scannable_identifier(*values: Optional[str], fallback: str) -> str:
    """Choose the first identifier that can actually be encoded as Code 128."""
    for value in values:
        if value and sanitize_barcode_value(value):
            return value.strip()
    return fallback


def _filter_ids(ids: List[str], exclude_ids: Optional[Set[str]]) -> List[str]:
    """Drop ids the caller is not allowed to print.

    Callers pass ids the record-privacy layer has already canonicalized (see
    :func:`app.api.prospect_privacy.normalize_prospect_id`); normalize the
    request side the same way so a re-cased or unhyphenated UUID cannot slip
    a filtered record back in.
    """
    if not exclude_ids:
        return ids

    from app.api.prospect_privacy import normalize_prospect_id

    return [i for i in ids if normalize_prospect_id(i) not in exclude_ids]


async def _build_inventory_specs(db, org_id, ids, extra_lines):
    # Inventory owns the extra-line fields. Read-only here (no barcode writes):
    # items get their sequential barcode at creation, and the inventory print
    # page uses its own persisting endpoint.
    from app.services.inventory_service import InventoryService

    return await InventoryService(db).build_label_specs(
        ids, org_id, extra_lines, persist=False
    )


async def _build_apparatus_specs(db, org_id, ids, extra_lines):
    from app.models.apparatus import Apparatus

    rows = await db.scalars(
        select(Apparatus).where(
            Apparatus.organization_id == org_id,
            Apparatus.id.in_([str(i) for i in ids]),
        )
    )
    specs = []
    for a in rows.all():
        barcode = _first_scannable_identifier(
            a.asset_tag, a.unit_number, fallback=_short_id(a.id)
        )
        specs.append(
            LabelSpec(
                name=a.name or a.unit_number or "Apparatus",
                barcode_value=barcode,
                asset_tag=a.asset_tag,
                serial_number=getattr(a, "vin", None),
            )
        )
    return specs, 0


async def _build_prospect_specs(db, org_id, ids, extra_lines):
    from app.models.membership_pipeline import ProspectiveMember

    rows = await db.scalars(
        select(ProspectiveMember).where(
            ProspectiveMember.organization_id == org_id,
            ProspectiveMember.id.in_([str(i) for i in ids]),
        )
    )
    specs = []
    for p in rows.all():
        name = " ".join(filter(None, [p.first_name, p.last_name])) or "Applicant"
        # The status token is a stable, scannable badge id (used for public
        # status checks); fall back to a short id.
        barcode = getattr(p, "status_token", None) or _short_id(p.id)
        specs.append(LabelSpec(name=name, barcode_value=barcode))
    return specs, 0


async def _build_facility_specs(db, org_id, ids, extra_lines):
    from app.models.facilities import Facility

    rows = await db.scalars(
        select(Facility).where(
            Facility.organization_id == org_id,
            Facility.id.in_([str(i) for i in ids]),
        )
    )
    specs = []
    for f in rows.all():
        barcode = _first_scannable_identifier(
            f.facility_number, fallback=_short_id(f.id)
        )
        specs.append(
            LabelSpec(
                name=f.name or "Facility",
                barcode_value=barcode,
                asset_tag=f.facility_number,
            )
        )
    return specs, 0


async def _build_member_specs(db, org_id, ids, extra_lines):
    from app.models.user import User

    rows = await db.scalars(
        select(User).where(
            User.organization_id == org_id,
            User.id.in_([str(i) for i in ids]),
        )
    )
    specs = []
    for u in rows.all():
        name = " ".join(filter(None, [u.first_name, u.last_name])) or "Member"
        barcode = _first_scannable_identifier(
            u.membership_number, fallback=_short_id(u.id)
        )
        specs.append(
            LabelSpec(
                name=name,
                barcode_value=barcode,
                asset_tag=u.membership_number,
            )
        )
    return specs, 0


async def _build_storage_area_specs(db, org_id, ids, extra_lines):
    """Shelf, rack and compartment labels.

    Every storage area is meant to carry an ``SA-`` barcode, assigned at
    create time. Areas made before that was mandatory may still have none;
    they are given the next code in the same series here, and committed, so
    the label printed is the value stored. Printing a fallback instead would
    put a code on the shelf that nothing could ever look up.
    """
    from app.models.inventory import StorageArea
    from app.models.location import Location
    from app.services.inventory_service import InventoryService

    # Request order, deduplicated: the print page pairs each preview with the
    # id at the same position.
    wanted = list(dict.fromkeys(str(i) for i in ids))
    # The whole org's areas, not just the requested ones: a label names its
    # parents ("Engine 1 › Driver side"), and a compartment is only
    # identifiable by the rig it is on.
    rows = await db.scalars(
        select(StorageArea).where(StorageArea.organization_id == org_id)
    )
    areas = {a.id: a for a in rows.all()}
    targets = [areas[i] for i in wanted if i in areas]

    location_ids = {a.location_id for a in areas.values() if a.location_id}
    location_names: Dict[str, str] = {}
    if location_ids:
        loc_rows = await db.execute(
            select(Location.id, Location.name).where(
                Location.organization_id == org_id,
                Location.id.in_(location_ids),
            )
        )
        location_names = {row.id: row.name for row in loc_rows}

    assigned = 0
    service = InventoryService(db)
    for area in targets:
        if not area.barcode or not sanitize_barcode_value(area.barcode):
            area.barcode = await service.next_storage_area_barcode(org_id)
            assigned += 1
    if assigned:
        await db.commit()

    def trail(area) -> str:
        parts: List[str] = []
        seen: Set[str] = set()
        node = areas.get(area.parent_id) if area.parent_id else None
        root = area
        # `seen` bounds the walk; a parent cycle in the data must not hang.
        while node is not None and node.id not in seen:
            seen.add(node.id)
            parts.insert(0, node.label or node.name)
            root = node
            node = areas.get(node.parent_id) if node.parent_id else None
        location = location_names.get(root.location_id or area.location_id or "")
        if location:
            parts.insert(0, location)
        return " › ".join(parts)

    specs = []
    for area in targets:
        title = area.name or "Storage area"
        if area.label and area.label != area.name:
            title = f"{area.label} · {title}"
        specs.append(
            LabelSpec(
                name=title,
                barcode_value=_first_scannable_identifier(
                    area.barcode, fallback=_short_id(area.id)
                ),
                extra=trail(area) or None,
            )
        )
    return specs, assigned


# module -> (permissions accepted to print (any-of), spec builder).
# `permission_matches` does not treat manage as implying view, so both are
# listed explicitly — mirroring how module endpoints pair view/manage.
MODULE_LABELS: Dict[str, Tuple[Tuple[str, ...], SpecBuilder]] = {
    # Inventory is manage-only, unlike its neighbours here. The gear catalogue
    # itself requires inventory.manage, and a label document naming arbitrary
    # item ids is a read of it — accepting inventory.view (which every seeded
    # member holds) would leave this generic endpoint as a way around that.
    # apparatus/facilities/membership stay view-level because their own pages
    # are view-level; prospective_members.view is not a baseline grant.
    "inventory": (("inventory.manage",), _build_inventory_specs),
    "apparatus": (("apparatus.view", "apparatus.manage"), _build_apparatus_specs),
    "prospective_members": (
        ("prospective_members.view", "prospective_members.manage"),
        _build_prospect_specs,
    ),
    "facilities": (("facilities.view", "facilities.manage"), _build_facility_specs),
    "membership": (("members.view", "members.manage"), _build_member_specs),
    # Manage-only like inventory: the storage-areas screen is, and printing
    # can assign a barcode to an area that lacks one.
    "storage_areas": (("inventory.manage",), _build_storage_area_specs),
}


def is_known_label_module(module: str) -> bool:
    return module in MODULE_LABELS


def required_permissions_for_module(module: str) -> Optional[Tuple[str, ...]]:
    """Permissions accepted (any-of) to use label endpoints for *module*."""
    entry = MODULE_LABELS.get(module)
    return entry[0] if entry else None


#: "This caller did not mention the field" — distinct from an explicit ``None``,
#: which means "clear it". ``None`` alone cannot express both, and conflating
#: them is what let a save that carried no printer erase the one on file.
class _Unset:
    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "UNSET"


UNSET = _Unset()

# Saved setups per organization and module; enough for every printer and
# stock combination a department runs, small enough to scan in a picker.
MAX_LABEL_SETUPS = 20


class LabelService:
    """Position-scoped label presets and cross-module label generation."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Per-position, per-module printer preset
    # ------------------------------------------------------------------

    async def _primary_position_id(self, user_id, organization_id) -> Optional[str]:
        from app.models.user import Position, user_roles

        row = await self.db.scalar(
            select(Position.id)
            .join(user_roles, Position.id == user_roles.c.position_id)
            .where(user_roles.c.user_id == str(user_id))
            .where(Position.organization_id == str(organization_id))
            .order_by(Position.priority.desc())
            .limit(1)
        )
        return row

    async def get_preset(self, user_id, organization_id, module: str) -> Dict[str, Any]:
        from app.models.user import Position

        position_id = await self._primary_position_id(user_id, organization_id)
        if position_id is None:
            return {"preset": None, "position_id": None, "module": module}

        position = await self.db.scalar(
            select(Position).where(Position.id == position_id)
        )
        presets = (position.settings or {}).get("label_presets") if position else None
        pref = presets.get(module) if isinstance(presets, dict) else None
        if not pref:
            return {"preset": None, "position_id": position_id, "module": module}
        return {
            "preset": pref.get("preset"),
            "printer_id": pref.get("printer_id"),
            "custom_width": pref.get("custom_width"),
            "custom_height": pref.get("custom_height"),
            # Absent on presets saved before symbology was a choice, which must
            # read as Code 128 — the symbology every existing label carries.
            "symbology": pref.get("symbology") or SYMBOLOGY_CODE128,
            # What prints on the label besides the code; null when never saved.
            "extra_lines": pref.get("extra_lines"),
            "position_id": position_id,
            "module": module,
        }

    async def set_preset(
        self,
        user_id,
        organization_id,
        module: str,
        preset: str,
        printer_id: Any = UNSET,
        custom_width: Optional[float] = None,
        custom_height: Optional[float] = None,
        symbology: str = SYMBOLOGY_CODE128,
        extra_lines: Any = UNSET,
    ) -> Dict[str, Any]:
        """Store the label preset for the caller's position.

        ``printer_id`` follows the update contract in CLAUDE.md pitfall #1:
        omitted means "leave the remembered destination alone", an explicit
        ``None`` clears it. The entry used to be rewritten wholesale, so any
        save that did not carry a printer erased one — the inventory size
        preset never sends one at all, and the print page sends none while its
        printer list is still in flight. Nobody had to touch a control; opening
        the page on a slow link was enough to lose the position's destination.
        ``extra_lines`` follows the same contract, for the same reason: only
        the inventory page sends it, and every other save must keep it.
        """
        from app.models.user import Position

        if not is_known_label_format(preset):
            raise ValueError(f"Unknown label preset: {preset}")
        validate_symbology(symbology)

        position_id = await self._primary_position_id(user_id, organization_id)
        if position_id is None:
            raise ValueError("No position is available to store the preference on")

        position = await self.db.scalar(
            select(Position).where(
                Position.id == position_id,
                Position.organization_id == str(organization_id),
            )
        )
        if position is None:
            raise ValueError("Position not found")

        # Deep-copy + reassign so SQLAlchemy detects the nested change
        # (Position.settings is a plain JSON column; see CLAUDE.md Pitfall #12).
        settings = copy.deepcopy(position.settings or {})
        presets = settings.get("label_presets")
        if not isinstance(presets, dict):
            presets = {}
        stored = presets.get(module)
        stored_printer = stored.get("printer_id") if isinstance(stored, dict) else None
        stored_lines = stored.get("extra_lines") if isinstance(stored, dict) else None
        presets[module] = {
            "preset": preset,
            "printer_id": stored_printer if printer_id is UNSET else printer_id,
            "custom_width": custom_width,
            "custom_height": custom_height,
            "symbology": symbology,
            "extra_lines": stored_lines if extra_lines is UNSET else extra_lines,
        }
        settings["label_presets"] = presets
        position.settings = settings
        await self.db.flush()
        return {
            **presets[module],
            "position_id": position_id,
            "module": module,
        }

    # ------------------------------------------------------------------
    # Named setups, shared across the organization
    # ------------------------------------------------------------------
    #
    # A setup names a whole print configuration ("Rollo 2x1, QR") so any
    # member at any station can apply it in one step. They live on the
    # organization, not a position: the preset above follows a role, while a
    # setup describes a printer and its stock, which the whole department
    # shares.

    async def list_setups(self, organization_id, module: str) -> List[Dict[str, Any]]:
        from app.models.user import Organization

        org = await self.db.scalar(
            select(Organization).where(Organization.id == str(organization_id))
        )
        setups = ((org.settings or {}).get("label_setups") or {}) if org else {}
        found = setups.get(module) if isinstance(setups, dict) else None
        return (
            [s for s in found if isinstance(s, dict)] if isinstance(found, list) else []
        )

    async def save_setup(
        self, organization_id, module: str, setup: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Add a setup, or replace the one with the same name (any case).

        The caller validates the fields; this enforces the cap and the name
        rule. The organization row is locked for the read-modify-write, so
        two members saving at once cannot drop each other's setup.
        """
        from app.core.utils import generate_uuid
        from app.models.user import Organization

        validate_symbology(setup["symbology"])
        if not is_known_label_format(setup["preset"]):
            raise ValueError(f"Unknown label preset: {setup['preset']}")

        org = await self.db.scalar(
            select(Organization)
            .where(Organization.id == str(organization_id))
            .with_for_update()
        )
        if org is None:
            raise ValueError("Organization not found")
        settings = copy.deepcopy(org.settings or {})
        by_module = settings.get("label_setups")
        if not isinstance(by_module, dict):
            by_module = {}
        current = by_module.get(module)
        setups = (
            [s for s in current if isinstance(s, dict)]
            if isinstance(current, list)
            else []
        )

        key = setup["name"].strip().lower()
        at = next(
            (i for i, s in enumerate(setups) if str(s.get("name", "")).lower() == key),
            None,
        )
        if at is None:
            if len(setups) >= MAX_LABEL_SETUPS:
                raise ValueError(
                    f"An organization holds up to {MAX_LABEL_SETUPS} saved setups. "
                    "Delete one first."
                )
            setups.append({**setup, "id": generate_uuid()})
        else:
            setups[at] = {**setup, "id": setups[at].get("id") or generate_uuid()}

        by_module[module] = setups
        settings["label_setups"] = by_module
        org.settings = settings
        await self.db.flush()
        return setups

    async def delete_setup(
        self, organization_id, module: str, setup_id: str
    ) -> Optional[List[Dict[str, Any]]]:
        """Remove one setup. None when the organization has no such setup."""
        from app.models.user import Organization

        org = await self.db.scalar(
            select(Organization)
            .where(Organization.id == str(organization_id))
            .with_for_update()
        )
        if org is None:
            return None
        settings = copy.deepcopy(org.settings or {})
        by_module = settings.get("label_setups")
        current = by_module.get(module) if isinstance(by_module, dict) else None
        if not isinstance(current, list):
            return None
        remaining = [
            s for s in current if isinstance(s, dict) and s.get("id") != setup_id
        ]
        if len(remaining) == len(current):
            return None
        by_module[module] = remaining
        settings["label_setups"] = by_module
        org.settings = settings
        await self.db.flush()
        return remaining

    # ------------------------------------------------------------------
    # Generation
    # ------------------------------------------------------------------

    async def generate(
        self,
        organization_id,
        module: str,
        ids: List[str],
        label_format: str = "letter",
        custom_width: Optional[float] = None,
        custom_height: Optional[float] = None,
        auto_rotate: Optional[bool] = None,
        extra_lines: Optional[List[str]] = None,
        exclude_ids: Optional[Set[str]] = None,
        symbology: str = SYMBOLOGY_CODE128,
        start_position: int = 1,
    ) -> Tuple[BytesIO, int, int]:
        entry = MODULE_LABELS.get(module)
        if entry is None:
            raise ValueError(f"Labels are not available for module: {module}")
        _, builder = entry

        specs, auto_populated = await builder(
            self.db, str(organization_id), _filter_ids(ids, exclude_ids), extra_lines
        )
        if not specs:
            raise ValueError("No records found for label generation")

        pdf = render_labels(
            specs,
            label_format,
            custom_width,
            custom_height,
            auto_rotate,
            symbology,
            start_position=start_position,
        )
        return pdf, auto_populated, len(specs)

    async def preview(
        self,
        organization_id,
        module: str,
        ids: List[str],
        exclude_ids: Optional[Set[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Return label preview data (name, barcode value, subtitle) for the
        on-screen preview — read-only, no side effects."""
        entry = MODULE_LABELS.get(module)
        if entry is None:
            raise ValueError(f"Labels are not available for module: {module}")
        _, builder = entry
        specs, _ = await builder(
            self.db, str(organization_id), _filter_ids(ids, exclude_ids), None
        )
        return [
            {
                "name": s.name,
                "barcode_value": s.barcode_value,
                "subtitle": s.asset_tag or s.serial_number or None,
            }
            for s in specs
        ]
