"""
Compliance Officer Dashboard Endpoints

API endpoints for ISO readiness assessment, compliance attestations,
annual compliance reports with CSV export, and record completeness
evaluation (NFPA 1401).
"""

import csv
import io
import logging
from datetime import date
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.services.compliance_officer_service import (
    AnnualComplianceReportService,
    ComplianceAttestationService,
    ISOReadinessService,
    RecordCompletenessService,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# =============================================================================
# Request / Response Schemas
# =============================================================================


class AttestationCreate(BaseModel):
    """Request body for creating a compliance attestation."""

    period_type: str = Field(..., description="Period type, e.g. 'annual' or 'quarterly'")
    period_year: int = Field(..., description="Year of the attestation period")
    period_quarter: Optional[int] = Field(
        None, description="Quarter number (1-4) if period_type is quarterly"
    )
    compliance_percentage: float = Field(
        ..., ge=0, le=100, description="Overall compliance percentage"
    )
    notes: str = Field("", description="Additional notes or observations")
    areas_reviewed: List[str] = Field(
        default_factory=list, description="List of compliance areas reviewed"
    )
    exceptions: List[Dict] = Field(
        default_factory=list,
        description="List of exception records with details",
    )


class AnnualReportExportRequest(BaseModel):
    """Request body for exporting the annual compliance report."""

    year: int = Field(..., description="Report year")
    format: str = Field("csv", description="Export format (currently only 'csv')")


# =============================================================================
# ISO Readiness
# =============================================================================


@router.get("/iso-readiness")
async def get_iso_readiness(
    year: Optional[int] = Query(None, description="Assessment year"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Get ISO readiness assessment for the organization."""
    try:
        service = ISOReadinessService(db)
        result = await service.get_iso_readiness(
            current_user.organization_id, year=year
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        logger.error(f"Error fetching ISO readiness: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# =============================================================================
# Compliance Attestations
# =============================================================================


@router.post("/attestations")
async def create_attestation(
    data: AttestationCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Create a formal compliance attestation record."""
    try:
        service = ComplianceAttestationService(db)
        result = await service.create_attestation(
            organization_id=current_user.organization_id,
            attestation_data=data.model_dump(),
            attested_by=current_user.id,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        logger.error(f"Error creating attestation: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/attestations")
async def get_attestations(
    limit: int = Query(20, ge=1, le=100, description="Maximum number of results"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Get list of past compliance attestations."""
    try:
        service = ComplianceAttestationService(db)
        result = await service.get_attestation_history(
            current_user.organization_id, limit=limit
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        logger.error(f"Error fetching attestations: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# =============================================================================
# Annual Compliance Report
# =============================================================================


@router.get("/annual-report")
async def get_annual_report(
    year: int = Query(..., description="Report year"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Get comprehensive annual compliance report."""
    try:
        service = AnnualComplianceReportService(db)
        result = await service.generate_annual_report(
            current_user.organization_id, year=year
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        logger.error(f"Error fetching annual report: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/annual-report/export")
async def export_annual_report(
    data: AnnualReportExportRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Export annual compliance report as CSV."""
    try:
        service = AnnualComplianceReportService(db)
        report = await service.generate_annual_report(
            current_user.organization_id, year=data.year
        )

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Name",
            "Compliance %",
            "Hours",
            "Requirements Met",
            "Requirements Total",
            "Expired Certs",
            "Status",
        ])

        members = report.get("member_compliance", [])
        for member in members:
            writer.writerow([
                member.get("name", ""),
                member.get("compliance_pct", 0),
                member.get("hours_completed", 0),
                member.get("requirements_met", 0),
                member.get("requirements_total", 0),
                member.get("expired_certifications", 0),
                member.get("status", ""),
            ])

        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": (
                    f"attachment; filename=annual_compliance_{data.year}.csv"
                )
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        logger.error(f"Error exporting annual report: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# =============================================================================
# Record Completeness (NFPA 1401)
# =============================================================================


@router.get("/record-completeness")
async def get_record_completeness(
    start_date: Optional[date] = Query(None, description="Filter start date"),
    end_date: Optional[date] = Query(None, description="Filter end date"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Get record completeness evaluation per NFPA 1401 standards."""
    try:
        service = RecordCompletenessService(db)
        result = await service.evaluate_record_completeness(
            current_user.organization_id,
            start_date=start_date,
            end_date=end_date,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        logger.error(f"Error fetching record completeness: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/incomplete-records")
async def get_incomplete_records(
    limit: int = Query(50, ge=1, le=200, description="Maximum number of results"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Get list of records with missing required fields."""
    try:
        service = RecordCompletenessService(db)
        result = await service.get_incomplete_records(
            current_user.organization_id, limit=limit
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        logger.error(f"Error fetching incomplete records: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
