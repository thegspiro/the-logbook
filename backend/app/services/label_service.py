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
view permission required to print it. The actual PDF rendering is shared
(:mod:`app.utils.label_renderer`).
"""

import copy
from io import BytesIO
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.label_renderer import (
    LabelSpec,
    is_known_label_format,
    render_labels,
)

# A builder fetches the module's records (org-scoped) for the given ids and
# returns (label specs, count of records whose barcode was auto-populated).
SpecBuilder = Callable[
    [AsyncSession, str, List[str], Optional[List[str]]],
    Awaitable[Tuple[List[LabelSpec], int]],
]


def _short_id(value: str, length: int = 12) -> str:
    return value.replace("-", "")[:length].upper()


async def _build_inventory_specs(db, org_id, ids, extra_lines):
    # Inventory owns barcode auto-assignment and the extra-line fields, so it
    # builds its own specs (and persists any missing barcodes).
    from app.services.inventory_service import InventoryService

    return await InventoryService(db).build_label_specs(ids, org_id, extra_lines)


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
        barcode = a.asset_tag or a.unit_number or _short_id(a.id)
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
        barcode = f.facility_number or _short_id(f.id)
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
        barcode = u.membership_number or _short_id(u.id)
        specs.append(
            LabelSpec(
                name=name,
                barcode_value=barcode,
                asset_tag=u.membership_number,
            )
        )
    return specs, 0


# module -> (view permission required to print, spec builder)
MODULE_LABELS: Dict[str, Tuple[str, SpecBuilder]] = {
    "inventory": ("inventory.view", _build_inventory_specs),
    "apparatus": ("apparatus.view", _build_apparatus_specs),
    "prospective_members": ("prospective_members.view", _build_prospect_specs),
    "facilities": ("facilities.view", _build_facility_specs),
    "membership": ("members.view", _build_member_specs),
}


def is_known_label_module(module: str) -> bool:
    return module in MODULE_LABELS


def required_permission_for_module(module: str) -> Optional[str]:
    entry = MODULE_LABELS.get(module)
    return entry[0] if entry else None


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
            "custom_width": pref.get("custom_width"),
            "custom_height": pref.get("custom_height"),
            "position_id": position_id,
            "module": module,
        }

    async def set_preset(
        self,
        user_id,
        organization_id,
        module: str,
        preset: str,
        custom_width: Optional[float] = None,
        custom_height: Optional[float] = None,
    ) -> Dict[str, Any]:
        from app.models.user import Position

        if not is_known_label_format(preset):
            raise ValueError(f"Unknown label preset: {preset}")

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
        presets[module] = {
            "preset": preset,
            "custom_width": custom_width,
            "custom_height": custom_height,
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
    ) -> Tuple[BytesIO, int]:
        entry = MODULE_LABELS.get(module)
        if entry is None:
            raise ValueError(f"Labels are not available for module: {module}")
        _, builder = entry

        specs, auto_populated = await builder(
            self.db, str(organization_id), ids, extra_lines
        )
        if not specs:
            raise ValueError("No records found for label generation")

        pdf = render_labels(
            specs, label_format, custom_width, custom_height, auto_rotate
        )
        return pdf, auto_populated
