"""Department leave settings, and members asking for leave.

**Who decides** is the department's choice of positions. When nobody else
holds them (none chosen, the office is vacant, or the only holder is the
member asking), a request goes to the Chief, then to everyone who can record
leave (``members.manage``), so it is never left with nobody to answer it --
the same fallback training waiver requests use. The member never decides
their own request.

**How they decide** is the department's rule, kept on each request as it was
when the request was made (``LeaveDecisionRule``). Votes are counted against
the people who may decide *now*: a vote from someone who has since left the
position no longer counts, and the bar moves with the number of current
approvers.

**A vote and its outcome are one locked decision** (CLAUDE.md pitfall #27).
The request row is locked before the votes are read, so two approvers voting
at once cannot both see an undecided request and both create the leave.

**An approval creates the leave exactly as an officer recording it would**:
the linked training waiver, the dropped shift assignments, the audit entry,
and the member's leave notice email (sent by the endpoint after commit).
"""

import copy
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence, Set

from loguru import logger
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.audit import log_audit_event
from app.core.constants import CHIEF_POSITION_SLUGS
from app.models.leave_request import (
    LeaveDecisionRule,
    LeaveRequest,
    LeaveRequestStatus,
    LeaveRequestVote,
    LeaveVote,
)
from app.models.user import Organization, Position, User, user_positions
from app.schemas.leave_of_absence import (
    LeaveApproverPosition,
    LeaveOfAbsenceSettings,
    LeaveRequestCreate,
    LeaveRequestResponse,
    LeaveRequestVoteResponse,
    LeaveSettingsResponse,
    settings_from,
)
from app.services.member_leave_service import MemberLeaveService
from app.utils.org_scoping import assert_all_in_org

SETTINGS_KEY = "leave_of_absence"
MANAGE_PERMISSION = "members.manage"


class LeaveRequestNotFound(Exception):
    """The request is not in the caller's department, or not theirs to see."""


class LeaveRequestForbidden(Exception):
    """The caller may see the request but not do this to it."""


# ----------------------------------------------------------------------
# The decision rule
# ----------------------------------------------------------------------


def approvals_needed(rule: LeaveDecisionRule, approver_count: int) -> int:
    """How many approvals settle a request under ``rule``."""
    if approver_count <= 0:
        return 0
    if rule == LeaveDecisionRule.ANY:
        return 1
    if rule == LeaveDecisionRule.MAJORITY:
        return approver_count // 2 + 1
    return approver_count


def settle(
    rule: LeaveDecisionRule,
    approver_count: int,
    approvals: int,
    denials: int,
    latest: Optional[LeaveVote] = None,
) -> Optional[LeaveRequestStatus]:
    """The outcome the counted votes reach, or ``None`` while still open.

    ``latest`` is the vote just cast: under ``any`` it is the one that
    settles the request, whichever way it went.
    """
    if approver_count <= 0:
        return None
    if rule == LeaveDecisionRule.ANY:
        if latest == LeaveVote.APPROVE:
            return LeaveRequestStatus.APPROVED
        if latest == LeaveVote.DENY:
            return LeaveRequestStatus.DENIED
        return None
    needed = approvals_needed(rule, approver_count)
    if approvals >= needed:
        return LeaveRequestStatus.APPROVED
    # Denied once approval can no longer be reached by the votes left.
    if approver_count - denials < needed:
        return LeaveRequestStatus.DENIED
    return None


def rule_sentence(rule: LeaveDecisionRule, approver_count: int) -> str:
    """The rule as the approvers' email states it."""
    if rule == LeaveDecisionRule.ANY:
        return "The first approver to approve or deny it decides it."
    needed = approvals_needed(rule, approver_count)
    if rule == LeaveDecisionRule.MAJORITY:
        return (
            f"It is approved once {needed} of the {approver_count} approvers "
            "approve it, and denied once that can no longer happen."
        )
    return (
        f"It is approved once all {approver_count} approvers approve it; any "
        "one denial denies it."
    )


@dataclass
class _Pool:
    """Who may decide in a department, worked out once per call."""

    configured: Set[str]
    chiefs: Set[str]
    managers: Set[str]

    def approvers_for(self, requester_id: str) -> Set[str]:
        requester = str(requester_id)
        for step in (self.configured, self.chiefs, self.managers):
            ids = step - {requester}
            if ids:
                return ids
        return set()


