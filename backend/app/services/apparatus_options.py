"""
The department's vehicles, as any signed-in member may see them.

One definition of "this department's vehicles", shared by the shift-template
picker (``GET /scheduling/apparatus-options``) and suggestion-box apparatus
questions, so the two can never offer different fleets.
"""

from typing import List, Tuple

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import BasicApparatus
from app.schemas.scheduling import ApparatusOption
from app.utils.positions import normalize_stored_positions


async def department_apparatus_options(
    db: AsyncSession, organization_id: str
) -> Tuple[List[ApparatusOption], str]:
    """The org's vehicles and where they came from: the full Apparatus
    module (``"apparatus"``), else the lightweight BasicApparatus list
    (``"basic"``), else nothing (``"none"``). Archived and inactive vehicles
    are left out."""
    org_id = str(organization_id)
    options: List[ApparatusOption] = []

    try:
        from app.models.apparatus import Apparatus as FullApparatus
        from app.models.apparatus import ApparatusType

        result = await db.execute(
            select(FullApparatus, ApparatusType.name.label("type_name"))
            .join(
                ApparatusType,
                FullApparatus.apparatus_type_id == ApparatusType.id,
                isouter=True,
            )
            .where(FullApparatus.organization_id == org_id)
            .where(FullApparatus.is_archived.is_(False))
            .order_by(FullApparatus.unit_number)
        )
        for apparatus, type_name in result.all():
            options.append(
                ApparatusOption(
                    id=apparatus.id,
                    name=apparatus.name or apparatus.unit_number,
                    unit_number=apparatus.unit_number,
                    apparatus_type=(type_name or "other").lower(),
                    source="apparatus",
                    positions=normalize_stored_positions(apparatus.crew_positions),
                    min_staffing=apparatus.min_staffing,
                )
            )
    except Exception as exc:
        # The full Apparatus module may not be installed for this org; fall
        # through to BasicApparatus. Log so a genuine query failure (vs. the
        # module simply being absent) is still diagnosable.
        logger.debug(f"Apparatus module lookup failed, using fallback: {exc}")
    if options:
        return options, "apparatus"

    basic_result = await db.execute(
        select(BasicApparatus)
        .where(BasicApparatus.organization_id == org_id)
        .where(BasicApparatus.is_active.is_(True))
        .order_by(BasicApparatus.unit_number)
    )
    for basic_row in basic_result.scalars().all():
        options.append(
            ApparatusOption(
                id=basic_row.id,
                name=basic_row.name,
                unit_number=basic_row.unit_number,
                apparatus_type=basic_row.apparatus_type or "other",
                source="basic",
                positions=normalize_stored_positions(basic_row.positions),
                min_staffing=basic_row.min_staffing,
            )
        )
    return options, ("basic" if options else "none")
