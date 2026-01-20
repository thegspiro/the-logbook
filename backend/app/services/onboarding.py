"""
Onboarding Service

Handles first-time system setup and configuration.
This module guides users through initial setup and can be disabled once complete.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
import secrets
import os

from app.models.onboarding import OnboardingStatus, OnboardingChecklistItem
from app.models.user import Organization, User, Role, UserStatus
from app.services.auth import AuthService
from app.core.config import settings
from app.core.audit import log_audit_event


class OnboardingService:
    """
    Manages the onboarding process for first-time system setup
    """

    # Define onboarding steps
    STEPS = [
        {
            "id": 1,
            "name": "welcome",
            "title": "Welcome to The Logbook",
            "description": "Let's set up your secure intranet platform"
        },
        {
            "id": 2,
            "name": "security_check",
            "title": "Security Configuration Check",
            "description": "Verify security keys and encryption settings"
        },
        {
            "id": 3,
            "name": "organization",
            "title": "Create Your Organization",
            "description": "Set up your fire department or emergency services organization"
        },
        {
            "id": 4,
            "name": "admin_user",
            "title": "Create Administrator Account",
            "description": "Create the first admin user with secure credentials"
        },
        {
            "id": 5,
            "name": "modules",
            "title": "Select Modules",
            "description": "Choose which modules to enable for your organization"
        },
        {
            "id": 6,
            "name": "notifications",
            "title": "Configure Notifications",
            "description": "Set up email and SMS notifications (optional)"
        },
        {
            "id": 7,
            "name": "review",
            "title": "Review & Complete",
            "description": "Review your configuration and complete setup"
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
        # Check if onboarding status exists
        result = await self.db.execute(
            select(OnboardingStatus).where(OnboardingStatus.is_completed == True)
        )
        completed = result.scalar_one_or_none()

        if completed:
            return False

        # Also check if any organizations exist
        result = await self.db.execute(select(func.count(Organization.id)))
        org_count = result.scalar()

        # If organizations exist, assume onboarding was done (legacy)
        if org_count > 0:
            # Auto-mark as completed
            await self._mark_legacy_completed()
            return False

        return True

    async def get_onboarding_status(self) -> Optional[OnboardingStatus]:
        """
        Get current onboarding status

        Returns:
            OnboardingStatus object or None if not started
        """
        result = await self.db.execute(
            select(OnboardingStatus).order_by(OnboardingStatus.created_at.desc()).limit(1)
        )
        return result.scalar_one_or_none()

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
        await self.db.commit()
        await self.db.refresh(status)

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
        if settings.SECRET_KEY == "change_me_to_random_64_character_string":
            issues.append({
                "field": "SECRET_KEY",
                "severity": "critical",
                "message": "SECRET_KEY is using default value. Generate a secure key immediately!",
                "fix": "Run: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
            })
            passed = False
        elif len(settings.SECRET_KEY) < 32:
            issues.append({
                "field": "SECRET_KEY",
                "severity": "critical",
                "message": "SECRET_KEY is too short. Must be at least 32 characters.",
                "fix": "Generate a longer key"
            })
            passed = False

        # Check ENCRYPTION_KEY
        if settings.ENCRYPTION_KEY == "change_me_to_32_byte_hex_string":
            issues.append({
                "field": "ENCRYPTION_KEY",
                "severity": "critical",
                "message": "ENCRYPTION_KEY is using default value. Generate a secure key!",
                "fix": "Run: python -c \"import secrets; print(secrets.token_hex(32))\""
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
        settings_dict: Optional[Dict[str, Any]] = None
    ) -> Organization:
        """
        Create the first organization during onboarding

        Args:
            name: Organization name
            slug: URL-friendly slug
            organization_type: Type of organization
            description: Optional description
            settings_dict: Optional organization settings

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

        # Create organization
        org = Organization(
            name=name,
            slug=slug,
            type=organization_type,
            description=description,
            settings=settings_dict or {},
            active=True
        )

        self.db.add(org)
        await self.db.commit()
        await self.db.refresh(org)

        # Create default roles for organization
        await self._create_default_roles(org.id)

        # Update onboarding status
        status = await self.get_onboarding_status()
        if status:
            status.organization_name = name
            status.organization_type = organization_type
            await self._mark_step_completed(status, 3, "organization")

        return org

    async def _create_default_roles(self, organization_id: str):
        """Create default roles for an organization"""
        default_roles = [
            {
                "name": "Super Administrator",
                "slug": "super_admin",
                "description": "Full system access and management",
                "permissions": ["*"],  # All permissions
                "is_system": True,
                "priority": 100
            },
            {
                "name": "Administrator",
                "slug": "admin",
                "description": "Organization management and user administration",
                "permissions": [
                    "users.*", "roles.*", "settings.*", "modules.*",
                    "documents.*", "calendar.*", "communications.*"
                ],
                "is_system": True,
                "priority": 90
            },
            {
                "name": "Chief",
                "slug": "chief",
                "description": "Department chief with full operational access",
                "permissions": [
                    "users.view", "users.edit",
                    "documents.*", "calendar.*", "training.*",
                    "inventory.*", "incidents.*", "reports.view"
                ],
                "is_system": True,
                "priority": 80
            },
            {
                "name": "Officer",
                "slug": "officer",
                "description": "Officer with elevated permissions",
                "permissions": [
                    "users.view", "documents.*", "calendar.*",
                    "training.view", "training.edit", "inventory.view",
                    "incidents.*"
                ],
                "is_system": True,
                "priority": 70
            },
            {
                "name": "Member",
                "slug": "member",
                "description": "Regular member with standard access",
                "permissions": [
                    "users.view_own", "documents.view", "calendar.view",
                    "training.view_own", "communications.view"
                ],
                "is_system": True,
                "priority": 50
            },
            {
                "name": "Probationary",
                "slug": "probationary",
                "description": "Probationary member with limited access",
                "permissions": [
                    "users.view_own", "documents.view_public",
                    "calendar.view", "communications.view"
                ],
                "is_system": True,
                "priority": 30
            }
        ]

        for role_data in default_roles:
            role = Role(
                organization_id=organization_id,
                **role_data
            )
            self.db.add(role)

        await self.db.commit()

    async def create_admin_user(
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
        Create the first administrator user

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

        user = await auth_service.register_user(
            organization_id=organization_id,
            username=username,
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
            badge_number=badge_number
        )

        # Assign Super Admin role
        result = await self.db.execute(
            select(Role).where(
                Role.organization_id == organization_id,
                Role.slug == "super_admin"
            )
        )
        super_admin_role = result.scalar_one_or_none()

        if super_admin_role:
            user.roles.append(super_admin_role)
            await self.db.commit()

        # Update onboarding status
        status = await self.get_onboarding_status()
        if status:
            status.admin_email = email
            status.admin_username = username
            await self._mark_step_completed(status, 4, "admin_user")

        # Log event
        await log_audit_event(
            db=self.db,
            event_type="onboarding.admin_created",
            event_category="onboarding",
            severity="info",
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
        Configure which modules are enabled

        Args:
            enabled_modules: List of module names to enable

        Returns:
            Dictionary of module name to enabled status
        """
        # Define available modules
        available_modules = [
            "training", "compliance", "scheduling", "inventory",
            "meetings", "elections", "fundraising", "incidents",
            "equipment", "vehicles", "budget"
        ]

        # Validate modules
        invalid_modules = [m for m in enabled_modules if m not in available_modules]
        if invalid_modules:
            raise ValueError(f"Invalid modules: {', '.join(invalid_modules)}")

        # Update onboarding status
        status = await self.get_onboarding_status()
        if status:
            status.enabled_modules = enabled_modules
            await self._mark_step_completed(status, 5, "modules")

        return {module: module in enabled_modules for module in available_modules}

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

        # Verify all critical steps are completed
        required_steps = ["security_check", "organization", "admin_user"]
        for step in required_steps:
            if not status.steps_completed.get(step, False):
                raise ValueError(f"Required step '{step}' has not been completed")

        # Mark as completed
        status.is_completed = True
        status.completed_at = datetime.utcnow()
        status.current_step = len(self.STEPS)
        status.setup_notes = notes

        await self.db.commit()

        # Create post-onboarding checklist
        await self._create_post_onboarding_checklist()

        # Log completion
        await log_audit_event(
            db=self.db,
            event_type="onboarding.completed",
            event_category="onboarding",
            severity="info",
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
        steps = status.steps_completed or {}
        steps[step_name] = {
            "completed": True,
            "completed_at": datetime.utcnow().isoformat(),
            "step_number": step_number
        }
        status.steps_completed = steps
        status.current_step = step_number + 1
        await self.db.commit()

    async def _mark_legacy_completed(self):
        """Mark onboarding as completed for existing installations"""
        status = OnboardingStatus(
            is_completed=True,
            completed_at=datetime.utcnow(),
            current_step=len(self.STEPS),
            steps_completed={"legacy": True},
            setup_notes="Auto-completed for existing installation"
        )
        self.db.add(status)
        await self.db.commit()

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

        await self.db.commit()

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
                "session_timeout_minutes": settings.ACCESS_TOKEN_EXPIRE_MINUTES // 60,
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
