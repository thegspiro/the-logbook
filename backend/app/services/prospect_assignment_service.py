"""
Prospect Assignment Service

Assigns members to an applicant as case manager or interviewer, and lists the
applicants a member is assigned to. The assignment is what lets a member see
the applicant (app/services/prospect_access.py), so every write checks that
both the applicant and the member belong to the caller's organization
(CLAUDE.md pitfall #14c), and only a current member can be assigned.
"""

from typing import Any, Dict, Iterable, List, Optional, Tuple

from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.membership_pipeline import (
    AssignmentRole,
    ProspectAssignment,
    ProspectiveMember,
)
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Organization, User

ROLE_LABELS = {
    AssignmentRole.CASE_MANAGER.value: "case manager",
    AssignmentRole.INTERVIEWER.value: "interviewer",
}

MY_APPLICANTS_PATH = "/prospective-members/my-applicants"

# What a case manager is told happened, one sentence per event. ``detail`` is
# the form or stage the event names.
ATTENTION_EVENTS = {
    "follow_up_submitted": "{applicant} submitted their follow-up form, {detail}.",
    "withdrew": (
        "{applicant} withdrew their application from their application status page."
    ),
    "interview_stage": (
        "{applicant} has reached the {detail} stage, which needs interviews."
    ),
    "approval_stage": (
        "{applicant} has reached the {detail} stage, which needs sign-offs."
    ),
}


