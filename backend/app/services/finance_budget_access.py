"""Who may charge a budget line, and who may decide that.

Budget categories nest: a Quartermaster category holds sub-categories such as
Boot reimbursement and Officer brass, each with its own lines. A category says
who may charge its lines on a purchase request, check request or expense
report (owner decisions, 2026-10-14):

* ``open`` — every member who can raise a request may pick the line.
* ``restricted`` — only the positions **answerable** for the line, and the
  positions the restricting category names. Answerable means the line's own
  owner and the owner of its category or of any category above it, so the
  Quartermaster who owns the parent keeps every restricted line beneath it.
* unset — the parent's rule, positions included. A top-level category with
  no setting is open, which is how every line behaved before the setting
  existed.

``finance.manage`` is not subject to the rule; callers express that by not
asking (the endpoints pass no charger for a manager, as ``_requester_scope``
does for request ownership).

Who may change a category's rule: ``finance.manage``, or a holder of an owner
position on the category or one above it — the Quartermaster sets up their
own lines without the Treasurer.

This module is the one definition of all three questions (CLAUDE.md pitfall
#29). The request-form picker (``list_budget_options``), the server-side
check on every request write, the category responses and the owner's
settings screen all ask it rather than re-deriving it.
"""

from dataclasses import dataclass, field
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    Budget,
    BudgetCategory,
    BudgetCategoryChargePosition,
    ChargeAccess,
)
from app.services.finance_budget_ownership import held_positions_query

# Parent links are client-supplied; a cycle is refused on write, but the
# walk is bounded as well so one stored before that guard cannot hang it.
MAX_CATEGORY_DEPTH = 20


@dataclass(frozen=True)
class CategoryNode:
    id: str
    name: str
    parent_id: Optional[str]
    owner_position_id: Optional[str]
    charge_access: Optional[str]


@dataclass(frozen=True)
class ChargeRule:
    """The rule in force for a category's lines.

    ``source_category_id`` is the category that set it (None when nothing in
    the chain did, which is open). ``answerable_position_ids`` holds the owner
    of every category from this one to the top; a line adds its own owner.
    """

    access: ChargeAccess
    source_category_id: Optional[str]
    named_position_ids: frozenset[str] = field(default_factory=frozenset)
    answerable_position_ids: frozenset[str] = field(default_factory=frozenset)

    def allows(
        self, held_position_ids: Iterable[str], line_owner_position_id: Optional[str]
    ) -> bool:
        if self.access == ChargeAccess.OPEN:
            return True
        allowed = set(self.named_position_ids) | set(self.answerable_position_ids)
        if line_owner_position_id:
            allowed.add(str(line_owner_position_id))
        return bool(allowed.intersection(held_position_ids))


class CategoryTree:
    """An organization's categories and named positions, resolved in memory.

    A department has tens of categories, so one read of each table answers
    every line in a request form or a category list without a query per row.
    """

    def __init__(
        self,
        categories: Iterable[CategoryNode],
        named_positions: dict[str, set[str]],
    ) -> None:
        self.by_id: dict[str, CategoryNode] = {c.id: c for c in categories}
        self.named_positions = named_positions

    def chain(self, category_id: Optional[str]) -> list[CategoryNode]:
        """The category and its ancestors, nearest first, stopping at a cycle."""
        chain: list[CategoryNode] = []
        seen: set[str] = set()
        current = self.by_id.get(category_id) if category_id else None
        while current is not None and current.id not in seen:
            if len(chain) > MAX_CATEGORY_DEPTH:
                break
            chain.append(current)
            seen.add(current.id)
            current = self.by_id.get(current.parent_id) if current.parent_id else None
        return chain

    def path(self, category_id: Optional[str]) -> list[str]:
        """Category names from the top down: ``["Quartermaster", "Officer brass"]``."""
        return [node.name for node in reversed(self.chain(category_id))]

    def descendant_ids(self, category_id: str) -> set[str]:
        """Every category below ``category_id`` (not including it)."""
        children: dict[str, list[str]] = {}
        for node in self.by_id.values():
            if node.parent_id:
                children.setdefault(node.parent_id, []).append(node.id)
        found: set[str] = set()
        stack = list(children.get(category_id, []))
        while stack:
            current = stack.pop()
            if current in found or current == category_id:
                continue
            found.add(current)
            stack.extend(children.get(current, []))
        return found

    def rule(self, category_id: Optional[str]) -> ChargeRule:
        chain = self.chain(category_id)
        answerable = frozenset(
            str(node.owner_position_id) for node in chain if node.owner_position_id
        )
        for node in chain:
            if node.charge_access:
                access = ChargeAccess(node.charge_access)
                named = (
                    frozenset(self.named_positions.get(node.id, set()))
                    if access == ChargeAccess.RESTRICTED
                    else frozenset()
                )
                return ChargeRule(access, node.id, named, answerable)
        return ChargeRule(ChargeAccess.OPEN, None, frozenset(), answerable)

    def manageable_by(self, category_id: str, held_position_ids: set[str]) -> bool:
        """Whether a holder of ``held_position_ids`` owns this category or one above."""
        return any(
            node.owner_position_id and str(node.owner_position_id) in held_position_ids
            for node in self.chain(category_id)
        )


