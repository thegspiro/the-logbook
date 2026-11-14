"""Medical screening *status*. Listed only when the department turns it on.

Never a result, a provider or a note. All three are encrypted at rest, but
only `provider_name`, `result_summary` and `result_data` are also named on
the MCP redaction denylist (`app/mcp/redaction.py`) — `notes` is not, since
that field name is shared with several non-PHI modules (meetings, finance,
scheduling, generic write-ups), and denying it globally would strip their
legitimate content instead. What actually keeps `ScreeningRecord.notes` out
of these tools is that neither one reads it: both build their return dicts
from an explicit, closed field list (`ComplianceSummary`/`ComplianceItem`
for the first, a hand-picked projection for the second), so there is no
code path that touches it. A future addition to this file that serializes
a `ScreeningRecord` more broadly (e.g. `record.__dict__`, or the response
schema's own dump) would **not** be caught by the denylist for `notes` the
way it would for the other three — keep new tools on the same explicit-
projection discipline rather than relying on redaction to catch it. What
these tools say is whether a member is current on each screening
requirement and when it lapses.
"""

from typing import Any

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
from app.services.medical_screening_service import MedicalScreeningService


def register(server: Any) -> None:
    @logbook_tool(
        server,
        title="Member medical compliance",
        gate="medical_screening",
        module="medical_screening",
        permissions=("medical_screening.view", "medical_screening.manage"),
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
        # An explicit projection rather than the schema's dump: the item's
        # ``status`` is the record's outcome (passed, waived, ...), which is
        # a result by another name and is what this tool promises never to
        # say. Compliance is the yes/no derived from it.
        return {
            "member_id": summary.subject_id,
            "member_name": summary.subject_name,
            "total_requirements": summary.total_requirements,
            "compliant_count": summary.compliant_count,
            "non_compliant_count": summary.non_compliant_count,
            "expiring_soon_count": summary.expiring_soon_count,
            "is_fully_compliant": summary.is_fully_compliant,
            "self_recorded_count": summary.self_recorded_count,
            "items": [
                {
                    "requirement_id": item.requirement_id,
                    "requirement_name": item.requirement_name,
                    "screening_type": item.screening_type,
                    "is_compliant": item.is_compliant,
                    "last_screening_date": iso(item.last_screening_date),
                    "expiration_date": iso(item.expiration_date),
                    "days_until_expiration": item.days_until_expiration,
                    "due_by_frequency": item.expiration_from_frequency,
                    "in_grace_period": item.in_grace_period,
                    "grace_period_ends": iso(item.grace_period_ends),
                    "self_recorded": item.self_recorded,
                }
                for item in summary.items
            ],
        }

    @logbook_tool(
        server,
        title="Expiring screenings",
        gate="medical_screening",
        module="medical_screening",
        permissions=("medical_screening.view", "medical_screening.manage"),
    )
    async def list_expiring_screenings(
        db: AsyncSession,
        principal: McpPrincipal,
        days: int = 30,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Members' screenings falling due within ``days`` days, soonest
        first, with the member's name, the screening type and the due date —
        whether the record carries an expiration date or falls due by its
        requirement's frequency. A screening past due but inside its grace
        period is included with negative days and ``in_grace_period``. Paged;
        ``total`` counts every matching screening."""
        days = max(1, min(days, 365))
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        # The dashboard's own list, so the tool and the Compliance tab name the
        # same screenings: one due-date rule (frequency, grace, the linked
        # requirement, superseded records), computed in the service rather
        # than re-derived here (pitfall #29; owner decision 2026-11-01:
        # compute derived due dates in the tool). A frequency-derived date has
        # no column to page on in SQL, so the window is loaded and paged here;
        # it is bounded by ``days`` <= 365 and by one current record per
        # member and requirement. Members only: applicants' screenings belong
        # to the prospective-members module, which this switch does not cover.
        expiring = await MedicalScreeningService(db).get_expiring_soon(
            principal.organization_id, days=days, members_only=True
        )
        names = await member_names(
            db,
            principal.organization_id,
            (s.user_id for s in expiring[offset : offset + limit]),
        )
        items = [
            {
                "record_id": s.record_id,
                "member_id": s.user_id,
                "member_name": names.get(s.user_id or ""),
                "screening_type": iso(s.screening_type),
                "requirement_name": s.requirement_name,
                "expiration_date": s.expiration_date.isoformat(),
                "due_by_frequency": s.expiration_from_frequency,
                "days_until_expiration": s.days_until_expiration,
                "in_grace_period": s.in_grace_period,
                "grace_period_ends": iso(s.grace_period_ends),
            }
            for s in expiring[offset : offset + limit]
        ]
        body = page(items, len(expiring), limit, offset)
        body["days"] = days
        return body