class ProspectAssignmentService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _prospect(
        self, prospect_id: str, organization_id: str
    ) -> Optional[ProspectiveMember]:
        return (
            await self.db.execute(
                select(ProspectiveMember).where(
                    ProspectiveMember.id == str(prospect_id),
                    ProspectiveMember.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()

    async def list_for_prospect(
        self, prospect_id: str, organization_id: str
    ) -> List[Dict[str, Any]]:
        result = await self.db.execute(
            select(ProspectAssignment)
            .where(
                ProspectAssignment.prospect_id == str(prospect_id),
                ProspectAssignment.organization_id == str(organization_id),
            )
            .order_by(ProspectAssignment.created_at)
        )
        assignments = list(result.scalars().all())
        names = await self._names(
            {a.user_id for a in assignments}
            | {a.assigned_by for a in assignments if a.assigned_by},
            organization_id,
        )
        return [self.describe(a, names) for a in assignments]

    async def _names(self, user_ids: set, organization_id: str) -> Dict[str, str]:
        if not user_ids:
            return {}
        result = await self.db.execute(
            select(User).where(
                User.id.in_([str(u) for u in user_ids]),
                User.organization_id == str(organization_id),
            )
        )
        return {str(u.id): u.display_name or u.username for u in result.scalars()}

    @staticmethod
    def describe(
        assignment: ProspectAssignment, names: Dict[str, str]
    ) -> Dict[str, Any]:
        return {
            "id": assignment.id,
            "prospect_id": assignment.prospect_id,
            "user_id": assignment.user_id,
            "user_name": names.get(str(assignment.user_id)),
            "role": assignment.role,
            "assigned_by_name": (
                names.get(str(assignment.assigned_by))
                if assignment.assigned_by
                else None
            ),
            "created_at": assignment.created_at,
        }

    async def assign(
        self,
        prospect_id: str,
        user_id: str,
        role: str,
        organization_id: str,
        assigned_by: User,
    ) -> Tuple[Dict[str, Any], bool]:
        """Assign ``user_id`` to the applicant. Returns the assignment and
        whether it is new; assigning someone already assigned in that role is
        a no-op that returns the existing row.

        Raises LookupError for an applicant not in the organization and
        ValueError for a member who is not a current member of it.
        """
        from app.services.membership_pipeline_service import MembershipPipelineService

        if role not in ROLE_LABELS:
            raise ValueError("Unknown assignment role")
        prospect = await self._prospect(prospect_id, organization_id)
        if prospect is None:
            raise LookupError("Prospect not found")
        member = (
            await self.db.execute(
                select(User).where(
                    User.id == str(user_id),
                    User.organization_id == str(organization_id),
                    User.deleted_at.is_(None),
                    User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                )
            )
        ).scalar_one_or_none()
        if member is None:
            raise ValueError("Only a current member of the department can be assigned")

        existing = await self._existing(prospect_id, user_id, role)
        if existing is not None:
            return await self._describe_one(existing, organization_id), False

        assignment = ProspectAssignment(
            organization_id=str(organization_id),
            prospect_id=str(prospect_id),
            user_id=str(user_id),
            role=role,
            assigned_by=str(assigned_by.id),
        )
        try:
            async with self.db.begin_nested():
                self.db.add(assignment)
        except IntegrityError:
            # Two coordinators assigning the same member at once meet the
            # unique index; the loser reports the winner's row.
            raced = await self._existing(prospect_id, user_id, role)
            if raced is None:
                raise
            return await self._describe_one(raced, organization_id), False

        await MembershipPipelineService(self.db)._log_activity(
            prospect_id=str(prospect_id),
            action="assignment_added",
            details={
                "assignment_id": str(assignment.id),
                "user_id": str(user_id),
                "user_name": member.display_name or member.username,
                "role": role,
            },
            performed_by=str(assigned_by.id),
        )
        await self.db.commit()
        await self.db.refresh(assignment)
        await self._notify_assigned(prospect, member, role, assigned_by)
        return await self._describe_one(assignment, organization_id), True

    async def unassign(
        self,
        prospect_id: str,
        assignment_id: str,
        organization_id: str,
        removed_by: User,
    ) -> Optional[Dict[str, Any]]:
        assignment = (
            await self.db.execute(
                select(ProspectAssignment).where(
                    ProspectAssignment.id == str(assignment_id),
                    ProspectAssignment.prospect_id == str(prospect_id),
                    ProspectAssignment.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        if assignment is None:
            return None
        from app.services.membership_pipeline_service import MembershipPipelineService

        described = await self._describe_one(assignment, organization_id)
        await self.db.delete(assignment)
        await MembershipPipelineService(self.db)._log_activity(
            prospect_id=str(prospect_id),
            action="assignment_removed",
            details={
                "assignment_id": str(assignment_id),
                "user_id": described["user_id"],
                "user_name": described["user_name"],
                "role": described["role"],
            },
            performed_by=str(removed_by.id),
        )
        await self.db.commit()
        return described

    async def _existing(
        self, prospect_id: str, user_id: str, role: str
    ) -> Optional[ProspectAssignment]:
        return (
            await self.db.execute(
                select(ProspectAssignment).where(
                    ProspectAssignment.prospect_id == str(prospect_id),
                    ProspectAssignment.user_id == str(user_id),
                    ProspectAssignment.role == role,
                )
            )
        ).scalar_one_or_none()

    async def _describe_one(
        self, assignment: ProspectAssignment, organization_id: str
    ) -> Dict[str, Any]:
        names = await self._names(
            {assignment.user_id}
            | ({assignment.assigned_by} if assignment.assigned_by else set()),
            organization_id,
        )
        return self.describe(assignment, names)

    async def _notify_assigned(
        self,
        prospect: ProspectiveMember,
        member: User,
        role: str,
        assigned_by: User,
    ) -> None:
        """Email the member they were assigned. After the commit and
        best-effort: the assignment stands whether or not this goes out."""
        if not member.email:
            return
        try:
            from app.services.email_service import EmailService

            org = await self.db.get(Organization, prospect.organization_id)
            if org is None:
                return
            frontend_url = getattr(settings, "FRONTEND_URL", "") or ""
            sent = await EmailService(org).send_applicant_assigned_email(
                to_email=member.email,
                recipient_name=member.full_name,
                applicant_name=prospect.full_name,
                role_label=ROLE_LABELS[role],
                assigned_by_name=assigned_by.full_name,
                applicant_url=(
                    f"{frontend_url}{MY_APPLICANTS_PATH}?applicant={prospect.id}"
                ),
                db=self.db,
                organization_id=str(org.id),
            )
            if not sent:
                logger.warning(
                    "Assignment email for prospect {} was not sent", prospect.id
                )
        except Exception as e:
            logger.error(
                "Failed to send assignment email for prospect {}: {}", prospect.id, e
            )

    async def notify_case_managers(
        self,
        prospect: ProspectiveMember,
        event: str,
        *,
        detail: Optional[str] = None,
        already_told: Iterable[str] = (),
    ) -> int:
        """Email the applicant's case managers that the applicant needs them.

        ``event`` is a key of ``ATTENTION_EVENTS``, and ``detail`` the form or
        stage name its sentence names; that sentence is all the email says
        about what happened. Members in
        ``already_told`` (user ids) are skipped: a coordinator who is also the
        case manager has just had the coordinators' notice for the same event.
        Membership-admin email, so a member who has switched that off is not
        sent it. After the caller's commit and best-effort: the event stands
        whether or not this goes out. Returns how many were sent.
        """
        from app.services.email_policy import (
            EmailKind,
            department_required_kinds,
            recipients_for,
        )

        try:
            skip = {str(u) for u in already_told}
            event_summary = ATTENTION_EVENTS[event].format(
                applicant=prospect.full_name, detail=detail or ""
            )
            result = await self.db.execute(
                select(User)
                .join(ProspectAssignment, ProspectAssignment.user_id == User.id)
                .where(
                    ProspectAssignment.prospect_id == str(prospect.id),
                    ProspectAssignment.organization_id == str(prospect.organization_id),
                    ProspectAssignment.role == AssignmentRole.CASE_MANAGER.value,
                    User.organization_id == str(prospect.organization_id),
                    User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                    User.deleted_at.is_(None),
                    User.email.isnot(None),
                )
            )
            case_managers = [
                u for u in result.scalars().unique().all() if str(u.id) not in skip
            ]
            if not case_managers:
                return 0
            org = await self.db.get(Organization, prospect.organization_id)
            if org is None:
                return 0
            recipients = recipients_for(
                case_managers,
                EmailKind.MEMBERSHIP_ADMIN,
                department_required_kinds(org),
            )

            from app.services.email_service import EmailService

            email_service = EmailService(org)
            frontend_url = getattr(settings, "FRONTEND_URL", "") or ""
            applicant_url = (
                f"{frontend_url}{MY_APPLICANTS_PATH}?applicant={prospect.id}"
            )
            sent = 0
            for member in recipients:
                if await email_service.send_applicant_needs_attention_email(
                    to_email=member.email,
                    recipient_name=member.full_name,
                    applicant_name=prospect.full_name,
                    event_summary=event_summary,
                    applicant_url=applicant_url,
                    db=self.db,
                    organization_id=str(org.id),
                ):
                    sent += 1
            return sent
        except Exception as e:
            logger.error(
                "Failed to notify case managers of prospect {}: {}", prospect.id, e
            )
            return 0

    async def my_applicants(
        self, user: User
    ) -> List[Tuple[ProspectiveMember, List[str]]]:
        """The applicants ``user`` is assigned to, with their roles on each,
        newest application first."""
        result = await self.db.execute(
            select(ProspectAssignment.prospect_id, ProspectAssignment.role).where(
                ProspectAssignment.user_id == str(user.id),
                ProspectAssignment.organization_id == str(user.organization_id),
            )
        )
        roles: Dict[str, List[str]] = {}
        for prospect_id, role in result.all():
            roles.setdefault(str(prospect_id), []).append(str(role))
        if not roles:
            return []
        prospects = await self.db.execute(
            select(ProspectiveMember)
            .where(
                ProspectiveMember.id.in_(list(roles)),
                ProspectiveMember.organization_id == str(user.organization_id),
            )
            .options(
                selectinload(ProspectiveMember.current_step),
                selectinload(ProspectiveMember.pipeline),
                selectinload(ProspectiveMember.step_progress),
                selectinload(ProspectiveMember.target_role),
            )
            .order_by(ProspectiveMember.created_at.desc())
        )
        return [(p, sorted(roles[str(p.id)])) for p in prospects.scalars().all()]
