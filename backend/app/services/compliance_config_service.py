"""
Compliance Requirements Configuration Service

Manages compliance configuration, profiles, and report generation/storage.
"""

import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.compliance_config import (
    ComplianceConfig,
    ComplianceProfile,
    ComplianceReport,
    ReportStatus,
)
from app.models.training import TrainingRequirement
from app.models.user import Organization
from app.services.compliance_officer_service import AnnualComplianceReportService
from app.services.email_service import EmailService


class ComplianceConfigService:
    """Service for managing compliance configuration."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_config(self, organization_id: str) -> Optional[ComplianceConfig]:
        """Get the compliance config for an organization, with profiles."""
        result = await self.db.execute(
            select(ComplianceConfig)
            .options(selectinload(ComplianceConfig.profiles))
            .where(ComplianceConfig.organization_id == organization_id)
        )
        return result.scalars().first()

    async def create_or_update_config(
        self,
        organization_id: str,
        data: Dict[str, Any],
        updated_by: Optional[str] = None,
    ) -> ComplianceConfig:
        """Create or update the compliance config for an organization."""
        config = await self.get_config(organization_id)

        if config is None:
            config = ComplianceConfig(
                organization_id=organization_id,
                updated_by=updated_by,
                **data,
            )
            self.db.add(config)
        else:
            for key, value in data.items():
                if hasattr(config, key):
                    setattr(config, key, value)
            config.updated_by = updated_by

        await self.db.flush()

        # Re-fetch with profiles
        return await self.get_config(organization_id)  # type: ignore[return-value]

    async def create_profile(
        self,
        organization_id: str,
        data: Dict[str, Any],
    ) -> ComplianceProfile:
        """Create a compliance profile for the organization's config."""
        config = await self.get_config(organization_id)
        if config is None:
            raise ValueError(
                "Compliance configuration must be set up before creating profiles"
            )

        profile = ComplianceProfile(config_id=config.id, **data)
        self.db.add(profile)
        await self.db.flush()
        await self.db.refresh(profile)
        return profile

    async def update_profile(
        self,
        profile_id: str,
        organization_id: str,
        data: Dict[str, Any],
    ) -> ComplianceProfile:
        """Update a compliance profile."""
        result = await self.db.execute(
            select(ComplianceProfile)
            .join(ComplianceConfig)
            .where(
                ComplianceProfile.id == profile_id,
                ComplianceConfig.organization_id == organization_id,
            )
        )
        profile = result.scalars().first()
        if not profile:
            raise ValueError("Profile not found")

        for key, value in data.items():
            if hasattr(profile, key) and value is not None:
                setattr(profile, key, value)

        await self.db.flush()
        await self.db.refresh(profile)
        return profile

    async def delete_profile(
        self,
        profile_id: str,
        organization_id: str,
    ) -> None:
        """Delete a compliance profile."""
        result = await self.db.execute(
            select(ComplianceProfile)
            .join(ComplianceConfig)
            .where(
                ComplianceProfile.id == profile_id,
                ComplianceConfig.organization_id == organization_id,
            )
        )
        profile = result.scalars().first()
        if not profile:
            raise ValueError("Profile not found")

        await self.db.delete(profile)
        await self.db.flush()

    async def get_available_requirements(
        self,
        organization_id: str,
    ) -> List[Dict[str, Any]]:
        """Get all training requirements for the organization (for selection UI)."""
        result = await self.db.execute(
            select(TrainingRequirement)
            .where(TrainingRequirement.organization_id == organization_id)
            .where(TrainingRequirement.is_active == True)  # noqa: E712
            .order_by(TrainingRequirement.name)
        )
        requirements = result.scalars().all()
        return [
            {
                "id": str(req.id),
                "name": req.name,
                "requirement_type": req.requirement_type,
                "source": getattr(req, "source", None),
                "frequency": getattr(req, "frequency", None),
            }
            for req in requirements
        ]


