"""The four Federal Programs every department starts with, as opportunities.

Owner decision, 2026-11-01 ("Grants — Opportunities Could Not Be Edited"):
the Federal Programs cards on the Grant Opportunities page were fixed text
nobody could start an application from. They are now ordinary
``grant_opportunities`` rows of each department — editable, retirable and
startable like any other — and the cards are gone.

``GrantOpportunity.organization_id`` is NOT NULL and an opportunity is edited
and retired per department, so these are per-department rows rather than
system rows: a new department gets them when it is created
(``OnboardingService.create_organization``), and a department that existed
before is given them by migration ``3c1f5e2a9d47``, which carries its own
frozen copy of the text below.

**Idempotent by program code.** A department that already holds an
opportunity with one of these ``federal_program_code`` values — retired or
not, typed in by hand or seeded — is not given a second: a retired one stays
retired, and an edited one keeps its edits. ``match_required`` and the award
range are left for the department to fill in: they change each funding year,
and a stale figure presented as fact is worse than a blank one.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.grant import DeadlineType, GrantCategory, GrantOpportunity

FEDERAL_PROGRAMS: tuple[dict[str, Any], ...] = (
    {
        "federal_program_code": "AFG",
        "name": "Assistance to Firefighters Grant (AFG)",
        "agency": "FEMA",
        "description": (
            "Provides funding for critically needed resources to equip and "
            "train emergency personnel, enhancing their capabilities to protect "
            "the public and reduce firefighter injuries."
        ),
        "category": GrantCategory.EQUIPMENT,
    },
    {
        "federal_program_code": "SAFER",
        "name": "Staffing for Adequate Fire and Emergency Response (SAFER)",
        "agency": "FEMA",
        "description": (
            "Provides funding to help fire departments increase or maintain the "
            "number of trained firefighters available in their communities."
        ),
        "category": GrantCategory.STAFFING,
    },
    {
        "federal_program_code": "FP&S",
        "name": "Fire Prevention & Safety (FP&S)",
        "agency": "FEMA",
        "description": (
            "Supports projects that enhance the safety of the public and "
            "firefighters from fire and related hazards through prevention and "
            "safety activities."
        ),
        "category": GrantCategory.PREVENTION,
    },
    {
        "federal_program_code": "FIREHOUSE_SUBS",
        "name": "Firehouse Subs Public Safety Foundation",
        "agency": "Firehouse Subs Foundation",
        "description": (
            "Provides funding for life-saving equipment, prevention education, "
            "scholarships, and continued training for first responders."
        ),
        "category": GrantCategory.EQUIPMENT,
    },
)

FEDERAL_PROGRAM_CODES = tuple(p["federal_program_code"] for p in FEDERAL_PROGRAMS)


async def seed_federal_program_opportunities(
    db: AsyncSession, organization_id: str
) -> int:
    """Give a department the programs it does not hold yet. Returns how many
    were added; a second call adds none."""
    held = await db.execute(
        select(GrantOpportunity.federal_program_code).where(
            GrantOpportunity.organization_id == str(organization_id),
            GrantOpportunity.federal_program_code.in_(FEDERAL_PROGRAM_CODES),
        )
    )
    have = set(held.scalars().all())
    added = 0
    for program in FEDERAL_PROGRAMS:
        if program["federal_program_code"] in have:
            continue
        db.add(
            GrantOpportunity(
                organization_id=str(organization_id),
                # Each runs on a yearly (FEMA) or recurring (foundation)
                # application cycle whose dates the department enters.
                deadline_type=DeadlineType.RECURRING,
                is_active=True,
                match_required=False,
                **program,
            )
        )
        added += 1
    if added:
        await db.flush()
    return added
