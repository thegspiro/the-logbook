"""
Organization Service

Business logic for organization-related operations.
"""

from typing import Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.models.user import Organization
from app.schemas.organization import OrganizationSettings, ContactInfoSettings


class OrganizationService:
    """Service for organization-related business logic"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_organization(self, organization_id: UUID) -> Optional[Organization]:
        """Get an organization by ID"""
        result = await self.db.execute(
            select(Organization).where(Organization.id == organization_id)
        )
        return result.scalar_one_or_none()

    async def get_organization_settings(
        self,
        organization_id: UUID
    ) -> OrganizationSettings:
        """
        Get organization settings

        Returns a parsed OrganizationSettings object with defaults if not set.
        """
        org = await self.get_organization(organization_id)
        if not org:
            # Return default settings if org not found
            return OrganizationSettings()

        # Get settings from JSONB field, or use defaults
        settings_dict = org.settings or {}

        # Parse contact info visibility settings
        contact_info = settings_dict.get("contact_info_visibility", {})
        contact_settings = ContactInfoSettings(
            enabled=contact_info.get("enabled", False),
            show_email=contact_info.get("show_email", True),
            show_phone=contact_info.get("show_phone", True),
            show_mobile=contact_info.get("show_mobile", True),
        )

        return OrganizationSettings(
            contact_info_visibility=contact_settings,
            **{k: v for k, v in settings_dict.items() if k != "contact_info_visibility"}
        )

    async def update_organization_settings(
        self,
        organization_id: UUID,
        settings_update: Dict[str, Any]
    ) -> OrganizationSettings:
        """
        Update organization settings

        Args:
            organization_id: The organization ID
            settings_update: Dictionary of settings to update

        Returns:
            Updated OrganizationSettings
        """
        org = await self.get_organization(organization_id)
        if not org:
            raise ValueError("Organization not found")

        # Get current settings
        current_settings = org.settings or {}

        # Update with new settings (merge dictionaries)
        updated_settings = {**current_settings, **settings_update}

        # Update in database
        org.settings = updated_settings
        await self.db.commit()
        await self.db.refresh(org)

        # Return updated settings
        return await self.get_organization_settings(organization_id)

    def check_contact_info_enabled(self, settings: OrganizationSettings) -> bool:
        """Check if contact information display is enabled"""
        return settings.contact_info_visibility.enabled
