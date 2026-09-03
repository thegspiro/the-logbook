"""Medical screening *status*. Listed only when the department turns it on.

Never a result, a provider or a note: those columns are encrypted at rest
and on the redaction denylist. What these tools say is whether a member is
current on each screening requirement and when it lapses.
"""

from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import (
    clamp_limit,
    clamp_offset,
    iso,
    member_names,
    page,
    require_member,
)
from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
)
from app.services.medical_screening_service import MedicalScreeningService


def register(server: Any) -> None:
    @logbook_tool(
        server,
        title="Member medical compliance",
        gate="medical_screening",
        module="medical_screening",
    )
    async def get_member_medical_compliance(
        db: AsyncSession, principal: McpPrincipal, member_id: str
    ) -> dict:
        """Whether a member is current on each active screening requirement:
        compliant or not, last screening date, expiration and days left.
        Status only — no results."""
        member = await require_member(db, principal.organization_id, member_id)
        summary = await MedicalScreeningService(db).get_compliance_status(
            principal.organization_id, user_id=member.id
        )
        return summary.model_dump(mode="json")

    @logbook_tool(
        server,
        title="Expiring screenings",
        gate="medical_screening",
        module="medical_screening",
    )
    async def list_expiring_screenings(
        db: AsyncSession,
        principal: McpPrincipal,
        days: int = 30,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Members' screening records expiring within ``days`` days, soonest
        first, with the member's name, the screening type and the expiry
        date. Paged; ``total`` counts every matching record."""
        days = max(1, min(days, 365))
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        today = date.today()
        # The same filter as MedicalScreeningService.get_expiring_soon, which
        # loads the whole window for a dashboard; here it is paged, and
        # restricted to members in SQL: applicants' screenings belong to the
        # prospective-members module, which this switch does not cover.
        criteria = (
            ScreeningRecord.organization_id == principal.organization_id,
            ScreeningRecord.user_id.isnot(None),
            ScreeningRecord.expiration_date.isnot(None),
            ScreeningRecord.expiration_date >= today,
            ScreeningRecord.expiration_date <= today + timedelta(days=days),
            ScreeningRecord.status.in_(
                [ScreeningStatus.PASSED.value, ScreeningStatus.COMPLETED.value]
            ),
        )
        total = (
            await db.execute(
                select(func.count()).select_from(ScreeningRecord).where(*criteria)
            )
        ).scalar_one()
        rows = await db.execute(
            select(ScreeningRecord)
            .where(*criteria)
            .order_by(ScreeningRecord.expiration_date.asc(), ScreeningRecord.id)
            .offset(offset)
            .limit(limit)
        )
        records = list(rows.scalars().all())
        names = await member_names(
            db, principal.organization_id, (r.user_id for r in records)
        )
        requirement_ids = {r.requirement_id for r in records if r.requirement_id}
        requirements: dict[str, str] = {}
        if requirement_ids:
            found = await db.execute(
                select(ScreeningRequirement.id, ScreeningRequirement.name).where(
                    ScreeningRequirement.organization_id == principal.organization_id,
                    ScreeningRequirement.id.in_(requirement_ids),
                )
            )
            requirements = {row.id: row.name for row in found.all()}
        items = [
            {
                "record_id": r.id,
                "member_id": r.user_id,
                "member_name": names.get(r.user_id),
                "screening_type": iso(r.screening_type),
                "requirement_name": requirements.get(r.requirement_id or ""),
                "expiration_date": r.expiration_date.isoformat(),
                "days_until_expiration": (r.expiration_date - today).days,
            }
            for r in records
        ]
        body = page(items, total, limit, offset)
        body["days"] = days
        return body
