"""Finance: budget totals. Listed only when the department turns it on."""

from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PaginationParams
from app.mcp.principal import McpPrincipal
from app.mcp.redaction import scrub_text
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import (
    clamp_limit,
    clamp_offset,
    iso,
    page,
    parse_uuid,
)
from app.models.finance import BudgetCategory, FiscalYear
from app.services.finance_service import FinanceService


def _money(value: Any) -> Optional[float]:
    return float(value) if value is not None else None


# A listing carries this much of a budget line's notes; the rest is read in
# pieces through ``get_budget_notes``. The column is unbounded Text, so a
# page of budget lines cannot carry every word of it.
BUDGET_TEXT_CHARS = 20_000


def _clip(value: Any) -> tuple[Any, bool]:
    """``value`` scrubbed and cut to ``BUDGET_TEXT_CHARS``, and whether cut."""
    if not isinstance(value, str):
        return value, False
    value = scrub_text(value)
    if len(value) <= BUDGET_TEXT_CHARS:
        return value, False
    return value[:BUDGET_TEXT_CHARS], True


def _chunk(text: str, offset: int) -> dict:
    text = scrub_text(text)
    piece = text[offset : offset + BUDGET_TEXT_CHARS]
    body = {
        "content": piece,
        "content_offset": offset,
        "content_total_chars": len(text),
        "content_has_more": offset + len(piece) < len(text),
    }
    if body["content_has_more"]:
        body["next_content_offset"] = offset + len(piece)
    return body


def register(server: Any) -> None:
    @logbook_tool(server, title="List fiscal years", gate="finance", module="finance")
    async def list_fiscal_years(
        db: AsyncSession, principal: McpPrincipal, limit: int = 50, offset: int = 0
    ) -> dict:
        """Fiscal years, newest first, with their dates and status. Paged;
        ``total`` counts every fiscal year."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        total = (
            await db.execute(
                select(func.count())
                .select_from(FiscalYear)
                .where(FiscalYear.organization_id == principal.organization_id)
            )
        ).scalar_one()
        years = await FinanceService(db).list_fiscal_years(
            principal.organization_id, PaginationParams(skip=offset, limit=limit)
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
        return page(items, total, limit, offset)

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
        encumbered amounts. Page with ``limit`` and ``offset``. Notes are cut
        at 20,000 characters (``notes_truncated``); ``get_budget_notes``
        reads the rest."""
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
        items = []
        for b in budgets:
            notes, cut = _clip(b.notes)
            items.append(
                {
                    "id": b.id,
                    "fiscal_year_id": b.fiscal_year_id,
                    "category_id": b.category_id,
                    "category": categories.get(b.category_id or ""),
                    "amount_budgeted": _money(b.amount_budgeted),
                    "amount_spent": _money(b.amount_spent),
                    "amount_encumbered": _money(b.amount_encumbered),
                    "station_id": b.station_id,
                    "notes": notes,
                    "notes_truncated": cut,
                }
            )
        return page(items, None, limit, offset)

    @logbook_tool(server, title="Read budget notes", gate="finance", module="finance")
    async def get_budget_notes(
        db: AsyncSession,
        principal: McpPrincipal,
        budget_id: str,
        content_offset: int = 0,
    ) -> dict:
        """A budget line's notes, 20,000 characters at a time. When
        ``content_has_more`` is true, call again with ``content_offset`` set
        to ``next_content_offset``."""
        content_offset = clamp_offset(content_offset)
        budget = await FinanceService(db).get_budget(
            str(parse_uuid(budget_id, "budget_id")), principal.organization_id
        )
        if budget is None:
            raise ValueError("Budget not found")
        body = {"budget_id": budget.id, "fiscal_year_id": budget.fiscal_year_id}
        body.update(_chunk(budget.notes or "", content_offset))
        return body
