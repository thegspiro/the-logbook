"""
Onboarding Service

Handles first-time system setup and configuration.
This module guides users through initial setup and can be disabled once complete.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import ProgrammingError, OperationalError
from sqlalchemy import select, func
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, UTC
import secrets
import os

from app.models.onboarding import OnboardingStatus, OnboardingChecklistItem
from app.models.user import Organization, User, Role, UserStatus, OrganizationType, IdentifierType
from app.services.auth_service import AuthService
from app.core.config import settings
from app.core.audit import log_audit_event
from app.core.permissions import DEFAULT_ROLES
from app.core.constants import ROLE_IT_MANAGER, ROLE_MEMBER


class OnboardingService:
    """
    Manages the onboarding process for first-time system setup
    """

    # Define onboarding steps - aligned with frontend flow
    STEPS = [
        {
            "id": 1,
            "name": "organization",
            "title": "Organization Setup",
            "description": "Set up your fire department or emergency services organization",
            "required": True
        },
        {
            "id": 2,
            "name": "navigation",
            "title": "Navigation Layout",
            "description": "Choose your preferred navigation layout",
            "required": False
        },
        {
            "id": 3,
            "name": "email_platform",
            "title": "Email Platform",
            "description": "Select your email service provider",
            "required": False
        },
        {
            "id": 4,
            "name": "email_config",
            "title": "Email Configuration",
            "description": "Configure email settings",
            "required": False
        },
        {
            "id": 5,
            "name": "file_storage",
            "title": "File Storage",
            "description": "Choose your file storage solution",
            "required": False
        },
        {
            "id": 6,
            "name": "authentication",
            "title": "Authentication",
            "description": "Select authentication method",
            "required": False
        },
        {
            "id": 7,
            "name": "it_team",
            "title": "IT Team & Backup Access",
            "description": "Configure IT team and backup access",
            "required": False
        },
        {
            "id": 8,
            "name": "roles",
            "title": "Role Setup",
            "description": "Configure roles and permissions",
            "required": False
        },
        {
            "id": 9,
            "name": "modules",
            "title": "Select Modules",
            "description": "Choose which modules to enable for your organization",
            "required": False
        },
        {
            "id": 10,
            "name": "admin_user",
            "title": "Create Administrator",
            "description": "Create the first admin user with secure credentials",
            "required": True
        }
    ]

    def __init__(self, db: AsyncSession):
        self.db = db

    async def needs_onboarding(self) -> bool:
        """
        Check if the system needs onboarding

        Returns:
            True if onboarding is needed, False if already completed
        """
        try:
            # First, check if onboarding is explicitly marked as completed
            result = await self.db.execute(
                select(OnboardingStatus).where(OnboardingStatus.is_completed == True)
            )
            completed = result.scalar_one_or_none()

            if completed:
                return False

            # Check if there's an onboarding in progress (not completed)
            result = await self.db.execute(
                select(OnboardingStatus).where(OnboardingStatus.is_completed == False)
            )
            in_progress = result.scalar_one_or_none()

            if in_progress:
                # Onboarding is in progress, needs to continue
                return True

            # No OnboardingStatus found - check if this is a legacy installation
            # (organizations exist but no onboarding record was ever created)
            result = await self.db.execute(select(func.count(Organization.id)))
            org_count = result.scalar()

            if org_count > 0:
                # Legacy installation - auto-mark as completed
                await self._mark_legacy_completed()
                return False

            # No onboarding status and no organizations - needs onboarding
            return True
        except (ProgrammingError, OperationalError):
            # Tables don't exist yet (migrations haven't run).
            # Treat as needing onboarding — the frontend will show the
            # setup wizard, and subsequent requests will work once
            # migrations complete.
            await self.db.rollback()
            return True

    async def get_onboarding_status(self) -> Optional[OnboardingStatus]:
        """
        Get current onboarding status

        Returns:
            OnboardingStatus object or None if not started
        """
        try:
            result = await self.db.execute(
                select(OnboardingStatus).order_by(OnboardingStatus.created_at.desc()).limit(1)
            )
            return result.scalar_one_or_none()
        except (ProgrammingError, OperationalError):
            await self.db.rollback()
            return None

    async def start_onboarding(
        self,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ) -> OnboardingStatus:
        """
        Start the onboarding process

        Args:
            ip_address: IP address of user starting onboarding
            user_agent: User agent string

        Returns:
            OnboardingStatus object
        """
        # Check if already exists
        existing = await self.get_onboarding_status()
        if existing and not existing.is_completed:
            return existing

        # Create new onboarding status
        status = OnboardingStatus(
            current_step=1,
            steps_completed={},
            setup_ip_address=ip_address,
            setup_user_agent=user_agent,
        )

        self.db.add(status)
        await self.db.flush()

        return status

    async def verify_security_configuration(self) -> Dict[str, Any]:
        """
        Verify that security settings are properly configured

        Returns:
            Dictionary with verification results
        """
        issues = []
        warnings = []
        passed = True

        # Check SECRET_KEY
        if "INSECURE_DEFAULT" in settings.SECRET_KEY:
            issues.append({
                "field": "SECRET_KEY",
                "severity": "critical",
                "message": "SECRET_KEY is using the insecure default value. Generate a secure key in your .env file.",
                "fix": "Run: python -c \"import secrets; print(secrets.token_urlsafe(64))\" and set SECRET_KEY in .env"
            })
            passed = False
        elif len(settings.SECRET_KEY) < 32:
            issues.append({
                "field": "SECRET_KEY",
                "severity": "critical",
                "message": "SECRET_KEY is too short. Must be at least 32 characters.",
                "fix": "Generate a longer key with: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
            })
            passed = False

        # Check ENCRYPTION_KEY
        if "INSECURE_DEFAULT" in settings.ENCRYPTION_KEY:
            issues.append({
                "field": "ENCRYPTION_KEY",
                "severity": "critical",
                "message": "ENCRYPTION_KEY is using the insecure default value. Generate a secure key in your .env file.",
                "fix": "Run: python -c \"import secrets; print(secrets.token_hex(32))\" and set ENCRYPTION_KEY in .env"
            })
            passed = False

        # Check database password
        if settings.DB_PASSWORD == "change_me_in_production":
            issues.append({
                "field": "DB_PASSWORD",
                "severity": "critical",
                "message": "Database password is using default value",
                "fix": "Set a strong database password in .env file"
            })
            passed = False

        # Check if in production with DEBUG=True
        if settings.ENVIRONMENT == "production" and settings.DEBUG:
            warnings.append({
                "field": "DEBUG",
                "severity": "high",
                "message": "DEBUG mode is enabled in production environment",
                "fix": "Set DEBUG=false in .env file"
            })

        # Check password policy
        if settings.PASSWORD_MIN_LENGTH < 12:
            warnings.append({
                "field": "PASSWORD_MIN_LENGTH",
                "severity": "medium",
                "message": "Password minimum length is below recommended 12 characters",
                "fix": "Set PASSWORD_MIN_LENGTH=12 or higher"
            })

        # Check CORS origins
        if "*" in str(settings.ALLOWED_ORIGINS):
            warnings.append({
                "field": "ALLOWED_ORIGINS",
                "severity": "high",
                "message": "CORS is allowing all origins (*)",
                "fix": "Restrict ALLOWED_ORIGINS to specific domains"
            })

        # Safety check: if passed=False but no issues, add a generic issue
        # This prevents the UI from showing "Please fix the following errors" with empty bullets
        if not passed and len(issues) == 0:
            issues.append({
                "field": "CONFIGURATION",
                "severity": "critical",
                "message": "Security configuration check failed but no specific issues were identified. Please review logs for details.",
                "fix": "Check application logs for more information about the security validation failure."
            })

        return {
            "passed": passed,
            "issues": issues,
            "warnings": warnings,
            "total_issues": len(issues),
            "total_warnings": len(warnings),
        }

    async def create_organization(
        self,
        name: str,
        slug: str,
        organization_type: str = "fire_department",
        description: Optional[str] = None,
        settings_dict: Optional[Dict[str, Any]] = None,
        # New comprehensive fields
        timezone: str = "America/New_York",
        phone: Optional[str] = None,
        fax: Optional[str] = None,
        email: Optional[str] = None,
        website: Optional[str] = None,
        # Mailing address
        mailing_address_line1: Optional[str] = None,
        mailing_address_line2: Optional[str] = None,
        mailing_city: Optional[str] = None,
        mailing_state: Optional[str] = None,
        mailing_zip: Optional[str] = None,
        mailing_country: str = "USA",
        # Physical address
        physical_address_same: bool = True,
        physical_address_line1: Optional[str] = None,
        physical_address_line2: Optional[str] = None,
        physical_city: Optional[str] = None,
        physical_state: Optional[str] = None,
        physical_zip: Optional[str] = None,
        physical_country: str = "USA",
        # Department identifiers
        identifier_type: str = "department_id",
        fdid: Optional[str] = None,
        state_id: Optional[str] = None,
        department_id: Optional[str] = None,
        # Additional info
        county: Optional[str] = None,
        founded_year: Optional[int] = None,
        logo: Optional[str] = None,
    ) -> Organization:
        """
        Create the first organization during onboarding

        Args:
            name: Organization name
            slug: URL-friendly slug
            organization_type: Type of organization (fire_department, ems_only, fire_ems_combined)
            description: Optional description
            settings_dict: Optional organization settings
            timezone: Organization timezone (e.g., America/New_York)
            phone: Main phone number
            fax: Fax number
            email: Main contact email
            website: Organization website URL
            mailing_address_*: Mailing address fields
            physical_address_same: Whether physical address is same as mailing
            physical_address_*: Physical address fields (if different)
            identifier_type: Type of identifier (fdid, state_id, department_id)
            fdid: Fire Department ID (NFIRS)
            state_id: State license/certification number
            department_id: Internal department ID
            county: County/jurisdiction
            founded_year: Year organization was founded
            logo: Logo as base64 data URL or external URL

            Note: EIN/tax_id can be added later via organization settings when
            enabling the Financial or Reports module.

        Returns:
            Created Organization object
        """
        # Validate slug is URL-safe
        if not slug.replace("-", "").replace("_", "").isalnum():
            raise ValueError("Slug must contain only letters, numbers, hyphens, and underscores")

        # Check if organization already exists
        result = await self.db.execute(
            select(Organization).where(Organization.slug == slug)
        )
        existing = result.scalar_one_or_none()
        if existing:
            raise ValueError(f"Organization with slug '{slug}' already exists")

        # Map organization type string to enum
        org_type_enum = OrganizationType.FIRE_DEPARTMENT
        if organization_type == "ems_only":
            org_type_enum = OrganizationType.EMS_ONLY
        elif organization_type == "fire_ems_combined":
            org_type_enum = OrganizationType.FIRE_EMS_COMBINED

        # Map identifier type string to enum
        id_type_enum = IdentifierType.DEPARTMENT_ID
        if identifier_type == "fdid":
            id_type_enum = IdentifierType.FDID
        elif identifier_type == "state_id":
            id_type_enum = IdentifierType.STATE_ID

        # Create organization with all fields
        org = Organization(
            name=name,
            slug=slug,
            organization_type=org_type_enum,
            type=organization_type,  # Keep legacy field for compatibility
            description=description,
            settings=settings_dict or {},
            active=True,
            # Timezone
            timezone=timezone,
            # Contact info
            phone=phone,
            fax=fax,
            email=email,
            website=website,
            # Mailing address
            mailing_address_line1=mailing_address_line1,
            mailing_address_line2=mailing_address_line2,
            mailing_city=mailing_city,
            mailing_state=mailing_state,
            mailing_zip=mailing_zip,
            mailing_country=mailing_country,
            # Physical address
            physical_address_same=physical_address_same,
            physical_address_line1=physical_address_line1,
            physical_address_line2=physical_address_line2,
            physical_city=physical_city,
            physical_state=physical_state,
            physical_zip=physical_zip,
            physical_country=physical_country,
            # Identifiers
            identifier_type=id_type_enum,
            fdid=fdid,
            state_id=state_id,
            department_id=department_id,
            # Additional info
            county=county,
            founded_year=founded_year,
            logo=logo,
        )

        self.db.add(org)
        await self.db.flush()
        await self.db.refresh(org)  # Refresh to load all attributes properly

        # Create default roles for organization
        await self._create_default_roles(org.id)

        # Update onboarding status
        status = await self.get_onboarding_status()
        if status:
            status.organization_name = name
            status.organization_type = organization_type
            await self._mark_step_completed(status, 1, "organization")  # Now Step 1

        return org

    async def _create_default_roles(self, organization_id: str):
        """Create default positions for an organization.

        Uses DEFAULT_POSITIONS from permissions.py as the single source of truth.
        The it_manager position (priority 100, all permissions) serves as
        the System Owner position for the person who sets up the platform.
        The user may later customize which positions to keep during the PositionSetup
        onboarding step.
        """
        # Create all positions from the central DEFAULT_POSITIONS registry
        for slug, role_data in DEFAULT_ROLES.items():
            role = Role(
                organization_id=organization_id,
                name=role_data["name"],
                slug=slug,
                description=role_data["description"],
                permissions=role_data["permissions"],
                is_system=role_data.get("is_system", True),
                priority=role_data["priority"],
            )
            self.db.add(role)

        await self.db.flush()

    # Backward-compatible alias
    async def create_admin_user(self, **kwargs) -> "User":
        return await self.create_system_owner(**kwargs)

    async def create_system_owner(
        self,
        organization_id: str,
        username: str,
        email: str,
        password: str,
        first_name: str,
        last_name: str,
        badge_number: Optional[str] = None
    ) -> User:
        """
        Create the System Owner (IT Manager) user

        This is the first user created during onboarding. They receive
        the ``it_manager`` position with wildcard permissions.

        Args:
            organization_id: Organization UUID
            username: Username
            email: Email address
            password: Plain text password (will be hashed)
            first_name: First name
            last_name: Last name
            badge_number: Optional badge number

        Returns:
            Created User object
        """
        # Use AuthService to create user with proper password hashing
        auth_service = AuthService(self.db)

        user, error = await auth_service.register_user(
            organization_id=organization_id,
            username=username,
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
            badge_number=badge_number
        )

        if error or not user:
            raise ValueError(error or "Failed to create System Owner user")

        # Assign IT Manager position — the System Owner position for the
        # person who sets up the platform.  This position carries wildcard
        # "*" permissions granting full access.
        result = await self.db.execute(
            select(Role).where(
                Role.organization_id == organization_id,
                Role.slug == ROLE_IT_MANAGER
            )
        )
        it_manager_position = result.scalar_one_or_none()

        if it_manager_position:
            # Refresh user with positions relationship loaded to avoid MissingGreenlet error
            await self.db.refresh(user, ['positions'])
            user.positions.append(it_manager_position)
            await self.db.flush()

        # Also assign the default "member" position
        member_result = await self.db.execute(
            select(Role).where(
                Role.organization_id == organization_id,
                Role.slug == ROLE_MEMBER
            )
        )
        member_position = member_result.scalar_one_or_none()
        if member_position and member_position not in user.positions:
            user.positions.append(member_position)
            await self.db.flush()

        # Update onboarding status
        status = await self.get_onboarding_status()
        if status:
            status.admin_email = email
            status.admin_username = username
            await self._mark_step_completed(status, 10, "admin_user")  # Step 10 in new flow

        # Log event
        await log_audit_event(
            db=self.db,
            event_type="onboarding.admin_created",
            event_category="onboarding",
            severity="INFO",
            user_id=str(user.id),
            username=username,
            event_data={
                "organization_id": organization_id,
                "email": email
            }
        )

        return user

    async def configure_modules(
        self,
        enabled_modules: List[str]
    ) -> Dict[str, bool]:
        """
        Configure which modules are enabled.

        Writes to **both** OnboardingStatus.enabled_modules (for onboarding
        state tracking) and Organization.settings.modules (the canonical
        source of truth used by the rest of the application).

        Args:
            enabled_modules: List of module names to enable

        Returns:
            Dictionary of module name to enabled status
        """
        # Core modules are always enabled — they power cross-module features
        core_modules = ["members", "events", "documents", "forms"]

        # Define available modules - must match API endpoint and frontend module registry
        available_modules = [
            # Core modules (always enabled)
            *core_modules,
            # Operations modules
            "training", "inventory", "scheduling", "apparatus", "facilities",
            # Governance modules
            "elections", "minutes", "reports",
            # Communication modules
            "notifications", "mobile",
            # Advanced modules
            "integrations",
            # Membership
            "prospective_members",
            # Legacy/additional modules (for backwards compatibility)
            "compliance", "meetings", "fundraising", "incidents",
            "equipment", "vehicles", "budget"
        ]

        # Validate modules
        invalid_modules = [m for m in enabled_modules if m not in available_modules]
        if invalid_modules:
            raise ValueError(f"Invalid modules: {', '.join(invalid_modules)}")

        # Ensure core modules are always included
        final_modules = list(set(enabled_modules) | set(core_modules))

        # Update onboarding status
        status = await self.get_onboarding_status()
        if status:
            status.enabled_modules = final_modules
            await self._mark_step_completed(status, 9, "modules")  # Step 9 in new flow

        # ── Also persist to Organization.settings.modules (canonical store) ──
        # Configurable module keys that the Settings page manages
        configurable_keys = [
            "training", "inventory", "scheduling", "elections", "minutes",
            "reports", "notifications", "mobile", "forms", "integrations",
            "facilities",
        ]
        modules_dict = {k: k in final_modules for k in configurable_keys}

        result = await self.db.execute(select(Organization).limit(1))
        org = result.scalar_one_or_none()
        if org:
            settings_dict = dict(org.settings or {})
            settings_dict["modules"] = modules_dict
            org.settings = settings_dict
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(org, "settings")
            await self.db.flush()

        return {module: module in final_modules for module in available_modules}

    async def verify_database_connection(self) -> Dict[str, Any]:
        """
        Verify database connectivity and configuration

        Returns:
            Dictionary with connection status
        """
        try:
            # Test query
            result = await self.db.execute(select(func.now()))
            db_time = result.scalar()

            # Check table existence
            result = await self.db.execute(
                select(func.count()).select_from(Organization)
            )
            org_count = result.scalar()

            return {
                "connected": True,
                "database": settings.DB_NAME,
                "host": settings.DB_HOST,
                "port": settings.DB_PORT,
                "server_time": str(db_time),
                "organizations_count": org_count,
                "charset": settings.DB_CHARSET
            }
        except Exception as e:
            return {
                "connected": False,
                "error": str(e),
                "database": settings.DB_NAME,
                "host": settings.DB_HOST,
                "port": settings.DB_PORT
            }

    async def complete_onboarding(
        self,
        notes: Optional[str] = None
    ) -> OnboardingStatus:
        """
        Mark onboarding as completed

        Args:
            notes: Optional notes about the setup

        Returns:
            Updated OnboardingStatus object
        """
        status = await self.get_onboarding_status()
        if not status:
            raise ValueError("Onboarding has not been started")

        if status.is_completed:
            raise ValueError("Onboarding is already completed")

        # Verify all critical steps are completed (only organization and admin_user are required)
        required_steps = ["organization", "admin_user"]
        for step in required_steps:
            step_data = status.steps_completed.get(step)
            if not step_data or not step_data.get("completed", False):
                raise ValueError(f"Required step '{step}' has not been completed")

        # Mark as completed
        status.is_completed = True
        status.completed_at = datetime.now(UTC)
        status.current_step = len(self.STEPS)
        status.setup_notes = notes

        await self.db.flush()

        # Create post-onboarding checklist
        await self._create_post_onboarding_checklist()

        # Log completion
        await log_audit_event(
            db=self.db,
            event_type="onboarding.completed",
            event_category="onboarding",
            severity="INFO",
            event_data={
                "organization": status.organization_name,
                "admin_user": status.admin_username,
                "enabled_modules": status.enabled_modules
            }
        )

        return status

    async def _mark_step_completed(
        self,
        status: OnboardingStatus,
        step_number: int,
        step_name: str
    ):
        """Mark a step as completed in onboarding status"""
        # Copy the dict so SQLAlchemy detects the JSON column mutation.
        # Assigning the same dict object back won't trigger change detection.
        steps = dict(status.steps_completed or {})
        steps[step_name] = {
            "completed": True,
            "completed_at": datetime.now(UTC).isoformat(),
            "step_number": step_number
        }
        status.steps_completed = steps
        status.current_step = step_number + 1
        await self.db.flush()

    async def _mark_legacy_completed(self):
        """Mark onboarding as completed for existing installations"""
        status = OnboardingStatus(
            is_completed=True,
            completed_at=datetime.now(UTC),
            current_step=len(self.STEPS),
            steps_completed={"legacy": True},
            setup_notes="Auto-completed for existing installation"
        )
        self.db.add(status)
        await self.db.flush()

    async def _create_post_onboarding_checklist(self):
        """Create post-onboarding checklist items"""
        checklist_items = [
            {
                "title": "Set up TLS/HTTPS certificates",
                "description": "Enable HTTPS for secure communication",
                "category": "security",
                "priority": "critical",
                "documentation_link": "https://docs.the-logbook.org/security/tls",
                "estimated_time_minutes": 60,
                "sort_order": 1
            },
            {
                "title": "Configure email notifications",
                "description": "Set up SMTP for email notifications",
                "category": "configuration",
                "priority": "high",
                "documentation_link": "https://docs.the-logbook.org/configuration/email",
                "estimated_time_minutes": 30,
                "sort_order": 2
            },
            {
                "title": "Set up automated backups",
                "description": "Configure regular database backups",
                "category": "deployment",
                "priority": "critical",
                "documentation_link": "https://docs.the-logbook.org/deployment/backups",
                "estimated_time_minutes": 45,
                "sort_order": 3
            },
            {
                "title": "Review HIPAA compliance checklist",
                "description": "Complete HIPAA compliance requirements",
                "category": "security",
                "priority": "critical",
                "documentation_link": "SECURITY.md#hipaa-compliance-checklist",
                "estimated_time_minutes": 120,
                "sort_order": 4
            },
            {
                "title": "Enable multi-factor authentication",
                "description": "Require MFA for all administrative users",
                "category": "security",
                "priority": "high",
                "documentation_link": "SECURITY.md#authentication--authorization",
                "estimated_time_minutes": 15,
                "sort_order": 5
            },
            {
                "title": "Configure firewall rules",
                "description": "Set up network security and firewall",
                "category": "security",
                "priority": "critical",
                "documentation_link": "https://docs.the-logbook.org/security/firewall",
                "estimated_time_minutes": 90,
                "sort_order": 6
            },
            {
                "title": "Set up monitoring and alerting",
                "description": "Configure system monitoring and alerts",
                "category": "deployment",
                "priority": "high",
                "documentation_link": "https://docs.the-logbook.org/deployment/monitoring",
                "estimated_time_minutes": 60,
                "sort_order": 7
            },
            {
                "title": "Train staff on security policies",
                "description": "Conduct security awareness training",
                "category": "security",
                "priority": "high",
                "documentation_link": "SECURITY.md",
                "estimated_time_minutes": 180,
                "sort_order": 8
            },
            {
                "title": "Test disaster recovery plan",
                "description": "Verify backup restoration procedures",
                "category": "deployment",
                "priority": "high",
                "documentation_link": "https://docs.the-logbook.org/deployment/disaster-recovery",
                "estimated_time_minutes": 120,
                "sort_order": 9
            },
            {
                "title": "Review and customize user roles",
                "description": "Adjust role permissions for your organization",
                "category": "configuration",
                "priority": "medium",
                "documentation_link": "https://docs.the-logbook.org/configuration/roles",
                "estimated_time_minutes": 45,
                "sort_order": 10
            }
        ]

        for item_data in checklist_items:
            item = OnboardingChecklistItem(**item_data)
            self.db.add(item)

        await self.db.flush()

    async def get_post_onboarding_checklist(self) -> List[OnboardingChecklistItem]:
        """
        Get post-onboarding checklist items

        Returns:
            List of checklist items sorted by priority and order
        """
        result = await self.db.execute(
            select(OnboardingChecklistItem).order_by(
                OnboardingChecklistItem.sort_order
            )
        )
        return result.scalars().all()

    async def get_system_info(self) -> Dict[str, Any]:
        """
        Get system information for onboarding display

        Returns:
            Dictionary with system info
        """
        return {
            "app_name": settings.APP_NAME,
            "version": settings.VERSION,
            "environment": settings.ENVIRONMENT,
            "database": {
                "type": "MySQL",
                "host": settings.DB_HOST,
                "port": settings.DB_PORT,
                "name": settings.DB_NAME
            },
            "security": {
                "password_min_length": settings.PASSWORD_MIN_LENGTH,
                "mfa_available": True,
                "session_timeout_minutes": settings.ACCESS_TOKEN_EXPIRE_MINUTES,
                "encryption": "AES-256",
                "password_hashing": "Argon2id"
            },
            "features": {
                "hipaa_compliant": True,
                "section_508_accessible": True,
                "tamper_proof_logging": True,
                "multi_factor_auth": True,
                "role_based_access": True
            }
        }
