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
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Set

from loguru import logger
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.audit import log_audit_event
from app.core.constants import CHIEF_POSITION_SLUGS
from app.models.leave_request import (
    LeaveApproverCover,
    LeaveDecisionRule,
    LeaveMessageKind,
    LeaveRequest,
    LeaveRequestMessage,
    LeaveRequestStatus,
    LeaveRequestVote,
    LeaveVote,
)
from app.models.user import (
    MemberLeaveOfAbsence,
    Organization,
    Position,
    User,
    user_positions,
)
from app.schemas.leave_of_absence import (
    LeaveApproverCoverBoard,
    LeaveApproverCoverCreate,
    LeaveApproverCoverResponse,
    LeaveApproverPosition,
    LeaveCoverPerson,
    LeaveCoverSuggestion,
    LeaveDates,
    LeaveOfAbsenceSettings,
    LeaveProposalResponse,
    LeaveRequestCreate,
    LeaveRequestMessageResponse,
    LeaveRequestResponse,
    LeaveRequestSummary,
    LeaveRequestVoteResponse,
    LeaveSettingsResponse,
    settings_from,
)
from app.services.member_leave_service import MemberLeaveService
from app.utils.org_scoping import assert_all_in_org
from app.utils.org_timezone import resolve_org_today

SETTINGS_KEY = "leave_of_absence"
MANAGE_PERMISSION = "members.manage"


class LeaveRequestNotFound(Exception):
    """The request is not in the caller's department, or not theirs to see."""


class LeaveRequestForbidden(Exception):
    """The caller may see the request but not do this to it."""


def _overlaps(
    a_start: date, a_end: Optional[date], b_start: date, b_end: Optional[date]
) -> bool:
    """Whether two date ranges share a day. ``None`` as an end is open."""
    return (b_end is None or a_start <= b_end) and (a_end is None or b_start <= a_end)


def _within(
    start: date, end: Optional[date], outer_start: date, outer_end: Optional[date]
) -> bool:
    """Whether ``[start, end]`` lies entirely inside the outer range."""
    if start < outer_start:
        return False
    if outer_end is None:
        return True
    return end is not None and end <= outer_end


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
    """Who may decide in a department, worked out once per call.

    ``covers`` maps an approver away today to the officer standing in for
    them, already checked to manage leave.
    """

    configured: Set[str]
    chiefs: Set[str]
    managers: Set[str]
    covers: Dict[str, str] = field(default_factory=dict)

    def approvers_for(
        self, requester_id: str, routed_to_chief: bool = False
    ) -> Set[str]:
        """The approvers whose votes count on a request: its seats.

        A request routed to the Chief skips the approver positions. The
        requester never decides their own request.
        """
        requester = str(requester_id)
        steps = (
            (self.chiefs, self.managers)
            if routed_to_chief
            else (self.configured, self.chiefs, self.managers)
        )
        for step in steps:
            ids = step - {requester}
            if ids:
                return ids
        return set()

    def deciders(self, request: LeaveRequest) -> "_Deciders":
        seats = self.approvers_for(request.user_id, bool(request.routed_to_chief))
        requester = str(request.user_id)
        holder = {}
        for seat in seats:
            stand_in = self.covers.get(seat)
            # A stand-in never decides their own request; the seat stays
            # with the approver.
            holder[seat] = stand_in if stand_in and stand_in != requester else seat
        return _Deciders(seats=seats, holder=holder)