async def load_category_tree(db: AsyncSession, organization_id: str) -> CategoryTree:
    categories = await db.execute(
        select(
            BudgetCategory.id,
            BudgetCategory.name,
            BudgetCategory.parent_category_id,
            BudgetCategory.owner_position_id,
            BudgetCategory.charge_access,
        ).where(BudgetCategory.organization_id == organization_id)
    )
    nodes = [
        CategoryNode(
            id=str(row.id),
            name=row.name,
            parent_id=str(row.parent_category_id) if row.parent_category_id else None,
            owner_position_id=(
                str(row.owner_position_id) if row.owner_position_id else None
            ),
            charge_access=(
                row.charge_access.value
                if isinstance(row.charge_access, ChargeAccess)
                else row.charge_access
            ),
        )
        for row in categories.all()
    ]
    named = await db.execute(
        select(
            BudgetCategoryChargePosition.category_id,
            BudgetCategoryChargePosition.position_id,
        ).where(BudgetCategoryChargePosition.organization_id == organization_id)
    )
    named_positions: dict[str, set[str]] = {}
    for category_id, position_id in named.all():
        named_positions.setdefault(str(category_id), set()).add(str(position_id))
    return CategoryTree(nodes, named_positions)


async def held_position_ids(
    db: AsyncSession, organization_id: str, user_id: str
) -> set[str]:
    result = await db.execute(held_positions_query(organization_id, user_id))
    return {str(position_id) for position_id in result.scalars().all()}


class BudgetChargeRefusedError(ValueError):
    """The caller may not charge the budget line they named."""


async def assert_may_charge(
    db: AsyncSession,
    organization_id: str,
    charger_id: Optional[str],
    budget_id: Optional[str],
) -> None:
    """Refuse a request write that names a line ``charger_id`` may not charge.

    ``charger_id`` None means the caller is not subject to the rule
    (``finance.manage``). A missing ``budget_id`` (no line, or a cleared one)
    is never refused. The line itself must already have been checked to be in
    the org; a line that is not found here is left to that check.
    """
    if not charger_id or not budget_id:
        return
    result = await db.execute(
        select(Budget.category_id, Budget.owner_position_id).where(
            Budget.id == str(budget_id),
            Budget.organization_id == organization_id,
        )
    )
    line = result.first()
    if line is None:
        return
    tree = await load_category_tree(db, organization_id)
    rule = tree.rule(str(line.category_id))
    if rule.access == ChargeAccess.OPEN:
        return
    held = await held_position_ids(db, organization_id, charger_id)
    if not rule.allows(held, line.owner_position_id):
        raise BudgetChargeRefusedError(
            "This budget line is restricted. Choose another line or ask the "
            "line's owner to give your position access."
        )
