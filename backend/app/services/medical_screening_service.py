"""
Medical Screening Service

Business logic for managing medical screening requirements,
records, and compliance tracking.
"""

from datetime import date, timedelta
from typing import List, Optional

from sqlalchemy import Select, and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
)
from app.models.membership_pipeline import ProspectiveMember, ProspectStatus
from app.models.user import User, UserStatus
from app.schemas.medical_screening import (
    ComplianceItem,
    ComplianceSummary,
    ExpiringScreening,
    MyComplianceSummary,
    ScreeningRecordCreate,
    ScreeningRecordUpdate,
    ScreeningRequirementCreate,
    ScreeningRequirementUpdate,
    ScreeningSubject,
    ScreeningSubjects,
)
from app.utils.member_names import format_display_name
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import assert_in_org
from app.utils.org_timezone import resolve_org_today


def _page(query: Select, skip: int, limit: Optional[int]) -> Select:
    """Apply OFFSET/LIMIT to a list query; ``limit=None`` leaves it unbounded."""
    if skip:
        query = query.offset(skip)
    if limit is not None:
        query = query.limit(limit)
    return query


# Members a screening can be recorded for: everyone still on the roster,
# including a member on leave or suspended — a return-to-duty physical is
# exactly the record those two statuses need. Former members are left out.
_SCREENABLE_MEMBER_STATUSES = (
    UserStatus.ACTIVE,
    UserStatus.PROBATIONARY,
    UserStatus.LEAVE,
    UserStatus.SUSPENDED,
)
# Prospects still in the pipeline. An approved prospect becomes a member and
# is screened as one from then on.
_SCREENABLE_PROSPECT_STATUSES = (ProspectStatus.ACTIVE, ProspectStatus.ON_HOLD)


def _is_self(actor_id: Optional[str], subject_user_id: Optional[str]) -> bool:
    """Whether the person writing a record is the member it is about."""
    return bool(actor_id) and str(actor_id) == str(subject_user_id or "")


