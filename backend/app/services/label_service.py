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
    ) -> Dict[str, Any]:
        """Store the label preset for the caller's position.

        ``printer_id`` follows the update contract in CLAUDE.md pitfall #1:
        omitted means "leave the remembered destination alone", an explicit
        ``None`` clears it. The entry used to be rewritten wholesale, so any
        save that did not carry a printer erased one — the inventory size
        preset never sends one at all, and the print page sends none while its
        printer list is still in flight. Nobody had to touch a control; opening
        the page on a slow link was enough to lose the position's destination.
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
        presets[module] = {
            "preset": preset,
            "printer_id": stored_printer if printer_id is UNSET else printer_id,
            "custom_width": custom_width,
            "custom_height": custom_height,
            "symbology": symbology,
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
            specs, label_format, custom_width, custom_height, auto_rotate, symbology
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
