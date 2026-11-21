"""
Competency Matrix / Heat Map Service

Generates a department-wide dashboard view showing all members vs. all required
skills/certifications, color-coded by status:
- current (green): met, and not expiring soon
- expiring_soon (yellow): met, with an expiry within 90 days
- in_progress: part way to the target; not counted as ready
- expired (red): lapsed
- not_started (gray): nothing counted yet

Every cell is the shared grader's decision
(``training_compliance.evaluate_member_requirement_detail``), the one the
compliance matrix reads (CLAUDE.md pitfall #29); only the 90-day overlay is
this view's own.

Gives training officers an at-a-glance department readiness picture.
"""

from datetime import date, timedelta
from typing import Dict, List, Mapping, Optional, Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.training import TrainingRecord, TrainingRequirement, TrainingStatus
from app.models.user import ACTIVE_ACCOUNT_STATUSES, User
from app.services.training_compliance import (
    CATCH_UP_STATUS,
    NOT_YET_HELD_STATUS,
    ComplianceGrading,
    EvaluationCredits,
    HeldSession,
    _load_compliance_config,
    catch_up_deadline,
    evaluate_member_requirement_detail,
    load_credited_shift_dates,
    load_evaluation_credits,
    load_graded_records,
    load_held_sessions,
    member_join_date,
)
from app.services.training_waiver_service import WaiverPeriod, fetch_org_waivers
from app.utils.org_timezone import resolve_org_today