def _display_name(user: Optional[User], fallback: str = "A member") -> str:
    if user is None:
        return fallback
    return user.display_name or user.username or fallback


class LeaveRequestService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    async def get_settings(self, organization_id: str) -> LeaveOfAbsenceSettings:
        raw = (
            await self.db.execute(
                select(Organization.settings).where(
                    Organization.id == str(organization_id)
                )
            )
        ).scalar_one_or_none()
        section = raw.get(SETTINGS_KEY) if isinstance(raw, dict) else None
        return settings_from(section)

    async def settings_response(self, organization_id: str) -> LeaveSettingsResponse:
        org_id = str(organization_id)
        settings = await self.get_settings(org_id)
        holders = (
            await self.db.execute(
                select(Position.id, Position.name, func.count(User.id))
                .select_from(Position)
                .outerjoin(user_positions, user_positions.c.position_id == Position.id)
                .outerjoin(
                    User,
                    (User.id == user_positions.c.user_id)
                    & (User.organization_id == org_id)
                    & User.is_active,
                )
                .where(Position.organization_id == org_id)
                .group_by(Position.id, Position.name)
                .order_by(Position.name)
            )
        ).all()
        return LeaveSettingsResponse(
            **settings.model_dump(),
            available_positions=[
                LeaveApproverPosition(id=str(pid), name=name, holder_count=int(count))
                for pid, name, count in holders
            ],
        )

    async def save_settings(
        self, organization_id: str, settings: LeaveOfAbsenceSettings, actor: User
    ) -> LeaveOfAbsenceSettings:
        org_id = str(organization_id)
        await assert_all_in_org(
            self.db,
            Position,
            settings.request_approver_position_ids,
            org_id,
            label="approver position",
        )
        # Locked so a concurrent settings save cannot write back a copy taken
        # before this one.
        organization = (
            await self.db.execute(
                select(Organization)
                .where(Organization.id == org_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if organization is None:
            raise LeaveRequestNotFound("Organization not found")
        stored = copy.deepcopy(organization.settings or {})
        before = settings_from(stored.get(SETTINGS_KEY)).model_dump(mode="json")
        after = settings.model_dump(mode="json")
        stored[SETTINGS_KEY] = after
        organization.settings = stored
        changes = {
            key: {"from": before.get(key), "to": value}
            for key, value in after.items()
            if before.get(key) != value
        }
        if changes:
            await log_audit_event(
                db=self.db,
                event_type="leave_settings_updated",
                event_category="user_management",
                severity="info",
                event_data={"changes": changes},
                user_id=str(actor.id),
                username=actor.username,
            )
        await self.db.commit()
        return settings

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------

    async def _holder_ids(self, org_id: str, position_filter) -> Set[str]:
        rows = await self.db.execute(
            select(user_positions.c.user_id)
            .join(Position, Position.id == user_positions.c.position_id)
            .join(User, User.id == user_positions.c.user_id)
            .where(
                Position.organization_id == org_id,
                position_filter,
                User.organization_id == org_id,
                User.is_active,
            )
        )
        return {str(r[0]) for r in rows.all()}

    async def _pool(self, org_id: str, settings: LeaveOfAbsenceSettings) -> _Pool:
        configured: Set[str] = set()
        if settings.request_approver_position_ids:
            configured = await self._holder_ids(
                org_id, Position.id.in_(list(settings.request_approver_position_ids))
            )
        chiefs = await self._holder_ids(org_id, Position.slug.in_(CHIEF_POSITION_SLUGS))
        members = (
            await self.db.execute(
                select(User)
                .options(selectinload(User.positions))
                .where(User.organization_id == org_id, User.is_active)
            )
        ).scalars()
        managers = {
            str(u.id) for u in members if user_has_permission(u, MANAGE_PERMISSION)
        }
        return _Pool(configured=configured, chiefs=chiefs, managers=managers)

    async def approvers_for(self, organization_id: str, requester_id: str) -> Set[str]:
        """The members who may decide a request from ``requester_id`` today."""
        org_id = str(organization_id)
        pool = await self._pool(org_id, await self.get_settings(org_id))
        return pool.approvers_for(requester_id)

    # ------------------------------------------------------------------
    # Requests
    # ------------------------------------------------------------------

    async def create_request(
        self, organization_id: str, member: User, data: LeaveRequestCreate
    ) -> LeaveRequest:
        org_id = str(organization_id)
        settings = await self.get_settings(org_id)
        if not settings.requests_enabled:
            raise LeaveRequestForbidden(
                "Your department does not take leave requests here. Ask the "
                "officer who manages leave."
            )
        request = LeaveRequest(
            organization_id=org_id,
            user_id=str(member.id),
            leave_type=data.leave_type,
            start_date=data.start_date,
            end_date=data.end_date,
            reason=data.reason,
            status=LeaveRequestStatus.PENDING,
            decision_rule=settings.request_decision_rule,
        )
        self.db.add(request)
        await self.db.flush()
        await log_audit_event(
            db=self.db,
            event_type="leave_request_submitted",
            event_category="user_management",
            severity="info",
            event_data={
                "leave_request_id": str(request.id),
                "start_date": data.start_date.isoformat(),
                "end_date": data.end_date.isoformat() if data.end_date else None,
                "decision_rule": settings.request_decision_rule.value,
            },
            user_id=str(member.id),
            username=member.username,
        )
        await self.db.commit()
        await self.db.refresh(request)
        return request

    async def _get(
        self, org_id: str, request_id: str, *, lock: bool = False
    ) -> LeaveRequest:
        query = select(LeaveRequest).where(
            LeaveRequest.id == str(request_id),
            LeaveRequest.organization_id == org_id,
        )
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        request = (await self.db.execute(query)).scalar_one_or_none()
        if request is None:
            raise LeaveRequestNotFound("Leave request not found")
        return request

    async def _votes(
        self, request_ids: Sequence[str], *, lock: bool = False
    ) -> Dict[str, List]:
        if not request_ids:
            return {}
        query = (
            select(LeaveRequestVote)
            .where(LeaveRequestVote.request_id.in_(list(request_ids)))
            .order_by(LeaveRequestVote.created_at)
        )
        if lock:
            # A locking read: under REPEATABLE READ a plain SELECT answers
            # from the snapshot taken at the transaction's first read, which
            # can predate a vote committed while this one waited on the
            # request's lock (pitfall #27).
            query = query.with_for_update().execution_options(populate_existing=True)
        rows = (await self.db.execute(query)).scalars().all()
        by_request: Dict[str, List] = {}
        for vote in rows:
            by_request.setdefault(str(vote.request_id), []).append(vote)
        return by_request

    async def get_for(
        self, organization_id: str, request_id: str, viewer: User
    ) -> LeaveRequest:
        """The request, if ``viewer`` may see it: their own, one they may
        decide, or any for those who manage leave."""
        org_id = str(organization_id)
        request = await self._get(org_id, request_id)
        if str(request.user_id) == str(viewer.id) or user_has_permission(
            viewer, MANAGE_PERMISSION
        ):
            return request
        if str(viewer.id) in await self.approvers_for(org_id, request.user_id):
            return request
        raise LeaveRequestNotFound("Leave request not found")

    async def list_mine(self, organization_id: str, member: User) -> List[LeaveRequest]:
        return list(
            (
                await self.db.execute(
                    select(LeaveRequest)
                    .where(
                        LeaveRequest.organization_id == str(organization_id),
                        LeaveRequest.user_id == str(member.id),
                    )
                    .order_by(LeaveRequest.created_at.desc())
                )
            )
            .scalars()
            .all()
        )

    async def list_for_decider(
        self, organization_id: str, viewer: User, *, include_closed: bool = False
    ) -> List[LeaveRequest]:
        """Requests ``viewer`` may decide, or every request for a manager."""
        org_id = str(organization_id)
        query = select(LeaveRequest).where(LeaveRequest.organization_id == org_id)
        if not include_closed:
            query = query.where(LeaveRequest.status == LeaveRequestStatus.PENDING)
        rows = list(
            (await self.db.execute(query.order_by(LeaveRequest.created_at.desc())))
            .scalars()
            .all()
        )
        if user_has_permission(viewer, MANAGE_PERMISSION):
            return rows
        pool = await self._pool(org_id, await self.get_settings(org_id))
        viewer_id = str(viewer.id)
        return [r for r in rows if viewer_id in pool.approvers_for(r.user_id)]

    async def withdraw(
        self, organization_id: str, request_id: str, member: User
    ) -> LeaveRequest:
        org_id = str(organization_id)
        request = await self._get(org_id, request_id, lock=True)
        if str(request.user_id) != str(member.id):
            raise LeaveRequestNotFound("Leave request not found")
        if request.status != LeaveRequestStatus.PENDING:
            raise LeaveRequestForbidden(
                "Only a request still waiting can be withdrawn."
            )
        request.status = LeaveRequestStatus.WITHDRAWN
        request.decided_at = datetime.now(timezone.utc)
        await log_audit_event(
            db=self.db,
            event_type="leave_request_withdrawn",
            event_category="user_management",
            severity="info",
            event_data={"leave_request_id": str(request.id)},
            user_id=str(member.id),
            username=member.username,
        )
        await self.db.commit()
        await self.db.refresh(request)
        return request

    async def vote(
        self,
        organization_id: str,
        request_id: str,
        voter: User,
        vote: LeaveVote,
        note: Optional[str],
    ) -> LeaveRequest:
        """Record ``voter``'s vote and settle the request if it now is.

        Locks the request row first, so the read of the votes and the outcome
        are one decision (pitfall #27). Returns the request; its status says
        whether this vote settled it, and ``leave_id`` names the leave an
        approval created.
        """
        org_id = str(organization_id)
        request = await self._get(org_id, request_id, lock=True)
        approvers = await self.approvers_for(org_id, request.user_id)
        voter_id = str(voter.id)
        if voter_id not in approvers:
            if str(request.user_id) == voter_id or user_has_permission(
                voter, MANAGE_PERMISSION
            ):
                raise LeaveRequestForbidden(
                    "You are not one of this request's approvers."
                )
            raise LeaveRequestNotFound("Leave request not found")
        if request.status != LeaveRequestStatus.PENDING:
            raise LeaveRequestForbidden("This request has already been decided.")
        existing = (await self._votes([str(request.id)], lock=True)).get(
            str(request.id), []
        )
        if any(str(v.voter_id) == voter_id for v in existing):
            raise LeaveRequestForbidden("You have already voted on this request.")

        self.db.add(
            LeaveRequestVote(
                organization_id=org_id,
                request_id=str(request.id),
                voter_id=voter_id,
                vote=vote,
                note=note,
            )
        )
        counted = [v for v in existing if str(v.voter_id) in approvers]
        approvals = sum(v.vote == LeaveVote.APPROVE for v in counted) + (
            vote == LeaveVote.APPROVE
        )
        denials = sum(v.vote == LeaveVote.DENY for v in counted) + (
            vote == LeaveVote.DENY
        )
        outcome = settle(
            request.decision_rule, len(approvers), approvals, denials, latest=vote
        )
        await log_audit_event(
            db=self.db,
            event_type="leave_request_vote",
            event_category="user_management",
            severity="info",
            event_data={
                "leave_request_id": str(request.id),
                "target_user_id": str(request.user_id),
                "vote": vote.value,
                "outcome": outcome.value if outcome else None,
            },
            user_id=voter_id,
            username=voter.username,
        )
        if outcome is None:
            await self.db.commit()
            await self.db.refresh(request)
            return request

        request.status = outcome
        request.decided_at = datetime.now(timezone.utc)
        request.decided_by = voter_id
        if outcome == LeaveRequestStatus.APPROVED:
            # create_leave commits, carrying the vote and the status with it.
            leave = await MemberLeaveService(self.db).create_leave(
                organization_id=org_id,
                user_id=str(request.user_id),
                start_date=request.start_date,
                end_date=request.end_date,
                leave_type=request.leave_type.value,
                reason=request.reason,
                granted_by=voter_id,
            )
            request.leave_id = str(leave.id)
            await log_audit_event(
                db=self.db,
                event_type="leave_of_absence_created",
                event_category="user_management",
                severity="info",
                event_data={
                    "target_user_id": str(request.user_id),
                    "leave_id": str(leave.id),
                    "leave_type": request.leave_type.value,
                    "start_date": request.start_date.isoformat(),
                    "end_date": (
                        request.end_date.isoformat() if request.end_date else None
                    ),
                    "leave_request_id": str(request.id),
                },
                user_id=voter_id,
                username=voter.username,
            )
        await self.db.commit()
        await self.db.refresh(request)
        if outcome == LeaveRequestStatus.APPROVED:
            await self._drop_assignments(request)
        return request

    async def _drop_assignments(self, request: LeaveRequest) -> None:
        """Free the member's shifts during the leave, as an officer's
        recording does. Best-effort: the leave is already committed."""
        from app.services.scheduling_service import SchedulingService

        try:
            await SchedulingService(self.db).cancel_member_assignments_in_range(
                request.organization_id,
                str(request.user_id),
                request.start_date,
                request.end_date,
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "Failed to cancel shift assignments for approved leave request {}: {}",
                request.id,
                exc,
            )

    # ------------------------------------------------------------------
    # Responses
    # ------------------------------------------------------------------

    async def to_responses(
        self,
        organization_id: str,
        requests: Sequence[LeaveRequest],
        viewer: User,
    ) -> List[LeaveRequestResponse]:
        """Render requests for ``viewer``. The reason is included only for the
        member themself and for those who may decide the request."""
        if not requests:
            return []
        org_id = str(organization_id)
        votes = await self._votes([str(r.id) for r in requests])
        user_ids = {str(r.user_id) for r in requests} | {
            str(r.decided_by) for r in requests if r.decided_by
        }
        for request_votes in votes.values():
            user_ids |= {str(v.voter_id) for v in request_votes}
        users = {
            str(u.id): u
            for u in (
                await self.db.execute(
                    select(User).where(
                        User.id.in_(list(user_ids)), User.organization_id == org_id
                    )
                )
            )
            .scalars()
            .all()
        }
        pool = await self._pool(org_id, await self.get_settings(org_id))
        viewer_id = str(viewer.id)
        is_manager = user_has_permission(viewer, MANAGE_PERMISSION)
        out: List[LeaveRequestResponse] = []
        for r in requests:
            approvers = pool.approvers_for(r.user_id)
            request_votes = votes.get(str(r.id), [])
            counted = [v for v in request_votes if str(v.voter_id) in approvers]
            my_vote = next(
                (v.vote for v in request_votes if str(v.voter_id) == viewer_id), None
            )
            may_see_reason = (
                str(r.user_id) == viewer_id or viewer_id in approvers or is_manager
            )
            out.append(
                LeaveRequestResponse(
                    id=str(r.id),
                    user_id=str(r.user_id),
                    member_name=_display_name(users.get(str(r.user_id))),
                    leave_type=r.leave_type,
                    start_date=r.start_date,
                    end_date=r.end_date,
                    reason=r.reason if may_see_reason else None,
                    status=r.status,
                    decision_rule=r.decision_rule,
                    created_at=r.created_at,
                    decided_at=r.decided_at,
                    decided_by_name=(
                        _display_name(users.get(str(r.decided_by)))
                        if r.decided_by
                        else None
                    ),
                    leave_id=str(r.leave_id) if r.leave_id else None,
                    votes=[
                        LeaveRequestVoteResponse(
                            voter_id=str(v.voter_id),
                            voter_name=_display_name(users.get(str(v.voter_id))),
                            vote=v.vote,
                            note=v.note,
                            created_at=v.created_at,
                        )
                        for v in request_votes
                    ],
                    approvals=sum(v.vote == LeaveVote.APPROVE for v in counted),
                    denials=sum(v.vote == LeaveVote.DENY for v in counted),
                    approver_count=len(approvers),
                    approvals_needed=approvals_needed(r.decision_rule, len(approvers)),
                    can_vote=(
                        r.status == LeaveRequestStatus.PENDING
                        and viewer_id in approvers
                        and my_vote is None
                    ),
                    my_vote=my_vote,
                )
            )
        return out

    async def requester_and_approvers(
        self, organization_id: str, request: LeaveRequest
    ) -> tuple:
        """The requesting member and the members who may decide, for email."""
        org_id = str(organization_id)
        ids = await self.approvers_for(org_id, request.user_id)
        users = (
            (
                await self.db.execute(
                    select(User).where(
                        or_(
                            User.id == str(request.user_id),
                            User.id.in_(list(ids) or [""]),
                        ),
                        User.organization_id == org_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        member = next((u for u in users if str(u.id) == str(request.user_id)), None)
        approvers = [u for u in users if str(u.id) in ids]
        return member, approvers, len(ids)
