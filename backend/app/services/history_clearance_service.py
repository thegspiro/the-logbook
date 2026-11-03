"""
History Clearance Service

A department's clearance list is an ordered set of steps, each naming a
position. A record bound for the public passes every step in turn; any one
active member holding a step's position clears it. Owner decisions:

* the list governs **public** publishing; publishing to members needs only
  ``history.publish``, and internal material may go through the list by choice;
* ``history.manage`` and ``settings.manage`` both edit the list, and every
  change is audit-logged and emailed to administrators;
* a member may clear their own submission — a small department's President
  writes and publishes — and the decision says so;
* an empty list means nothing stands between ``history.publish`` and the
  public, which is how a department with no review works today.

A request freezes the list as it stood at submission, so editing the list does
not change a review already under way.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.history import (
    ClearanceDecisionKind,
    ClearancePurpose,
    ClearanceStatus,
    HistoricalMember,
    HistoryClearanceDecision,
    HistoryClearanceRequest,
    HistoryClearanceStep,
    HistoryRevision,
    RevisionKind,
)
from app.models.user import Position, User, user_positions

RECORD_PATHS = {"member": "/history/people/{id}"}
REVIEW_PATH = "/history/clearance/{id}"


@dataclass(frozen=True)
class DecisionOutcome:
    request: HistoryClearanceRequest
    #: Members to tell it is now their turn.
    notify_next: list[str]
    #: The submitter, when the request finished either way.
    notify_submitter: Optional[str]


def record_path(record_type: str, record_id: str) -> str:
    return RECORD_PATHS[record_type].format(id=record_id)


def review_path(request_id: str) -> str:
    return REVIEW_PATH.format(id=request_id)


class HistoryClearanceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # The list
    # ------------------------------------------------------------------

    async def list_steps(self, organization_id: str) -> list[HistoryClearanceStep]:
        result = await self.db.execute(
            select(HistoryClearanceStep)
            .where(HistoryClearanceStep.organization_id == str(organization_id))
            .order_by(HistoryClearanceStep.step_order)
        )
        return list(result.scalars().all())

    async def position_names(
        self, organization_id: str, position_ids: set[str]
    ) -> dict[str, str]:
        if not position_ids:
            return {}
        result = await self.db.execute(
            select(Position.id, Position.name).where(
                Position.organization_id == str(organization_id),
                Position.id.in_(position_ids),
            )
        )
        return {pid: name for pid, name in result.all()}

    async def replace_steps(
        self, organization_id: str, steps: list[dict[str, str]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Replace the list; return (before, after) for the audit entry."""
        before = [
            {"name": s.name, "position_id": s.position_id}
            for s in await self.list_steps(organization_id)
        ]
        wanted = {str(s["position_id"]) for s in steps}
        known = await self.position_names(organization_id, wanted)
        if len(known) != len(wanted):
            raise ValueError("A chosen position is not one of this department's")
        await self.db.execute(
            delete(HistoryClearanceStep).where(
                HistoryClearanceStep.organization_id == str(organization_id)
            )
        )
        after = []
        for order, step in enumerate(steps):
            name = " ".join(step["name"].split())
            if not name:
                raise ValueError("Give each step a name")
            self.db.add(
                HistoryClearanceStep(
                    organization_id=str(organization_id),
                    step_order=order,
                    name=name,
                    position_id=str(step["position_id"]),
                )
            )
            after.append({"name": name, "position_id": str(step["position_id"])})
        await self.db.flush()
        return before, after

    async def clearer_position_ids(self, organization_id: str) -> set[str]:
        return {
            s.position_id
            for s in await self.list_steps(organization_id)
            if s.position_id is not None
        }

    async def held_position_ids(self, organization_id: str, user_id: str) -> set[str]:
        result = await self.db.execute(
            select(user_positions.c.position_id)
            .join(Position, Position.id == user_positions.c.position_id)
            .where(
                user_positions.c.user_id == str(user_id),
                Position.organization_id == str(organization_id),
            )
        )
        return {str(pid) for (pid,) in result.all()}

    async def is_clearer(self, organization_id: str, user_id: str) -> bool:
        clearers = await self.clearer_position_ids(organization_id)
        if not clearers:
            return False
        return bool(clearers & await self.held_position_ids(organization_id, user_id))

    async def holders_of(self, organization_id: str, position_id: str) -> list[str]:
        from app.services.finance_budget_ownership import position_holders_query

        result = await self.db.execute(
            position_holders_query(str(organization_id), str(position_id))
        )
        return [str(u.id) for u in result.scalars().unique().all()]

    async def administrators(self, organization_id: str) -> list[str]:
        """Active members holding ``settings.manage``, wildcards counted."""
        from app.api.dependencies import user_has_permission

        result = await self.db.execute(
            select(User)
            .options(selectinload(User.positions))
            .where(User.organization_id == str(organization_id), User.is_active)
        )
        return [
            str(u.id)
            for u in result.scalars().unique().all()
            if user_has_permission(u, "settings.manage")
        ]

    # ------------------------------------------------------------------
    # Requests
    # ------------------------------------------------------------------

    async def get_request(
        self, organization_id: str, request_id: str, *, for_update: bool = False
    ) -> Optional[HistoryClearanceRequest]:
        query = (
            select(HistoryClearanceRequest)
            .options(selectinload(HistoryClearanceRequest.decisions))
            .where(
                HistoryClearanceRequest.id == str(request_id),
                HistoryClearanceRequest.organization_id == str(organization_id),
            )
            .execution_options(populate_existing=True)
        )
        if for_update:
            query = query.with_for_update()
        return await self.db.scalar(query)

    async def latest_request(
        self, organization_id: str, record_type: str, record_id: str
    ) -> Optional[HistoryClearanceRequest]:
        return await self.db.scalar(
            select(HistoryClearanceRequest)
            .options(selectinload(HistoryClearanceRequest.decisions))
            .where(
                HistoryClearanceRequest.organization_id == str(organization_id),
                HistoryClearanceRequest.record_type == record_type,
                HistoryClearanceRequest.record_id == str(record_id),
            )
            .order_by(
                HistoryClearanceRequest.submitted_at.desc(),
                HistoryClearanceRequest.revision_number.desc(),
            )
            .limit(1)
        )

    async def is_cleared(
        self,
        organization_id: str,
        record_type: str,
        record_id: str,
        substantial_revision_number: int,
    ) -> bool:
        """Whether the record's latest substantial revision may go public.

        True with no list at all. Otherwise a request for that revision, or a
        later one, must have cleared every step; minor edits after it do not
        undo it.
        """
        if not await self.list_steps(organization_id):
            return True
        cleared = await self.db.scalar(
            select(HistoryClearanceRequest.id).where(
                HistoryClearanceRequest.organization_id == str(organization_id),
                HistoryClearanceRequest.record_type == record_type,
                HistoryClearanceRequest.record_id == str(record_id),
                HistoryClearanceRequest.status == ClearanceStatus.CLEARED,
                HistoryClearanceRequest.revision_number >= substantial_revision_number,
            )
        )
        return cleared is not None

    async def _log(
        self,
        request: HistoryClearanceRequest,
        kind: RevisionKind,
        actor_id: Optional[str],
        note: Optional[str],
    ) -> None:
        self.db.add(
            HistoryRevision(
                organization_id=request.organization_id,
                record_type=request.record_type,
                record_id=request.record_id,
                revision_number=request.revision_number,
                kind=kind,
                note=note,
                actor_id=actor_id,
            )
        )
        await self.db.flush()

    async def submit(
        self,
        person: HistoricalMember,
        purpose: ClearancePurpose,
        actor_id: str,
    ) -> tuple[HistoryClearanceRequest, list[str]]:
        """Open a request for the record's current revision.

        Returns the request and the members to tell it is their turn.
        """
        steps = await self.list_steps(person.organization_id)
        if not steps:
            raise ValueError(
                "This department has no clearance list; the record can be "
                "published directly"
            )
        await self.withdraw_pending(
            person.organization_id, "member", person.id, actor_id
        )
        request = HistoryClearanceRequest(
            organization_id=person.organization_id,
            record_type="member",
            record_id=person.id,
            revision_number=person.revision_number,
            purpose=purpose,
            status=ClearanceStatus.PENDING,
            steps=[
                {
                    "step_id": s.id,
                    "name": s.name,
                    "position_id": s.position_id,
                }
                for s in steps
            ],
            current_step_index=0,
            submitted_by=actor_id,
        )
        self.db.add(request)
        await self.db.flush()
        await self._log(
            request,
            RevisionKind.SUBMITTED,
            actor_id,
            (
                "Submitted for public clearance"
                if purpose == ClearancePurpose.PUBLIC
                else "Submitted for review"
            ),
        )
        first = steps[0].position_id
        notify = await self.holders_of(person.organization_id, first) if first else []
        request = await self.get_request(person.organization_id, request.id)
        assert request is not None
        return request, notify

    async def withdraw_pending(
        self,
        organization_id: str,
        record_type: str,
        record_id: str,
        actor_id: Optional[str],
    ) -> None:
        result = await self.db.execute(
            select(HistoryClearanceRequest).where(
                HistoryClearanceRequest.organization_id == str(organization_id),
                HistoryClearanceRequest.record_type == record_type,
                HistoryClearanceRequest.record_id == str(record_id),
                HistoryClearanceRequest.status == ClearanceStatus.PENDING,
            )
        )
        for request in result.scalars().all():
            request.status = ClearanceStatus.WITHDRAWN
            request.closed_at = datetime.now(timezone.utc)
            await self._log(
                request,
                RevisionKind.WITHDRAWN,
                actor_id,
                "Withdrawn: the record changed substantially while under review",
            )

    @staticmethod
    def current_step(request: HistoryClearanceRequest) -> Optional[dict[str, Any]]:
        if request.status != ClearanceStatus.PENDING:
            return None
        if request.current_step_index >= len(request.steps):
            return None
        step: dict[str, Any] = request.steps[request.current_step_index]
        return step

    async def can_decide(self, request: HistoryClearanceRequest, user_id: str) -> bool:
        step = self.current_step(request)
        if step is None or not step.get("position_id"):
            return False
        held = await self.held_position_ids(request.organization_id, user_id)
        return str(step["position_id"]) in held

    async def decide(
        self,
        request: HistoryClearanceRequest,
        decision: ClearanceDecisionKind,
        note: Optional[str],
        actor_id: str,
    ) -> DecisionOutcome:
        # Two holders of one step deciding at once would both read the same
        # current step and both advance it. Re-read the request as a locking
        # read: the copy the caller loaded predates the lock, and under
        # REPEATABLE READ a plain re-read would still answer from that snapshot
        # (CLAUDE.md pitfall #27).
        locked = await self.get_request(
            request.organization_id, request.id, for_update=True
        )
        if locked is None:
            raise ValueError("This request is no longer waiting for a decision")
        request = locked
        step = self.current_step(request)
        if step is None:
            raise ValueError("This request is no longer waiting for a decision")
        position_id = step.get("position_id")
        if not position_id or not await self.position_names(
            request.organization_id, {str(position_id)}
        ):
            raise ValueError(
                f'The "{step["name"]}" step names a position that no longer '
                "exists. Update the clearance list and submit the record again."
            )
        if not await self.can_decide(request, actor_id):
            raise PermissionError("Only a holder of this step's position can decide it")
        now = datetime.now(timezone.utc)
        self.db.add(
            HistoryClearanceDecision(
                request_id=request.id,
                step_index=request.current_step_index,
                step_name=step["name"],
                decision=decision,
                decided_by=actor_id,
                decided_by_author=str(actor_id) == str(request.submitted_by or ""),
                note=(note or "").strip() or None,
                decided_at=now,
            )
        )
        notify_next: list[str] = []
        notify_submitter: Optional[str] = None
        author = (
            " (by the author)" if str(actor_id) == str(request.submitted_by) else ""
        )
        if decision == ClearanceDecisionKind.RETURNED:
            request.status = ClearanceStatus.RETURNED
            request.closed_at = now
            notify_submitter = request.submitted_by
            await self._log(
                request,
                RevisionKind.RETURNED,
                actor_id,
                f'Returned at "{step["name"]}"{author}: {(note or "").strip()}',
            )
        else:
            await self._log(
                request,
                RevisionKind.CLEARED,
                actor_id,
                f'Cleared "{step["name"]}"{author}',
            )
            request.current_step_index += 1
            following = self.current_step(request)
            if following is None:
                request.status = ClearanceStatus.CLEARED
                request.closed_at = now
                notify_submitter = request.submitted_by
            elif following.get("position_id"):
                notify_next = await self.holders_of(
                    request.organization_id, following["position_id"]
                )
        await self.db.flush()
        refreshed = await self.get_request(request.organization_id, request.id)
        assert refreshed is not None
        return DecisionOutcome(refreshed, notify_next, notify_submitter)

    async def queue(
        self, organization_id: str, user_id: str
    ) -> list[HistoryClearanceRequest]:
        """Pending requests whose current step this member can decide."""
        held = await self.held_position_ids(organization_id, user_id)
        if not held:
            return []
        result = await self.db.execute(
            select(HistoryClearanceRequest)
            .options(selectinload(HistoryClearanceRequest.decisions))
            .where(
                HistoryClearanceRequest.organization_id == str(organization_id),
                HistoryClearanceRequest.status == ClearanceStatus.PENDING,
            )
            .order_by(HistoryClearanceRequest.submitted_at)
        )
        out = []
        for request in result.scalars().all():
            step = self.current_step(request)
            if step and step.get("position_id") and str(step["position_id"]) in held:
                out.append(request)
        return out

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    async def request_view(
        self,
        request: HistoryClearanceRequest,
        *,
        record_label: str,
        viewer_id: str,
    ) -> dict[str, Any]:
        user_ids = {request.submitted_by} | {d.decided_by for d in request.decisions}
        names = await self._user_names({u for u in user_ids if u})
        positions = await self.position_names(
            request.organization_id,
            {str(s["position_id"]) for s in request.steps if s.get("position_id")},
        )
        decisions = {d.step_index: d for d in request.decisions}
        steps = []
        for index, step in enumerate(request.steps):
            position_id = step.get("position_id")
            decision = decisions.get(index)
            steps.append(
                {
                    "index": index,
                    "name": step["name"],
                    "position_id": position_id,
                    "position_name": (
                        positions.get(str(position_id)) if position_id else None
                    ),
                    "blocked": not position_id or str(position_id) not in positions,
                    "decision": decision.decision if decision else None,
                    "decided_by_name": (
                        names.get(decision.decided_by)
                        if decision and decision.decided_by
                        else None
                    ),
                    "decided_by_author": bool(decision and decision.decided_by_author),
                    "note": decision.note if decision else None,
                    "decided_at": decision.decided_at if decision else None,
                }
            )
        return {
            "id": request.id,
            "record_type": request.record_type,
            "record_id": request.record_id,
            "record_label": record_label,
            "revision_number": request.revision_number,
            "purpose": request.purpose,
            "status": request.status,
            "current_step_index": request.current_step_index,
            "steps": steps,
            "submitted_by_name": (
                names.get(request.submitted_by) if request.submitted_by else None
            ),
            "submitted_at": request.submitted_at,
            "closed_at": request.closed_at,
            "can_decide": await self.can_decide(request, viewer_id),
        }

    async def _user_names(self, user_ids: set[str]) -> dict[str, str]:
        if not user_ids:
            return {}
        result = await self.db.execute(select(User).where(User.id.in_(user_ids)))
        return {str(u.id): u.full_name for u in result.scalars().all()}
