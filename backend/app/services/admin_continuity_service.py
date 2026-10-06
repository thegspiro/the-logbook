"""
Administrator continuity guard (ORU-7).

An organization must never be left without a signed-in-able administrator.
Every path that can strip administrative capability — reassigning positions,
deleting a member, archiving them, changing their status, rewriting a
position's permission list — previously enforced only that the *caller* held
`members.manage`. None of them counted who would be left afterwards, so a
sole administrator could lock the whole department out in one request, for
example by setting their own status to `inactive`.

Recovery from that state needs a database administrator: the onboarding flow
refuses to mint a second system owner, and every restore endpoint is itself
behind `members.manage`.

This module answers one question — *would this change leave the org with zero
administrators?* — and is called by each mutation path before it commits.

WHAT COUNTS AS AN ADMINISTRATOR
-------------------------------
A user who is active (`status == ACTIVE` and not soft-deleted) and whose
effective permissions satisfy `members.manage`, which is the permission that
gates every user-management and status endpoint. Effective permissions are
positions plus rank defaults, matched through `permission_matches` so the
`"*"` and `"members.*"` wildcards count. `members.manage` is deliberately the
yardstick rather than the broader admin-slug list: holding it is exactly what
makes a member able to undo the change.

CONCURRENCY (W11-8)
-------------------
Counting administrators and then removing one is a read-then-write (CLAUDE.md
pitfall 27): two requests removing two different administrators each counted
two and both went through, leaving none. Every count here first takes the
organization's ``admin_continuity`` lock, which serializes the decisions, and
then reads members and their positions in one locking read. The locking read
is the half that is easy to miss: under REPEATABLE READ a plain SELECT answers
from the snapshot taken at the transaction's first read, which predates the
lock, so the second request would still count the administrator the first
one just removed. Positions are joined into that same read for the same
reason; a separate eager-load query would be an unlocked snapshot read.

Callers that lock a member row of their own must take
``lock_administrator_continuity`` first, so every path locks in one order.

THE LAST WILDCARD HOLDER (PERM-5)
---------------------------------
`members.manage` is not the only capability that cannot be restored in-app.
`*` cannot be re-granted except by someone who already holds it (the grant
ceiling) and cannot be minted (no position may be created carrying it). So a
position change may not take `*` from the organization's only active holder,
even when other members keep `members.manage`. Only position changes are
guarded this way: a deactivated or archived member keeps their positions and
gets `*` back when restored, and a member manager can still offboard a
departing chief once `*` has been given to someone else.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.permissions import get_rank_default_permissions, permission_matches
from app.models.user import User, UserStatus
from app.utils.org_locks import ADMIN_CONTINUITY, lock_organization_scope

# The capability that must survive every change. Whoever holds it can restore
# any member this guard protects against removing.
ADMIN_PERMISSION = "members.manage"
WILDCARD = "*"


class LastAdministratorError(ValueError):
    """
    Raised when a change would leave an organization with no administrator.

    A ValueError so the endpoint layer's existing `except ValueError` →
    HTTP 400 handling surfaces the message to the caller unchanged.
    """


def _effective_permissions(user: User) -> set[str]:
    """
    Positions plus rank defaults.

    Mirrors `_collect_user_permissions` in app/api/dependencies.py — the same
    aggregation the request path uses, so the guard cannot disagree with what
    an actual login would grant.
    """
    perms: set[str] = set()
    for position in user.positions:
        perms.update(position.permissions or [])
    if user.rank:
        perms.update(get_rank_default_permissions(str(user.rank)))
    return perms


def is_administrator(user: User) -> bool:
    """True if *user* can currently sign in and manage members."""
    if user.status != UserStatus.ACTIVE or user.deleted_at is not None:
        return False
    return permission_matches(ADMIN_PERMISSION, _effective_permissions(user))


async def lock_administrator_continuity(db: AsyncSession, organization_id: str) -> None:
    """Serialize administrator-removing decisions for one organization.

    Held until the transaction ends. Re-taking it in the same transaction is
    harmless, so a caller that must lock a member row first takes this and
    the guards below take it again.
    """
    await lock_organization_scope(db, organization_id, ADMIN_CONTINUITY)


async def _active_members_locked(db: AsyncSession, organization_id: str) -> list[User]:
    """Active members with their positions, read current under the org lock.

    A shared locking read over the members and their position rows, after
    the continuity lock: see CONCURRENCY in the module docstring.
    """
    await lock_administrator_continuity(db, organization_id)
    result = await db.execute(
        select(User)
        .options(joinedload(User.positions))
        .where(
            User.organization_id == organization_id,
            User.status == UserStatus.ACTIVE,
            User.deleted_at.is_(None),
        )
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    return list(result.unique().scalars().all())


async def _active_administrators(db: AsyncSession, organization_id: str) -> list[User]:
    """Every user in *organization_id* who currently qualifies as an admin."""
    members = await _active_members_locked(db, organization_id)
    return [user for user in members if is_administrator(user)]


async def assert_not_last_administrator(
    db: AsyncSession,
    organization_id: str,
    user_id: str | UUID,
    *,
    action: str,
) -> None:
    """
    Refuse a change that would remove the org's final administrator.

    Call before mutating *user_id* in a way that costs them administrative
    capability — deletion, archival, deactivation, or losing the positions
    that carry `members.manage`.

    No-ops when the target is not currently an administrator: removing a
    non-admin cannot reduce the count.

    Args:
        organization_id: the caller's org — never one supplied by the client.
        user_id: the member about to be changed.
        action: verb used in the error message, e.g. "deactivate".

    Raises:
        LastAdministratorError: if *user_id* is the only administrator left.
    """
    target_id = str(user_id)
    admins = await _active_administrators(db, organization_id)

    if not any(admin.id == target_id for admin in admins):
        return

    if len(admins) > 1:
        return

    raise LastAdministratorError(
        f"Cannot {action} the only remaining administrator. Grant "
        f"'{ADMIN_PERMISSION}' to another active member first, otherwise no "
        "one would be able to manage members or restore access."
    )


async def assert_role_change_retains_administrator(
    db: AsyncSession,
    organization_id: str,
    role_id: str | UUID,
    new_permissions: list[str] | None,
    *,
    action: str,
) -> None:
    """
    Refuse a position change that would cost the org every administrator.

    A position's permission list is shared by everyone holding it, so editing
    or deleting one is an org-wide change: emptying the `it_manager` position
    strips the wildcard from every holder at once. This recounts the whole
    organization with the proposed permissions applied rather than checking a
    single member.

    Args:
        new_permissions: the permission list the position would carry, or
            None when it is being deleted.

    Raises:
        LastAdministratorError: if no active member would still satisfy
            `members.manage` afterwards.
    """
    target_role_id = str(role_id)
    replacement = set(new_permissions or [])

    for user in await _active_members_locked(db, organization_id):
        perms: set[str] = set()
        for position in user.positions:
            if str(position.id) == target_role_id:
                # Deleted positions contribute nothing; edited ones
                # contribute their proposed list.
                if new_permissions is not None:
                    perms.update(replacement)
            else:
                perms.update(position.permissions or [])
        if user.rank:
            perms.update(get_rank_default_permissions(str(user.rank)))

        if permission_matches(ADMIN_PERMISSION, perms):
            return

    raise LastAdministratorError(
        f"Cannot {action}: no active member would be left holding "
        f"'{ADMIN_PERMISSION}', so no one could manage members or restore "
        "access. Grant it to another position first."
    )


async def assert_positions_retain_administrator(
    db: AsyncSession,
    organization_id: str,
    user_id: str | UUID,
    new_permissions: set[str],
    *,
    action: str = "remove these positions from",
) -> None:
    """
    Refuse a position change that would cost the org its final administrator.

    Unlike `assert_not_last_administrator`, the target survives the change —
    what it loses is the permission. *new_permissions* is the effective set
    the user would hold afterwards.

    Also refuses to take `*` from the organization's only active holder of
    it (PERM-5): see THE LAST WILDCARD HOLDER in the module docstring.

    Raises:
        LastAdministratorError: if the user is the only administrator and the
            proposed permissions no longer satisfy `members.manage`, or the
            only `*` holder and the proposed permissions drop `*`.
    """
    if WILDCARD not in new_permissions:
        admins = await _active_administrators(db, organization_id)
        holders = [a for a in admins if WILDCARD in _effective_permissions(a)]
        if len(holders) == 1 and holders[0].id == str(user_id):
            raise LastAdministratorError(
                f"Cannot {action} the only member with full administrative "
                "access ('*'). It cannot be granted back by anyone who does not "
                "already hold it, so give a position carrying '*' to another "
                "active member first."
            )

    if permission_matches(ADMIN_PERMISSION, new_permissions):
        return

    await assert_not_last_administrator(db, organization_id, user_id, action=action)
