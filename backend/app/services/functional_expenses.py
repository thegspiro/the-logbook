"""Which function an expense served: program, management & general, fundraising.

A nonprofit reports its expenses by function (IRS Form 990 Part IX). A payment
takes, in order: its own ``functional_class`` override, else its budget
category's, else the nearest ancestor category's, else none — reported as
unclassified rather than guessed, so a department sees what it has not yet
set up.

The resolver is shared by the functional expenses report and the request
detail pages, so the class a page shows is the class the report counts
(CLAUDE.md pitfall #29).
"""

from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import Budget, BudgetCategory, FunctionalClass

# A category tree is shallow; this only stops a cycle someone wrote by hand.
_MAX_DEPTH = 20


@dataclass(frozen=True)
class _Category:
    name: str
    functional_class: Optional[FunctionalClass]
    parent_id: Optional[str]


class FunctionalClassifier:
    """The department's categories and budget lines, loaded once per report."""

    def __init__(
        self, categories: dict[str, _Category], line_categories: dict[str, str]
    ):
        self._categories = categories
        self._line_categories = line_categories

    @classmethod
    async def load(cls, db: AsyncSession, org_id: str) -> "FunctionalClassifier":
        categories = {
            row.id: _Category(row.name, row.functional_class, row.parent_category_id)
            for row in (
                await db.execute(
                    select(
                        BudgetCategory.id,
                        BudgetCategory.name,
                        BudgetCategory.functional_class,
                        BudgetCategory.parent_category_id,
                    ).where(BudgetCategory.organization_id == org_id)
                )
            ).all()
        }
        lines = {
            budget_id: category_id
            for budget_id, category_id in (
                await db.execute(
                    select(Budget.id, Budget.category_id).where(
                        Budget.organization_id == org_id
                    )
                )
            ).all()
        }
        return cls(categories, lines)

    def category_of(self, budget_id: Optional[str]) -> Optional[str]:
        return self._line_categories.get(budget_id) if budget_id else None

    def category_name(self, category_id: Optional[str]) -> Optional[str]:
        category = self._categories.get(category_id) if category_id else None
        return category.name if category else None

    def category_class(self, category_id: Optional[str]) -> Optional[FunctionalClass]:
        """The category's class, or the nearest ancestor's."""
        seen: set[str] = set()
        while category_id and category_id not in seen and len(seen) < _MAX_DEPTH:
            seen.add(category_id)
            category = self._categories.get(category_id)
            if category is None:
                return None
            if category.functional_class is not None:
                return category.functional_class
            category_id = category.parent_id
        return None

    def resolve(
        self, override: Optional[FunctionalClass], budget_id: Optional[str]
    ) -> Optional[FunctionalClass]:
        if override is not None:
            return override
        return self.category_class(self.category_of(budget_id))
