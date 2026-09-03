"""Finance: budget totals. Listed only when the department turns it on."""

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PaginationParams
from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import iso, parse_uuid
from app.services.finance_service import FinanceService


def _money(value: Any) -> Optional[float]:
    return float(value) if value is not None else None


def register(server: Any) -> None:
    @logbook_tool(server, title="List fiscal years", gate="finance")
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

    @logbook_tool(server, title="Budget summary", gate="finance")
    async def get_budget_summary(
        db: AsyncSession, principal: McpPrincipal, fiscal_year_id: str
    ) -> dict:
        """Budgeted, spent and encumbered totals for one fiscal year."""
        summary = await FinanceService(db).get_budget_summary(
            principal.organization_id, str(parse_uuid(fiscal_year_id, "fiscal_year_id"))
        )
        return {k: iso(v) for k, v in summary.items()}

    @logbook_tool(server, title="List budgets", gate="finance")
    async def list_budgets(
        db: AsyncSession, principal: McpPrincipal, fiscal_year_id: Optional[str] = None
    ) -> dict:
        """Budget lines by category for a fiscal year: budgeted, spent and
        encumbered amounts."""
        budgets = await FinanceService(db).list_budgets(
            principal.organization_id,
            PaginationParams(skip=0, limit=200),
            fiscal_year_id=(
                str(parse_uuid(fiscal_year_id, "fiscal_year_id"))
                if fiscal_year_id
                else None
            ),
        )
        items = [
            {
                "id": b.id,
                "fiscal_year_id": b.fiscal_year_id,
                "category_id": b.category_id,
                "category": getattr(getattr(b, "category", None), "name", None),
                "amount_budgeted": _money(b.amount_budgeted),
                "amount_spent": _money(b.amount_spent),
                "amount_encumbered": _money(b.amount_encumbered),
                "station_id": b.station_id,
                "notes": b.notes,
            }
            for b in budgets
        ]
        return {"items": items, "total": len(items)}
