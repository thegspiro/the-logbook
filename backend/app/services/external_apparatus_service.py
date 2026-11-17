"""
The list of outside agencies and apparatus members may log shifts on.

Scheduling officers maintain it; members only pick from it. A unit that is
no longer used is deactivated, which hides it from the picker while every
shift already logged on it keeps its name. Deleting is allowed only while
nothing references the row, because a delete that silently detached logged
shifts would quietly change the apparatus summary leadership reads.
"""

from typing import Any, Dict, List, Mapping, Optional

from sqlalchemy import func, select, update
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
        """The unit and its agency, if a member may log a shift on it now.

        The unit row is read with a shared lock, held until the caller
        commits the shift it is logging. :meth:`merge_agency` takes an
        exclusive lock on the same row before it moves or removes the unit, so
        the two serialize: a shift logged during a merge waits for it and
        then reads the unit's new agency, and a merge started while a shift
        is being logged waits for that shift and relabels it. Without it, a
        shift could land on a moved unit still carrying the merged-away name.

        Only the unit is locked, and its agency read without one. The merge
        locks agencies before units; locking both here, in a join whose row
        order the database chooses, could take them the other way round and
        deadlock. The unit's lock is the one that matters: it is what a merge
        rewrites.
        """
        unit = (
            await self.db.execute(
                select(ExternalApparatus)
                .where(
                    ExternalApparatus.id == str(apparatus_id),
                    ExternalApparatus.organization_id == str(organization_id),
                    ExternalApparatus.is_active.is_(True),
                )
                .with_for_update(read=True)
                # A copy already in the session would otherwise be handed
                # back as it was, not as the locked read found it.
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if unit is None:
            return None
        agency = (
            await self.db.execute(
                select(ExternalAgency).where(
                    ExternalAgency.id == unit.agency_id,
                    ExternalAgency.organization_id == str(organization_id),
                    ExternalAgency.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if agency is None:
            return None
        return unit, agency

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
            evaluate_shifts=bool(payload.get("evaluate_shifts", False)),
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

    async def merge_agency(
        self, organization_id: str, source_id: str, target_id: str
    ) -> Optional[Dict[str, Any]]:
        """Fold ``source`` into ``target``: one department under one name.

        For when the same department reached the list twice under two
        spellings ("Arlington County" and "Arlington County Fire
        Department"), typically from a history import.

        * Each of the source's units moves to the target. A unit the target
          already has under the same name, as the database's collation
          judges it (see :meth:`_same_named_unit`), is combined instead: its shifts
          are repointed to the target's unit and the duplicate is removed.
        * **Past shifts are relabelled** with the target's name — owner
          decision 2026-11-16, overriding the usual rule that a shift keeps
          the names it was logged under, because the point of a merge is that
          one department reads as one everywhere. That covers shifts on the
          source's units and shifts whose unit was deleted but which still
          carry the source's name. It cannot be undone from the record; the
          endpoint's audit event keeps both names.
        * The target keeps its own settings (active, evaluated shifts), so a
          moved unit's shifts follow the target's evaluation setting.
        * A shift's review status is untouched: an officer combining two
          spellings has not changed what the member claimed.

        Both agency rows are locked for the transaction, so two officers
        merging at once cannot each move half the units. Returns None when
        either agency is not in the organization.
        """
        org = str(organization_id)
        if str(source_id) == str(target_id):
            raise ValueError("Choose a different department to merge into")

        agencies = {
            a.id: a
            for a in (
                await self.db.execute(
                    select(ExternalAgency)
                    .where(
                        ExternalAgency.organization_id == org,
                        ExternalAgency.id.in_([str(source_id), str(target_id)]),
                    )
                    .with_for_update()
                )
            ).scalars()
        }
        source = agencies.get(str(source_id))
        target = agencies.get(str(target_id))
        if source is None or target is None:
            return None

        units = list(
            (
                await self.db.execute(
                    select(ExternalApparatus)
                    .where(
                        ExternalApparatus.organization_id == org,
                        ExternalApparatus.agency_id.in_([source.id, target.id]),
                    )
                    .with_for_update()
                )
            ).scalars()
        )
        target_units = {u.id: u for u in units if u.agency_id == target.id}

        moved = combined = relabelled = 0
        for unit in (u for u in units if u.agency_id == source.id):
            match_id = await self._same_named_unit(org, target.id, unit.name)
            match = target_units.get(match_id) if match_id else None
            values: Dict[str, Any] = {"agency_name": target.name}
            if match is not None:
                values.update(external_apparatus_id=match.id, apparatus_name=match.name)
            result = await self.db.execute(
                update(ExternalShiftHours)
                .where(
                    ExternalShiftHours.organization_id == org,
                    ExternalShiftHours.external_apparatus_id == unit.id,
                )
                .values(**values)
                .execution_options(synchronize_session=False)
            )
            relabelled += result.rowcount or 0
            if match is not None:
                await self.db.delete(unit)
                combined += 1
            else:
                unit.agency_id = target.id
                moved += 1

        detached = await self.db.execute(
            update(ExternalShiftHours)
            .where(
                ExternalShiftHours.organization_id == org,
                ExternalShiftHours.external_apparatus_id.is_(None),
                ExternalShiftHours.agency_name == source.name,
            )
            .values(agency_name=target.name)
            .execution_options(synchronize_session=False)
        )
        relabelled += detached.rowcount or 0

        # The moves must reach the database before the source goes: its
        # delete cascades to whatever units still name it.
        await self.db.flush()
        source_name = source.name
        await self.db.delete(source)
        await self.db.commit()
        return {
            "agency_id": target.id,
            "source_name": source_name,
            "target_name": target.name,
            "moved_apparatus": moved,
            "combined_apparatus": combined,
            "relabelled_shifts": relabelled,
        }

    async def _same_named_unit(
        self, organization_id: str, agency_id: str, name: str
    ) -> Optional[str]:
        """The agency's unit the database counts as having this name, if any.

        Asked of the database rather than compared in Python because the
        unique index on ``(agency_id, name)`` decides by the column's
        collation (``utf8mb4_unicode_ci``): case- and accent-blind, trailing
        spaces ignored, leading ones not. A Python approximation disagrees
        with it somewhere, and where it says "different" and the index says
        "same", moving the unit violates the index and the merge rolls back.
        """
        return (
            await self.db.execute(
                select(ExternalApparatus.id).where(
                    ExternalApparatus.organization_id == str(organization_id),
                    ExternalApparatus.agency_id == str(agency_id),
                    ExternalApparatus.name == name,
                )
                # A locking read, so it sees the latest committed names rather
                # than the snapshot the request's first plain read (loading
                # the signed-in user) fixed. A unit renamed after that point
                # would otherwise be missed, or matched by its old name. The
                # merge already holds these rows' locks, so this waits on
                # nothing new.
                .with_for_update()
            )
        ).scalar_one_or_none()

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
            "evaluate_shifts": bool(agency.evaluate_shifts),
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