class CompetencyMatrixService:
    """Generates competency matrix / heat map data."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_competency_matrix(
        self,
        organization_id: UUID | str,
        requirement_ids: Optional[List[str]] = None,
        user_ids: Optional[List[str]] = None,
    ) -> Dict:
        """
        Generate the competency matrix for the organization.

        Returns:
        {
            "generated_at": "2026-02-14T...",
            "requirements": [{"id": "...", "name": "...", "type": "..."}],
            "members": [
                {
                    "user_id": "...",
                    "name": "...",
                    "statuses": {
                        "<requirement_id>": {
                            "status": "current|expiring_soon|expired|not_started",
                            "expiration_date": "2026-06-01" | null,
                            "completion_date": "2025-06-01" | null,
                            "details": "EMT-B #12345"
                        }
                    }
                }
            ],
            "summary": {
                "total_members": 25,
                "total_requirements": 8,
                "current_count": 150,
                "expiring_soon_count": 12,
                "expired_count": 3,
                "not_started_count": 35,
                "readiness_percentage": 75.0
            }
        }
        """
        # Get active requirements
        req_query = (
            select(TrainingRequirement)
            .where(TrainingRequirement.organization_id == str(organization_id))
            .where(TrainingRequirement.active == True)  # noqa: E712
        )
        if requirement_ids:
            req_query = req_query.where(TrainingRequirement.id.in_(requirement_ids))
        req_result = await self.db.execute(req_query)
        requirements = list(req_result.scalars().all())

        # Get active, non-exempt members
        user_query = (
            select(User)
            .options(selectinload(User.positions))
            .where(User.organization_id == str(organization_id))
            .where(User.status.in_(ACTIVE_ACCOUNT_STATUSES))
            .where(User.compliance_exempt == False)  # noqa: E712
            .where(User.deleted_at.is_(None))
        )
        if user_ids:
            user_query = user_query.where(User.id.in_(user_ids))
        user_query = user_query.order_by(User.last_name, User.first_name)
        user_result = await self.db.execute(user_query)
        members = list(user_result.scalars().all())

        # Batch-fetch all active waivers / leaves for the org
        waivers_by_user = await fetch_org_waivers(self.db, str(organization_id))

        # The department's date, the same day the compliance matrix grades
        # against, so the two views agree about every member.
        today = await resolve_org_today(self.db, organization_id)
        expiring_threshold = today + timedelta(days=90)
        # Which requirements grade each member, and the current-month
        # cut-off, as the compliance matrix resolves them: one config load
        # (owner decision 2026-11-20, CLAUDE.md pitfall 29). There is no
        # member standing here, so the profile narrows cells only.
        grading = ComplianceGrading.from_config(
            await _load_compliance_config(self.db, str(organization_id))
        )
        org_include_current = grading.include_current_month
        # The records the grader's windows read, as the compliance matrix
        # loads them, rather than every completed record the org holds.
        records_by_user: Dict[str, List[TrainingRecord]] = {}
        for record in await load_graded_records(
            self.db,
            str(organization_id),
            [str(m.id) for m in members],
            requirements,
            today,
            org_include_current,
        ):
            records_by_user.setdefault(str(record.user_id), []).append(record)
        shifts_by_user = await load_credited_shift_dates(
            self.db,
            str(organization_id),
            [m.id for m in members],
            requirements,
            today,
            org_include_current,
        )
        evaluations_by_user = await load_evaluation_credits(
            self.db,
            str(organization_id),
            [m.id for m in members],
            requirements,
            today,
            org_include_current,
        )
        held_sessions = await load_held_sessions(
            self.db, str(organization_id), requirements
        )

        # Counters
        current_count = 0
        expiring_soon_count = 0
        expired_count = 0
        in_progress_count = 0
        not_started_count = 0
        # Cells that grade nobody: the member's compliance profile does not
        # list the requirement, it does not apply to the member (type, role,
        # grandfathering cutoff), or an existing member is still inside its
        # catch-up period. Shown, but kept out of readiness.
        ungraded_count = 0

        # Build matrix
        requirement_list = [
            {
                "id": str(req.id),
                "name": req.name,
                "type": req.requirement_type.value if req.requirement_type else None,
                "source": req.source.value if req.source else None,
                "registry_code": req.registry_code,
            }
            for req in requirements
        ]

        member_rows = []
        for member in members:
            uid = str(member.id)
            user_records = records_by_user.get(uid, [])
            member_waivers = waivers_by_user.get(uid, [])
            statuses = {}
            join_date = member_join_date(member)
            # for_member over the requested columns: with a requirement_ids
            # filter this is the profile's list intersected with it.
            graded = {
                str(r.id) for r in grading.for_member(member, requirements).requirements
            }

            for req in requirements:
                rid = str(req.id)
                if rid not in graded:
                    statuses[rid] = {
                        "status": "not_applicable",
                        "expiration_date": None,
                        "completion_date": None,
                        "details": None,
                    }
                    ungraded_count += 1
                    continue
                status_info = self._evaluate_requirement_status(
                    req,
                    user_records,
                    today,
                    expiring_threshold,
                    waivers=member_waivers,
                    org_include_current_month=org_include_current,
                    shift_dates=shifts_by_user.get(uid, []),
                    held_sessions=held_sessions,
                    join_date=join_date,
                    evaluation_credits=evaluations_by_user.get(uid, {}),
                )
                deadline = catch_up_deadline(req, join_date, today)
                if deadline is not None and status_info["status"] not in (
                    "current",
                    "expiring_soon",
                    "not_applicable",
                ):
                    status_info = {
                        **status_info,
                        "status": CATCH_UP_STATUS,
                        "details": f"Existing member: due by {deadline.isoformat()}",
                    }
                statuses[rid] = status_info

                # Count
                s = status_info["status"]
                if s in (CATCH_UP_STATUS, "not_applicable"):
                    ungraded_count += 1
                elif s == "current":
                    current_count += 1
                elif s == "expiring_soon":
                    expiring_soon_count += 1
                elif s == "expired":
                    expired_count += 1
                elif s == "in_progress":
                    in_progress_count += 1
                else:
                    not_started_count += 1

            member_rows.append(
                {
                    "user_id": uid,
                    "name": member.full_name,
                    "statuses": statuses,
                }
            )

        total_cells = len(members) * len(requirements) - ungraded_count
        readiness = (
            ((current_count + expiring_soon_count) / total_cells * 100)
            if total_cells > 0
            else 0
        )

        return {
            "generated_at": today.isoformat(),
            "requirements": requirement_list,
            "members": member_rows,
            "summary": {
                "total_members": len(members),
                "total_requirements": len(requirements),
                "current_count": current_count,
                "expiring_soon_count": expiring_soon_count,
                "expired_count": expired_count,
                "in_progress_count": in_progress_count,
                "not_started_count": not_started_count,
                "readiness_percentage": round(readiness, 1),
            },
        }

    def _evaluate_requirement_status(
        self,
        requirement: TrainingRequirement,
        user_records: List[TrainingRecord],
        today: date,
        expiring_threshold: date,
        waivers: Optional[List[WaiverPeriod]] = None,
        org_include_current_month: bool = True,
        shift_dates: Optional[List[date]] = None,
        held_sessions: Optional[Mapping[str, Sequence[HeldSession]]] = None,
        join_date: Optional[date] = None,
        evaluation_credits: Optional[EvaluationCredits] = None,
    ) -> Dict:
        """One member's cell: the shared grader's status in this view's words.

        This view used to grade hours, courses, certifications, calls and
        record-counted shifts by its own rules -- calendar-year windows for
        rolling requirements, no category filter, a calls target met by one
        record -- and disagreed with the compliance matrix (review finding of
        2026-11-21). Partial progress is ``in_progress``, which readiness does
        not count; it used to read ``expiring_soon`` and count as ready.

        The 90-day overlay stays on the real day (``expiring_threshold``):
        a met cell whose expiry falls inside it reads ``expiring_soon``.
        """
        ev = evaluate_member_requirement_detail(
            requirement,
            user_records,
            today,
            waivers=waivers,
            org_include_current_month=org_include_current_month,
            join_date=join_date,
            shift_dates=shift_dates,
            held_sessions=held_sessions,
            evaluation_credits=evaluation_credits,
        )
        # A catch-up status lands on "not_started" here; the caller turns an
        # unmet cell inside the catch-up period into its own status.
        status = {
            TrainingStatus.COMPLETED.value: "current",
            TrainingStatus.IN_PROGRESS.value: "in_progress",
            "expired": "expired",
            NOT_YET_HELD_STATUS: "not_applicable",
        }.get(ev.status, "not_started")
        expiry = date.fromisoformat(ev.expiry_date) if ev.expiry_date else None
        if status == "current" and expiry and today <= expiry <= expiring_threshold:
            status = "expiring_soon"
        progress = (
            f"{ev.progress_current:g}/{ev.progress_required:g} "
            f"{ev.progress_unit or ''}".strip()
            if ev.progress_current is not None and ev.progress_required is not None
            else None
        )
        return {
            "status": status,
            "expiration_date": ev.expiry_date,
            "completion_date": ev.completion_date,
            "details": progress if status != "not_started" else None,
        }
