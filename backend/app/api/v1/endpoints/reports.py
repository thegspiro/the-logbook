"""
Reports API Endpoints

Endpoints for report generation, saved report management,
and report export.
"""

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.database import get_db
from app.models.analytics import SavedReport
from app.models.user import User
from app.schemas.reports import (
    ReportRequest,
    SavedReportCreate,
    SavedReportResponse,
    SavedReportUpdate,
)
from app.services.reports_service import ReportsService

router = APIRouter()


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
    return await service.get_available_reports()


@router.post("/generate")
async def generate_report(
    request: ReportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("reports.view")),
):
    """Generate a report"""
    service = ReportsService(db)
    report = await service.generate_report(
        current_user.organization_id,
        request.report_type,
        start_date=request.start_date,
        end_date=request.end_date,
        filters=request.filters,
    )

    if "error" in report:
        raise HTTPException(status_code=400, detail=report["error"])

    return report


# ============================================
# Saved / Scheduled Reports
# ============================================


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
            SavedReport.is_active == True,  # noqa: E712
        )
        .order_by(SavedReport.name)
    )
    reports = result.scalars().all()

    return [
        SavedReportResponse(
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
            created_by=str(r.created_by) if r.created_by else "",
            created_at=r.created_at.isoformat() if r.created_at else "",
            updated_at=r.updated_at.isoformat() if r.updated_at else "",
        )
        for r in reports
    ]


@router.post("/saved", response_model=SavedReportResponse)
async def create_saved_report(
    request: SavedReportCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("reports.view")),
):
    """Create a new saved report configuration"""
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
    db.add(report)
    await db.commit()
    await db.refresh(report)

    return SavedReportResponse(
        id=str(report.id),
        name=report.name,
        description=report.description,
        report_type=report.report_type,
        filters=report.filters,
        is_scheduled=report.is_scheduled,
        schedule_frequency=report.schedule_frequency,
        schedule_day=report.schedule_day,
        email_recipients=report.email_recipients,
        last_run_at=None,
        next_run_at=(str(report.next_run_date) if report.next_run_date else None),
        created_by=str(report.created_by) if report.created_by else "",
        created_at=(report.created_at.isoformat() if report.created_at else ""),
        updated_at=(report.updated_at.isoformat() if report.updated_at else ""),
    )


@router.patch("/saved/{report_id}", response_model=SavedReportResponse)
async def update_saved_report(
    report_id: str,
    request: SavedReportUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("reports.view")),
):
    """Update a saved report configuration"""
    result = await db.execute(
        select(SavedReport).where(
            SavedReport.id == report_id,
            SavedReport.organization_id == str(current_user.organization_id),
        )
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Saved report not found")

    update_data = request.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(report, key, value)

    await db.commit()
    await db.refresh(report)

    return SavedReportResponse(
        id=str(report.id),
        name=report.name,
        description=report.description,
        report_type=report.report_type,
        filters=report.filters,
        is_scheduled=report.is_scheduled,
        schedule_frequency=report.schedule_frequency,
        schedule_day=report.schedule_day,
        email_recipients=report.email_recipients,
        last_run_at=(report.last_run_at.isoformat() if report.last_run_at else None),
        next_run_at=(str(report.next_run_date) if report.next_run_date else None),
        created_by=str(report.created_by) if report.created_by else "",
        created_at=(report.created_at.isoformat() if report.created_at else ""),
        updated_at=(report.updated_at.isoformat() if report.updated_at else ""),
    )


@router.delete("/saved/{report_id}")
async def delete_saved_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("reports.view")),
):
    """Delete (soft-delete) a saved report"""
    result = await db.execute(
        select(SavedReport).where(
            SavedReport.id == report_id,
            SavedReport.organization_id == str(current_user.organization_id),
        )
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Saved report not found")

    report.is_active = False
    await db.commit()
    return {"detail": "Saved report deleted"}


@router.post("/saved/{report_id}/run")
async def run_saved_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("reports.view")),
):
    """Run a saved report immediately and return the results"""
    result = await db.execute(
        select(SavedReport).where(
            SavedReport.id == report_id,
            SavedReport.organization_id == str(current_user.organization_id),
        )
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Saved report not found")

    service = ReportsService(db)
    filters = report.filters or {}
    report_data = await service.generate_report(
        current_user.organization_id,
        report.report_type,
        start_date=filters.get("start_date"),
        end_date=filters.get("end_date"),
        filters=filters,
    )

    if "error" in report_data:
        raise HTTPException(status_code=400, detail=report_data["error"])

    # Update last_run_at
    report.last_run_at = datetime.now(timezone.utc)
    await db.commit()

    return report_data
