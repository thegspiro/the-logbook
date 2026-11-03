"""
Who may see and act on one prospective member.

Two things grant access to an applicant:

- ``prospective_members.view_all``, which sees every applicant in the
  organization, assigned or not; and
- an assignment (``prospect_assignments``) to that applicant as case manager or
  interviewer, which sees that applicant only, whatever else the member holds.

``prospective_members.view`` and ``prospective_members.manage`` no longer show
an applicant by themselves: without ``view_all``, their holder sees only the
applicants they are assigned to. Migration ``c588f525fdbb`` gave ``view_all``
to every position holding either, so nobody's view narrowed on upgrade.

What a member may then do with an applicant they can see is the
:class:`ProspectAccess` levels below. The rules live here, once, and the
endpoints ask; the frontend is told the result (``my_access`` on the prospect
response) rather than re-deriving it (CLAUDE.md pitfall #29).
"""

from dataclasses import dataclass
from typing import FrozenSet, Iterable, Optional, Set

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.membership_pipeline import AssignmentRole, ProspectAssignment
from app.models.user import User

VIEW_ALL = "prospective_members.view_all"
PIPELINE_MANAGE = "prospective_members.manage"

# The permissions most pipeline writes accept today. A few accept only
# prospective_members.manage; each endpoint names its own set.
MANAGE_PERMISSIONS = ("members.manage", PIPELINE_MANAGE)


def _has(user: User, permission: str) -> bool:
    # Imported here: app.api.dependencies imports the services package, and
    # this module is imported by both sides.
    from app.api.dependencies import user_has_permission

    return user_has_permission(user, permission)


def can_view_all(user: User) -> bool:
    return _has(user, VIEW_ALL)


@dataclass(frozen=True)
class ProspectAccess:
    """One member's access to one applicant.

    ``manager`` is whether the member holds one of the permissions the
    endpoint in question accepts for managing; it says nothing about this
    applicant on its own, which is why every level below also asks whether
    they can see the applicant at all.
    """

    view_all: bool
    manager: bool
    roles: FrozenSet[str]

    @property
    def is_case_manager(self) -> bool:
        return AssignmentRole.CASE_MANAGER.value in self.roles

    @property
    def is_interviewer(self) -> bool:
        return AssignmentRole.INTERVIEWER.value in self.roles

    @property
    def can_see(self) -> bool:
        """Details, documents and follow-up forms: any assignment will do."""
        return self.view_all or bool(self.roles)

    @property
    def can_manage(self) -> bool:
        """Rejecting, converting, moving to any stage, the election package,
        assigning people: managers only, and only for applicants they see."""
        return self.manager and self.can_see

    @property
    def can_see_full(self) -> bool:
        """The activity log, linked events and the election package. An
        interviewer's assignment is narrower: details, documents and their own
        interview."""
        return self.view_all or self.is_case_manager or self.can_manage

    @property
    def can_work(self) -> bool:
        """Notes, documents, checklists, forms, advancing, skipping and moving
        back a stage: a case manager does these for their own applicants."""
        return self.can_manage or self.is_case_manager

    @property
    def can_log_interview(self) -> bool:
        return self.can_manage or bool(self.roles)

    @property
    def sees_all_interviews(self) -> bool:
        """An interviewer who is nothing more sees only their own interview,
        so each assessment stays independent of the others."""
        return self.can_see_full

    def as_dict(self) -> dict:
        return {
            "roles": sorted(self.roles),
            "view_all": self.view_all,
            "can_work": self.can_work,
            "can_manage": self.can_manage,
            "can_see_full": self.can_see_full,
            "can_log_interview": self.can_log_interview,
        }


async def assigned_roles(
    db: AsyncSession, user: User, prospect_id: str
) -> FrozenSet[str]:
    if not user.organization_id:
        return frozenset()
    result = await db.execute(
        select(ProspectAssignment.role).where(
            ProspectAssignment.prospect_id == str(prospect_id),
            ProspectAssignment.user_id == str(user.id),
            ProspectAssignment.organization_id == str(user.organization_id),
        )
    )
    return frozenset(str(role) for role in result.scalars().all())


async def load_access(
    db: AsyncSession,
    user: User,
    prospect_id: str,
    manage_permissions: Iterable[str] = MANAGE_PERMISSIONS,
) -> ProspectAccess:
    return ProspectAccess(
        view_all=can_view_all(user),
        manager=any(_has(user, p) for p in manage_permissions),
        roles=await assigned_roles(db, user, prospect_id),
    )


async def assigned_prospect_ids(db: AsyncSession, user: User) -> Set[str]:
    if not user.organization_id:
        return set()
    result = await db.execute(
        select(ProspectAssignment.prospect_id)
        .where(
            ProspectAssignment.user_id == str(user.id),
            ProspectAssignment.organization_id == str(user.organization_id),
        )
        .distinct()
    )
    return {str(pid) for pid in result.scalars().all()}


async def visible_prospect_ids(db: AsyncSession, user: User) -> Optional[Set[str]]:
    """The applicants a list, board or search may show this member.

    None means every applicant (``view_all``); otherwise exactly the ones they
    are assigned to, which may be none at all.
    """
    if can_view_all(user):
        return None
    return await assigned_prospect_ids(db, user)
