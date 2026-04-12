"""
Compliance Requirements Configuration Endpoints

API endpoints for managing compliance configuration, profiles,
and compliance report generation/retrieval.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.database import get_db
from app.core.utils import ensure_found, handle_service_errors
from app.schemas.compliance_config import (
    ComplianceConfigCreate,
    ComplianceConfigResponse,
    ComplianceConfigUpdate,
    ComplianceProfileCreate,
    ComplianceProfileResponse,
    ComplianceProfileUpdate,
    ComplianceReportDetail,
    ComplianceReportGenerate,
    ComplianceReportSummary,
)
from app.services.compliance_config_service import (
    ComplianceConfigService,
    ComplianceReportService,
)

router = APIRouter()


# =============================================================================
# Compliance Configuration
# =============================================================================


@router.get("/config")
async def get_compliance_config(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Get the compliance requirements configuration for the organization."""
    async with handle_service_errors("Failed to fetch compliance config"):
        service = ComplianceConfigService(db)
        config = await service.get_config(current_user.organization_id)
        if not config:
            return None
        return ComplianceConfigResponse.model_validate(config)


@router.put("/config")
async def update_compliance_config(
    data: ComplianceConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("settings.manage")),
):
    """Create or update compliance requirements configuration."""
    async with handle_service_errors("Failed to update compliance config"):
        service = ComplianceConfigService(db)
        update_data = data.model_dump(exclude_none=True)
        config = await service.create_or_update_config(
            organization_id=current_user.organization_id,
            data=update_data,
            updated_by=current_user.id,
        )
        await db.commit()
        return ComplianceConfigResponse.model_validate(config)


@router.post("/config/initialize")
async def initialize_compliance_config(
    data: ComplianceConfigCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("settings.manage")),
):
    """Initialize compliance config (first-time setup)."""
    async with handle_service_errors("Failed to initialize compliance config"):
        service = ComplianceConfigService(db)
        existing = await service.get_config(current_user.organization_id)
        if existing:
            raise ValueError("Compliance configuration already exists")

        config = await service.create_or_update_config(
            organization_id=current_user.organization_id,
            data=data.model_dump(),
            updated_by=current_user.id,
        )
        await db.commit()
        return ComplianceConfigResponse.model_validate(config)


# =============================================================================
# Available Requirements (for profile configuration UI)
# =============================================================================


@router.get("/config/requirements")
async def get_available_requirements(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Get all training requirements available for compliance configuration."""
    async with handle_service_errors("Failed to fetch requirements"):
        service = ComplianceConfigService(db)
        requirements = await service.get_available_requirements(
            current_user.organization_id
        )
        return {"requirements": requirements}


# =============================================================================
# Compliance Profiles
# =============================================================================


@router.post("/config/profiles")
async def create_compliance_profile(
    data: ComplianceProfileCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("settings.manage")),
):
    """Create a new compliance profile."""
    async with handle_service_errors("Failed to create profile"):
        service = ComplianceConfigService(db)
        profile = await service.create_profile(
            organization_id=current_user.organization_id,
            data=data.model_dump(),
        )
        await db.commit()
        return ComplianceProfileResponse.model_validate(profile)


@router.put("/config/profiles/{profile_id}")
async def update_compliance_profile(
    profile_id: str,
    data: ComplianceProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("settings.manage")),
):
    """Update a compliance profile."""
    async with handle_service_errors("Failed to update profile"):
        service = ComplianceConfigService(db)
        profile = await service.update_profile(
            profile_id=profile_id,
            organization_id=current_user.organization_id,
            data=data.model_dump(exclude_none=True),
        )
        await db.commit()
        return ComplianceProfileResponse.model_validate(profile)


@router.delete("/config/profiles/{profile_id}")
async def delete_compliance_profile(
    profile_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("settings.manage")),
):
    """Delete a compliance profile."""
    async with handle_service_errors("Failed to delete profile"):
        service = ComplianceConfigService(db)
        await service.delete_profile(
            profile_id=profile_id,
            organization_id=current_user.organization_id,
        )
        await db.commit()
        return {"message": "Profile deleted"}


# =============================================================================
# Compliance Reports
# =============================================================================


@router.post("/reports/generate")
async def generate_compliance_report(
    data: ComplianceReportGenerate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Generate a new compliance report (monthly or yearly)."""
    async with handle_service_errors("Failed to generate report"):
        service = ComplianceReportService(db)
        report = await service.generate_report(
            organization_id=current_user.organization_id,
            report_type=data.report_type,
            year=data.year,
            month=data.month,
            generated_by=current_user.id,
            send_email=data.send_email,
            additional_recipients=data.additional_recipients,
        )
        await db.commit()
        return ComplianceReportDetail.model_validate(report)


@router.get("/reports")
async def list_compliance_reports(
    report_type: Optional[str] = Query(None, description="Filter by type"),
    year: Optional[int] = Query(None, description="Filter by year"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """List stored compliance reports."""
    async with handle_service_errors("Failed to list reports"):
        service = ComplianceReportService(db)
        result = await service.list_reports(
            organization_id=current_user.organization_id,
            report_type=report_type,
            year=year,
            limit=limit,
            offset=offset,
        )
        return {
            "reports": [
                ComplianceReportSummary.model_validate(r) for r in result["reports"]
            ],
            "total": result["total"],
            "limit": result["limit"],
            "offset": result["offset"],
        }


@router.get("/reports/{report_id}")
async def get_compliance_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Get a single compliance report with full data."""
    async with handle_service_errors("Failed to fetch report"):
        service = ComplianceReportService(db)
        report = ensure_found(
            await service.get_report(
                report_id=report_id,
                organization_id=current_user.organization_id,
            ),
            "Report",
        )
        return ComplianceReportDetail.model_validate(report)


@router.delete("/reports/{report_id}")
async def delete_compliance_report(
    report_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("settings.manage")),
):
    """Delete a stored compliance report."""
    async with handle_service_errors("Failed to delete report"):
        service = ComplianceReportService(db)
        await service.delete_report(
            report_id=report_id,
            organization_id=current_user.organization_id,
        )
        await db.commit()
        return {"message": "Report deleted"}


@router.post("/reports/{report_id}/email")
async def email_compliance_report(
    report_id: str,
    recipients: List[str],
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Email an existing report to specified recipients."""
    async with handle_service_errors("Failed to email report"):
        service = ComplianceReportService(db)
        await service.email_existing_report(
            report_id=report_id,
            organization_id=current_user.organization_id,
            recipients=recipients,
        )
        await db.commit()
        return {"message": f"Report emailed to {len(recipients)} recipient(s)"}
