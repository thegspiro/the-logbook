"""
Medical Screening Service

Business logic for managing medical screening requirements,
records, and compliance tracking.
"""

import re
from datetime import date, timedelta
from typing import Dict, List, Optional, Set, Tuple

from dateutil.relativedelta import relativedelta
from sqlalchemy import Select, and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
)
from app.models.membership_pipeline import ProspectiveMember, ProspectStatus
from app.models.user import Position, User, UserStatus, user_positions
from app.schemas.medical_screening import (
    ComplianceItem,
    ComplianceRoster,
    ComplianceRosterRow,
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


def _role_key(value: str) -> str:
    """A position name or slug in the one spelling they are compared by.

    "Safety Officer" is the name and ``safety_officer`` the slug of the same
    position; an officer typing either, in any case, means it.
    """
    return " ".join(re.split(r"[\s_\-]+", value.strip().casefold())).strip()


def _requirement_roles(requirement: ScreeningRequirement) -> Set[str]:
    """The positions a requirement is scoped to; empty when it is not scoped.

    ``applies_to_roles`` is unvalidated JSON, so anything that is not a list of
    non-blank strings reads as "not scoped". That is the safe direction for a
    medical-compliance check: a malformed value grades the requirement for
    everyone rather than silently dropping a screening from a member who owes
    it. A blank list, the default, is the same: the requirement applies to all.
    """
    roles = getattr(requirement, "applies_to_roles", None)
    if not isinstance(roles, (list, tuple)):
        return set()
    return {key for role in roles if isinstance(role, str) and (key := _role_key(role))}


def _applicable_requirements(
    requirements: List[ScreeningRequirement],
    held_positions: Optional[Set[str]],
) -> List[ScreeningRequirement]:
    """The requirements a subject is graded on.

    ``held_positions`` is the subject's position names and slugs run through
    :func:`_role_key`. ``None`` means the subject holds no positions at all (a
    prospect), and such a subject is graded on every requirement: a role-scoped
    requirement cannot be shown not to apply to someone who has no role yet, and
    the pipeline gate that screening feeds should not quietly lose a screening.
    """
    if held_positions is None:
        return requirements
    applicable = []
    for requirement in requirements:
        roles = _requirement_roles(requirement)
        if not roles or roles & held_positions:
            applicable.append(requirement)
    return applicable


# The statuses that satisfy a requirement. One definition for both halves of
# "expiring soon": `_grade` counts a satisfying screening about to lapse, and
# `get_expiring_soon` lists the same screenings, so a waiver that is about to
# run out is both counted and listed (MS2-7). Edit here, never at one caller.
_SATISFYING_STATUSES = (
    ScreeningStatus.PASSED.value,
    ScreeningStatus.COMPLETED.value,
    ScreeningStatus.WAIVED.value,
)


def _positive_months(months: Optional[int]) -> Optional[int]:
    # The column accepts any int32; a zero or negative frequency describes no
    # recurrence, so it falls back to "no expiration" rather than a past date.
    return months if months and months > 0 else None


def _effective_expiration(
    record: ScreeningRecord,
    graded: Optional[ScreeningRequirement],
    frequency_by_requirement: Dict[str, Optional[int]],
) -> Tuple[Optional[date], bool]:
    """When ``record`` lapses, and whether that date came from a frequency.

    A record's own expiration date always wins. A record saved without one
    falls due ``frequency_months`` after it was completed (W71-1, owner
    decision): the frequency of the requirement the record is linked to, or,
    when it is linked to none (or its requirement was deleted), of the
    requirement it is being graded against. A record with no completed date,
    or whose requirement has no frequency, stays compliant indefinitely, as
    before. Months are calendar months, clamped to the month's last day, the
    same rule as the record form's ``addCalendarMonths``.
    """
    if record.expiration_date:
        return record.expiration_date, False
    if not record.completed_date:
        return None, False
    if record.requirement_id and record.requirement_id in frequency_by_requirement:
        months = _positive_months(frequency_by_requirement[record.requirement_id])
    else:
        months = _positive_months(graded.frequency_months if graded else None)
    if months is None:
        return None, False
    return record.completed_date + relativedelta(months=months), True


def _grade(
    requirements: List[ScreeningRequirement],
    records: List[ScreeningRecord],
    today: date,
    frequency_by_requirement: Optional[Dict[str, Optional[int]]] = None,
) -> Tuple[List[ComplianceItem], int, int, int]:
    """Grade one subject's records against the active requirements.

    The single definition of "compliant" for this module: the per-subject
    summary, the dashboard's own counts and the department roster are all
    built from it, so no screen can grade a member differently from another.
    Returns ``(items, compliant_count, expiring_soon_count,
    self_recorded_count)``.

    ``frequency_by_requirement`` maps every requirement id in the organization,
    active or not, to its ``frequency_months``; see ``_effective_expiration``.
    """
    frequencies = frequency_by_requirement or {}
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
            and r.status in _SATISFYING_STATUSES
        ]
        matching_records.sort(key=lambda r: r.completed_date or date.min, reverse=True)

        latest = matching_records[0] if matching_records else None
        is_compliant = False
        days_until_exp = None
        expires, from_frequency = (
            _effective_expiration(latest, req, frequencies) if latest else (None, False)
        )

        if latest:
            if expires:
                is_compliant = expires >= today
                days_until_exp = (expires - today).days
                # `0 <=`, not `0 <`: a screening expiring **today** is the
                # one most in need of flagging, and `get_expiring_soon`
                # below already returns it (`expiration_date >= today`).
                # Excluding it here meant the summary count and the list it
                # links to disagreed about the same member on that single
                # day — the count said nothing was due, the list named it.
                # Keep the two windows in step: this is the other half of
                # the same "expiring soon" definition (see
                # _SATISFYING_STATUSES for the statuses both share).
                if 0 <= days_until_exp <= 30:
                    expiring_soon_count += 1
            else:
                # No expiration and no frequency to derive one: compliant
                # indefinitely.
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
                expiration_date=expires,
                expiration_from_frequency=from_frequency,
                days_until_expiration=days_until_exp,
                status=latest.status if latest else None,
                self_recorded=self_recorded,
            )
        )

    return items, compliant_count, expiring_soon_count, self_recorded_count


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
        # W71: as on create — `onupdate` expires updated_at at the flush, and the
        # response model's lazy read raised MissingGreenlet. The endpoint has
        # already committed, so the officer was told a saved edit had failed.
        await self.db.refresh(requirement)
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
        await self.db.refresh(record)  # see update_requirement (W71)
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

    async def _position_keys(
        self, organization_id: str, user_id: Optional[str] = None
    ) -> Dict[str, Set[str]]:
        """Each member's position names and slugs, as :func:`_role_key` forms.

        Scoped through ``Position.organization_id``, so an id from another
        organization resolves no positions rather than another tenant's. One
        member when ``user_id`` is given, otherwise every assignment in the org.
        """
        query = (
            select(user_positions.c.user_id, Position.name, Position.slug)
            .select_from(user_positions)
            .join(Position, Position.id == user_positions.c.position_id)
            .where(Position.organization_id == organization_id)
        )
        if user_id is not None:
            query = query.where(user_positions.c.user_id == str(user_id))

        held: Dict[str, Set[str]] = {}
        for member_id, name, slug in (await self.db.execute(query)).all():
            keys = held.setdefault(str(member_id), set())
            keys.update(
                key for key in (_role_key(name or ""), _role_key(slug or "")) if key
            )
        return held

    async def _requirement_frequencies(
        self, organization_id: str
    ) -> Dict[str, Optional[int]]:
        """Every requirement's ``frequency_months``, inactive ones included.

        Inactive ones too: a record linked to a requirement that has since been
        switched off still falls due by that requirement's frequency.
        """
        rows = await self.db.execute(
            select(
                ScreeningRequirement.id, ScreeningRequirement.frequency_months
            ).where(ScreeningRequirement.organization_id == organization_id)
        )
        return {str(rid): months for rid, months in rows.all()}

    async def get_compliance_status(
        self,
        organization_id: str,
        user_id: Optional[str] = None,
        prospect_id: Optional[str] = None,
    ) -> ComplianceSummary:
        """
        Check compliance status for a user or prospect against the active
        screening requirements that apply to them.

        A requirement lists the positions it applies to (``applies_to_roles``);
        a member is graded on it only if they hold one of them, and a requirement
        listing none applies to everyone. A prospect holds no positions and is
        graded on every requirement.
        """
        # Get active requirements
        requirements = await self.list_requirements(organization_id, is_active=True)
        if user_id and any(_requirement_roles(r) for r in requirements):
            held = (await self._position_keys(organization_id, user_id)).get(
                str(user_id), set()
            )
            requirements = _applicable_requirements(requirements, held)

        # Get records for this subject
        records = await self.list_records(
            organization_id,
            user_id=user_id,
            prospect_id=prospect_id,
        )

        today = await resolve_org_today(self.db, organization_id)
        frequencies = await self._requirement_frequencies(organization_id)
        items, compliant_count, expiring_soon_count, self_recorded_count = _grade(
            requirements, records, today, frequencies
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

    async def get_compliance_roster(
        self,
        organization_id: str,
        standing: Optional[str] = None,
    ) -> ComplianceRoster:
        """Every screenable member and open prospect, graded, without detail.

        Each row is graded by :func:`_grade`, the same function behind the
        per-subject summary, so the roster and the detail a row opens cannot
        disagree. Counts only — which screening a row is missing is read by
        opening that row, an audited per-subject read.

        ``standing`` narrows the rows: ``not_compliant`` (any requirement unmet
        — expired or never recorded), ``expiring_soon`` (all met, at least one
        lapsing within 30 days) or ``compliant`` (all met, none lapsing soon).
        The totals always describe the whole roster.

        With no active requirement every row is ``not_applicable`` and every
        total is zero: an empty requirement set grades nobody, so it must not
        report the department as compliant (and ``?standing=compliant`` then
        matches nobody). The same holds for one row whose position leaves it
        with no requirement that applies: it is ``not_applicable``, not
        compliant. ``total_requirements`` stays the department's active set.
        """
        requirements = await self.list_requirements(organization_id, is_active=True)
        held_by_member = (
            await self._position_keys(organization_id)
            if any(_requirement_roles(r) for r in requirements)
            else None
        )
        subjects = await self.list_subjects(organization_id)
        records = await self.list_records(organization_id)
        today = await resolve_org_today(self.db, organization_id)
        frequencies = await self._requirement_frequencies(organization_id)

        by_user: Dict[str, List[ScreeningRecord]] = {}
        by_prospect: Dict[str, List[ScreeningRecord]] = {}
        for record in records:
            # Both, not either: a converted prospect's records carry both ids,
            # and the per-subject read filters on each id independently.
            if record.user_id:
                by_user.setdefault(str(record.user_id), []).append(record)
            if record.prospect_id:
                by_prospect.setdefault(str(record.prospect_id), []).append(record)

        rows: List[ComplianceRosterRow] = []
        for subject_type, people, held in (
            ("user", subjects.members, by_user),
            ("prospect", subjects.prospects, by_prospect),
        ):
            for person in people:
                applicable = (
                    _applicable_requirements(
                        requirements, held_by_member.get(str(person.id), set())
                    )
                    if subject_type == "user" and held_by_member is not None
                    else requirements
                )
                _, compliant, expiring, _ = _grade(
                    applicable, held.get(str(person.id), []), today, frequencies
                )
                not_met = len(applicable) - compliant
                rows.append(
                    ComplianceRosterRow(
                        subject_id=str(person.id),
                        subject_name=person.name,
                        subject_type=subject_type,
                        compliant_count=compliant,
                        non_compliant_count=not_met,
                        expiring_soon_count=expiring,
                        standing=(
                            "not_applicable"
                            if not applicable
                            else (
                                "not_compliant"
                                if not_met
                                else "expiring_soon" if expiring else "compliant"
                            )
                        ),
                    )
                )

        totals = {
            key: sum(1 for row in rows if row.standing == key)
            for key in ("not_compliant", "expiring_soon", "compliant")
        }
        return ComplianceRoster(
            total_requirements=len(requirements),
            total_subjects=len(rows),
            not_compliant=totals["not_compliant"],
            expiring_soon=totals["expiring_soon"],
            compliant=totals["compliant"],
            rows=[row for row in rows if standing is None or row.standing == standing],
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
                    ScreeningRecord.status.in_(_SATISFYING_STATUSES),
                )
            )
            .order_by(ScreeningRecord.expiration_date.asc())
        )
        result = await self.db.execute(query)
        dated = list(result.scalars().all())
        due: List[Tuple[ScreeningRecord, date, bool]] = [
            (r, r.expiration_date, False) for r in dated if r.expiration_date
        ]
        due.extend(await self._due_by_frequency(organization_id, today, cutoff))
        due.sort(key=lambda item: item[1])
        records = [record for record, _, _ in due]

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
        for record, expires, from_frequency in due:
            days_left = (expires - today).days
            expiring.append(
                ExpiringScreening(
                    record_id=record.id,
                    screening_type=record.screening_type,
                    requirement_name=names["requirements"].get(record.requirement_id),
                    user_id=record.user_id,
                    user_name=names["users"].get(record.user_id),
                    prospect_id=record.prospect_id,
                    prospect_name=names["prospects"].get(record.prospect_id),
                    expiration_date=expires,
                    days_until_expiration=days_left,
                    self_recorded=bool(record.self_recorded),
                    status=record.status,
                    expiration_from_frequency=from_frequency,
                )
            )

        return expiring

    async def _due_by_frequency(
        self, organization_id: str, today: date, cutoff: date
    ) -> List[Tuple[ScreeningRecord, date, bool]]:
        """Records with no expiration date that fall due by frequency in the window.

        The list's half of ``_effective_expiration``, so the expiring count the
        summary reports and this list agree about a record saved without an
        expiration (pitfall #29). A record linked to no requirement is measured
        against the active requirement of its type with the shortest frequency:
        the first one it falls due for.
        """
        frequencies = await self._requirement_frequencies(organization_id)
        positive = [m for m in map(_positive_months, frequencies.values()) if m]
        if not positive:
            return []
        shortest_by_type: Dict[str, ScreeningRequirement] = {}
        for req in await self.list_requirements(organization_id, is_active=True):
            months = _positive_months(req.frequency_months)
            if months is None:
                continue
            current = shortest_by_type.get(req.screening_type)
            if current is None or months < (current.frequency_months or 0):
                shortest_by_type[req.screening_type] = req

        # Completed longer ago than the longest frequency has lapsed under any
        # of them, so the query never reads the whole history.
        earliest = today - relativedelta(months=max(positive))
        rows = await self.db.execute(
            select(ScreeningRecord).where(
                ScreeningRecord.organization_id == organization_id,
                ScreeningRecord.expiration_date.is_(None),
                ScreeningRecord.completed_date.isnot(None),
                ScreeningRecord.completed_date >= earliest,
                ScreeningRecord.status.in_(_SATISFYING_STATUSES),
            )
        )
        due: List[Tuple[ScreeningRecord, date, bool]] = []
        for record in rows.scalars().all():
            expires, from_frequency = _effective_expiration(
                record, shortest_by_type.get(record.screening_type), frequencies
            )
            if expires and today <= expires <= cutoff:
                due.append((record, expires, from_frequency))
        return due

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
            prospect_rows = await self.db.execute(
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
                for pid, first, last in prospect_rows.all()
            }

        requirements: dict = {}
        if requirement_ids:
            requirement_rows = await self.db.execute(
                select(ScreeningRequirement.id, ScreeningRequirement.name).where(
                    ScreeningRequirement.id.in_(requirement_ids),
                    ScreeningRequirement.organization_id == organization_id,
                )
            )
            requirements = {rid: name for rid, name in requirement_rows.all()}

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
