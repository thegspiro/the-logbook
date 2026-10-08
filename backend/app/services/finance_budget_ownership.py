"""Who owns a budget line.

A budget line is owned by a **position**, not a person, so ownership survives
an election or a resignation without anyone re-assigning lines. A category may
name an owner position as well, and a line with no owner of its own
**inherits** its category's; a line's own owner always wins. Both are read
from the line and its category as stored, never from "the current fiscal
year", because an owner sees their lines in every year, closed ones included
(owner decisions, 2026-10-08).

This module is the one definition of that rule (CLAUDE.md pitfall #29). The
budget list and detail responses report it through
``effective_owner_position_id``; the owner's own "My budgets" view
(``GET /finance/my-budgets``), the navigation's ``ownsAny`` signal and the
owner's read access to a line's detail, amendments and transactions all ask
``owned_budgets_query`` / ``user_owns_budget`` / ``user_owns_any_budget`` the
same question rather than re-deriving it.

Ownership grants no write: only ``finance.manage`` sets amounts, owners,
stations and amendments. What an owner may *see* is decided by the caller of
this module (``_authorize_budget_view`` in the finance endpoints).
"""

from typing import Any, Optional

from sqlalchemy import Select, and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import Budget, BudgetCategory
from app.models.user import Position, User, user_positions


def resolve_owner(
    line_owner_position_id: Optional[str],
    category_owner_position_id: Optional[str],
) -> tuple[Optional[str], bool]:
    """Return ``(effective owner position id, inherited from the category)``.

    ``inherited`` is True only when the line has no owner of its own and the
    category supplies one; a line with neither has no owner and is not
    "inherited".
    """
    if line_owner_position_id:
        return str(line_owner_position_id), False
    if category_owner_position_id:
        return str(category_owner_position_id), True
    return None, False


def effective_owner_position_id(budget: Any, category: Any) -> Optional[str]:
    """The position that owns ``budget``: its own, else its category's.

    ``category`` may be ``None`` (a line whose category could not be loaded
    then has only its own owner, if any).
    """
    effective, _inherited = resolve_owner(
        getattr(budget, "owner_position_id", None),
        getattr(category, "owner_position_id", None) if category else None,
    )
    return effective


def effective_owner_column():
    """SQL form of ``effective_owner_position_id``; the two must stay identical.

    Valid in a query that joins ``BudgetCategory`` to ``Budget``.
    """
    return func.coalesce(Budget.owner_position_id, BudgetCategory.owner_position_id)


def owned_budgets_query(organization_id: str, user_id: str) -> Select:
    """Select the budget lines ``user_id`` owns, in every fiscal year.

    The user owns a line when they hold its effective owner position. Every
    table in the chain is constrained to ``organization_id`` — the line, its
    category, the position and the user — and the user must be active, so a
    departed member who still has a position row owns nothing.
    """
    effective = effective_owner_column()
    return (
        select(Budget)
        .join(
            BudgetCategory,
            and_(
                BudgetCategory.id == Budget.category_id,
                BudgetCategory.organization_id == organization_id,
            ),
        )
        .join(
            Position,
            and_(
                Position.id == effective,
                Position.organization_id == organization_id,
            ),
        )
        .join(user_positions, user_positions.c.position_id == Position.id)
        .join(
            User,
            and_(
                User.id == user_positions.c.user_id,
                User.organization_id == organization_id,
            ),
        )
        .where(
            Budget.organization_id == organization_id,
            User.id == str(user_id),
            User.is_active,
        )
        .distinct()
    )


async def owned_budget_ids(
    db: AsyncSession, organization_id: str, user_id: str
) -> set[str]:
    """The ids of every budget line ``user_id`` owns, all fiscal years."""
    query = owned_budgets_query(organization_id, user_id).with_only_columns(Budget.id)
    result = await db.execute(query)
    return {str(row) for row in result.scalars().all()}


async def user_owns_budget(
    db: AsyncSession, organization_id: str, user_id: str, budget_id: str
) -> bool:
    """True when ``user_id`` holds the effective owner position of the line."""
    query = (
        owned_budgets_query(organization_id, user_id)
        .with_only_columns(Budget.id)
        .where(Budget.id == str(budget_id))
    )
    result = await db.execute(query)
    return result.first() is not None


async def user_owns_any_budget(
    db: AsyncSession, organization_id: str, user_id: str
) -> bool:
    """True when ``user_id`` owns at least one line, in any fiscal year.

    One indexed ``LIMIT 1`` probe — cheap enough for the navigation to ask once
    per session without loading the lines themselves.
    """
    query = (
        owned_budgets_query(organization_id, user_id)
        .with_only_columns(Budget.id)
        .limit(1)
    )
    result = await db.execute(query)
    return result.first() is not None


def held_positions_query(organization_id: str, user_id: str) -> Select:
    """Select the ids of the positions ``user_id`` holds, in the org.

    The same chain ``owned_budgets_query`` walks from a line's owner to its
    holders — position in the org, member in the org and active — asked from
    the member's end. A budget request for a line that does not exist yet is
    owned by the position named on it, so this is how "may this member act
    for that position" is answered (``user_holds_position``).
    """
    return (
        select(Position.id)
        .join(user_positions, user_positions.c.position_id == Position.id)
        .join(
            User,
            and_(
                User.id == user_positions.c.user_id,
                User.organization_id == organization_id,
            ),
        )
        .where(
            Position.organization_id == organization_id,
            User.id == str(user_id),
            User.is_active,
        )
    )


async def user_holds_position(
    db: AsyncSession, organization_id: str, user_id: str, position_id: str
) -> bool:
    """True when ``user_id`` is an active member holding ``position_id``."""
    query = held_positions_query(organization_id, user_id).where(
        Position.id == str(position_id)
    )
    result = await db.execute(query.limit(1))
    return result.first() is not None
