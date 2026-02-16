"""
Minutes Template Service

Business logic for managing meeting minutes templates.
"""

import logging
from typing import List, Optional
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.minute import (
    MinutesTemplate, MinutesMeetingType,
    DEFAULT_BUSINESS_SECTIONS, DEFAULT_SPECIAL_SECTIONS, DEFAULT_COMMITTEE_SECTIONS,
    DEFAULT_TRUSTEE_SECTIONS, DEFAULT_EXECUTIVE_SECTIONS, DEFAULT_ANNUAL_SECTIONS,
)
from app.schemas.minute import TemplateCreate, TemplateUpdate

logger = logging.getLogger(__name__)


class TemplateService:
    """Service for managing meeting minutes templates"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def initialize_defaults(self, organization_id: UUID, created_by: UUID) -> List[MinutesTemplate]:
        """Create default templates for an organization if none exist"""
        existing = await self.db.execute(
            select(func.count(MinutesTemplate.id))
            .where(MinutesTemplate.organization_id == str(organization_id))
        )
        if (existing.scalar() or 0) > 0:
            return await self.list_templates(organization_id)

        defaults = [
            {
                "name": "Standard Business Meeting",
                "description": "Default template for regular business meetings with all standard sections.",
                "meeting_type": MinutesMeetingType.BUSINESS,
                "is_default": True,
                "sections": DEFAULT_BUSINESS_SECTIONS,
                "header_config": {
                    "org_name": None,
                    "logo_url": None,
                    "subtitle": "Official Meeting Minutes",
                    "show_date": True,
                    "show_meeting_type": True,
                },
                "footer_config": {
                    "left_text": None,
                    "center_text": "Confidential — For Internal Use Only",
                    "right_text": None,
                    "show_page_numbers": True,
                    "confidentiality_notice": None,
                },
            },
            {
                "name": "Special Meeting",
                "description": "Streamlined template for special-purpose meetings.",
                "meeting_type": MinutesMeetingType.SPECIAL,
                "is_default": True,
                "sections": DEFAULT_SPECIAL_SECTIONS,
                "header_config": {
                    "org_name": None,
                    "logo_url": None,
                    "subtitle": "Special Meeting Minutes",
                    "show_date": True,
                    "show_meeting_type": True,
                },
                "footer_config": {
                    "show_page_numbers": True,
                },
            },
            {
                "name": "Committee Meeting",
                "description": "Template for committee meetings with recommendation tracking.",
                "meeting_type": MinutesMeetingType.COMMITTEE,
                "is_default": True,
                "sections": DEFAULT_COMMITTEE_SECTIONS,
                "header_config": {
                    "org_name": None,
                    "logo_url": None,
                    "subtitle": "Committee Meeting Minutes",
                    "show_date": True,
                    "show_meeting_type": True,
                },
                "footer_config": {
                    "show_page_numbers": True,
                },
            },
            {
                "name": "Trustee Meeting",
                "description": "Template for Board of Trustees meetings with financial and fiduciary sections.",
                "meeting_type": MinutesMeetingType.TRUSTEE,
                "is_default": True,
                "sections": DEFAULT_TRUSTEE_SECTIONS,
                "header_config": {
                    "org_name": None,
                    "logo_url": None,
                    "subtitle": "Board of Trustees Meeting Minutes",
                    "show_date": True,
                    "show_meeting_type": True,
                },
                "footer_config": {
                    "left_text": None,
                    "center_text": "Confidential — For Internal Use Only",
                    "right_text": None,
                    "show_page_numbers": True,
                    "confidentiality_notice": None,
                },
            },
            {
                "name": "Executive Meeting",
                "description": "Template for executive/officer meetings with strategic planning and personnel sections.",
                "meeting_type": MinutesMeetingType.EXECUTIVE,
                "is_default": True,
                "sections": DEFAULT_EXECUTIVE_SECTIONS,
                "header_config": {
                    "org_name": None,
                    "logo_url": None,
                    "subtitle": "Executive Meeting Minutes",
                    "show_date": True,
                    "show_meeting_type": True,
                },
                "footer_config": {
                    "left_text": None,
                    "center_text": "Confidential — Executive Session",
                    "right_text": None,
                    "show_page_numbers": True,
                    "confidentiality_notice": "This document contains confidential information discussed in executive session.",
                },
            },
            {
                "name": "Annual Meeting",
                "description": "Template for annual general meetings with year-end reports, elections, and awards.",
                "meeting_type": MinutesMeetingType.ANNUAL,
                "is_default": True,
                "sections": DEFAULT_ANNUAL_SECTIONS,
                "header_config": {
                    "org_name": None,
                    "logo_url": None,
                    "subtitle": "Annual Meeting Minutes",
                    "show_date": True,
                    "show_meeting_type": True,
                },
                "footer_config": {
                    "show_page_numbers": True,
                },
            },
        ]

        created = []
        for tpl_data in defaults:
            tpl = MinutesTemplate(
                organization_id=str(organization_id),
                created_by=str(created_by),
                **tpl_data,
            )
            self.db.add(tpl)
            created.append(tpl)

        await self.db.commit()
        for tpl in created:
            await self.db.refresh(tpl)
        return created

    async def list_templates(
        self, organization_id: UUID, meeting_type: Optional[str] = None
    ) -> List[MinutesTemplate]:
        """List all templates for an organization"""
        query = (
            select(MinutesTemplate)
            .where(MinutesTemplate.organization_id == str(organization_id))
        )
        if meeting_type:
            query = query.where(MinutesTemplate.meeting_type == meeting_type)
        query = query.order_by(MinutesTemplate.is_default.desc(), MinutesTemplate.name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_template(
        self, template_id: str, organization_id: UUID
    ) -> Optional[MinutesTemplate]:
        """Get a template by ID"""
        result = await self.db.execute(
            select(MinutesTemplate)
            .where(MinutesTemplate.id == str(template_id))
            .where(MinutesTemplate.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def create_template(
        self, data: TemplateCreate, organization_id: UUID, created_by: UUID
    ) -> MinutesTemplate:
        """Create a new template"""
        tpl_dict = data.model_dump()

        # Serialize sections
        tpl_dict["sections"] = [
            s.model_dump() if hasattr(s, "model_dump") else s
            for s in data.sections
        ]
        if data.header_config and hasattr(data.header_config, "model_dump"):
            tpl_dict["header_config"] = data.header_config.model_dump()
        if data.footer_config and hasattr(data.footer_config, "model_dump"):
            tpl_dict["footer_config"] = data.footer_config.model_dump()

        # If marking as default, unset other defaults for this meeting type
        if tpl_dict.get("is_default"):
            await self._clear_defaults(organization_id, tpl_dict["meeting_type"])

        tpl = MinutesTemplate(
            organization_id=str(organization_id),
            created_by=str(created_by),
            **tpl_dict,
        )
        self.db.add(tpl)
        await self.db.commit()
        await self.db.refresh(tpl)
        return tpl

    async def update_template(
        self, template_id: str, organization_id: UUID, data: TemplateUpdate
    ) -> Optional[MinutesTemplate]:
        """Update a template"""
        tpl = await self.get_template(template_id, organization_id)
        if not tpl:
            return None

        update_data = data.model_dump(exclude_unset=True)

        # Serialize sections
        if "sections" in update_data and data.sections:
            update_data["sections"] = [
                s.model_dump() if hasattr(s, "model_dump") else s
                for s in data.sections
            ]
        if "header_config" in update_data and data.header_config and hasattr(data.header_config, "model_dump"):
            update_data["header_config"] = data.header_config.model_dump()
        if "footer_config" in update_data and data.footer_config and hasattr(data.footer_config, "model_dump"):
            update_data["footer_config"] = data.footer_config.model_dump()

        # Handle default toggle
        if update_data.get("is_default"):
            mt = update_data.get("meeting_type") or (tpl.meeting_type if isinstance(tpl.meeting_type, str) else tpl.meeting_type.value)
            await self._clear_defaults(organization_id, mt)

        for field, value in update_data.items():
            setattr(tpl, field, value)

        await self.db.commit()
        await self.db.refresh(tpl)
        return tpl

    async def delete_template(
        self, template_id: str, organization_id: UUID
    ) -> bool:
        """Delete a template"""
        tpl = await self.get_template(template_id, organization_id)
        if not tpl:
            return False

        await self.db.delete(tpl)
        await self.db.commit()
        return True

    async def get_default_for_type(
        self, organization_id: UUID, meeting_type: str
    ) -> Optional[MinutesTemplate]:
        """Get the default template for a meeting type"""
        result = await self.db.execute(
            select(MinutesTemplate)
            .where(MinutesTemplate.organization_id == str(organization_id))
            .where(MinutesTemplate.meeting_type == meeting_type)
            .where(MinutesTemplate.is_default == True)
        )
        return result.scalar_one_or_none()

    async def _clear_defaults(self, organization_id: UUID, meeting_type: str):
        """Clear the is_default flag for all templates of a given type"""
        result = await self.db.execute(
            select(MinutesTemplate)
            .where(MinutesTemplate.organization_id == str(organization_id))
            .where(MinutesTemplate.meeting_type == meeting_type)
            .where(MinutesTemplate.is_default == True)
        )
        for tpl in result.scalars().all():
            tpl.is_default = False
