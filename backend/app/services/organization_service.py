"""
Organization Service

Business logic for organization-related operations.
"""

import copy
from typing import Any, Dict, List, Optional
from uuid import UUID

from loguru import logger
from pydantic import EmailStr, TypeAdapter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.onboarding import OnboardingStatus
from app.models.user import Organization, User
from app.schemas.organization import (
    _LEGACY_EMAIL_OAUTH_FIELDS,
    ContactInfoSettings,
    DepartmentEmailSettings,
    EmailServiceSettings,
    EnabledModulesResponse,
    FileStorageSettings,
    MembershipIdSettings,
    ModuleSettings,
    OrganizationSettings,
    SchedulingNotificationSettings,
    SetupProgressSettings,
    decrypt_settings_secrets,
    encrypt_settings_secrets,
)
from app.utils.email_providers import normalize_stored_platform

_EMAIL_ADAPTER = TypeAdapter(EmailStr)


def _valid_emails(values: Any) -> List[str]:
    """Filter to syntactically valid addresses, dropping anything a
    since-tightened schema would reject.

    Used only when reconstructing *stored* settings for a read (never on a
    write, which stays strictly validated by ``OrganizationSettingsUpdate``).
    Without this, a legacy value saved back when ``cc_emails`` was a plain
    ``List[str]`` would make ``get_organization_settings`` raise a
    ``ValidationError`` on every future read of that org's settings —
    including the read at the end of an unrelated settings update (e.g.
    toggling a module), locking an admin out of fixing anything.
    """
    if not isinstance(values, list):
        return []
    out: List[str] = []
    for value in values:
        try:
            out.append(_EMAIL_ADAPTER.validate_python(value))
        except Exception:
            continue
    return out


