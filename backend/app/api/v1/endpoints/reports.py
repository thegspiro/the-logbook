"""
Reports API Endpoints

Endpoints for report generation, saved report management,
and report export.
"""

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission, user_has_permission
from app.api.prospect_privacy import get_hidden_prospect_ids
from app.core.database import get_db
from app.core.utils import ensure_found, safe_error_detail
from app.models.analytics import SavedReport
from app.models.user import User
from app.schemas.reports import (
    ReportRequest,
    SavedReportCreate,
    SavedReportResponse,
    SavedReportUpdate,
)
from app.services.reports_service import ReportsService
from app.services.saved_report_schedule import (
    PII_REPORT_PERMISSIONS as _PII_REPORT_PERMISSIONS,
)
from app.services.saved_report_schedule import (
    REPORT_PERIODS,
    disallowed_pii_recipients,
    next_run_on_or_after,
    report_dates,
    validate_schedule,
)
from app.utils.model_updates import apply_updates
from app.utils.org_timezone import resolve_org_today

router = APIRouter()

# A handful of report types enumerate people and their personal data — the member
# roster returns email/membership number, the pipeline overview returns applicant
# name/email/PII. `reports.view` alone let a holder read that PII even without the
# permission that gates the same data at its source, so each PII-bearing report
# additionally requires the read permission for the underlying record type
# (RPT-3, owner decision 2026-08-09). Report types absent from this map carry only
# aggregate/operational data and stay at `reports.view`.
#
# training_summary/training_progress/annual_training/certification_expiration/
# compliance_status all return per-member name + training/compliance detail
# (course names, certification numbers, compliance %) sourced from
# TrainingRecord/TrainingRequirement — org-wide access to that same data is
# gated behind training.manage at its source (training.py's /records,
# /compliance-matrix). admin_hours returns per-member name + hours + status
# from AdminHoursEntry, gated behind admin_hours.manage at its source. None of
# the five was in this map, so `reports.view` alone bypassed the source gate.
# GET /saved has no pagination and returns the org's full active set on every
# load; a cap on writes here is what keeps that read bounded (RPT-29).
MAX_ACTIVE_SAVED_REPORTS_PER_ORG = 200

# The map itself lives in saved_report_schedule so the scheduled sender, which
# has no request to hang a dependency on, enforces the identical gate.
PII_REPORT_PERMISSIONS = _PII_REPORT_PERMISSIONS


def _enforce_report_pii_permission(current_user: User, report_type: str) -> None:
    """Require the source-record read permission for a PII-bearing report type."""
    required = PII_REPORT_PERMISSIONS.get(report_type)
    if required and not user_has_permission(current_user, required):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"This report exposes protected member data and requires the "
                f"'{required}' permission"
            ),
        )


# ============================================
# Report Generation
# ============================================


@router.get("/available")
async def get_available_reports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("reports.view")),
):
    """Get list of available reports"""
    service = ReportsService(db)
    catalog = await service.get_available_reports()
    # Hide PII-bearing reports the caller can't run, so the UI doesn't offer a
    # report that /generate will 403 on (RPT-3).
    reports = catalog.get("available_reports")
    if isinstance(reports, list):
        catalog["available_reports"] = [
            r
            for r in reports
            if not (
                isinstance(r, dict)
                and r.get("id") in PII_REPORT_PERMISSIONS
                and not user_has_permission(
                    current_user, PII_REPORT_PERMISSIONS[r["id"]]
                )
            )
        ]
    return catalog


@router.post("/generate")
async def generate_report(
    request: ReportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("reports.view")),
    hidden_prospect_ids: set[str] = Depends(get_hidden_prospect_ids),
):
    """Generate a report"""
    _enforce_report_pii_permission(current_user, request.report_type)
    service = ReportsService(db)
    report = await service.generate_report(
        current_user.organization_id,
        request.report_type,
        start_date=request.start_date,
        end_date=request.end_date,
        filters=request.filters,
        hidden_prospect_ids=hidden_prospect_ids,
    )

    if "error" in report:
        raise HTTPException(status_code=400, detail=report["error"])

    return report


# ============================================
# Saved / Scheduled Reports
# ============================================


def _saved_response(r: SavedReport) -> SavedReportResponse:
    return SavedReportResponse(
        id=str(r.id),
        name=r.name,
        description=r.description,
        report_type=r.report_type,
        filters=r.filters,
        is_scheduled=r.is_scheduled,
        schedule_frequency=r.schedule_frequency,
        schedule_day=r.schedule_day,
        email_recipients=r.email_recipients,
        last_run_at=r.last_run_at.isoformat() if r.last_run_at else None,
        next_run_at=(str(r.next_run_date) if r.next_run_date else None),
        # RPT2-29-2: the saved_report_delivery task now reads the schedule.
        enforced=bool(r.is_scheduled),
        created_by=str(r.created_by) if r.created_by else "",
        created_at=r.created_at.isoformat() if r.created_at else "",
        updated_at=r.updated_at.isoformat() if r.updated_at else "",
    )


