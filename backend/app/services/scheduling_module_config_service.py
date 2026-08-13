"""
Scheduling Module Configuration Service

Get/update/reset of per-organization department-wide shift settings
(position names, apparatus-type crew defaults, equipment-check rules).
Mirrors TrainingModuleConfigService: one row per organization, all lookups
keyed by the caller's organization_id.
"""

import copy
from typing import Any, Dict, Optional, Tuple

from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scheduling_module_config import SchedulingModuleConfig
from app.schemas.scheduling_module_config import ShiftSettingsSchema

# Built-in defaults, kept in lockstep with the frontend's DEFAULT_SETTINGS in
# frontend/src/modules/scheduling/types/shiftSettings.ts. Top-level keys are
# the schema (snake_case) field names; nested keys are camelCase because that
# is the wire shape stored verbatim in the JSON columns.
DEFAULT_APPARATUS_TYPE_DEFAULTS: Dict[str, Any] = {
    "engine": {
        "positions": ["officer", "driver", "firefighter", "firefighter"],
        "minStaffing": 4,
    },
    "ladder": {
        "positions": ["officer", "driver", "firefighter", "firefighter"],
        "minStaffing": 4,
    },
    "ambulance": {"positions": ["driver", "ems", "ems"], "minStaffing": 2},
    "rescue": {
        "positions": ["officer", "driver", "firefighter", "firefighter"],
        "minStaffing": 4,
    },
    "tanker": {"positions": ["driver", "firefighter"], "minStaffing": 2},
    "brush": {"positions": ["driver", "firefighter"], "minStaffing": 2},
    "tower": {
        "positions": ["officer", "driver", "firefighter", "firefighter"],
        "minStaffing": 4,
    },
    "hazmat": {
        "positions": ["officer", "driver", "firefighter", "firefighter"],
        "minStaffing": 4,
    },
    "boat": {"positions": ["officer", "driver"], "minStaffing": 2},
    "chief": {"positions": ["officer"], "minStaffing": 1},
    "utility": {"positions": ["driver"], "minStaffing": 1},
}

DEFAULT_RESOURCE_TYPE_DEFAULTS: Dict[str, Any] = {
    "first_aid_station": {
        "positions": ["ems", "ems"],
        "label": "First Aid Station",
    },
    "bicycle_team": {"positions": ["ems", "ems"], "label": "Bicycle Team"},
    "command_post": {
        "positions": ["officer", "captain"],
        "label": "Command Post",
    },
    "rehab_station": {
        "positions": ["ems", "firefighter"],
        "label": "Rehab Station",
    },
}

DEFAULT_SHIFT_SETTINGS: Dict[str, Any] = {
    "default_duration_hours": 12,
    "default_min_staffing": 4,
    "require_assignment_confirmation": True,
    "overtime_threshold_hours_per_week": 48,
    "enabled_positions": [
        "officer",
        "driver",
        "firefighter",
        "ems",
        "captain",
        "lieutenant",
    ],
    "custom_positions": [],
    "apparatus_type_defaults": DEFAULT_APPARATUS_TYPE_DEFAULTS,
    "resource_type_defaults": DEFAULT_RESOURCE_TYPE_DEFAULTS,
    "equipment_check_settings": {
        "enabled": False,
        "requireSignature": False,
        "defaultExpirationWarningDays": 30,
        "blockShiftStartOnFail": False,
    },
}

# Columns that carry one settings field each; used to fold row values over the
# defaults and to write a full payload back.
_SETTINGS_COLUMNS = tuple(DEFAULT_SHIFT_SETTINGS.keys())


class SchedulingModuleConfigService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _get_row(self, organization_id: str) -> Optional[SchedulingModuleConfig]:
        result = await self.db.execute(
            select(SchedulingModuleConfig).where(
                SchedulingModuleConfig.organization_id == str(organization_id)
            )
        )
        return result.scalars().first()

    async def get_settings(
        self, organization_id: str
    ) -> Tuple[Dict[str, Any], Optional[SchedulingModuleConfig]]:
        """Return (effective settings, row-or-None) for the organization.

        The effective settings are the built-in defaults with every non-NULL
        stored column folded over them, so callers always get a complete
        object. Row is None when the org has never saved settings.
        """
        row = await self._get_row(organization_id)
        # deepcopy so callers can never mutate the module-level defaults —
        # the same aliasing trap as CLAUDE.md Pitfall #12, one level earlier.
        settings = copy.deepcopy(DEFAULT_SHIFT_SETTINGS)
        if row is not None:
            for column in _SETTINGS_COLUMNS:
                value = getattr(row, column)
                if value is not None:
                    settings[column] = value
        return settings, row

    async def update_settings(
        self,
        organization_id: str,
        payload: ShiftSettingsSchema,
        updated_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Replace the organization's settings with the full payload.

        The panel owns every field and sends them all on each save, so this
        is a wholesale write — no merge, no exclude_unset ambiguity.
        """
        row = await self._get_row(organization_id)
        if row is None:
            row = SchedulingModuleConfig(organization_id=str(organization_id))
            self.db.add(row)

        # by_alias keeps nested keys camelCase in the JSON columns (the wire
        # shape the frontend reads back verbatim); scalar columns take the
        # plain value either way. model_dump builds fresh dicts, so each JSON
        # column is assigned a brand-new object — never a mutated shared
        # reference (Pitfall #12).
        data = payload.model_dump()
        data_camel = payload.model_dump(by_alias=True)
        for column in _SETTINGS_COLUMNS:
            if isinstance(DEFAULT_SHIFT_SETTINGS[column], (dict, list)):
                setattr(row, column, data_camel[to_camel(column)])
            else:
                setattr(row, column, data[column])

        if updated_by:
            row.updated_by = str(updated_by)

        await self.db.commit()
        await self.db.refresh(row)
        settings, _ = await self.get_settings(organization_id)
        return settings

    async def reset_settings(self, organization_id: str) -> None:
        """Delete the organization's stored settings (back to defaults)."""
        row = await self._get_row(organization_id)
        if row is not None:
            await self.db.delete(row)
            await self.db.commit()
