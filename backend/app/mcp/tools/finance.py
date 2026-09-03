"""Finance: budget totals. Listed only when the department turns it on."""

from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PaginationParams
from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import (
    clamp_limit,
    clamp_offset,
    iso,
    page,
    parse_uuid,
)
from app.models.finance import BudgetCategory
from app.services.finance_service import FinanceService


def _money(value: Any) -> Optional[float]:
    return float(value) if value is not None else None


def register(server: Any) -> None:
    @logbook_tool(server, title="List fiscal years", gate="finance", module="finance")
    async def list_fiscal_years(db: AsyncSession, principal: McpPrincipal) -> dict:
        """Fiscal years, newest first, with their dates and status."""
        years = await FinanceService(db).list_fiscal_years(
            principal.organization_id, PaginationParams(skip=0, limit=100)
        )
        items = [
            {
                "id": fy.id,
                "name": fy.name,
                "start_date": iso(fy.start_date),
                "end_date": iso(fy.end_date),
                "status": iso(fy.status),
                "is_locked": bool(fy.is_locked),
            }
            for fy in years
        ]
        return {"items": items, "total": len(items)}

    @logbook_tool(server, title="Budget summary", gate="finance", module="finance")
    async def get_budget_summary(
        db: AsyncSession, principal: McpPrincipal, fiscal_year_id: str
    ) -> dict:
        """Budgeted, spent and encumbered totals for one fiscal year."""
        service = FinanceService(db)
        fy_id = str(parse_uuid(fiscal_year_id, "fiscal_year_id"))
        # An unknown or foreign id would otherwise aggregate to a plausible
        # all-zero summary.
        if await service.get_fiscal_year(fy_id, principal.organization_id) is None:
            raise ValueError("Fiscal year not found")
        summary = await service.get_budget_summary(principal.organization_id, fy_id)
        return {k: iso(v) for k, v in summary.items()}

    @logbook_tool(server, title="List budgets", gate="finance", module="finance")
    async def list_budgets(
        db: AsyncSession,
        principal: McpPrincipal,
        fiscal_year_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Budget lines by category for a fiscal year: budgeted, spent and
        encumbered amounts. Page with ``limit`` and ``offset``."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        budgets = await FinanceService(db).list_budgets(
            principal.organization_id,
            PaginationParams(skip=offset, limit=limit),
            fiscal_year_id=(
                str(parse_uuid(fiscal_year_id, "fiscal_year_id"))
                if fiscal_year_id
                else None
            ),
        )
        # Category names in one query: the list does not eager-load the
        # relationship and an async session cannot lazy-load it.
        category_ids = {b.category_id for b in budgets if b.category_id}
        categories: dict[str, str] = {}
        if category_ids:
            rows = await db.execute(
                select(BudgetCategory).where(
                    BudgetCategory.organization_id == principal.organization_id,
                    BudgetCategory.id.in_(category_ids),
                )
            )
            categories = {c.id: c.name for c in rows.scalars().all()}
        items = [
            {
                "id": b.id,
                "fiscal_year_id": b.fiscal_year_id,
                "category_id": b.category_id,
                "category": categories.get(b.category_id or ""),
                "amount_budgeted": _money(b.amount_budgeted),
                "amount_spent": _money(b.amount_spent),
                "amount_encumbered": _money(b.amount_encumbered),
                "station_id": b.station_id,
                "notes": b.notes,
            }
            for b in budgets
        ]
        return page(items, None, limit, offset)