def _deep_merge_settings(
    base: Dict[str, Any], updates: Dict[str, Any]
) -> Dict[str, Any]:
    """Recursively merge ``updates`` into ``base`` (returns a new dict).

    A shallow ``{**base, **updates}`` merge replaces a whole nested section when
    a partial PATCH touches only one of its sub-keys — dropping the section's
    other keys (ORU-9 data-loss risk). This merges dict-valued sections key by
    key; a non-dict value (including an explicit null/list) still replaces.
    """
    result = dict(base)
    for key, value in updates.items():
        existing = result.get(key)
        if isinstance(value, dict) and isinstance(existing, dict):
            result[key] = _deep_merge_settings(existing, value)
        else:
            result[key] = value
    return result


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
        "storefront": "storefront",
        "prospective-members": "prospective_members",
        "prospective_members": "prospective_members",
        "public-info": "public_info",
        "public_info": "public_info",
    }

    @staticmethod
    def _trusted_stored_modules(settings_dict: Dict[str, Any]) -> Optional[dict]:
        """The stored per-field flags, when the dict is a real configuration.

        ``None`` means the organization has not configured its modules — no
        stored dict at all, or the every-field-False shape with no
        ``_user_configured`` marker, which is onboarding's failed-dual-write
        signature rather than a department's choice.

        One implementation, because two callers ask the same question for
        opposite purposes and must not drift: :meth:`_resolve_module_settings`
        decides whether to trust the dict or fall back, and
        :meth:`get_enabled_modules` reports the answer to the client as
        ``configured`` so the navigation can tell "everything is switched off"
        from "nothing has been chosen yet".

        A key that is simply absent means "this field did not exist when the
        dict was written", not "off". Both writers persist the whole field
        set, so the only way a field goes missing is that it was added to
        ``ModuleSettings`` afterwards — and reading those as False would
        switch a live module off for every existing installation on upgrade,
        which is the failure CLAUDE.md pitfall 19 is about. Absent keys are
        left out here so Pydantic applies the declared default.

        Trust is asked of what was actually *stored*, never of the resolved
        model: a field merely falling back to a True default is no evidence
        the dict survived onboarding, and counting it would disarm the
        recovery path.
        """
        modules = settings_dict.get("modules")
        if not isinstance(modules, dict) or not modules:
            return None
        stored = {
            f: bool(modules[f]) for f in ModuleSettings.model_fields if f in modules
        }
        if any(stored.values()) or modules.get("_user_configured"):
            return stored
        return None

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

        stored = self._trusted_stored_modules(settings_dict)
        if stored is not None:
            return ModuleSettings(**stored)

        # No stored dict, or the all-off shape that signals a failed
        # onboarding dual-write — fall through to OnboardingStatus.

        # ── Migration from OnboardingStatus ──
        # OnboardingStatus is a system-wide singleton (single-org install) with
        # no organization_id column, so the row can only be tied to an org by
        # the organization_name it recorded during setup. Require that match —
        # seeding from a row that names a different org would leak another
        # tenant's module choices (and then persist them below). No match →
        # fall through to defaults (fail closed).
        onboarding = None
        if org is not None:
            onboarding_result = await self.db.execute(select(OnboardingStatus).limit(1))
            candidate = onboarding_result.scalars().first()
            if candidate is not None and candidate.organization_name == org.name:
                onboarding = candidate

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
                new_settings = copy.deepcopy(settings_dict)
                new_settings["modules"] = {f: getattr(migrated, f) for f in field_names}
                new_settings["modules"]["_user_configured"] = True
                org.settings = new_settings
                await self.db.flush()

            return migrated

        # No data anywhere — return defaults (standard modules enabled)
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
        # SEC: Decrypt any encrypted secret fields (backward-compatible with plaintext)
        settings_dict = decrypt_settings_secrets(org.settings or {})

        # Parse contact info visibility settings
        contact_info = settings_dict.get("contact_info_visibility", {})
        contact_settings = ContactInfoSettings(
            enabled=contact_info.get("enabled", False),
            show_email=contact_info.get("show_email", True),
            show_phone=contact_info.get("show_phone", True),
            show_mobile=contact_info.get("show_mobile", True),
        )

        # Parse email service settings. A platform label saved before the
        # schema validated the field is settled onto a known value first, or
        # this read raises for that organization (see normalize_stored_platform).
        # `or {}`: the section is optional and may be stored as null.
        email_service = normalize_stored_platform(
            settings_dict.get("email_service") or {}
        )
        email_settings = (
            EmailServiceSettings(
                **{
                    k: email_service[k]
                    for k in email_service
                    if k in EmailServiceSettings.model_fields
                }
            )
            if email_service
            else EmailServiceSettings()
        )

        # Parse file storage settings
        file_storage = settings_dict.get("file_storage", {})
        file_storage_settings = (
            FileStorageSettings(
                **{
                    k: file_storage[k]
                    for k in file_storage
                    if k in FileStorageSettings.model_fields
                }
            )
            if file_storage
            else FileStorageSettings()
        )

        # Parse auth settings
        from app.schemas.organization import AuthSettings

        auth = settings_dict.get("auth", {})
        auth_settings = (
            AuthSettings(**{k: auth[k] for k in auth if k in AuthSettings.model_fields})
            if auth
            else AuthSettings()
        )

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

        # Parse department email settings
        dept_email = settings_dict.get("department_email", {})
        dept_email_settings = (
            DepartmentEmailSettings(
                **{
                    k: dept_email[k]
                    for k in dept_email
                    if k in DepartmentEmailSettings.model_fields
                }
            )
            if dept_email
            else DepartmentEmailSettings()
        )

        # Parse department setup checklist acknowledgment state
        setup = settings_dict.get("setup", {})
        setup_settings = SetupProgressSettings(
            acknowledged=[
                key for key in setup.get("acknowledged", []) if isinstance(key, str)
            ]
        )

        # Parse scheduling notification settings. Reconstructed explicitly
        # (rather than left in extra_settings for Pydantic to validate
        # blindly) so a legacy cc_emails entry saved before EmailStr
        # tightened the field is dropped rather than raising — see
        # _valid_emails' docstring.
        scheduling = settings_dict.get("scheduling", {})
        scheduling_settings = (
            SchedulingNotificationSettings(
                **{
                    k: (
                        _valid_emails(scheduling[k])
                        if k == "cc_emails"
                        else scheduling[k]
                    )
                    for k in scheduling
                    if k in SchedulingNotificationSettings.model_fields
                }
            )
            if scheduling
            else SchedulingNotificationSettings()
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
            "department_email",
            "setup",
            "scheduling",
        }
        extra_settings = {k: v for k, v in settings_dict.items() if k not in known_keys}

        return OrganizationSettings(
            contact_info_visibility=contact_settings,
            email_service=email_settings,
            file_storage=file_storage_settings,
            auth=auth_settings,
            modules=module_settings,
            membership_id=membership_id_settings,
            department_email=dept_email_settings,
            setup=setup_settings,
            scheduling=scheduling_settings,
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

        # Deep copy to avoid mutating SQLAlchemy's committed state
        current_settings = copy.deepcopy(org.settings or {})

        # SEC: If the update contains redacted placeholder values ('••••••••'),
        # preserve the existing encrypted values instead of overwriting them.
        # "auth" must be included: GET /settings redacts SSO client secrets to
        # '••••••••', so a full-settings round-trip that saves the auth section
        # back would otherwise persist the literal bullet string (encrypt skips
        # it), silently destroying the real SSO client secret and breaking login.
        for section_key in ("email_service", "file_storage", "auth"):
            incoming = settings_update.get(section_key)
            existing = current_settings.get(section_key)
            if isinstance(incoming, dict) and isinstance(existing, dict):
                for field, val in incoming.items():
                    if val == "••••••••":
                        incoming[field] = existing.get(field)

        # Deep-merge so a partial PATCH of one sub-key doesn't wipe the rest of
        # its section (ORU-9). A shallow {**a, **b} would replace whole sections.
        updated_settings = _deep_merge_settings(current_settings, settings_update)

        # The merge keeps every key the row already had, which is right for a
        # partial PATCH and wrong for the OAuth client credentials the email
        # section no longer has a field for: nothing reads them, but a merge
        # would carry the encrypted secret forward on every save. Prune them
        # once the section is being written anyway.
        email_section = updated_settings.get("email_service")
        if "email_service" in settings_update and isinstance(email_section, dict):
            for legacy_key in _LEGACY_EMAIL_OAUTH_FIELDS:
                email_section.pop(legacy_key, None)

        # SEC: Encrypt secret fields before persisting to the database
        updated_settings = encrypt_settings_secrets(updated_settings)

        org.settings = updated_settings
        await self.db.commit()
        await self.db.refresh(org)

        # Return updated settings
        return await self.get_organization_settings(organization_id)

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

        enabled = module_settings.get_enabled_modules()

        # Safeguard: if NO configurable modules are enabled (only essential
        # ones remain), something is likely misconfigured.  Log a warning so
        # operators can investigate.
        configurable_fields = list(ModuleSettings.model_fields.keys())
        if not any(getattr(module_settings, f) for f in configurable_fields):
            logger.warning(
                "All configurable modules are disabled for org {} — "
                "users will see a minimal navigation.  Check the "
                "organization's module settings.",
                organization_id,
            )

        # Asked of org.settings *after* resolving, not of the dict we were
        # handed: the OnboardingStatus migration inside the resolver writes a
        # real configuration back, and reading the pre-resolution dict would
        # report that organization as unconfigured for one more request.
        return EnabledModulesResponse(
            enabled_modules=enabled,
            module_settings=module_settings,
            configured=self._trusted_stored_modules(org.settings or {}) is not None,
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
        # Deep copy after potential migration flush to avoid shared references
        current_settings = copy.deepcopy(org.settings or {})
        field_names = list(ModuleSettings.model_fields.keys())
        current_modules = current_settings.get(
            "modules",
            {f: getattr(resolved, f) for f in field_names},
        )

        # Merge the incoming toggles and mark as explicitly configured.
        # The resolved layer sits between the two so a field added to
        # ModuleSettings since this dict was written is persisted at its
        # resolved value rather than staying absent — otherwise the dict never
        # self-heals and every read keeps depending on the default fallback.
        updated_modules = {
            **current_modules,
            **{f: getattr(resolved, f) for f in field_names},
            **module_updates,
            "_user_configured": True,
        }
        current_settings["modules"] = updated_modules

        org.settings = current_settings
        await self.db.commit()
        await self.db.refresh(org)

        # Return updated enabled modules
        return await self.get_enabled_modules(organization_id)

    async def get_membership_id_settings(
        self, organization_id: UUID
    ) -> MembershipIdSettings:
        """Get membership ID settings for an organization."""
        org_settings = await self.get_organization_settings(organization_id)
        return org_settings.membership_id

    async def generate_next_membership_id(self, organization_id: UUID) -> Optional[str]:
        """
        Generate the next membership ID for a new member.

        Reads the org's membership_id settings (prefix + next_number),
        formats the ID, then atomically increments next_number.
        Returns None if auto-generation is disabled.
        """
        # Lock the org row FOR UPDATE so two concurrent member creations can't
        # both read the same next_number and mint duplicate membership IDs
        # (TOCTOU on the JSON counter). The lock is released at commit/rollback.
        result = await self.db.execute(
            select(Organization)
            .where(Organization.id == str(organization_id))
            .with_for_update()
        )
        org = result.scalar_one_or_none()
        if not org:
            return None

        settings_dict = copy.deepcopy(org.settings or {})
        mid = settings_dict.get("membership_id", {})

        if not mid.get("enabled") or not mid.get("auto_generate"):
            return None

        prefix = mid.get("prefix", "")
        next_number = mid.get("next_number", 1)

        # Format: prefix + zero-padded number (4 digits minimum)
        membership_id = f"{prefix}{str(next_number).zfill(4)}"

        # Verify this number isn't already in use (active members only).
        # If it is, keep incrementing until we find an unused one — but cap the
        # search so a pathological/dense ID space can't spin forever.
        max_attempts = 100_000
        attempts = 0
        while True:
            result = await self.db.execute(
                select(func.count())
                .select_from(User)
                .where(
                    User.organization_id == str(organization_id),
                    User.membership_number == membership_id,
                    User.deleted_at.is_(None),
                )
            )
            count = result.scalar() or 0
            if count == 0:
                break
            attempts += 1
            if attempts >= max_attempts:
                raise ValueError(
                    "Unable to generate a unique membership ID after "
                    f"{max_attempts} attempts"
                )
            next_number += 1
            membership_id = f"{prefix}{str(next_number).zfill(4)}"

        # Increment next_number in org settings for the next call
        mid["next_number"] = next_number + 1
        settings_dict["membership_id"] = mid
        org.settings = settings_dict
        await self.db.flush()

        return membership_id
