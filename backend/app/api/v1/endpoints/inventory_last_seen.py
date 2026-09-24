"""
Inventory "Not Seen" Report Endpoints

Which active items nobody has handled in a given number of days, as a list and
as a CSV. Mounted under ``/inventory`` behind the Inventory module gate.

Not gated by the NFC switch: taps are one source among several (assignments,
checkouts, issuances), and a department that tracks custody without tags still
gets a useful report. ``inventory.manage`` because it is a quartermaster's
reconciliation tool and lists who-has-what by implication.
"""

import io
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.models.user import User
from app.schemas.inventory_last_seen import NotSeenReportResponse
from app.services.inventory_last_seen_service import (
    DEFAULT_DAYS,
    MAX_ROWS,
    InventoryLastSeenService,
)
from app.utils.csv_export import SafeCsvWriter

router = APIRouter()

_SOURCE_LABELS = {
    "nfc_tap": "NFC tap",
    "assignment": "Assigned",
    "return": "Returned",
    "checkout": "Checked out",
    "check_in": "Checked in",
    "issuance": "Issued",
    "issuance_return": "Issuance returned",
}


@router.get("/not-seen", response_model=NotSeenReportResponse)
async def get_not_seen_report(
    days: int = Query(DEFAULT_DAYS, ge=1, le=3650),
    category_id: Optional[str] = Query(None, max_length=36),
    limit: int = Query(500, ge=1, le=MAX_ROWS),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """Active items not seen in ``days`` days — never-seen first, then oldest."""
    return await InventoryLastSeenService(db).not_seen(
        str(current_user.organization_id),
        days=days,
        category_id=category_id,
        limit=limit,
    )


@router.get("/not-seen/export")
async def export_not_seen_report(
    days: int = Query(DEFAULT_DAYS, ge=1, le=3650),
    category_id: Optional[str] = Query(None, max_length=36),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("inventory.manage")),
):
    """The same report as a CSV, capped at the report's row limit.

    Built in memory rather than streamed: the cap bounds it to a few hundred
    kilobytes, and the rows come from one computation that has to finish
    before the first row can be ordered anyway.
    """
    report = await InventoryLastSeenService(db).not_seen(
        str(current_user.organization_id),
        days=days,
        category_id=category_id,
        limit=MAX_ROWS,
    )

    output = io.StringIO()
    writer = SafeCsvWriter(output)
    writer.writerow(
        [
            "Name",
            "Serial Number",
            "Asset Tag",
            "Category",
            "Status",
            "Storage Area",
            "Last Seen (UTC)",
            "Last Seen By",
            "Days Since Seen",
        ]
    )
    for row in report["items"]:
        seen_at = row["last_seen_at"]
        writer.writerow(
            [
                row["name"],
                row["serial_number"] or "",
                row["asset_tag"] or "",
                row["category_name"] or "",
                row["status"].value,
                row["storage_area_name"] or "",
                seen_at.strftime("%Y-%m-%d %H:%M") if seen_at else "Never",
                _SOURCE_LABELS.get(row["last_seen_source"] or "", ""),
                "" if row["days_since_seen"] is None else row["days_since_seen"],
            ]
        )

    await log_audit_event(
        db=db,
        event_type="inventory_not_seen_exported",
        event_category="inventory",
        severity="info",
        event_data={
            "days": days,
            "category_id": category_id,
            "rows": len(report["items"]),
            "total": report["total"],
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": (
                f'attachment; filename="inventory_not_seen_{days}d.csv"'
            )
        },
    )