class ComplianceReportService:
    """Service for generating, storing, and emailing compliance reports."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate_report(
        self,
        organization_id: str,
        report_type: str,
        year: int,
        month: Optional[int] = None,
        generated_by: Optional[str] = None,
        send_email: bool = False,
        additional_recipients: Optional[List[str]] = None,
    ) -> ComplianceReport:
        """Generate and store a compliance report."""
        # Build period label
        if report_type == "monthly" and month:
            period_label = datetime(year, month, 1).strftime("%B %Y")
        else:
            period_label = str(year)

        # Create the report record
        report = ComplianceReport(
            organization_id=organization_id,
            report_type=report_type,
            period_label=period_label,
            period_year=year,
            period_month=month if report_type == "monthly" else None,
            status=ReportStatus.GENERATING.value,
            generated_by=generated_by,
        )
        self.db.add(report)
        await self.db.flush()

        start_time = time.monotonic()

        try:
            # Generate the actual report data using existing service
            annual_service = AnnualComplianceReportService(self.db)
            report_data = await annual_service.generate_annual_report(
                organization_id, year=year
            )

            # If monthly, filter/annotate the data
            if report_type == "monthly" and month:
                report_data["report_period"] = {
                    "type": "monthly",
                    "year": year,
                    "month": month,
                    "label": period_label,
                }

            elapsed_ms = int((time.monotonic() - start_time) * 1000)

            # Build summary
            exec_summary = report_data.get("executive_summary", {})
            summary = {
                "overall_compliance_pct": exec_summary.get(
                    "overall_compliance_pct", 0
                ),
                "fully_compliant_members": exec_summary.get(
                    "fully_compliant_members", 0
                ),
                "total_members": exec_summary.get("total_members", 0),
                "at_risk_members": exec_summary.get("at_risk_members", 0),
                "non_compliant_members": exec_summary.get(
                    "non_compliant_members", 0
                ),
                "total_training_hours": exec_summary.get(
                    "total_training_hours", 0
                ),
            }

            report.report_data = report_data
            report.summary = summary
            report.status = ReportStatus.COMPLETED.value
            report.generation_duration_ms = elapsed_ms

            await self.db.flush()

            # Email the report if requested
            if send_email:
                await self._email_report(
                    report, organization_id, additional_recipients
                )

            await self.db.refresh(report)
            return report

        except Exception as e:
            elapsed_ms = int((time.monotonic() - start_time) * 1000)
            report.status = ReportStatus.FAILED.value
            report.error_message = str(e)
            report.generation_duration_ms = elapsed_ms
            await self.db.flush()
            logger.error(f"Report generation failed: {e}")
            raise

    async def _email_report(
        self,
        report: ComplianceReport,
        organization_id: str,
        additional_recipients: Optional[List[str]] = None,
    ) -> None:
        """Email a completed report to configured recipients."""
        # Get organization for email service
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == organization_id)
        )
        org = org_result.scalars().first()

        # Get configured recipients from compliance config
        config_result = await self.db.execute(
            select(ComplianceConfig).where(
                ComplianceConfig.organization_id == organization_id
            )
        )
        config = config_result.scalars().first()

        recipients: List[str] = []
        if config and config.report_email_recipients:
            recipients.extend(config.report_email_recipients)
        if additional_recipients:
            recipients.extend(additional_recipients)

        # Deduplicate
        recipients = list(set(recipients))

        if not recipients:
            logger.info("No recipients configured for compliance report email")
            return

        summary = report.summary or {}
        compliance_pct = summary.get("overall_compliance_pct", 0)
        total_members = summary.get("total_members", 0)
        compliant_members = summary.get("fully_compliant_members", 0)

        org_name = org.name if org else "Your Organization"

        html_body = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a2e;">Compliance Report — {report.period_label}</h2>
            <p>The {report.report_type} compliance report for <strong>{org_name}</strong>
               has been generated.</p>

            <div style="background: #f8f9fa; border-radius: 8px; padding: 20px;
                        margin: 20px 0;">
                <h3 style="margin-top: 0; color: #333;">Executive Summary</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px 0; color: #666;">Overall Compliance</td>
                        <td style="padding: 8px 0; text-align: right;">
                            <strong>{compliance_pct:.1f}%</strong>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #666;">Compliant Members</td>
                        <td style="padding: 8px 0; text-align: right;">
                            <strong>{compliant_members} / {total_members}</strong>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #666;">At Risk</td>
                        <td style="padding: 8px 0; text-align: right;">
                            <strong>{summary.get('at_risk_members', 0)}</strong>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #666;">Non-Compliant</td>
                        <td style="padding: 8px 0; text-align: right;">
                            <strong>{summary.get('non_compliant_members', 0)}</strong>
                        </td>
                    </tr>
                </table>
            </div>

            <p style="color: #666; font-size: 14px;">
                Log in to The Logbook to view the full report with detailed
                member-by-member compliance data.
            </p>
        </div>
        """

        text_body = (
            f"Compliance Report — {report.period_label}\n\n"
            f"Overall Compliance: {compliance_pct:.1f}%\n"
            f"Compliant Members: {compliant_members} / {total_members}\n"
            f"At Risk: {summary.get('at_risk_members', 0)}\n"
            f"Non-Compliant: {summary.get('non_compliant_members', 0)}\n\n"
            f"Log in to The Logbook to view the full report."
        )

        try:
            email_svc = EmailService(organization=org)
            success_count, _ = await email_svc.send_email(
                to_emails=recipients,
                subject=f"Compliance Report — {report.period_label}",
                html_body=html_body,
                text_body=text_body,
            )
            if success_count > 0:
                report.emailed_to = recipients
                report.emailed_at = datetime.now(timezone.utc)
                await self.db.flush()
                logger.info(
                    f"Compliance report emailed to {len(recipients)} recipient(s)"
                )
        except Exception as e:
            logger.error(f"Failed to email compliance report: {e}")

    async def list_reports(
        self,
        organization_id: str,
        report_type: Optional[str] = None,
        year: Optional[int] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """List stored compliance reports."""
        query = (
            select(ComplianceReport)
            .where(ComplianceReport.organization_id == organization_id)
        )

        if report_type:
            query = query.where(ComplianceReport.report_type == report_type)
        if year:
            query = query.where(ComplianceReport.period_year == year)

        query = query.order_by(ComplianceReport.generated_at.desc())

        # Count total
        from sqlalchemy import func

        count_query = (
            select(func.count())
            .select_from(ComplianceReport)
            .where(ComplianceReport.organization_id == organization_id)
        )
        if report_type:
            count_query = count_query.where(
                ComplianceReport.report_type == report_type
            )
        if year:
            count_query = count_query.where(
                ComplianceReport.period_year == year
            )
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        result = await self.db.execute(query.offset(offset).limit(limit))
        reports = result.scalars().all()

        return {
            "reports": reports,
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    async def get_report(
        self,
        report_id: str,
        organization_id: str,
    ) -> Optional[ComplianceReport]:
        """Get a single report by ID."""
        result = await self.db.execute(
            select(ComplianceReport).where(
                ComplianceReport.id == report_id,
                ComplianceReport.organization_id == organization_id,
            )
        )
        return result.scalars().first()

    async def delete_report(
        self,
        report_id: str,
        organization_id: str,
    ) -> None:
        """Delete a stored report."""
        result = await self.db.execute(
            select(ComplianceReport).where(
                ComplianceReport.id == report_id,
                ComplianceReport.organization_id == organization_id,
            )
        )
        report = result.scalars().first()
        if not report:
            raise ValueError("Report not found")

        await self.db.delete(report)
        await self.db.flush()

    async def email_existing_report(
        self,
        report_id: str,
        organization_id: str,
        recipients: List[str],
    ) -> None:
        """Re-send an existing report to specified recipients."""
        report = await self.get_report(report_id, organization_id)
        if not report:
            raise ValueError("Report not found")
        if report.status != ReportStatus.COMPLETED.value:
            raise ValueError("Cannot email a report that is not completed")

        await self._email_report(report, organization_id, recipients)
