"""
Reports API Endpoints

Endpoints for report generation including member roster,
training summary, event attendance, and compliance reports.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.database import get_db
from app.models.user import User
from app.schemas.reports import ReportRequest
from app.services.reports_service import ReportsService

router = APIRouter()


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
