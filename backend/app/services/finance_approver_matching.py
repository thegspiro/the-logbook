"""
Who may act on a finance approval step.

An approval chain step names its approver with ``approver_type`` /
``approver_value``. Until 2026-10 nothing read that pair: any
``finance.approve`` holder could approve or deny any step, whatever the chain
said, so a "Treasurer" step could be signed by the Safety Officer. This module
is the single authority on the rule that replaced it. The approve/deny
service methods, the pending-approvals list, the request detail flags and the
approver-coverage report all call it rather than re-deriving the rule
(CLAUDE.md pitfall #29).

The rule, per ``approver_type``:

- ``NULL``           any active ``finance.approve`` holder (the pre-2026-10
                     behaviour, kept for steps nobody assigned)
- ``position``       an active member holding a position in the step's org
                     whose slug equals the value (case-insensitive)
- ``permission``     an active member for whom ``user_has_permission`` grants
                     the value, so ``*``, module wildcards, rank defaults and
                     legacy aliases count exactly as they do everywhere else
- ``specific_user``  the member whose id is the value
- ``email``          the active member whose account email is the value
                     (case-insensitive); an external approver uses the
                     emailed token instead

A ``finance.configure_approvals`` holder who does not match may still act if
they give an override reason. That is decided here too, so the 403 messages
and the ``requires_override`` flag cannot drift apart.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import func
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.permissions import get_all_permissions
from app.models.finance import ApprovalChainStep, ApprovalStepType, ApproverType
from app.models.user import Position, User

FINANCE_APPROVE = "finance.approve"
APPROVALS_ADMIN_PERMISSION = "finance.configure_approvals"
OVERRIDE_REASON_MAX_LENGTH = 2000

_EMAIL_ADAPTER = TypeAdapter(EmailStr)


class ApproverMismatchError(PermissionError):
    """The caller is not the step's named approver and has no override (→ 403).

    A ``PermissionError`` rather than a ``ValueError`` so the endpoint layer's
    ``except ValueError`` → 400 cannot swallow it: this is an authorization
    refusal, not a malformed request.
    """


@dataclass(frozen=True)
class ApproverDecision:
    """Why a caller was allowed to act on a step."""

    matched: bool
    override: bool
    override_reason: Optional[str]
    approver_type: Optional[str]
    approver_value: Optional[str]
    assignee_label: str


def normalize_approver_type(value) -> Optional[ApproverType]:
    """The stored enum, whether the step came from the DB or a fresh dict."""
    if value is None or value == "":
        return None
    return ApproverType(value.value if isinstance(value, ApproverType) else value)


def _clean(value: Optional[str]) -> str:
    return (value or "").strip()


def is_valid_single_email(value: Optional[str]) -> bool:
    candidate = _clean(value)
    if not candidate or "," in candidate or ";" in candidate:
        return False
    try:
        _EMAIL_ADAPTER.validate_python(candidate)
    except ValidationError:
        return False
    return True


def is_known_permission(value: Optional[str]) -> bool:
    """A permission an approver step may name.

    ``*`` is accepted because the matcher treats it literally: only holders of
    the global wildcard (the IT manager) match. A module wildcard such as
    ``finance.*`` is refused — the matcher would read it as "holds the
    ``finance.*`` grant", while an admin typing it almost certainly means "any
    finance permission", and that gap would silently lock the step.
    """
    candidate = _clean(value)
    return candidate == "*" or candidate in set(get_all_permissions())


def _is_active_member_of(user: User, org_id: str) -> bool:
    return str(user.organization_id) == str(org_id) and bool(user.is_active)


async def ensure_positions_loaded(db: AsyncSession, user: User) -> None:
    """``user_has_permission`` walks ``user.positions``; make sure it can.

    The authenticated ``current_user`` arrives with positions eager-loaded,
    but a user fetched any other way does not, and a lazy load under the
    async session raises rather than querying.
    """
    state = sa_inspect(user, raiseerr=False)
    if state is None or "positions" not in state.unloaded:
        return
    if state.session is None:
        return
    await db.refresh(user, attribute_names=["positions"])


class ApproverDirectory:
    """Org-scoped lookups behind matching and labelling, cached per request.

    One instance serves a whole pending list or coverage report, so a slug or
    user id named by many steps is resolved once.
    """

    def __init__(self, db: AsyncSession, org_id: str):
        self.db = db
        self.org_id = str(org_id)
        self._positions: dict[str, Optional[Position]] = {}
        self._users: dict[str, Optional[User]] = {}
        self._members: Optional[list[User]] = None

    async def position(self, slug: Optional[str]) -> Optional[Position]:
        key = _clean(slug).lower()
        if not key:
            return None
        if key not in self._positions:
            result = await self.db.execute(
                select(Position).where(
                    Position.organization_id == self.org_id,
                    func.lower(Position.slug) == key,
                )
            )
            self._positions[key] = result.scalars().first()
        return self._positions[key]

    async def user(self, user_id: Optional[str]) -> Optional[User]:
        key = _clean(user_id)
        if not key:
            return None
        if key not in self._users:
            result = await self.db.execute(
                select(User).where(
                    User.id == key,
                    User.organization_id == self.org_id,
                    User.deleted_at.is_(None),
                )
            )
            self._users[key] = result.scalar_one_or_none()
        return self._users[key]

    async def active_members(self) -> list[User]:
        """Every active member of the org, positions loaded (coverage only)."""
        if self._members is None:
            result = await self.db.execute(
                select(User)
                .options(selectinload(User.positions))
                .where(User.organization_id == self.org_id, User.is_active)
            )
            self._members = list(result.scalars().unique().all())
        return self._members


async def user_matches_step(
    db: AsyncSession, user: User, step: ApprovalChainStep, org_id: str
) -> bool:
    """Whether ``user`` is the approver ``step`` names, in ``org_id``."""
    if not _is_active_member_of(user, org_id):
        return False
    await ensure_positions_loaded(db, user)

    approver_type = normalize_approver_type(step.approver_type)
    value = _clean(step.approver_value)

    # A notification step has no approver; it is never acted on in-app, and
    # if one ever is, it falls back to the unassigned rule rather than
    # reading approver fields the step editor treats as meaningless.
    if approver_type is None or step.step_type == ApprovalStepType.NOTIFICATION:
        return user_has_permission(user, FINANCE_APPROVE)
    if not value:
        return False
    if approver_type == ApproverType.POSITION:
        wanted = value.lower()
        return any(
            str(position.organization_id) == str(org_id)
            and _clean(position.slug).lower() == wanted
            for position in user.positions
        )
    if approver_type == ApproverType.PERMISSION:
        return user_has_permission(user, value)
    if approver_type == ApproverType.SPECIFIC_USER:
        return str(user.id) == value
    if approver_type == ApproverType.EMAIL:
        return _clean(user.email).lower() == value.lower()
    return False


async def describe_assignee(step: ApprovalChainStep, lookup: ApproverDirectory) -> str:
    """A human label for whoever ``step`` is waiting on."""
    approver_type = normalize_approver_type(step.approver_type)
    value = _clean(step.approver_value)
    if approver_type is None or step.step_type == ApprovalStepType.NOTIFICATION:
        return "any finance approver"
    if approver_type == ApproverType.POSITION:
        if not value:
            return "a position that has not been chosen"
        position = await lookup.position(value)
        if position is None:
            return f"the {value} position, which no longer exists"
        return f"{position.name} position"
    if approver_type == ApproverType.PERMISSION:
        if not value:
            return "a permission that has not been chosen"
        return f"members with {value}"
    if approver_type == ApproverType.SPECIFIC_USER:
        if not value:
            return "a member who has not been chosen"
        user = await lookup.user(value)
        if user is None:
            return "a member who is no longer in this department"
        return user.full_name or user.username or "a member"
    if approver_type == ApproverType.EMAIL:
        return value or "an email address that has not been set"
    return "any finance approver"


def is_approvals_admin(user: User) -> bool:
    return user_has_permission(user, APPROVALS_ADMIN_PERMISSION)


async def authorize_step_actor(
    db: AsyncSession,
    user: User,
    step: ApprovalChainStep,
    org_id: str,
    override_reason: Optional[str],
    lookup: Optional[ApproverDirectory] = None,
) -> ApproverDecision:
    """Allow a matching approver, or an approvals admin who gives a reason.

    Raises ``ApproverMismatchError`` otherwise. Called before any mutation.
    """
    lookup = lookup or ApproverDirectory(db, org_id)
    approver_type = normalize_approver_type(step.approver_type)
    common = {
        "approver_type": approver_type.value if approver_type else None,
        "approver_value": step.approver_value,
    }
    label = await describe_assignee(step, lookup)

    if await user_matches_step(db, user, step, org_id):
        return ApproverDecision(
            matched=True,
            override=False,
            override_reason=None,
            assignee_label=label,
            **common,
        )

    reason = _clean(override_reason)
    if not is_approvals_admin(user):
        raise ApproverMismatchError(f"This step is waiting on {label}.")
    if not reason:
        raise ApproverMismatchError(
            f"This step is assigned to {label}. An approvals administrator may "
            "act on it by giving an override reason."
        )
    if len(reason) > OVERRIDE_REASON_MAX_LENGTH:
        raise ValueError(
            f"The override reason must be {OVERRIDE_REASON_MAX_LENGTH} "
            "characters or fewer."
        )
    return ApproverDecision(
        matched=False,
        override=True,
        override_reason=reason,
        assignee_label=label,
        **common,
    )
