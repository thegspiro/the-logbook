"""
Organization Service

Business logic for organization-related operations.
"""

from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.onboarding import OnboardingStatus
from app.models.user import Organization
from app.schemas.organization import (
    ContactInfoSettings,
    EmailServiceSettings,
    EnabledModulesResponse,
    FileStorageSettings,
    MembershipIdSettings,
    ModuleSettings,
    OrganizationSettings,
)


class OrganizationService:
    """Service for organization-related business logic"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_organization(self, organization_id: UUID) -> Optional[Organization]:
        """Get an organization by ID"""
        result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        return result.scalar_one_or_none()

    # Mapping from onboarding module IDs (hyphenated) to ModuleSettings
    # field names (snake_case).  Entries where the ID already matches the
    # field name are included for clarity.
    _ONBOARDING_ID_TO_FIELD: Dict[str, str] = {
        "training": "training",
        "inventory": "inventory",
        "scheduling": "scheduling",
        "apparatus": "apparatus",
        "communications": "communications",
        "elections": "elections",
        "minutes": "minutes",
        "reports": "reports",
        "notifications": "notifications",
        "mobile": "mobile",
        "forms": "forms",
        "documents": "forms",  # legacy alias
        "integrations": "integrations",
        "facilities": "facilities",
        "incidents": "incidents",
        "hr-payroll": "hr_payroll",
        "hr_payroll": "hr_payroll",
        "grants": "grants",
        "prospective-members": "prospective_members",
        "prospective_members": "prospective_members",
        "public-info": "public_info",
        "public_info": "public_info",
    }

    async def _resolve_module_settings(
        self,
        settings_dict: Dict[str, Any],
        org: Optional["Organization"] = None,
    ) -> ModuleSettings:
        """
        Build ModuleSettings from org.settings.modules — the single
        canonical source of truth for module enablement.

        For backward-compatibility with installations that completed
        onboarding before modules were written to org.settings, we
        perform a one-time migration from OnboardingStatus.enabled_modules
        and persist the result so subsequent reads are fast and consistent.

        Safety net: if org.settings.modules exists but ALL configurable
        modules are False AND the dict was NOT explicitly saved by the
        Settings page (_user_configured flag), we check OnboardingStatus
        to recover from failed dual-writes during onboarding.
        """
        field_names = list(ModuleSettings.model_fields.keys())
        modules = settings_dict.get("modules")

        if isinstance(modules, dict) and len(modules) > 0:
            kwargs = {f: bool(modules.get(f, False)) for f in field_names}
            ms = ModuleSettings(**kwargs)

            # If at least one module is enabled, or the user explicitly
            # configured modules via the Settings page, trust the dict.
            any_enabled = any(getattr(ms, f) for f in field_names)
            if any_enabled or modules.get("_user_configured"):
                return ms

            # ALL modules are False and not user-confirmed — fall through
            # to check OnboardingStatus as a safety net for failed
            # dual-writes during onboarding.

        # ── Migration from OnboardingStatus ──
        onboarding_result = await self.db.execute(select(OnboardingStatus).limit(1))
        onboarding = onboarding_result.scalar_one_or_none()

        if onboarding and onboarding.enabled_modules:
            enabled_list = onboarding.enabled_modules
            # Map onboarding IDs (may be hyphenated) to field names
            enabled_fields: set[str] = set()
            for mod_id in enabled_list:
                field = self._ONBOARDING_ID_TO_FIELD.get(mod_id)
                if field:
                    enabled_fields.add(field)

            kwargs = {f: f in enabled_fields for f in field_names}
            migrated = ModuleSettings(**kwargs)

            # Persist to org.settings.modules so we never need the
            # fallback again — single source of truth going forward.
            if org is not None:
                new_settings = dict(settings_dict)
                new_settings["modules"] = {
                    f: getattr(migrated, f) for f in field_names
                }
                new_settings["modules"]["_user_configured"] = True
                org.settings = new_settings
                flag_modified(org, "settings")
                await self.db.flush()

            return migrated

        # No data anywhere — return all False
        return ModuleSettings()

    async def get_organization_settings(
        self, organization_id: UUID
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
        email_settings = EmailServiceSettings(**{
            k: email_service[k] for k in email_service
            if k in EmailServiceSettings.model_fields
        }) if email_service else EmailServiceSettings()

        # Parse file storage settings
        file_storage = settings_dict.get("file_storage", {})
        file_storage_settings = FileStorageSettings(**{
            k: file_storage[k] for k in file_storage
            if k in FileStorageSettings.model_fields
        }) if file_storage else FileStorageSettings()

        # Parse auth settings
        from app.schemas.organization import AuthSettings
        auth = settings_dict.get("auth", {})
        auth_settings = AuthSettings(**{
            k: auth[k] for k in auth
            if k in AuthSettings.model_fields
        }) if auth else AuthSettings()

        # Parse module settings (auto-migrates from onboarding if needed)
        module_settings = await self._resolve_module_settings(settings_dict, org=org)

        # Parse membership ID settings
        membership_id = settings_dict.get("membership_id", {})
        membership_id_settings = MembershipIdSettings(
            enabled=membership_id.get("enabled", False),
            auto_generate=membership_id.get("auto_generate", False),
            prefix=membership_id.get("prefix", ""),
            next_number=membership_id.get("next_number", 1),
        )

        # Collect extra/custom settings (e.g. station_mode) that aren't
        # covered by a dedicated sub-schema so they round-trip through the API.
        known_keys = {
            "contact_info_visibility",
            "email_service",
            "file_storage",
            "auth",
            "modules",
            "it_team",
            "member_drop_notifications",
            "membership_tiers",
            "membership_id",
        }
        extra_settings = {k: v for k, v in settings_dict.items() if k not in known_keys}

        return OrganizationSettings(
            contact_info_visibility=contact_settings,
            email_service=email_settings,
            file_storage=file_storage_settings,
            auth=auth_settings,
            modules=module_settings,
            membership_id=membership_id_settings,
            **extra_settings,
        )

    async def update_organization_settings(
        self, organization_id: UUID, settings_update: Dict[str, Any]
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
        self, organization_id: UUID
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
                module_settings=default_modules,
            )

        settings_dict = org.settings or {}
        module_settings = await self._resolve_module_settings(settings_dict, org=org)

        return EnabledModulesResponse(
            enabled_modules=module_settings.get_enabled_modules(),
            module_settings=module_settings,
        )

    async def update_module_settings(
        self, organization_id: UUID, module_updates: Dict[str, bool]
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

        # Get current settings — _resolve_module_settings will auto-migrate
        # from onboarding data if org.settings.modules is empty.
        current_settings = org.settings or {}
        resolved = await self._resolve_module_settings(current_settings, org=org)
        # Re-read settings after potential migration flush
        current_settings = org.settings or {}
        field_names = list(ModuleSettings.model_fields.keys())
        current_modules = current_settings.get(
            "modules",
            {f: getattr(resolved, f) for f in field_names},
        )

        # Merge the incoming toggles and mark as explicitly configured
        updated_modules = {
            **current_modules,
            **module_updates,
            "_user_configured": True,
        }
        current_settings["modules"] = updated_modules

        # Update in database — flag_modified needed for plain JSON column
        org.settings = current_settings
        flag_modified(org, "settings")
        await self.db.commit()
        await self.db.refresh(org)

        # Return updated enabled modules
        return await self.get_enabled_modules(organization_id)