async def _settle_schedule(
    db: AsyncSession, report: SavedReport, current_user: User
) -> None:
    """Validate a saved report's schedule as it now stands and set its next run.

    Raises HTTPException(400) for a schedule that could not be sent as saved,
    or that would email a PII-bearing report to someone the PII gate refuses
    (RPT2-29-2; see saved_report_schedule).
    """
    org_id = str(current_user.organization_id)
    recipients = [r.strip() for r in (report.email_recipients or []) if r.strip()]
    period = (report.filters or {}).get("period")
    if period is not None and period not in REPORT_PERIODS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown reporting period. Expected one of: {', '.join(REPORT_PERIODS)}",
        )
    try:
        validate_schedule(
            bool(report.is_scheduled),
            report.schedule_frequency,
            report.schedule_day,
            recipients,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    if not report.is_scheduled:
        report.next_run_date = None
        return
    refused = await disallowed_pii_recipients(
        db, org_id, report.report_type, recipients
    )
    if refused:
        raise HTTPException(
            status_code=400,
            detail=(
                "This report lists member data, so it can only be emailed to "
                "active members who hold the "
                f"'{PII_REPORT_PERMISSIONS[report.report_type]}' permission. "
                f"Not allowed: {', '.join(refused)}"
            ),
        )
    report.email_recipients = recipients
    today = await resolve_org_today(db, org_id)
    report.next_run_date = next_run_on_or_after(
        report.schedule_frequency or "", report.schedule_day, today
    )


@router.get("/saved", response_model=List[SavedReportResponse])
async def list_saved_reports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("reports.view")),
):
    """List all saved report configurations for the organization"""
    result = await db.execute(
        select(SavedReport)
        .where(
            SavedReport.organization_id == str(current_user.organization_id),
            SavedReport.is_active.is_(True),
        )
        .order_by(SavedReport.name)
    )
    return [_saved_response(r) for r in result.scalars().all()]


@router.post("/saved", response_model=SavedReportResponse)
async def create_saved_report(
    request: SavedReportCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("reports.manage")),
):
    """Create a new saved report configuration"""
    # Saving (and especially scheduling) a PII-bearing report needs the same
    # permission as running it (RPT-3, RPT2-29-2).
    _enforce_report_pii_permission(current_user, request.report_type)
    count_result = await db.execute(
        select(func.count()).where(
            SavedReport.organization_id == str(current_user.organization_id),
            SavedReport.is_active.is_(True),
        )
    )
    if (count_result.scalar() or 0) >= MAX_ACTIVE_SAVED_REPORTS_PER_ORG:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This organization has reached the maximum of "
                f"{MAX_ACTIVE_SAVED_REPORTS_PER_ORG} saved reports. "
                "Deactivate or delete an existing one before creating another."
            ),
        )
    report = SavedReport(
        organization_id=str(current_user.organization_id),
        name=request.name,
        description=request.description,
        report_type=request.report_type,
        filters=request.filters or {},
        is_scheduled=request.is_scheduled,
        schedule_frequency=request.schedule_frequency,
        schedule_day=request.schedule_day,
        email_recipients=request.email_recipients or [],
        created_by=str(current_user.id),
    )
    await _settle_schedule(db, report, current_user)
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return _saved_response(report)


@router.patch("/saved/{report_id}", response_model=SavedReportResponse)
async def update_saved_report(
    report_id: str,
    request: SavedReportUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("reports.manage")),
):
    """Update a saved report configuration"""
    result = await db.execute(
        select(SavedReport).where(
            SavedReport.id == report_id,
            SavedReport.organization_id == str(current_user.organization_id),
        )
    )
    report = ensure_found(result.scalar_one_or_none(), "Saved report")
    _enforce_report_pii_permission(current_user, report.report_type)

    update_data = request.model_dump(exclude_unset=True)
    try:
        apply_updates(report, update_data, skip={"organization_id", "id"})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    schedule_fields = {
        "filters",
        "is_scheduled",
        "schedule_frequency",
        "schedule_day",
        "email_recipients",
    }
    if schedule_fields & update_data.keys():
        await _settle_schedule(db, report, current_user)

    await db.commit()
    await db.refresh(report)
    return _saved_response(report)


@router.delete("/saved/{report_id}")
async def delete_saved_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("reports.manage")),
):
    """Delete (soft-delete) a saved report"""
    result = await db.execute(
        select(SavedReport).where(
            SavedReport.id == report_id,
            SavedReport.organization_id == str(current_user.organization_id),
        )
    )
    report = ensure_found(result.scalar_one_or_none(), "Saved report")

    report.is_active = False
    await db.commit()
    return {"detail": "Saved report deleted"}


@router.post("/saved/{report_id}/run")
async def run_saved_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("reports.view")),
    hidden_prospect_ids: set[str] = Depends(get_hidden_prospect_ids),
):
    """Run a saved report immediately and return the results"""
    result = await db.execute(
        select(SavedReport).where(
            SavedReport.id == report_id,
            SavedReport.organization_id == str(current_user.organization_id),
        )
    )
    report = ensure_found(result.scalar_one_or_none(), "Saved report")

    _enforce_report_pii_permission(current_user, report.report_type)

    service = ReportsService(db)
    filters = report.filters or {}
    # A relative period (filters.period) runs for the period as of today, the
    # same way the scheduled send resolves it.
    start_date, end_date = report_dates(
        filters, await resolve_org_today(db, str(current_user.organization_id))
    )
    report_data = await service.generate_report(
        current_user.organization_id,
        report.report_type,
        start_date=start_date,
        end_date=end_date,
        filters=filters,
        hidden_prospect_ids=hidden_prospect_ids,
    )

    if "error" in report_data:
        raise HTTPException(status_code=400, detail=report_data["error"])

    # Update last_run_at
    report.last_run_at = datetime.now(timezone.utc)
    await db.commit()

    return report_data