class MedicalScreeningService:
    """Service for medical screening operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # --- Screening Requirements ---

    async def list_requirements(
        self,
        organization_id: str,
        is_active: Optional[bool] = None,
        screening_type: Optional[str] = None,
        skip: int = 0,
        limit: Optional[int] = None,
    ) -> List[ScreeningRequirement]:
        """List screening requirements for an organization.

        ``skip``/``limit`` page in SQL (MS-6) — the endpoint used to load every
        row and slice in Python. ``limit=None`` keeps the full set for internal
        callers such as ``get_compliance_status``, which must grade against
        every active requirement.
        """
        query = select(ScreeningRequirement).where(
            ScreeningRequirement.organization_id == organization_id
        )
        if is_active is not None:
            query = query.where(ScreeningRequirement.is_active == is_active)
        if screening_type:
            query = query.where(ScreeningRequirement.screening_type == screening_type)
        # id breaks ties so two requirements sharing a name cannot swap pages
        # between requests.
        query = query.order_by(ScreeningRequirement.name, ScreeningRequirement.id)
        query = _page(query, skip, limit)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_requirement(
        self, requirement_id: str, organization_id: str
    ) -> Optional[ScreeningRequirement]:
        """Get a single screening requirement."""
        result = await self.db.execute(
            select(ScreeningRequirement).where(
                and_(
                    ScreeningRequirement.id == requirement_id,
                    ScreeningRequirement.organization_id == organization_id,
                )
            )
        )
        screening_requirement: Optional[ScreeningRequirement] = (
            result.scalar_one_or_none()
        )
        return screening_requirement

    async def create_requirement(
        self,
        organization_id: str,
        data: ScreeningRequirementCreate,
    ) -> ScreeningRequirement:
        """Create a new screening requirement."""
        requirement = ScreeningRequirement(
            id=generate_uuid(),
            organization_id=organization_id,
            name=data.name,
            screening_type=data.screening_type,
            description=data.description,
            frequency_months=data.frequency_months,
            applies_to_roles=data.applies_to_roles,
            is_active=data.is_active,
            grace_period_days=data.grace_period_days,
        )
        self.db.add(requirement)
        await self.db.flush()
        # Server-side `created_at` / `updated_at` stay expired after the flush,
        # and the response_model requires both. Pydantic reads attributes
        # synchronously, so the lazy reload raises MissingGreenlet and the POST
        # 500s on a row it did create.
        await self.db.refresh(requirement)
        return requirement

    async def update_requirement(
        self,
        requirement_id: str,
        organization_id: str,
        data: ScreeningRequirementUpdate,
    ) -> Optional[ScreeningRequirement]:
        """Update a screening requirement."""
        requirement = await self.get_requirement(requirement_id, organization_id)
        if not requirement:
            return None
        # name and screening_type are NOT NULL columns; an explicit null on
        # either used to reach db.flush() unguarded and 500 as a raw
        # IntegrityError instead of the clean 400 apply_updates raises.
        apply_updates(requirement, data.model_dump(exclude_unset=True))
        await self.db.flush()
        return requirement

    async def delete_requirement(
        self, requirement_id: str, organization_id: str
    ) -> bool:
        """Delete a screening requirement."""
        requirement = await self.get_requirement(requirement_id, organization_id)
        if not requirement:
            return False
        await self.db.delete(requirement)
        await self.db.flush()
        return True

    # --- Screening Records ---

    async def list_records(
        self,
        organization_id: str,
        user_id: Optional[str] = None,
        prospect_id: Optional[str] = None,
        screening_type: Optional[str] = None,
        status: Optional[str] = None,
        skip: int = 0,
        limit: Optional[int] = None,
    ) -> List[ScreeningRecord]:
        """List screening records with optional filters.

        ``skip``/``limit`` page in SQL (MS-6). ``limit=None`` returns every
        match, which only internal callers use — ``get_compliance_status``
        always passes a single subject, so its set is one person's history.
        """
        query = select(ScreeningRecord).where(
            ScreeningRecord.organization_id == organization_id
        )
        if user_id:
            query = query.where(ScreeningRecord.user_id == user_id)
        if prospect_id:
            query = query.where(ScreeningRecord.prospect_id == prospect_id)
        if screening_type:
            query = query.where(ScreeningRecord.screening_type == screening_type)
        if status:
            query = query.where(ScreeningRecord.status == status)
        # created_at has one-second resolution, so a batch entered together
        # ties on it; id keeps the order stable across page requests.
        query = query.order_by(ScreeningRecord.created_at.desc(), ScreeningRecord.id)
        query = _page(query, skip, limit)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_record(
        self, record_id: str, organization_id: str
    ) -> Optional[ScreeningRecord]:
        """Get a single screening record."""
        result = await self.db.execute(
            select(ScreeningRecord).where(
                and_(
                    ScreeningRecord.id == record_id,
                    ScreeningRecord.organization_id == organization_id,
                )
            )
        )
        screening_record: Optional[ScreeningRecord] = result.scalar_one_or_none()
        return screening_record

    async def list_subjects(self, organization_id: str) -> ScreeningSubjects:
        """Members and prospects a new screening record can be filed against.

        Backs the Add Record picker (MS-13). Org-scoped; names only. Bounded by
        the roster and the open pipeline rather than paged, because a picker
        that silently omits someone is worse than a long list.
        """
        member_rows = await self.db.execute(
            select(User.id, User.first_name, User.last_name, User.preferred_name)
            .where(
                User.organization_id == organization_id,
                User.deleted_at.is_(None),
                User.status.in_(_SCREENABLE_MEMBER_STATUSES),
            )
            .order_by(User.last_name, User.first_name, User.id)
        )
        prospect_rows = await self.db.execute(
            select(
                ProspectiveMember.id,
                ProspectiveMember.first_name,
                ProspectiveMember.last_name,
            )
            .where(
                ProspectiveMember.organization_id == organization_id,
                ProspectiveMember.status.in_(_SCREENABLE_PROSPECT_STATUSES),
            )
            .order_by(
                ProspectiveMember.last_name,
                ProspectiveMember.first_name,
                ProspectiveMember.id,
            )
        )
        return ScreeningSubjects(
            members=[
                ScreeningSubject(
                    id=uid, name=format_display_name(first, last, preferred)
                )
                for uid, first, last, preferred in member_rows.all()
            ],
            prospects=[
                ScreeningSubject(id=pid, name=f"{first or ''} {last or ''}".strip())
                for pid, first, last in prospect_rows.all()
            ],
        )

    async def create_record(
        self,
        organization_id: str,
        data: ScreeningRecordCreate,
        recorded_by: Optional[str] = None,
    ) -> ScreeningRecord:
        """Create a new screening record.

        ``recorded_by`` is the caller; when it is the record's own subject the
        record is marked ``self_recorded`` (MS-7).
        """
        # MS-3 (XC-1): the record is org-stamped from the caller, but its
        # subject/requirement ids come from the client. This record holds PHI,
        # so a foreign user_id doesn't just dangle — it attaches medical
        # screening results to the wrong person. Validate each in-org before
        # persisting; assert_in_org fails closed (ValueError → 400) and no-ops
        # on the ids that weren't supplied.
        await assert_in_org(
            self.db,
            User,
            data.user_id,
            organization_id,
            allow_none=True,
            label="member",
        )
        await assert_in_org(
            self.db,
            ProspectiveMember,
            data.prospect_id,
            organization_id,
            allow_none=True,
            label="prospect",
        )
        await assert_in_org(
            self.db,
            ScreeningRequirement,
            data.requirement_id,
            organization_id,
            allow_none=True,
            label="screening requirement",
        )
        record = ScreeningRecord(
            id=generate_uuid(),
            organization_id=organization_id,
            requirement_id=data.requirement_id,
            user_id=data.user_id,
            prospect_id=data.prospect_id,
            screening_type=data.screening_type,
            status=data.status,
            scheduled_date=data.scheduled_date,
            completed_date=data.completed_date,
            expiration_date=data.expiration_date,
            provider_name=data.provider_name,
            result_summary=data.result_summary,
            result_data=data.result_data,
            notes=data.notes,
            self_recorded=_is_self(recorded_by, data.user_id),
        )
        self.db.add(record)
        await self.db.flush()
        # Server-side `created_at` / `updated_at` stay expired after the flush,
        # and the response_model requires both. Pydantic reads attributes
        # synchronously, so the lazy reload raises MissingGreenlet and the POST
        # 500s on a row it did create.
        await self.db.refresh(record)
        return record

    async def update_record(
        self,
        record_id: str,
        organization_id: str,
        data: ScreeningRecordUpdate,
        reviewed_by: Optional[str] = None,
    ) -> Optional[ScreeningRecord]:
        """Update a screening record."""
        record = await self.get_record(record_id, organization_id)
        if not record:
            return None
        # screening_type and status are NOT NULL columns; an explicit null on
        # either used to reach db.flush() unguarded and 500 as a raw
        # IntegrityError instead of the clean 400 apply_updates raises.
        changes = data.model_dump(exclude_unset=True)
        apply_updates(record, changes)
        if reviewed_by and data.status in ("passed", "failed", "waived"):
            from datetime import datetime, timezone

            record.reviewed_by = reviewed_by
            record.reviewed_at = datetime.now(timezone.utc)
        # MS-7: whoever submits the status owns it. The edit form always sends
        # the status, so saving a record — with its result on screen — counts,
        # which is also what lets a colleague's save clear a self-recorded
        # pass. An update that leaves the status out keeps the flag.
        if reviewed_by and "status" in changes:
            record.self_recorded = _is_self(reviewed_by, record.user_id)
        await self.db.flush()
        return record

    async def try_advance_pipeline_stage(
        self,
        record: ScreeningRecord,
        organization_id: str,
        completed_by: str,
    ) -> bool:
        """Advance a prospect parked on a medical screening stage, if cleared.

        A screening result is the completion evidence a MEDICAL_SCREENING stage
        waits on, but nothing connected the two: an org could tick the stage's
        "auto-advance" box and still watch cleared applicants sit there until
        someone moved them by hand.

        Only a cleared result is evidence, so this mirrors the stage gate's own
        definition (``PASSED``/``COMPLETED``) rather than treating any write as
        progress. The gate still has the final say — it requires *every*
        configured screening to have cleared, so clearing one of three defers
        the advance instead of granting it.

        Call this after the screening write is committed: completing a stage
        commits, and an uncommitted screening row would otherwise ride along.
        """
        if not record.prospect_id:
            return False
        if record.status not in (ScreeningStatus.PASSED, ScreeningStatus.COMPLETED):
            return False

        from app.models.membership_pipeline import PipelineStepType
        from app.services.membership_pipeline_service import (
            MembershipPipelineService,
        )

        screening_type = (
            record.screening_type.value
            if hasattr(record.screening_type, "value")
            else record.screening_type
        )
        return await MembershipPipelineService(self.db).try_auto_advance_current_step(
            prospect_id=str(record.prospect_id),
            organization_id=organization_id,
            step_type=PipelineStepType.MEDICAL_SCREENING,
            trigger="medical screening result",
            completed_by=completed_by,
            action_result={
                "screening_record_id": str(record.id),
                "screening_type": screening_type,
            },
        )

    async def delete_record(self, record_id: str, organization_id: str) -> bool:
        """Delete a screening record."""
        record = await self.get_record(record_id, organization_id)
        if not record:
            return False
        await self.db.delete(record)
        await self.db.flush()
        return True

    # --- Compliance ---

    async def get_compliance_status(
        self,
        organization_id: str,
        user_id: Optional[str] = None,
        prospect_id: Optional[str] = None,
    ) -> ComplianceSummary:
        """
        Check compliance status for a user or prospect against all
        active screening requirements.
        """
        # Get active requirements
        requirements = await self.list_requirements(organization_id, is_active=True)

        # Get records for this subject
        records = await self.list_records(
            organization_id,
            user_id=user_id,
            prospect_id=prospect_id,
        )

        today = await resolve_org_today(self.db, organization_id)
        items: List[ComplianceItem] = []
        compliant_count = 0
        expiring_soon_count = 0
        self_recorded_count = 0

        for req in requirements:
            # Find the most recent passing/completed record for this requirement type
            matching_records = [
                r
                for r in records
                if r.screening_type == req.screening_type
                and r.status
                in (
                    ScreeningStatus.PASSED.value,
                    ScreeningStatus.COMPLETED.value,
                    ScreeningStatus.WAIVED.value,
                )
            ]
            matching_records.sort(
                key=lambda r: r.completed_date or date.min, reverse=True
            )

            latest = matching_records[0] if matching_records else None
            is_compliant = False
            days_until_exp = None

            if latest:
                if latest.expiration_date:
                    is_compliant = latest.expiration_date >= today
                    days_until_exp = (latest.expiration_date - today).days
                    # `0 <=`, not `0 <`: a screening expiring **today** is the
                    # one most in need of flagging, and `get_expiring_soon`
                    # below already returns it (`expiration_date >= today`).
                    # Excluding it here meant the summary count and the list it
                    # links to disagreed about the same member on that single
                    # day — the count said nothing was due, the list named it.
                    # Keep the two windows in step: this is the other half of
                    # the same "expiring soon" definition, and the WAIVED
                    # divergence between them is recorded as MS2-7.
                    if 0 <= days_until_exp <= 30:
                        expiring_soon_count += 1
                else:
                    # No expiration = compliant indefinitely
                    is_compliant = True

            self_recorded = bool(latest and latest.self_recorded)
            if is_compliant:
                compliant_count += 1
                if self_recorded:
                    self_recorded_count += 1

            items.append(
                ComplianceItem(
                    requirement_id=req.id,
                    requirement_name=req.name,
                    screening_type=req.screening_type,
                    is_compliant=is_compliant,
                    last_screening_date=(latest.completed_date if latest else None),
                    expiration_date=(latest.expiration_date if latest else None),
                    days_until_expiration=days_until_exp,
                    status=latest.status if latest else None,
                    self_recorded=self_recorded,
                )
            )

        subject_type = "user" if user_id else "prospect"
        subject_id = user_id or prospect_id or ""

        # MS-2: resolve the subject's display name (was always blank).
        names = await self._resolve_names(
            organization_id,
            user_ids={user_id} if user_id else set(),
            prospect_ids={prospect_id} if prospect_id else set(),
            requirement_ids=set(),
        )
        subject_name = (
            names["users"].get(user_id)
            if user_id
            else names["prospects"].get(prospect_id)
        ) or ""

        return ComplianceSummary(
            subject_id=subject_id,
            subject_name=subject_name,
            subject_type=subject_type,
            total_requirements=len(requirements),
            compliant_count=compliant_count,
            non_compliant_count=len(requirements) - compliant_count,
            expiring_soon_count=expiring_soon_count,
            is_fully_compliant=compliant_count == len(requirements),
            self_recorded_count=self_recorded_count,
            items=items,
        )

    async def get_my_compliance_summary(
        self,
        organization_id: str,
        user_id: str,
    ) -> MyComplianceSummary:
        """Reduce a member's own compliance to counts, dropping the detail.

        Built on top of ``get_compliance_status`` so there is one definition of
        "compliant" rather than two that can drift apart. Everything naming a
        specific screening is discarded here — see ``MyComplianceSummary``.
        """
        full = await self.get_compliance_status(
            organization_id=organization_id,
            user_id=user_id,
        )

        # Soonest lapse among screenings that are still valid. Anything already
        # lapsed is reported by non_compliant_count, so a negative number never
        # reaches the caller and cannot be rendered as "expires in -3 days".
        upcoming = [
            item.days_until_expiration
            for item in full.items
            if item.is_compliant
            and item.days_until_expiration is not None
            and item.days_until_expiration >= 0
        ]

        return MyComplianceSummary(
            total_requirements=full.total_requirements,
            compliant_count=full.compliant_count,
            non_compliant_count=full.non_compliant_count,
            expiring_soon_count=full.expiring_soon_count,
            is_fully_compliant=full.is_fully_compliant,
            days_until_next_expiration=min(upcoming) if upcoming else None,
        )

    async def get_expiring_soon(
        self,
        organization_id: str,
        days: int = 30,
    ) -> List[ExpiringScreening]:
        """Find screening records expiring within the given number of days."""
        today = await resolve_org_today(self.db, organization_id)
        cutoff = today + timedelta(days=days)

        query = (
            select(ScreeningRecord)
            .where(
                and_(
                    ScreeningRecord.organization_id == organization_id,
                    ScreeningRecord.expiration_date.isnot(None),
                    ScreeningRecord.expiration_date >= today,
                    ScreeningRecord.expiration_date <= cutoff,
                    ScreeningRecord.status.in_(
                        [
                            ScreeningStatus.PASSED.value,
                            ScreeningStatus.COMPLETED.value,
                        ]
                    ),
                )
            )
            .order_by(ScreeningRecord.expiration_date.asc())
        )
        result = await self.db.execute(query)
        records = list(result.scalars().all())

        # MS-2: resolve subject and requirement names in one batch each. The
        # response schema carries these fields and the dashboard renders
        # "Unknown" without them; a per-row lookup would be an N+1 over the
        # expiring set. All three queries are org-scoped.
        names = await self._resolve_names(
            organization_id,
            user_ids={r.user_id for r in records if r.user_id},
            prospect_ids={r.prospect_id for r in records if r.prospect_id},
            requirement_ids={r.requirement_id for r in records if r.requirement_id},
        )

        expiring: List[ExpiringScreening] = []
        for record in records:
            days_left = (
                (record.expiration_date - today).days if record.expiration_date else 0
            )
            expiring.append(
                ExpiringScreening(
                    record_id=record.id,
                    screening_type=record.screening_type,
                    requirement_name=names["requirements"].get(record.requirement_id),
                    user_id=record.user_id,
                    user_name=names["users"].get(record.user_id),
                    prospect_id=record.prospect_id,
                    prospect_name=names["prospects"].get(record.prospect_id),
                    expiration_date=record.expiration_date,
                    days_until_expiration=days_left,
                    self_recorded=bool(record.self_recorded),
                )
            )

        return expiring

    async def _resolve_names(
        self,
        organization_id: str,
        *,
        user_ids: set,
        prospect_ids: set,
        requirement_ids: set,
    ) -> dict:
        """Batch-resolve member / prospect / requirement display names, org-scoped.

        Returns ``{"users": {id: name}, "prospects": {id: name},
        "requirements": {id: name}}``. Missing or out-of-org ids are simply
        absent from their map, so callers get ``None`` from ``.get`` — a name
        never leaks across organizations.
        """
        users: dict = {}
        if user_ids:
            rows = await self.db.execute(
                select(
                    User.id, User.first_name, User.last_name, User.preferred_name
                ).where(
                    User.id.in_(user_ids),
                    User.organization_id == organization_id,
                )
            )
            # Members are named as they go by; prospects (below) have no
            # preferred name and keep first + last.
            users = {
                uid: format_display_name(first, last, preferred)
                for uid, first, last, preferred in rows.all()
            }

        prospects: dict = {}
        if prospect_ids:
            rows = await self.db.execute(
                select(
                    ProspectiveMember.id,
                    ProspectiveMember.first_name,
                    ProspectiveMember.last_name,
                ).where(
                    ProspectiveMember.id.in_(prospect_ids),
                    ProspectiveMember.organization_id == organization_id,
                )
            )
            prospects = {
                pid: f"{first or ''} {last or ''}".strip()
                for pid, first, last in rows.all()
            }

        requirements: dict = {}
        if requirement_ids:
            rows = await self.db.execute(
                select(ScreeningRequirement.id, ScreeningRequirement.name).where(
                    ScreeningRequirement.id.in_(requirement_ids),
                    ScreeningRequirement.organization_id == organization_id,
                )
            )
            requirements = {rid: name for rid, name in rows.all()}

        return {"users": users, "prospects": prospects, "requirements": requirements}

    async def attach_record_names(
        self, organization_id: str, records: List[ScreeningRecord]
    ) -> None:
        """Populate the display-name fields on record responses, in place.

        `ScreeningRecordResponse` carries `user_name` / `prospect_name` /
        `reviewer_name` / `requirement_name`, but the ORM row has none of them —
        so without this, every record on `/records` and `/records/{id}`
        serializes those as null and the UI (MedicalScreeningPage records tab)
        shows "Unknown". Resolves all four org-scoped, one batch query per entity
        type (the reviewer is a `User`, folded into the same user lookup), then
        sets plain instance attributes Pydantic reads via `from_attributes`;
        they are not mapped columns and never persist. Same batch approach and
        org-scoping guarantee as `get_expiring_soon` — a name can't cross orgs.
        """
        if not records:
            return
        names = await self._resolve_names(
            organization_id,
            user_ids={r.user_id for r in records if r.user_id}
            | {r.reviewed_by for r in records if r.reviewed_by},
            prospect_ids={r.prospect_id for r in records if r.prospect_id},
            requirement_ids={r.requirement_id for r in records if r.requirement_id},
        )
        for r in records:
            r.user_name = names["users"].get(r.user_id) if r.user_id else None
            r.prospect_name = (
                names["prospects"].get(r.prospect_id) if r.prospect_id else None
            )
            r.reviewer_name = (
                names["users"].get(r.reviewed_by) if r.reviewed_by else None
            )
            r.requirement_name = (
                names["requirements"].get(r.requirement_id)
                if r.requirement_id
                else None
            )
