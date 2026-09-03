"""Medical screening *status*. Listed only when the department turns it on.

Never a result, a provider or a note: those columns are encrypted at rest
and on the redaction denylist. What these tools say is whether a member is
current on each screening requirement and when it lapses.
"""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import require_member
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
        db: AsyncSession, principal: McpPrincipal, days: int = 30
    ) -> dict:
        """Screening records expiring within ``days`` days, with the member's
        name, the screening type and the expiry date."""
        days = max(1, min(days, 365))
        rows = await MedicalScreeningService(db).get_expiring_soon(
            principal.organization_id, days=days
        )
        # Members only: applicants' screenings belong to the prospective-
        # members module, which this switch does not cover.
        items = [
            {
                "record_id": r.record_id,
                "member_id": r.user_id,
                "member_name": r.user_name,
                "screening_type": r.screening_type,
                "requirement_name": r.requirement_name,
                "expiration_date": r.expiration_date.isoformat(),
                "days_until_expiration": r.days_until_expiration,
            }
            for r in rows
            if r.user_id
        ]
        return {"days": days, "items": items, "total": len(items)}
