"""Training and certifications: records, requirement progress, expiries."""

from datetime import date, timedelta
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import (
    clamp_limit,
    clamp_offset,
    iso,
    member_names,
    org_uuid,
    page,
    require_member,
)
from app.models.training import TrainingRecord, TrainingStatus
from app.services.training_service import TrainingService
from app.utils.sql_ordering import nulls_last_desc


def _record(record: TrainingRecord, member_name: Optional[str]) -> dict:
    # Scores and certification numbers are deliberately not projected: a
    # score is a performance detail, a certification number a credential.
    return {
        "id": record.id,
        "member_id": record.user_id,
        "member_name": member_name,
        "course_name": record.course_name,
        "course_code": record.course_code,
        "training_type": iso(record.training_type),
        "status": iso(record.status),
        "scheduled_date": iso(record.scheduled_date),
        "completion_date": iso(record.completion_date),
        "expiration_date": iso(record.expiration_date),
        "hours_completed": record.hours_completed,
        "credit_hours": record.credit_hours,
        "issuing_agency": record.issuing_agency,
        "instructor": record.instructor,
        "location": record.location,
        "passed": record.passed,
    }


def register(server: Any) -> None:
    @logbook_tool(server, title="Expiring certifications", module="training")
    async def list_expiring_certifications(
        db: AsyncSession,
        principal: McpPrincipal,
        days_ahead: int = 90,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Certifications expiring within ``days_ahead`` days, including ones
        already expired, oldest expiry first, with the member's name. Paged:
        ``total`` counts every matching record, so a long-established
        department's expired history is read a page at a time."""
        days_ahead = max(1, min(days_ahead, 730))
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        # The same filter as TrainingService.get_expiring_certifications,
        # which has no page bounds because its API callers read one member.
        cutoff = date.today() + timedelta(days=days_ahead)
        criteria = (
            TrainingRecord.organization_id == principal.organization_id,
            TrainingRecord.status == TrainingStatus.COMPLETED,
            TrainingRecord.expiration_date.isnot(None),
            TrainingRecord.expiration_date <= cutoff,
        )
        total = (
            await db.execute(
                select(func.count()).select_from(TrainingRecord).where(*criteria)
            )
        ).scalar_one()
        rows = await db.execute(
            select(TrainingRecord)
            .where(*criteria)
            .order_by(TrainingRecord.expiration_date, TrainingRecord.id)
            .offset(offset)
            .limit(limit)
        )
        records = list(rows.scalars().all())
        names = await member_names(
            db, principal.organization_id, (r.user_id for r in records)
        )
        body = page(
            [_record(r, names.get(r.user_id)) for r in records], total, limit, offset
        )
        body["days_ahead"] = days_ahead
        return body

    @logbook_tool(server, title="Member training summary", module="training")
    async def get_member_training_summary(
        db: AsyncSession, principal: McpPrincipal, member_id: str
    ) -> dict:
        """A member's training figures: total hours and hours this training
        year, certifications held, active, expiring within 90 days and
        expired, and courses completed. This does not compute the green /
        yellow / red compliance standing; for standing against each
        requirement use get_member_requirements_progress."""
        member = await require_member(db, principal.organization_id, member_id)
        stats = await TrainingService(db).get_user_training_stats(
            UUID(member.id), org_uuid(principal)
        )
        return stats.model_dump(mode="json")

    @logbook_tool(server, title="Member requirement progress", module="training")
    async def get_member_requirements_progress(
        db: AsyncSession,
        principal: McpPrincipal,
        member_id: str,
        year: Optional[int] = None,
    ) -> dict:
        """Progress against each training requirement that applies to a member:
        required and completed hours, percentage, due date and days until due
        (negative when overdue). ``year`` narrows to one training year."""
        member = await require_member(db, principal.organization_id, member_id)
        progress = await TrainingService(db).get_all_requirements_progress(
            UUID(member.id), org_uuid(principal), year=year
        )
        return {"items": [p.model_dump(mode="json") for p in progress]}

    @logbook_tool(server, title="Member training records", module="training")
    async def list_member_training_records(
        db: AsyncSession,
        principal: McpPrincipal,
        member_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """A member's training records, most recent first."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        uid = (await require_member(db, principal.organization_id, member_id)).id
        rows = await db.execute(
            select(TrainingRecord)
            .where(
                TrainingRecord.organization_id == principal.organization_id,
                TrainingRecord.user_id == uid,
            )
            .order_by(
                *nulls_last_desc(TrainingRecord.completion_date),
                TrainingRecord.created_at.desc(),
            )
            .offset(offset)
            .limit(limit)
        )
        records = list(rows.scalars().all())
        names = await member_names(db, principal.organization_id, [uid])
        return page([_record(r, names.get(uid)) for r in records], None, limit, offset)
