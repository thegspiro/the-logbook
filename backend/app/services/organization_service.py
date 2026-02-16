"""
Organization Service

Business logic for organization-related operations.
"""

from typing import Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified
from uuid import UUID

from app.models.user import Organization
from app.schemas.organization import (
    OrganizationSettings,
    ContactInfoSettings,
    EnabledModulesResponse,
    ModuleSettings,
    EmailServiceSettings,
)


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

        # Parse email service settings
        email_service = settings_dict.get("email_service", {})
        email_settings = EmailServiceSettings(
            enabled=email_service.get("enabled", False),
            smtp_host=email_service.get("smtp_host"),
            smtp_port=email_service.get("smtp_port", 587),
            smtp_user=email_service.get("smtp_user"),
            smtp_password=email_service.get("smtp_password"),
            from_email=email_service.get("from_email"),
            from_name=email_service.get("from_name"),
            use_tls=email_service.get("use_tls", True),
        )

        # Parse module settings
        modules = settings_dict.get("modules", {})
        module_settings = ModuleSettings(
            training=modules.get("training", False),
            inventory=modules.get("inventory", False),
            scheduling=modules.get("scheduling", False),
            elections=modules.get("elections", False),
            minutes=modules.get("minutes", False),
            reports=modules.get("reports", False),
            notifications=modules.get("notifications", False),
            mobile=modules.get("mobile", False),
            forms=modules.get("forms", False),
            integrations=modules.get("integrations", False),
        )

        return OrganizationSettings(
            contact_info_visibility=contact_settings,
            email_service=email_settings,
            modules=module_settings,
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

        # Update in database — flag_modified is required because the
        # Organization.settings column uses plain JSON (not MutableDict),
        # so SQLAlchemy may not detect the change without an explicit hint.
        org.settings = updated_settings
        flag_modified(org, "settings")
        await self.db.commit()
        await self.db.refresh(org)

        # Return updated settings
        return await self.get_organization_settings(organization_id)

    def check_contact_info_enabled(self, settings: OrganizationSettings) -> bool:
        """Check if contact information display is enabled"""
        return settings.contact_info_visibility.enabled

    async def get_enabled_modules(
        self,
        organization_id: UUID
    ) -> EnabledModulesResponse:
        """
        Get enabled modules for an organization

        Returns the list of enabled module IDs from organization settings.
        Uses the ModuleSettings schema to determine which modules are enabled.
        """
        org = await self.get_organization(organization_id)
        if not org:
            # Return default (essential modules only)
            default_modules = ModuleSettings()
            return EnabledModulesResponse(
                enabled_modules=default_modules.get_enabled_modules(),
                module_settings=default_modules
            )

        settings_dict = org.settings or {}
        modules = settings_dict.get("modules", {})

        module_settings = ModuleSettings(
            training=modules.get("training", False),
            inventory=modules.get("inventory", False),
            scheduling=modules.get("scheduling", False),
            elections=modules.get("elections", False),
            minutes=modules.get("minutes", False),
            reports=modules.get("reports", False),
            notifications=modules.get("notifications", False),
            mobile=modules.get("mobile", False),
            forms=modules.get("forms", False),
            integrations=modules.get("integrations", False),
        )

        return EnabledModulesResponse(
            enabled_modules=module_settings.get_enabled_modules(),
            module_settings=module_settings
        )

    async def update_module_settings(
        self,
        organization_id: UUID,
        module_updates: Dict[str, bool]
    ) -> EnabledModulesResponse:
        """
        Update module settings for an organization

        Args:
            organization_id: The organization ID
            module_updates: Dictionary of module_id -> enabled status

        Returns:
            Updated EnabledModulesResponse
        """
        org = await self.get_organization(organization_id)
        if not org:
            raise ValueError("Organization not found")

        # Get current settings
        current_settings = org.settings or {}
        current_modules = current_settings.get("modules", {})

        # Update with new module settings
        updated_modules = {**current_modules, **module_updates}
        current_settings["modules"] = updated_modules

        # Update in database — flag_modified needed for plain JSON column
        org.settings = current_settings
        flag_modified(org, "settings")
        await self.db.commit()
        await self.db.refresh(org)

        # Return updated enabled modules
        return await self.get_enabled_modules(organization_id)