@dataclass
class _Deciders:
    """A request's seats, and who holds each today.

    A seat is an approver whose vote counts. Its holder is the approver, or
    the officer standing in for them while they are away; the holder casts
    the seat's vote.
    """

    seats: Set[str]
    holder: Dict[str, str]

    @property
    def actors(self) -> Set[str]:
        return set(self.holder.values())

    def seats_of(self, user_id: str) -> Set[str]:
        uid = str(user_id)
        return {seat for seat, held_by in self.holder.items() if held_by == uid}

    def counted(self, votes: Sequence) -> List:
        return [v for v in votes if str(v.seat_id) in self.seats]

    def open_seats_of(self, user_id: str, votes: Sequence) -> Set[str]:
        filled = {str(v.seat_id) for v in votes}
        return self.seats_of(user_id) - filled

    def waiting_on(self, votes: Sequence) -> Set[str]:
        """Who holds a seat not yet filled this round."""
        filled = {str(v.seat_id) for v in votes}
        return {self.holder[s] for s in self.seats if s not in filled}


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
        today = await resolve_org_today(self.db, org_id)
        covers: Dict[str, str] = {}
        for cover in (
            await self.db.execute(
                select(LeaveApproverCover).where(
                    LeaveApproverCover.organization_id == org_id,
                    LeaveApproverCover.start_date <= today,
                    LeaveApproverCover.end_date >= today,
                )
            )
        ).scalars():
            # Checked when used, not only when set: a stand-in who no longer
            # manages leave (or has left) stops standing in, and the seat
            # returns to the approver.
            if str(cover.stand_in_id) in managers:
                covers[str(cover.approver_id)] = str(cover.stand_in_id)
        return _Pool(
            configured=configured, chiefs=chiefs, managers=managers, covers=covers
        )

    async def deciders_for(
        self, organization_id: str, request: LeaveRequest
    ) -> _Deciders:
        """Who decides ``request`` today: its seats and their holders."""
        org_id = str(organization_id)
        pool = await self._pool(org_id, await self.get_settings(org_id))
        return pool.deciders(request)

    # ------------------------------------------------------------------
    # Approver cover
    # ------------------------------------------------------------------

    # The longest cover one entry may set. A department that needs longer
    # sets another when this one ends, which keeps an officer looking at it.
    MAX_COVER_DAYS = 366

    def _cover_approvers(self, pool: _Pool) -> Set[str]:
        """Members who sit as approvers in their own right, and so may be
        covered: the approver positions' holders and the Chief, or, where
        neither exists, those who manage leave."""
        return (pool.configured | pool.chiefs) or set(pool.managers)

    async def _users_by_id(self, org_id: str, ids: Set[str]) -> Dict[str, User]:
        if not ids:
            return {}
        return {
            str(u.id): u
            for u in (
                await self.db.execute(
                    select(User).where(
                        User.id.in_(list(ids)), User.organization_id == org_id
                    )
                )
            ).scalars()
        }

    async def cover_suggestions(
        self,
        organization_id: str,
        member_id: str,
        *,
        leave_id: Optional[str] = None,
    ) -> List[LeaveCoverSuggestion]:
        """The member's own current and upcoming leaves that want a stand-in.

        Offered only to someone who may be covered (an approver in their own
        right), in a department that takes requests, with another officer who
        manages leave to name. A leave already spanned by one of the member's
        covers on any of its days is not offered again. The dates start no
        earlier than today and run no longer than one cover may.
        """
        org_id = str(organization_id)
        member = str(member_id)
        settings = await self.get_settings(org_id)
        if not settings.requests_enabled:
            return []
        pool = await self._pool(org_id, settings)
        if member not in self._cover_approvers(pool) or not (pool.managers - {member}):
            return []
        today = await resolve_org_today(self.db, org_id)
        query = select(MemberLeaveOfAbsence).where(
            MemberLeaveOfAbsence.organization_id == org_id,
            MemberLeaveOfAbsence.user_id == member,
            MemberLeaveOfAbsence.active.is_(True),
            or_(
                MemberLeaveOfAbsence.end_date.is_(None),
                MemberLeaveOfAbsence.end_date >= today,
            ),
        )
        if leave_id is not None:
            query = query.where(MemberLeaveOfAbsence.id == str(leave_id))
        leaves = list(
            (
                await self.db.execute(
                    query.order_by(
                        MemberLeaveOfAbsence.start_date, MemberLeaveOfAbsence.id
                    )
                )
            ).scalars()
        )
        if not leaves:
            return []
        covers = list(
            (
                await self.db.execute(
                    select(LeaveApproverCover).where(
                        LeaveApproverCover.organization_id == org_id,
                        LeaveApproverCover.approver_id == member,
                        LeaveApproverCover.end_date >= today,
                    )
                )
            ).scalars()
        )
        suggestions: List[LeaveCoverSuggestion] = []
        for leave in leaves:
            start = max(leave.start_date, today)
            end = leave.end_date
            if end is not None:
                end = min(end, start + timedelta(days=self.MAX_COVER_DAYS - 1))
            if any(
                c.start_date <= (end or date.max) and c.end_date >= start
                for c in covers
            ):
                continue
            suggestions.append(
                LeaveCoverSuggestion(
                    leave_id=str(leave.id), start_date=start, end_date=end
                )
            )
        return suggestions

    async def cover_board(
        self, organization_id: str, viewer: User
    ) -> LeaveApproverCoverBoard:
        """Current and upcoming covers the viewer may see, and the choices
        for setting one. Those who manage leave see every cover; anyone else
        sees the covers naming them, as approver or stand-in."""
        org_id = str(organization_id)
        today = await resolve_org_today(self.db, org_id)
        pool = await self._pool(org_id, await self.get_settings(org_id))
        viewer_id = str(viewer.id)
        is_manager = user_has_permission(viewer, MANAGE_PERMISSION)
        query = select(LeaveApproverCover).where(
            LeaveApproverCover.organization_id == org_id,
            LeaveApproverCover.end_date >= today,
        )
        if not is_manager:
            query = query.where(
                or_(
                    LeaveApproverCover.approver_id == viewer_id,
                    LeaveApproverCover.stand_in_id == viewer_id,
                )
            )
        covers = list(
            (
                await self.db.execute(
                    query.order_by(LeaveApproverCover.start_date, LeaveApproverCover.id)
                )
            ).scalars()
        )
        approver_ids = self._cover_approvers(pool)
        settable = (
            approver_ids
            if is_manager
            else ({viewer_id} if viewer_id in approver_ids else set())
        )
        users = await self._users_by_id(
            org_id,
            {str(c.approver_id) for c in covers}
            | {str(c.stand_in_id) for c in covers}
            | settable
            | (pool.managers if settable else set()),
        )

        def person(uid: str) -> LeaveCoverPerson:
            return LeaveCoverPerson(id=uid, name=_display_name(users.get(uid)))

        def by_name(ids: Set[str]) -> List[LeaveCoverPerson]:
            return sorted(
                (person(uid) for uid in ids if uid in users),
                key=lambda p: (p.name.lower(), p.id),
            )

        return LeaveApproverCoverBoard(
            covers=[
                LeaveApproverCoverResponse(
                    id=str(c.id),
                    approver_id=str(c.approver_id),
                    approver_name=_display_name(users.get(str(c.approver_id))),
                    stand_in_id=str(c.stand_in_id),
                    stand_in_name=_display_name(users.get(str(c.stand_in_id))),
                    start_date=c.start_date,
                    end_date=c.end_date,
                    active=c.start_date <= today <= c.end_date,
                    can_clear=is_manager or str(c.approver_id) == viewer_id,
                )
                for c in covers
            ],
            approvers=by_name(settable),
            stand_ins=by_name(pool.managers) if settable else [],
            suggested=await self.cover_suggestions(org_id, viewer_id),
            today=today,
        )

    async def set_cover(
        self, organization_id: str, actor: User, data: LeaveApproverCoverCreate
    ) -> LeaveApproverCover:
        """Name a stand-in for an approver's away period.

        The approver sets their own; those who manage leave may set anyone's.
        The stand-in must manage leave, so naming them shows a request's
        reason to nobody who could not already read it.
        """
        org_id = str(organization_id)
        settings = await self.get_settings(org_id)
        if not settings.requests_enabled:
            raise LeaveRequestForbidden(
                "Your department does not take leave requests here, so there is "
                "nothing for a stand-in to decide."
            )
        actor_id = str(actor.id)
        approver_id = str(data.approver_id)
        if approver_id != actor_id and not user_has_permission(
            actor, MANAGE_PERMISSION
        ):
            raise LeaveRequestForbidden(
                "Only an officer who manages leave can set another approver's " "cover."
            )
        # Locked so two covers for one approver, set at once, are checked for
        # overlap one after the other (pitfall #27). The lock is also the
        # in-department check on the approver. The overlap read below must
        # also be a locking read: under REPEATABLE READ a plain SELECT
        # answers from the snapshot taken before the lock (e.g. when
        # ``get_current_user`` resolved the caller at the start of the
        # request) and would miss the winner's just-committed insert.
        approver = (
            await self.db.execute(
                select(User)
                .where(User.id == approver_id, User.organization_id == org_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if approver is None:
            raise ValueError("That approver is not a member of your department.")
        pool = await self._pool(org_id, settings)
        if approver_id not in self._cover_approvers(pool):
            raise ValueError(
                "That member is not an approver, so there is nothing to cover."
            )
        stand_in_id = str(data.stand_in_id)
        if stand_in_id not in pool.managers:
            raise ValueError("The stand-in must be a current member who manages leave.")
        today = await resolve_org_today(self.db, org_id)
        if data.start_date < today:
            raise ValueError("A cover cannot start before today.")
        if (data.end_date - data.start_date).days >= self.MAX_COVER_DAYS:
            raise ValueError(
                f"A cover can run for at most {self.MAX_COVER_DAYS} days; set "
                "another when this one ends."
            )
        clash = (
            await self.db.execute(
                select(LeaveApproverCover.id)
                .where(
                    LeaveApproverCover.organization_id == org_id,
                    LeaveApproverCover.approver_id == approver_id,
                    LeaveApproverCover.start_date <= data.end_date,
                    LeaveApproverCover.end_date >= data.start_date,
                )
                .with_for_update()
            )
        ).first()
        if clash is not None:
            raise LeaveRequestForbidden(
                "This approver already has a cover for some of these days. "
                "Clear it first."
            )
        cover = LeaveApproverCover(
            organization_id=org_id,
            approver_id=approver_id,
            stand_in_id=stand_in_id,
            start_date=data.start_date,
            end_date=data.end_date,
            created_by=actor_id,
        )
        self.db.add(cover)
        await self.db.flush()
        await log_audit_event(
            db=self.db,
            event_type="leave_approver_cover_set",
            event_category="user_management",
            severity="info",
            event_data={
                "cover_id": str(cover.id),
                "approver_id": approver_id,
                "stand_in_id": stand_in_id,
                "start_date": data.start_date.isoformat(),
                "end_date": data.end_date.isoformat(),
            },
            user_id=actor_id,
            username=actor.username,
        )
        await self.db.commit()
        await self.db.refresh(cover)
        return cover

    async def clear_cover(
        self, organization_id: str, actor: User, cover_id: str
    ) -> Dict[str, object]:
        """End a cover now. Votes a stand-in already cast keep counting.

        Returns the cleared cover's fields, as the row is deleted and the
        stand-in's notice is sent after the response.
        """
        org_id = str(organization_id)
        cover = (
            await self.db.execute(
                select(LeaveApproverCover)
                .where(
                    LeaveApproverCover.id == str(cover_id),
                    LeaveApproverCover.organization_id == org_id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        actor_id = str(actor.id)
        is_manager = user_has_permission(actor, MANAGE_PERMISSION)
        if cover is None or not (
            is_manager or actor_id in (str(cover.approver_id), str(cover.stand_in_id))
        ):
            raise LeaveRequestNotFound("Cover not found")
        if not is_manager and actor_id != str(cover.approver_id):
            raise LeaveRequestForbidden(
                "Only the approver or an officer who manages leave can clear "
                "this cover."
            )
        await log_audit_event(
            db=self.db,
            event_type="leave_approver_cover_cleared",
            event_category="user_management",
            severity="info",
            event_data={
                "cover_id": str(cover.id),
                "approver_id": str(cover.approver_id),
                "stand_in_id": str(cover.stand_in_id),
                "start_date": cover.start_date.isoformat(),
                "end_date": cover.end_date.isoformat(),
            },
            user_id=actor_id,
            username=actor.username,
        )
        cleared: Dict[str, object] = {
            "id": str(cover.id),
            "approver_id": str(cover.approver_id),
            "stand_in_id": str(cover.stand_in_id),
            "start_date": cover.start_date,
            "end_date": cover.end_date,
        }
        await self.db.delete(cover)
        await self.db.commit()
        return cleared

    # ------------------------------------------------------------------
    # Requests
    # ------------------------------------------------------------------

    async def _extension_target(
        self,
        org_id: str,
        user_id: str,
        start: date,
        end: Optional[date],
        *,
        exclude_request_id: Optional[str] = None,
    ) -> Optional[MemberLeaveOfAbsence]:
        """The active leave these dates extend, or ``None`` for a new leave.

        Dates that overlap an active leave, or start the day after it ends,
        extend it (owner decision 2026-11-16): approval moves that leave's
        dates instead of recording a second one beside it. Refused instead:
        dates entirely inside a leave (already covered), dates touching more
        than one leave (an officer has to merge those), and dates overlapping
        another request still waiting (two answers for one period).
        """
        waiting = (
            (
                await self.db.execute(
                    select(LeaveRequest).where(
                        LeaveRequest.organization_id == org_id,
                        LeaveRequest.user_id == user_id,
                        LeaveRequest.status == LeaveRequestStatus.PENDING,
                    )
                )
            )
            .scalars()
            .all()
        )
        for other in waiting:
            if str(other.id) == str(exclude_request_id or ""):
                continue
            if _overlaps(start, end, other.start_date, other.end_date):
                raise LeaveRequestForbidden(
                    "These dates overlap another of your requests that is still "
                    "waiting. Withdraw that one, or wait for its answer."
                )
        leaves = (
            (
                await self.db.execute(
                    select(MemberLeaveOfAbsence).where(
                        MemberLeaveOfAbsence.organization_id == org_id,
                        MemberLeaveOfAbsence.user_id == user_id,
                        MemberLeaveOfAbsence.active.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )
        touching = [
            leave
            for leave in leaves
            if _overlaps(start, end, leave.start_date, leave.end_date)
            or (
                leave.end_date is not None
                and start == leave.end_date + timedelta(days=1)
            )
        ]
        if not touching:
            return None
        if len(touching) > 1:
            raise LeaveRequestForbidden(
                "These dates touch more than one of your leaves. Ask the officer "
                "who manages leave to change them."
            )
        leave = touching[0]
        if _within(start, end, leave.start_date, leave.end_date):
            raise LeaveRequestForbidden(
                "Your current leave already covers these dates."
            )
        return leave

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
        extends = await self._extension_target(
            org_id, str(member.id), data.start_date, data.end_date
        )
        pool = await self._pool(org_id, settings)
        routed_to_chief = str(member.id) in pool.configured
        request = LeaveRequest(
            organization_id=org_id,
            user_id=str(member.id),
            leave_type=data.leave_type,
            start_date=data.start_date,
            end_date=data.end_date,
            reason=data.reason,
            status=LeaveRequestStatus.PENDING,
            decision_rule=settings.request_decision_rule,
            extends_leave_id=str(extends.id) if extends else None,
            routed_to_chief=routed_to_chief,
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
                "extends_leave_id": str(extends.id) if extends else None,
                "routed_to_chief": routed_to_chief,
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
        deciders = await self.deciders_for(org_id, request)
        if str(viewer.id) in deciders.seats | deciders.actors:
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
        return [
            r
            for r in rows
            if viewer_id in pool.deciders(r).actors
            or (
                r.status != LeaveRequestStatus.PENDING
                and viewer_id in pool.deciders(r).seats
            )
        ]

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

    def _awaiting_member(self, request: LeaveRequest) -> Optional[str]:
        """Why voting is paused, if it is: the member owes an answer or a
        decision on changed dates. ``None`` while approvers may act."""
        if request.info_requested_at is not None:
            return "answer"
        if request.proposed_at is not None:
            return "proposal"
        return None

    async def _as_approver(
        self, org_id: str, request: LeaveRequest, user: User
    ) -> _Deciders:
        """The request's deciders, after checking ``user`` holds a seat today.

        Anyone who does not is told the request does not exist, except the
        member, those who manage leave, and an approver whose seat a stand-in
        holds while they are away, who can see it and are told why they
        cannot act on it.
        """
        deciders = await self.deciders_for(org_id, request)
        uid = str(user.id)
        if not deciders.seats_of(uid):
            if uid in deciders.seats:
                raise LeaveRequestForbidden(
                    "Someone is standing in for you as an approver until your "
                    "cover ends; they decide this request in your place."
                )
            if str(request.user_id) == uid or user_has_permission(
                user, MANAGE_PERMISSION
            ):
                raise LeaveRequestForbidden(
                    "You are not one of this request's approvers."
                )
            raise LeaveRequestNotFound("Leave request not found")
        if request.status != LeaveRequestStatus.PENDING:
            raise LeaveRequestForbidden("This request has already been decided.")
        return deciders

    def _current_votes(self, request: LeaveRequest, votes: Sequence) -> List:
        return [v for v in votes if v.round == request.vote_round]

    async def _audit(
        self,
        event_type: str,
        request: LeaveRequest,
        actor_id: str,
        actor_name: Optional[str],
        **data,
    ) -> None:
        await log_audit_event(
            db=self.db,
            event_type=event_type,
            event_category="user_management",
            severity="info",
            event_data={
                "leave_request_id": str(request.id),
                "target_user_id": str(request.user_id),
                **data,
            },
            user_id=actor_id,
            username=actor_name,
        )

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
        are one decision (pitfall #27). Only the current round's votes count:
        accepting changed dates starts a new one. Returns the request; its
        status says whether this vote settled it, and ``leave_id`` names the
        leave an approval created or extended.
        """
        org_id = str(organization_id)
        request = await self._get(org_id, request_id, lock=True)
        deciders = await self._as_approver(org_id, request, voter)
        if self._awaiting_member(request):
            raise LeaveRequestForbidden(
                "This request is waiting on the member. Voting resumes once they "
                "answer."
            )
        voter_id = str(voter.id)
        existing = self._current_votes(
            request,
            (await self._votes([str(request.id)], lock=True)).get(str(request.id), []),
        )
        # A stand-in who is also an approver in their own right holds two
        # seats, and one decision fills both: they decide in the away
        # approver's place as well as their own.
        seats = deciders.open_seats_of(voter_id, existing)
        if not seats:
            raise LeaveRequestForbidden("You have already voted on this request.")

        for seat in sorted(seats):
            self.db.add(
                LeaveRequestVote(
                    organization_id=org_id,
                    request_id=str(request.id),
                    voter_id=voter_id,
                    seat_id=seat,
                    on_behalf_of=seat if seat != voter_id else None,
                    round=request.vote_round,
                    vote=vote,
                    note=note,
                )
            )
        counted = deciders.counted(existing)
        approvals = sum(v.vote == LeaveVote.APPROVE for v in counted) + (
            len(seats) if vote == LeaveVote.APPROVE else 0
        )
        denials = sum(v.vote == LeaveVote.DENY for v in counted) + (
            len(seats) if vote == LeaveVote.DENY else 0
        )
        outcome = settle(
            request.decision_rule,
            len(deciders.seats),
            approvals,
            denials,
            latest=vote,
        )
        await self._audit(
            "leave_request_vote",
            request,
            voter_id,
            voter.username,
            vote=vote.value,
            round=request.vote_round,
            outcome=outcome.value if outcome else None,
            on_behalf_of=sorted(s for s in seats if s != voter_id) or None,
        )
        return await self._finish(org_id, request, outcome, voter_id, voter.username)

    async def _finish(
        self,
        org_id: str,
        request: LeaveRequest,
        outcome: Optional[LeaveRequestStatus],
        decider_id: str,
        decider_name: Optional[str],
    ) -> LeaveRequest:
        """Commit, settling the request first when ``outcome`` says it is.

        An approval records the leave, or moves the dates of the leave it
        extends, exactly as an officer would. The overlap check runs again
        here, because leave can be recorded while a request waits.
        """
        if outcome is None:
            await self.db.commit()
            await self.db.refresh(request)
            return request

        if outcome == LeaveRequestStatus.APPROVED:
            extends = await self._extension_target(
                org_id,
                str(request.user_id),
                request.start_date,
                request.end_date,
                exclude_request_id=str(request.id),
            )
            request.status = outcome
            request.decided_at = datetime.now(timezone.utc)
            request.decided_by = decider_id
            leaves = MemberLeaveService(self.db)
            if extends is not None:
                new_start = min(extends.start_date, request.start_date)
                new_end = (
                    None
                    if request.end_date is None or extends.end_date is None
                    else max(extends.end_date, request.end_date)
                )
                request.extends_leave_id = str(extends.id)
                # update_leave commits, carrying the vote and status with it.
                updated = await leaves.update_leave(
                    organization_id=org_id,
                    leave_id=str(extends.id),
                    start_date=new_start,
                    end_date=new_end,
                )
                if updated is None:  # pragma: no cover - found above, in-org
                    raise LeaveRequestForbidden("The leave to extend is gone.")
                request.leave_id = str(updated.id)
                await self._audit(
                    "leave_of_absence_updated",
                    request,
                    decider_id,
                    decider_name,
                    leave_id=str(updated.id),
                    fields_changed=["end_date", "start_date"],
                    extended_by_request=True,
                )
            else:
                request.extends_leave_id = None
                # create_leave commits, carrying the vote and status with it.
                leave = await leaves.create_leave(
                    organization_id=org_id,
                    user_id=str(request.user_id),
                    start_date=request.start_date,
                    end_date=request.end_date,
                    leave_type=request.leave_type.value,
                    reason=request.reason,
                    granted_by=decider_id,
                )
                request.leave_id = str(leave.id)
                await self._audit(
                    "leave_of_absence_created",
                    request,
                    decider_id,
                    decider_name,
                    leave_id=str(leave.id),
                    leave_type=request.leave_type.value,
                    start_date=request.start_date.isoformat(),
                    end_date=(
                        request.end_date.isoformat() if request.end_date else None
                    ),
                )
        else:
            request.status = outcome
            request.decided_at = datetime.now(timezone.utc)
            request.decided_by = decider_id
        await self.db.commit()
        await self.db.refresh(request)
        if outcome == LeaveRequestStatus.APPROVED:
            await self._drop_assignments(request)
        return request

    # ------------------------------------------------------------------
    # The conversation: questions and changed dates
    # ------------------------------------------------------------------

    async def _message(
        self,
        request: LeaveRequest,
        author_id: str,
        kind: LeaveMessageKind,
        body: Optional[str],
    ) -> None:
        """Add to the conversation. The caller holds the request's lock, so the
        next position cannot be taken by a concurrent writer."""
        last = (
            await self.db.execute(
                select(func.max(LeaveRequestMessage.position)).where(
                    LeaveRequestMessage.request_id == str(request.id)
                )
            )
        ).scalar_one_or_none()
        self.db.add(
            LeaveRequestMessage(
                organization_id=request.organization_id,
                request_id=str(request.id),
                author_id=author_id,
                kind=kind,
                body=body,
                position=(last or 0) + 1,
            )
        )

    async def ask_question(
        self, organization_id: str, request_id: str, approver: User, question: str
    ) -> LeaveRequest:
        """Ask the member a question. Voting pauses until they answer."""
        org_id = str(organization_id)
        request = await self._get(org_id, request_id, lock=True)
        await self._as_approver(org_id, request, approver)
        if self._awaiting_member(request):
            raise LeaveRequestForbidden(
                "The member already has a question or changed dates to answer."
            )
        request.info_requested_at = datetime.now(timezone.utc)
        await self._message(
            request, str(approver.id), LeaveMessageKind.QUESTION, question
        )
        await self._audit(
            "leave_request_question", request, str(approver.id), approver.username
        )
        await self.db.commit()
        await self.db.refresh(request)
        return request

    async def answer_question(
        self, organization_id: str, request_id: str, member: User, answer: str
    ) -> LeaveRequest:
        """The member answers; voting resumes."""
        org_id = str(organization_id)
        request = await self._get(org_id, request_id, lock=True)
        if str(request.user_id) != str(member.id):
            raise LeaveRequestNotFound("Leave request not found")
        if request.status != LeaveRequestStatus.PENDING:
            raise LeaveRequestForbidden("This request has already been decided.")
        if request.info_requested_at is None:
            raise LeaveRequestForbidden("There is no question waiting on you.")
        request.info_requested_at = None
        await self._message(request, str(member.id), LeaveMessageKind.ANSWER, answer)
        await self._audit(
            "leave_request_answer", request, str(member.id), member.username
        )
        await self.db.commit()
        await self.db.refresh(request)
        return request

    async def propose_changes(
        self,
        organization_id: str,
        request_id: str,
        approver: User,
        start: date,
        end: Optional[date],
        note: Optional[str],
    ) -> LeaveRequest:
        """Approve with different dates, for the member to accept or decline.

        Voting pauses until they answer. The dates are checked against the
        member's leave and other requests now, so the member is never asked to
        accept dates that would be refused.
        """
        org_id = str(organization_id)
        request = await self._get(org_id, request_id, lock=True)
        await self._as_approver(org_id, request, approver)
        if self._awaiting_member(request):
            raise LeaveRequestForbidden(
                "The member already has a question or changed dates to answer."
            )
        if end is not None and end < start:
            raise ValueError("The end date must be on or after the start date.")
        if start == request.start_date and end == request.end_date:
            raise ValueError("These are the dates the member asked for; approve it.")
        await self._extension_target(
            org_id,
            str(request.user_id),
            start,
            end,
            exclude_request_id=str(request.id),
        )
        request.proposed_start_date = start
        request.proposed_end_date = end
        request.proposed_by = str(approver.id)
        request.proposed_at = datetime.now(timezone.utc)
        await self._message(request, str(approver.id), LeaveMessageKind.PROPOSAL, note)
        await self._audit(
            "leave_request_changes_proposed",
            request,
            str(approver.id),
            approver.username,
            proposed_start_date=start.isoformat(),
            proposed_end_date=end.isoformat() if end else None,
        )
        await self.db.commit()
        await self.db.refresh(request)
        return request

    async def respond_to_changes(
        self,
        organization_id: str,
        request_id: str,
        member: User,
        accept: bool,
        note: Optional[str] = None,
    ) -> LeaveRequest:
        """The member accepts or declines an approver's changed dates.

        Accepting moves the request onto those dates and starts a new voting
        round (owner decision 2026-11-16): votes on the old dates no longer
        count, and the proposer's approval is the new round's first vote, so
        under "any one approver" accepting settles the request. Declining
        keeps the member's own dates and the votes already cast.
        """
        org_id = str(organization_id)
        request = await self._get(org_id, request_id, lock=True)
        if str(request.user_id) != str(member.id):
            raise LeaveRequestNotFound("Leave request not found")
        if request.status != LeaveRequestStatus.PENDING:
            raise LeaveRequestForbidden("This request has already been decided.")
        if request.proposed_at is None or request.proposed_start_date is None:
            raise LeaveRequestForbidden("There are no changed dates waiting on you.")
        proposer_id = str(request.proposed_by) if request.proposed_by else None
        start, end = request.proposed_start_date, request.proposed_end_date
        request.proposed_start_date = None
        request.proposed_end_date = None
        request.proposed_by = None
        request.proposed_at = None
        if not accept:
            await self._message(
                request, str(member.id), LeaveMessageKind.PROPOSAL_DECLINED, note
            )
            await self._audit(
                "leave_request_changes_declined",
                request,
                str(member.id),
                member.username,
            )
            await self.db.commit()
            await self.db.refresh(request)
            return request

        extends = await self._extension_target(
            org_id,
            str(request.user_id),
            start,
            end,
            exclude_request_id=str(request.id),
        )
        request.start_date = start
        request.end_date = end
        request.extends_leave_id = str(extends.id) if extends else None
        request.vote_round += 1
        await self._message(
            request, str(member.id), LeaveMessageKind.PROPOSAL_ACCEPTED, note
        )
        await self._audit(
            "leave_request_changes_accepted",
            request,
            str(member.id),
            member.username,
            start_date=start.isoformat(),
            end_date=end.isoformat() if end else None,
            round=request.vote_round,
        )
        deciders = await self.deciders_for(org_id, request)
        proposer_seats = deciders.seats_of(proposer_id) if proposer_id else set()
        if proposer_id is None or not proposer_seats:
            # The proposer no longer decides requests (or a stand-in now holds
            # their seat): the new round starts with no votes, and whoever
            # holds the seats decides it.
            await self.db.commit()
            await self.db.refresh(request)
            return request
        for seat in sorted(proposer_seats):
            self.db.add(
                LeaveRequestVote(
                    organization_id=org_id,
                    request_id=str(request.id),
                    voter_id=proposer_id,
                    seat_id=seat,
                    on_behalf_of=seat if seat != proposer_id else None,
                    round=request.vote_round,
                    vote=LeaveVote.APPROVE,
                    note=None,
                )
            )
        outcome = settle(
            request.decision_rule,
            len(deciders.seats),
            len(proposer_seats),
            0,
            latest=LeaveVote.APPROVE,
        )
        proposer = await self.db.get(User, proposer_id)
        return await self._finish(
            org_id,
            request,
            outcome,
            proposer_id,
            proposer.username if proposer else None,
        )

    # ------------------------------------------------------------------
    # The daily recheck
    # ------------------------------------------------------------------

    async def resettle_pending(self, organization_id: str) -> List[LeaveRequest]:
        """Settle waiting requests whose rule is already met.

        Votes count against the members who hold the approver positions now,
        so an approver stepping down can leave a majority or unanimity
        reached with nobody left to cast the vote that would notice. Under
        "any one approver" the first vote always settled the request, so
        those are not rechecked; nor is a request waiting on its member.
        Returns the requests this settled.
        """
        org_id = str(organization_id)
        ids = (
            (
                await self.db.execute(
                    select(LeaveRequest.id).where(
                        LeaveRequest.organization_id == org_id,
                        LeaveRequest.status == LeaveRequestStatus.PENDING,
                        LeaveRequest.decision_rule != LeaveDecisionRule.ANY,
                        LeaveRequest.info_requested_at.is_(None),
                        LeaveRequest.proposed_at.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        settled: List[LeaveRequest] = []
        for request_id in ids:
            request = await self._get(org_id, str(request_id), lock=True)
            if request.status != LeaveRequestStatus.PENDING or self._awaiting_member(
                request
            ):
                await self.db.rollback()
                continue
            deciders = await self.deciders_for(org_id, request)
            votes = self._current_votes(
                request,
                (await self._votes([str(request.id)], lock=True)).get(
                    str(request.id), []
                ),
            )
            counted = deciders.counted(votes)
            outcome = settle(
                request.decision_rule,
                len(deciders.seats),
                sum(v.vote == LeaveVote.APPROVE for v in counted),
                sum(v.vote == LeaveVote.DENY for v in counted),
            )
            if outcome is None or not counted:
                await self.db.rollback()
                continue
            last = counted[-1]
            await self._audit(
                "leave_request_resettled",
                request,
                str(last.voter_id),
                None,
                outcome=outcome.value,
                approver_count=len(deciders.seats),
            )
            try:
                settled.append(
                    await self._finish(
                        org_id, request, outcome, str(last.voter_id), None
                    )
                )
            except LeaveRequestForbidden as exc:
                # The dates now clash with leave recorded meanwhile: leave the
                # request for its approvers, who see the same refusal.
                await self.db.rollback()
                logger.warning(
                    "Leave request {} not settled on recheck: {}", request_id, exc
                )
        return settled

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
        """Render requests for ``viewer``. The reason and the conversation are
        included only for the member themself, those who may decide the
        request, and those who manage leave."""
        if not requests:
            return []
        org_id = str(organization_id)
        request_ids = [str(r.id) for r in requests]
        votes = await self._votes(request_ids)
        messages: Dict[str, List[LeaveRequestMessage]] = {}
        for message in (
            (
                await self.db.execute(
                    select(LeaveRequestMessage)
                    .where(
                        LeaveRequestMessage.request_id.in_(request_ids),
                        LeaveRequestMessage.organization_id == org_id,
                    )
                    .order_by(LeaveRequestMessage.position)
                )
            )
            .scalars()
            .all()
        ):
            messages.setdefault(str(message.request_id), []).append(message)
        leave_ids = {str(r.extends_leave_id) for r in requests if r.extends_leave_id}
        extended = {
            str(leave.id): leave
            for leave in (
                await self.db.execute(
                    select(MemberLeaveOfAbsence).where(
                        MemberLeaveOfAbsence.id.in_(list(leave_ids) or [""]),
                        MemberLeaveOfAbsence.organization_id == org_id,
                    )
                )
            )
            .scalars()
            .all()
        }
        user_ids = {str(r.user_id) for r in requests}
        user_ids |= {str(r.decided_by) for r in requests if r.decided_by}
        user_ids |= {str(r.proposed_by) for r in requests if r.proposed_by}
        for request_votes in votes.values():
            user_ids |= {str(v.voter_id) for v in request_votes}
            user_ids |= {str(v.on_behalf_of) for v in request_votes if v.on_behalf_of}
        for request_messages in messages.values():
            user_ids |= {str(m.author_id) for m in request_messages if m.author_id}
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
            deciders = pool.deciders(r)
            request_votes = votes.get(str(r.id), [])
            current = self._current_votes(r, request_votes)
            counted = deciders.counted(current)
            my_vote = next(
                (v.vote for v in current if str(v.voter_id) == viewer_id), None
            )
            is_member = str(r.user_id) == viewer_id
            may_see_private = (
                is_member
                or viewer_id in deciders.seats
                or viewer_id in deciders.actors
                or is_manager
            )
            pending = r.status == LeaveRequestStatus.PENDING
            awaiting = self._awaiting_member(r) if pending else None
            can_act = (
                pending and bool(deciders.seats_of(viewer_id)) and awaiting is None
            )
            leave = (
                extended.get(str(r.extends_leave_id)) if r.extends_leave_id else None
            )
            out.append(
                LeaveRequestResponse(
                    id=str(r.id),
                    user_id=str(r.user_id),
                    member_name=_display_name(users.get(str(r.user_id))),
                    leave_type=r.leave_type,
                    start_date=r.start_date,
                    end_date=r.end_date,
                    reason=r.reason if may_see_private else None,
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
                    extends_leave=(
                        LeaveDates(start_date=leave.start_date, end_date=leave.end_date)
                        if leave is not None
                        else None
                    ),
                    awaiting=awaiting,
                    proposal=(
                        LeaveProposalResponse(
                            start_date=r.proposed_start_date,
                            end_date=r.proposed_end_date,
                            proposed_by_name=_display_name(
                                users.get(str(r.proposed_by)), "An approver"
                            ),
                            proposed_at=r.proposed_at,
                        )
                        if awaiting == "proposal"
                        and r.proposed_start_date is not None
                        and r.proposed_at is not None
                        else None
                    ),
                    messages=(
                        [
                            LeaveRequestMessageResponse(
                                kind=m.kind,
                                author_name=_display_name(
                                    users.get(str(m.author_id)), "A former member"
                                ),
                                body=m.body,
                                created_at=m.created_at,
                            )
                            for m in messages.get(str(r.id), [])
                        ]
                        if may_see_private
                        else []
                    ),
                    vote_round=r.vote_round,
                    votes=[
                        LeaveRequestVoteResponse(
                            voter_id=str(v.voter_id),
                            voter_name=_display_name(users.get(str(v.voter_id))),
                            on_behalf_of_name=(
                                _display_name(
                                    users.get(str(v.on_behalf_of)), "A former member"
                                )
                                if v.on_behalf_of
                                else None
                            ),
                            round=v.round,
                            vote=v.vote,
                            note=v.note,
                            created_at=v.created_at,
                        )
                        for v in request_votes
                    ],
                    approvals=sum(v.vote == LeaveVote.APPROVE for v in counted),
                    denials=sum(v.vote == LeaveVote.DENY for v in counted),
                    approver_count=len(deciders.seats),
                    approvals_needed=approvals_needed(
                        r.decision_rule, len(deciders.seats)
                    ),
                    routed_to_chief=bool(r.routed_to_chief),
                    can_vote=can_act
                    and bool(deciders.open_seats_of(viewer_id, current)),
                    can_ask=can_act,
                    can_answer=is_member and awaiting == "answer",
                    can_respond_to_changes=is_member and awaiting == "proposal",
                    my_vote=my_vote,
                )
            )
        return out

    async def summary(self, organization_id: str, viewer: User) -> LeaveRequestSummary:
        """For the navigation: whether to offer the page, and what waits.

        ``to_decide`` counts requests the viewer may vote on now and has not,
        so a request paused on its member, or already voted on, drops out.
        """
        org_id = str(organization_id)
        settings = await self.get_settings(org_id)
        pending = list(
            (
                await self.db.execute(
                    select(LeaveRequest).where(
                        LeaveRequest.organization_id == org_id,
                        LeaveRequest.status == LeaveRequestStatus.PENDING,
                    )
                )
            )
            .scalars()
            .all()
        )
        viewer_id = str(viewer.id)
        mine = [r for r in pending if str(r.user_id) == viewer_id]
        waiting_on_me = sum(1 for r in mine if self._awaiting_member(r))
        others = [
            r
            for r in pending
            if str(r.user_id) != viewer_id and self._awaiting_member(r) is None
        ]
        to_decide = 0
        if others:
            pool = await self._pool(org_id, settings)
            mine_to_vote = [r for r in others if pool.deciders(r).seats_of(viewer_id)]
            if mine_to_vote:
                votes = await self._votes([str(r.id) for r in mine_to_vote])
                for r in mine_to_vote:
                    current = self._current_votes(r, votes.get(str(r.id), []))
                    open_seats = pool.deciders(r).open_seats_of(viewer_id, current)
                    to_decide += 1 if open_seats else 0
        return LeaveRequestSummary(
            requests_enabled=settings.requests_enabled,
            to_decide=to_decide,
            waiting_on_me=waiting_on_me,
        )

    async def end_own_leave_early(
        self, organization_id: str, member: User, leave_id: str, first_day_back: date
    ) -> tuple:
        """The member sets the last day of their own leave in progress.

        Shortening a leave needs no vote: the member is back, and the officers
        who manage leave are told so they can correct a wrong date. Only a
        department that takes requests offers it, and only for a leave that
        has begun and not yet ended. Returns ``(leave, previous end date)``.
        """
        org_id = str(organization_id)
        settings = await self.get_settings(org_id)
        if not settings.requests_enabled:
            raise LeaveRequestForbidden(
                "Your department does not take leave changes from members. "
                "Ask an officer to end your leave."
            )
        # Locked so two submissions, or one racing an officer's edit, settle
        # one at a time against the same end date.
        leave = (
            await self.db.execute(
                select(MemberLeaveOfAbsence)
                .where(
                    MemberLeaveOfAbsence.id == str(leave_id),
                    MemberLeaveOfAbsence.organization_id == org_id,
                    MemberLeaveOfAbsence.user_id == str(member.id),
                    MemberLeaveOfAbsence.active.is_(True),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if leave is None:
            raise LeaveRequestNotFound("Leave of absence not found")
        today = await resolve_org_today(self.db, org_id)
        if leave.start_date > today:
            raise LeaveRequestForbidden(
                "This leave has not begun yet. Ask an officer to change it."
            )
        if leave.end_date is not None and leave.end_date < today:
            raise LeaveRequestForbidden("This leave has already ended.")
        if first_day_back <= leave.start_date:
            raise ValueError("Your first day back must be after your leave began.")
        new_end = first_day_back - timedelta(days=1)
        if leave.end_date is not None and new_end >= leave.end_date:
            raise ValueError(
                "That is not earlier than your leave already ends. To stay away "
                "longer, ask for an extension instead."
            )
        extending = (
            await self.db.execute(
                select(LeaveRequest.id).where(
                    LeaveRequest.organization_id == org_id,
                    LeaveRequest.extends_leave_id == str(leave.id),
                    LeaveRequest.status == LeaveRequestStatus.PENDING,
                )
            )
        ).first()
        if extending is not None:
            raise LeaveRequestForbidden(
                "You have asked to extend this leave. Withdraw that request "
                "before ending the leave early."
            )
        previous_end = leave.end_date
        await log_audit_event(
            db=self.db,
            event_type="leave_of_absence_ended_early",
            event_category="user_management",
            severity="info",
            event_data={
                "leave_id": str(leave.id),
                "previous_end_date": (
                    previous_end.isoformat() if previous_end else None
                ),
                "end_date": new_end.isoformat(),
            },
            user_id=str(member.id),
            username=member.username,
        )
        # The officer's own edit path, so the linked training waiver follows
        # the new end date; it commits.
        updated = await MemberLeaveService(self.db).update_leave(
            organization_id=org_id, leave_id=str(leave.id), end_date=new_end
        )
        if updated is None:
            raise LeaveRequestNotFound("Leave of absence not found")
        return updated, previous_end

    async def escalation_recipients(
        self, organization_id: str, request: LeaveRequest
    ) -> List[User]:
        """Who is told that ``request`` has waited too long.

        The Chief, but only one who can open the request (a manager of leave
        or one of its approvers): a notice they cannot act on helps nobody.
        Otherwise everyone who manages leave. Never the requester.
        """
        org_id = str(organization_id)
        pool = await self._pool(org_id, await self.get_settings(org_id))
        requester = str(request.user_id)
        approvers = pool.deciders(request).actors
        ids = (pool.chiefs & (pool.managers | approvers)) - {requester}
        if not ids:
            ids = pool.managers - {requester}
        if not ids:
            return []
        return list(
            (
                await self.db.execute(
                    select(User)
                    .where(
                        User.id.in_(list(ids)),
                        User.organization_id == org_id,
                        User.is_active,
                    )
                    .order_by(User.id)
                )
            )
            .scalars()
            .all()
        )

    async def requester_and_approvers(
        self, organization_id: str, request: LeaveRequest
    ) -> tuple:
        """The requesting member and the members who may decide, for email.

        The deciders are the seats' holders today, so a stand-in is emailed
        in place of the approver they cover. The count is the seats', which
        the decision rule is measured against.
        """
        org_id = str(organization_id)
        deciders = await self.deciders_for(org_id, request)
        ids = deciders.actors
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
        return member, approvers, len(deciders.seats)

    async def waiting_on_ids(
        self, organization_id: str, request: LeaveRequest
    ) -> Set[str]:
        """Who holds a seat on ``request`` not yet filled this round."""
        deciders = await self.deciders_for(str(organization_id), request)
        votes = self._current_votes(
            request, (await self._votes([str(request.id)])).get(str(request.id), [])
        )
        return deciders.waiting_on(votes)
