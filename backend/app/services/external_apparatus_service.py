"""
The list of outside agencies and apparatus members may log shifts on.

Scheduling officers maintain it; members only pick from it. A unit that is
no longer used is deactivated, which hides it from the picker while every
shift already logged on it keeps its name. Deleting is allowed only while
nothing references the row, because a delete that silently detached logged
shifts would quietly change the apparatus summary leadership reads.
"""

from typing import Any, Dict, List, Mapping, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.external_shift_hours import (
    ExternalAgency,
    ExternalApparatus,
    ExternalShiftHours,
)
from app.utils.model_updates import apply_updates


class ExternalApparatusInUseError(Exception):
    """Raised when deleting a list entry that logged shifts still reference."""


_PROTECTED = {"id", "organization_id", "agency_id", "created_at", "updated_at"}


class ExternalApparatusService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def list_agencies(
        self, organization_id: str, *, active_only: bool = False
    ) -> List[Dict[str, Any]]:
        """Agencies with their apparatus nested, alphabetical.

        ``active_only`` is the member's picker: an inactive agency hides its
        apparatus too, whatever each unit's own flag says.
        """
        agency_query = select(ExternalAgency).where(
            ExternalAgency.organization_id == str(organization_id)
        )
        apparatus_query = select(ExternalApparatus).where(
            ExternalApparatus.organization_id == str(organization_id)
        )
        if active_only:
            agency_query = agency_query.where(ExternalAgency.is_active.is_(True))
            apparatus_query = apparatus_query.where(
                ExternalApparatus.is_active.is_(True)
            )

        agencies = (
            (await self.db.execute(agency_query.order_by(ExternalAgency.name)))
            .scalars()
            .all()
        )
        apparatus = (
            (await self.db.execute(apparatus_query.order_by(ExternalApparatus.name)))
            .scalars()
            .all()
        )

        by_agency: Dict[str, List[Dict[str, Any]]] = {}
        for unit in apparatus:
            by_agency.setdefault(unit.agency_id, []).append(
                self.serialize_apparatus(unit)
            )
        return [
            {**self.serialize_agency(agency), "apparatus": by_agency.get(agency.id, [])}
            for agency in agencies
        ]

    async def get_agency(
        self, organization_id: str, agency_id: str
    ) -> Optional[ExternalAgency]:
        agency: Optional[ExternalAgency] = (
            await self.db.execute(
                select(ExternalAgency).where(
                    ExternalAgency.id == str(agency_id),
                    ExternalAgency.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        return agency

    async def get_apparatus(
        self, organization_id: str, apparatus_id: str
    ) -> Optional[ExternalApparatus]:
        apparatus: Optional[ExternalApparatus] = (
            await self.db.execute(
                select(ExternalApparatus).where(
                    ExternalApparatus.id == str(apparatus_id),
                    ExternalApparatus.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        return apparatus

    async def get_pickable_apparatus(
        self, organization_id: str, apparatus_id: str
    ) -> Optional[tuple[ExternalApparatus, ExternalAgency]]:
        """The unit and its agency, if a member may log a shift on it now."""
        row = (
            await self.db.execute(
                select(ExternalApparatus, ExternalAgency)
                .join(ExternalAgency, ExternalAgency.id == ExternalApparatus.agency_id)
                .where(
                    ExternalApparatus.id == str(apparatus_id),
                    ExternalApparatus.organization_id == str(organization_id),
                    ExternalAgency.organization_id == str(organization_id),
                    ExternalApparatus.is_active.is_(True),
                    ExternalAgency.is_active.is_(True),
                )
            )
        ).first()
        if row is None:
            return None
        return row[0], row[1]

    # ------------------------------------------------------------------
    # Agencies
    # ------------------------------------------------------------------

    async def _assert_agency_name_free(
        self, organization_id: str, name: str, exclude_id: Optional[str] = None
    ) -> None:
        query = select(ExternalAgency.id).where(
            ExternalAgency.organization_id == str(organization_id),
            ExternalAgency.name == name,
        )
        if exclude_id is not None:
            query = query.where(ExternalAgency.id != str(exclude_id))
        if (await self.db.execute(query)).first() is not None:
            raise ValueError(f'An agency named "{name}" is already on the list')

    async def create_agency(
        self, organization_id: str, payload: Mapping[str, Any]
    ) -> ExternalAgency:
        await self._assert_agency_name_free(organization_id, payload["name"])
        agency = ExternalAgency(
            organization_id=str(organization_id),
            name=payload["name"],
            is_active=payload.get("is_active", True),
        )
        self.db.add(agency)
        await self.db.commit()
        await self.db.refresh(agency)
        return agency

    async def update_agency(
        self, organization_id: str, agency_id: str, updates: Mapping[str, Any]
    ) -> Optional[ExternalAgency]:
        agency = await self.get_agency(organization_id, agency_id)
        if agency is None:
            return None
        if updates.get("name") is not None:
            await self._assert_agency_name_free(
                organization_id, updates["name"], exclude_id=agency.id
            )
        apply_updates(agency, updates, skip=_PROTECTED)
        await self.db.commit()
        await self.db.refresh(agency)
        return agency

    async def delete_agency(
        self, organization_id: str, agency_id: str
    ) -> Optional[ExternalAgency]:
        agency = await self.get_agency(organization_id, agency_id)
        if agency is None:
            return None
        used = (
            await self.db.execute(
                select(func.count(ExternalShiftHours.id))
                .join(
                    ExternalApparatus,
                    ExternalApparatus.id == ExternalShiftHours.external_apparatus_id,
                )
                .where(
                    ExternalApparatus.agency_id == agency.id,
                    ExternalShiftHours.organization_id == str(organization_id),
                )
            )
        ).scalar_one()
        if used:
            raise ExternalApparatusInUseError(
                "Shifts have been logged on this agency's apparatus. "
                "Deactivate it instead, so those shifts keep their record."
            )
        await self.db.delete(agency)
        await self.db.commit()
        return agency

    # ------------------------------------------------------------------
    # Apparatus
    # ------------------------------------------------------------------

    async def _assert_apparatus_name_free(
        self, agency_id: str, name: str, exclude_id: Optional[str] = None
    ) -> None:
        query = select(ExternalApparatus.id).where(
            ExternalApparatus.agency_id == str(agency_id),
            ExternalApparatus.name == name,
        )
        if exclude_id is not None:
            query = query.where(ExternalApparatus.id != str(exclude_id))
        if (await self.db.execute(query)).first() is not None:
            raise ValueError(f'"{name}" is already listed for this agency')

    async def create_apparatus(
        self, organization_id: str, agency_id: str, payload: Mapping[str, Any]
    ) -> Optional[ExternalApparatus]:
        # Resolved through the caller's org, so a unit can never be filed
        # under another department's agency.
        agency = await self.get_agency(organization_id, agency_id)
        if agency is None:
            return None
        await self._assert_apparatus_name_free(agency.id, payload["name"])
        unit = ExternalApparatus(
            organization_id=str(organization_id),
            agency_id=agency.id,
            name=payload["name"],
            apparatus_type=payload.get("apparatus_type"),
            is_active=payload.get("is_active", True),
        )
        self.db.add(unit)
        await self.db.commit()
        await self.db.refresh(unit)
        return unit

    async def update_apparatus(
        self, organization_id: str, apparatus_id: str, updates: Mapping[str, Any]
    ) -> Optional[ExternalApparatus]:
        unit = await self.get_apparatus(organization_id, apparatus_id)
        if unit is None:
            return None
        if updates.get("name") is not None:
            await self._assert_apparatus_name_free(
                unit.agency_id, updates["name"], exclude_id=unit.id
            )
        apply_updates(unit, updates, skip=_PROTECTED)
        await self.db.commit()
        await self.db.refresh(unit)
        return unit

    async def delete_apparatus(
        self, organization_id: str, apparatus_id: str
    ) -> Optional[ExternalApparatus]:
        unit = await self.get_apparatus(organization_id, apparatus_id)
        if unit is None:
            return None
        used = (
            await self.db.execute(
                select(func.count(ExternalShiftHours.id)).where(
                    ExternalShiftHours.external_apparatus_id == unit.id,
                    ExternalShiftHours.organization_id == str(organization_id),
                )
            )
        ).scalar_one()
        if used:
            raise ExternalApparatusInUseError(
                "Shifts have been logged on this apparatus. "
                "Deactivate it instead, so those shifts keep their record."
            )
        await self.db.delete(unit)
        await self.db.commit()
        return unit

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    @staticmethod
    def serialize_agency(agency: ExternalAgency) -> Dict[str, Any]:
        return {
            "id": agency.id,
            "name": agency.name,
            "is_active": bool(agency.is_active),
        }

    @staticmethod
    def serialize_apparatus(unit: ExternalApparatus) -> Dict[str, Any]:
        return {
            "id": unit.id,
            "agency_id": unit.agency_id,
            "name": unit.name,
            "apparatus_type": unit.apparatus_type,
            "is_active": bool(unit.is_active),
        }
