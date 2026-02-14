"""
Permission System

Defines the permission taxonomy and constants for the application.
"""

from typing import Dict, List
from enum import Enum


class PermissionCategory(str, Enum):
    """Categories of permissions"""
    ADMIN = "admin"
    USERS = "users"
    ROLES = "roles"
    ORGANIZATION = "organization"
    SETTINGS = "settings"
    MEMBERS = "members"
    TRAINING = "training"
    COMPLIANCE = "compliance"
    SCHEDULING = "scheduling"
    INVENTORY = "inventory"
    MEETINGS = "meetings"
    MINUTES = "minutes"
    ELECTIONS = "elections"
    FUNDRAISING = "fundraising"
    AUDIT = "audit"
    EVENTS = "events"
    LOCATIONS = "locations"
    FORMS = "forms"
    DOCUMENTS = "documents"
    APPARATUS = "apparatus"
    ANALYTICS = "analytics"
    INTEGRATIONS = "integrations"
    NOTIFICATIONS = "notifications"
    REPORTS = "reports"


class Permission:
    """Permission definition"""
    def __init__(self, name: str, description: str, category: PermissionCategory):
        self.name = name
        self.description = description
        self.category = category

    def __str__(self):
        return self.name


# ============================================
# User & Member Management Permissions
# ============================================

USERS_VIEW = Permission("users.view", "View user list", PermissionCategory.USERS)
USERS_CREATE = Permission("users.create", "Create new users", PermissionCategory.USERS)
USERS_EDIT = Permission("users.edit", "Edit user information", PermissionCategory.USERS)
USERS_DELETE = Permission("users.delete", "Delete users", PermissionCategory.USERS)
USERS_VIEW_CONTACT = Permission("users.view_contact", "View user contact information", PermissionCategory.USERS)
USERS_UPDATE_ROLES = Permission("users.update_roles", "Update user roles", PermissionCategory.USERS)

MEMBERS_VIEW = Permission("members.view", "View member list", PermissionCategory.MEMBERS)
MEMBERS_MANAGE = Permission("members.manage", "Manage member profiles", PermissionCategory.MEMBERS)
MEMBERS_ASSIGN_ROLES = Permission("members.assign_roles", "Assign roles to members", PermissionCategory.MEMBERS)

# ============================================
# Role Management Permissions
# ============================================

ROLES_VIEW = Permission("roles.view", "View roles", PermissionCategory.ROLES)
ROLES_CREATE = Permission("roles.create", "Create new roles", PermissionCategory.ROLES)
ROLES_EDIT = Permission("roles.edit", "Edit roles", PermissionCategory.ROLES)
ROLES_UPDATE = Permission("roles.update", "Update roles", PermissionCategory.ROLES)
ROLES_DELETE = Permission("roles.delete", "Delete roles", PermissionCategory.ROLES)
ROLES_MANAGE_PERMISSIONS = Permission("roles.manage_permissions", "Manage role permissions", PermissionCategory.ROLES)

# ============================================
# Organization & Settings Permissions
# ============================================

ORGANIZATION_VIEW = Permission("organization.view", "View organization info", PermissionCategory.ORGANIZATION)
ORGANIZATION_EDIT = Permission("organization.edit", "Edit organization info", PermissionCategory.ORGANIZATION)
ORGANIZATION_UPDATE_SETTINGS = Permission("organization.update_settings", "Update organization settings", PermissionCategory.ORGANIZATION)

SETTINGS_VIEW = Permission("settings.view", "View settings", PermissionCategory.SETTINGS)
SETTINGS_EDIT = Permission("settings.edit", "Edit settings", PermissionCategory.SETTINGS)
SETTINGS_MANAGE_CONTACT_VISIBILITY = Permission("settings.manage_contact_visibility", "Manage contact info visibility", PermissionCategory.SETTINGS)

# ============================================
# Module-Specific Permissions
# ============================================

# Training
TRAINING_VIEW = Permission("training.view", "View training records", PermissionCategory.TRAINING)
TRAINING_MANAGE = Permission("training.manage", "Manage training records", PermissionCategory.TRAINING)

# Compliance
COMPLIANCE_VIEW = Permission("compliance.view", "View compliance records", PermissionCategory.COMPLIANCE)
COMPLIANCE_MANAGE = Permission("compliance.manage", "Manage compliance records", PermissionCategory.COMPLIANCE)

# Scheduling
SCHEDULING_VIEW = Permission("scheduling.view", "View schedules", PermissionCategory.SCHEDULING)
SCHEDULING_MANAGE = Permission("scheduling.manage", "Manage schedules", PermissionCategory.SCHEDULING)

# Inventory
INVENTORY_VIEW = Permission("inventory.view", "View inventory", PermissionCategory.INVENTORY)
INVENTORY_MANAGE = Permission("inventory.manage", "Manage inventory", PermissionCategory.INVENTORY)

# Meetings
MEETINGS_VIEW = Permission("meetings.view", "View meetings", PermissionCategory.MEETINGS)
MEETINGS_MANAGE = Permission("meetings.manage", "Manage meetings", PermissionCategory.MEETINGS)

# Elections
ELECTIONS_VIEW = Permission("elections.view", "View elections", PermissionCategory.ELECTIONS)
ELECTIONS_MANAGE = Permission("elections.manage", "Manage elections", PermissionCategory.ELECTIONS)

# Fundraising
FUNDRAISING_VIEW = Permission("fundraising.view", "View fundraising data", PermissionCategory.FUNDRAISING)
FUNDRAISING_MANAGE = Permission("fundraising.manage", "Manage fundraising", PermissionCategory.FUNDRAISING)

# Audit
AUDIT_VIEW = Permission("audit.view", "View audit logs", PermissionCategory.AUDIT)
AUDIT_EXPORT = Permission("audit.export", "Export audit logs", PermissionCategory.AUDIT)

# Events
EVENTS_VIEW = Permission("events.view", "View events", PermissionCategory.EVENTS)
EVENTS_CREATE = Permission("events.create", "Create events", PermissionCategory.EVENTS)
EVENTS_EDIT = Permission("events.edit", "Edit events", PermissionCategory.EVENTS)
EVENTS_DELETE = Permission("events.delete", "Delete events", PermissionCategory.EVENTS)
EVENTS_MANAGE = Permission("events.manage", "Manage all events", PermissionCategory.EVENTS)

# Locations
LOCATIONS_VIEW = Permission("locations.view", "View locations", PermissionCategory.LOCATIONS)
LOCATIONS_CREATE = Permission("locations.create", "Create locations", PermissionCategory.LOCATIONS)
LOCATIONS_EDIT = Permission("locations.edit", "Edit locations", PermissionCategory.LOCATIONS)
LOCATIONS_DELETE = Permission("locations.delete", "Delete locations", PermissionCategory.LOCATIONS)
LOCATIONS_MANAGE = Permission("locations.manage", "Manage all locations", PermissionCategory.LOCATIONS)

# Forms
FORMS_VIEW = Permission("forms.view", "View forms and submissions", PermissionCategory.FORMS)
FORMS_MANAGE = Permission("forms.manage", "Create, edit, and manage forms", PermissionCategory.FORMS)

# Admin
ADMIN_ACCESS = Permission("admin.access", "Full administrative access", PermissionCategory.ADMIN)

# Minutes
MINUTES_VIEW = Permission("minutes.view", "View meeting minutes", PermissionCategory.MINUTES)
MINUTES_MANAGE = Permission("minutes.manage", "Create, edit, and manage meeting minutes", PermissionCategory.MINUTES)

# Documents
DOCUMENTS_VIEW = Permission("documents.view", "View documents", PermissionCategory.DOCUMENTS)
DOCUMENTS_MANAGE = Permission("documents.manage", "Manage documents and folders", PermissionCategory.DOCUMENTS)

# Apparatus
APPARATUS_VIEW = Permission("apparatus.view", "View apparatus and fleet information", PermissionCategory.APPARATUS)
APPARATUS_CREATE = Permission("apparatus.create", "Create new apparatus records", PermissionCategory.APPARATUS)
APPARATUS_EDIT = Permission("apparatus.edit", "Edit apparatus records", PermissionCategory.APPARATUS)
APPARATUS_DELETE = Permission("apparatus.delete", "Delete apparatus records", PermissionCategory.APPARATUS)
APPARATUS_MAINTENANCE = Permission("apparatus.maintenance", "Log and manage maintenance records", PermissionCategory.APPARATUS)
APPARATUS_MANAGE = Permission("apparatus.manage", "Full apparatus and fleet management", PermissionCategory.APPARATUS)

# Analytics
ANALYTICS_VIEW = Permission("analytics.view", "View analytics and dashboards", PermissionCategory.ANALYTICS)

# Integrations
INTEGRATIONS_MANAGE = Permission("integrations.manage", "Manage third-party integrations", PermissionCategory.INTEGRATIONS)

# Notifications
NOTIFICATIONS_VIEW = Permission("notifications.view", "View notifications", PermissionCategory.NOTIFICATIONS)
NOTIFICATIONS_MANAGE = Permission("notifications.manage", "Manage notification rules", PermissionCategory.NOTIFICATIONS)

# Reports
REPORTS_VIEW = Permission("reports.view", "View and generate reports", PermissionCategory.REPORTS)

# Members (additional)
MEMBERS_CREATE = Permission("members.create", "Create new members", PermissionCategory.MEMBERS)

# Training (additional)
TRAINING_VIEW_ALL = Permission("training.view_all", "View all training records across organization", PermissionCategory.TRAINING)


# ============================================
# All Permissions Registry
# ============================================

ALL_PERMISSIONS: List[Permission] = [
    # Users & Members
    USERS_VIEW,
    USERS_CREATE,
    USERS_EDIT,
    USERS_DELETE,
    USERS_VIEW_CONTACT,
    USERS_UPDATE_ROLES,
    MEMBERS_VIEW,
    MEMBERS_MANAGE,
    MEMBERS_ASSIGN_ROLES,

    # Roles
    ROLES_VIEW,
    ROLES_CREATE,
    ROLES_EDIT,
    ROLES_UPDATE,
    ROLES_DELETE,
    ROLES_MANAGE_PERMISSIONS,

    # Organization & Settings
    ORGANIZATION_VIEW,
    ORGANIZATION_EDIT,
    ORGANIZATION_UPDATE_SETTINGS,
    SETTINGS_VIEW,
    SETTINGS_EDIT,
    SETTINGS_MANAGE_CONTACT_VISIBILITY,

    # Modules
    TRAINING_VIEW,
    TRAINING_MANAGE,
    COMPLIANCE_VIEW,
    COMPLIANCE_MANAGE,
    SCHEDULING_VIEW,
    SCHEDULING_MANAGE,
    INVENTORY_VIEW,
    INVENTORY_MANAGE,
    MEETINGS_VIEW,
    MEETINGS_MANAGE,
    ELECTIONS_VIEW,
    ELECTIONS_MANAGE,
    FUNDRAISING_VIEW,
    FUNDRAISING_MANAGE,
    AUDIT_VIEW,
    AUDIT_EXPORT,

    # Events
    EVENTS_VIEW,
    EVENTS_CREATE,
    EVENTS_EDIT,
    EVENTS_DELETE,
    EVENTS_MANAGE,

    # Locations
    LOCATIONS_VIEW,
    LOCATIONS_CREATE,
    LOCATIONS_EDIT,
    LOCATIONS_DELETE,
    LOCATIONS_MANAGE,

    # Forms
    FORMS_VIEW,
    FORMS_MANAGE,

    # Admin
    ADMIN_ACCESS,

    # Minutes
    MINUTES_VIEW,
    MINUTES_MANAGE,

    # Documents
    DOCUMENTS_VIEW,
    DOCUMENTS_MANAGE,

    # Apparatus
    APPARATUS_VIEW,
    APPARATUS_CREATE,
    APPARATUS_EDIT,
    APPARATUS_DELETE,
    APPARATUS_MAINTENANCE,
    APPARATUS_MANAGE,

    # Analytics
    ANALYTICS_VIEW,

    # Integrations
    INTEGRATIONS_MANAGE,

    # Notifications
    NOTIFICATIONS_VIEW,
    NOTIFICATIONS_MANAGE,

    # Reports
    REPORTS_VIEW,

    # Members (additional)
    MEMBERS_CREATE,

    # Training (additional)
    TRAINING_VIEW_ALL,
]


def get_all_permissions() -> List[str]:
    """Get list of all permission names"""
    return [p.name for p in ALL_PERMISSIONS]


def get_permissions_by_category() -> Dict[str, List[Permission]]:
    """Get permissions grouped by category"""
    categorized = {}
    for permission in ALL_PERMISSIONS:
        category = permission.category.value
        if category not in categorized:
            categorized[category] = []
        categorized[category].append(permission)
    return categorized


def get_permission_details() -> List[Dict[str, str]]:
    """Get permission details for API responses"""
    return [
        {
            "name": p.name,
            "description": p.description,
            "category": p.category.value
        }
        for p in ALL_PERMISSIONS
    ]


# ============================================
# Default Role Definitions
# ============================================

DEFAULT_ROLES = {
    "it_administrator": {
        "name": "IT Administrator",
        "slug": "it_administrator",
        "description": "Full system access for IT administration",
        "is_system": True,
        "priority": 100,
        "permissions": ["*"],  # Wildcard grants all current and future permissions
    },
    "chief": {
        "name": "Chief",
        "slug": "chief",
        "description": "Fire chief with full administrative access (equal to President)",
        "is_system": True,
        "priority": 95,
        "permissions": [
            USERS_VIEW.name,
            USERS_EDIT.name,
            USERS_VIEW_CONTACT.name,
            USERS_UPDATE_ROLES.name,
            MEMBERS_VIEW.name,
            MEMBERS_MANAGE.name,
            MEMBERS_ASSIGN_ROLES.name,
            ROLES_VIEW.name,
            ROLES_CREATE.name,
            ROLES_EDIT.name,
            ROLES_UPDATE.name,
            ROLES_MANAGE_PERMISSIONS.name,
            ORGANIZATION_VIEW.name,
            ORGANIZATION_EDIT.name,
            ORGANIZATION_UPDATE_SETTINGS.name,
            SETTINGS_VIEW.name,
            SETTINGS_EDIT.name,
            SETTINGS_MANAGE_CONTACT_VISIBILITY.name,
            TRAINING_VIEW.name,
            TRAINING_MANAGE.name,
            COMPLIANCE_VIEW.name,
            COMPLIANCE_MANAGE.name,
            SCHEDULING_VIEW.name,
            SCHEDULING_MANAGE.name,
            INVENTORY_VIEW.name,
            INVENTORY_MANAGE.name,
            MEETINGS_VIEW.name,
            MEETINGS_MANAGE.name,
            FUNDRAISING_VIEW.name,
            FUNDRAISING_MANAGE.name,
            AUDIT_VIEW.name,
            AUDIT_EXPORT.name,
            EVENTS_VIEW.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            EVENTS_DELETE.name,
            EVENTS_MANAGE.name,
            LOCATIONS_VIEW.name,
            LOCATIONS_CREATE.name,
            LOCATIONS_EDIT.name,
            LOCATIONS_DELETE.name,
            LOCATIONS_MANAGE.name,
            FORMS_VIEW.name,
            FORMS_MANAGE.name,
            MINUTES_VIEW.name,
            MINUTES_MANAGE.name,
            DOCUMENTS_VIEW.name,
            DOCUMENTS_MANAGE.name,
            APPARATUS_VIEW.name,
            APPARATUS_CREATE.name,
            APPARATUS_EDIT.name,
            APPARATUS_DELETE.name,
            APPARATUS_MAINTENANCE.name,
            APPARATUS_MANAGE.name,
            ANALYTICS_VIEW.name,
            INTEGRATIONS_MANAGE.name,
            NOTIFICATIONS_VIEW.name,
            NOTIFICATIONS_MANAGE.name,
            REPORTS_VIEW.name,
            MEMBERS_CREATE.name,
            TRAINING_VIEW_ALL.name,
        ],
    },
    "assistant_chief": {
        "name": "Assistant Chief",
        "slug": "assistant_chief",
        "description": "Assistant fire chief with broad administrative access",
        "is_system": True,
        "priority": 90,
        "permissions": [
            USERS_VIEW.name,
            USERS_EDIT.name,
            USERS_VIEW_CONTACT.name,
            USERS_UPDATE_ROLES.name,
            MEMBERS_VIEW.name,
            MEMBERS_MANAGE.name,
            MEMBERS_ASSIGN_ROLES.name,
            ROLES_VIEW.name,
            ORGANIZATION_VIEW.name,
            SETTINGS_VIEW.name,
            TRAINING_VIEW.name,
            TRAINING_MANAGE.name,
            COMPLIANCE_VIEW.name,
            COMPLIANCE_MANAGE.name,
            SCHEDULING_VIEW.name,
            SCHEDULING_MANAGE.name,
            INVENTORY_VIEW.name,
            INVENTORY_MANAGE.name,
            MEETINGS_VIEW.name,
            MEETINGS_MANAGE.name,
            AUDIT_VIEW.name,
            EVENTS_VIEW.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            EVENTS_MANAGE.name,
            LOCATIONS_VIEW.name,
            LOCATIONS_CREATE.name,
            LOCATIONS_EDIT.name,
            LOCATIONS_MANAGE.name,
            FORMS_VIEW.name,
            FORMS_MANAGE.name,
            MINUTES_VIEW.name,
            MINUTES_MANAGE.name,
            DOCUMENTS_VIEW.name,
            DOCUMENTS_MANAGE.name,
            APPARATUS_VIEW.name,
            APPARATUS_CREATE.name,
            APPARATUS_EDIT.name,
            APPARATUS_DELETE.name,
            APPARATUS_MAINTENANCE.name,
            APPARATUS_MANAGE.name,
            ANALYTICS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
            NOTIFICATIONS_MANAGE.name,
            REPORTS_VIEW.name,
            TRAINING_VIEW_ALL.name,
        ],
    },
    "president": {
        "name": "President",
        "slug": "president",
        "description": "Organization president with full administrative access (equal to Chief)",
        "is_system": True,
        "priority": 95,
        "permissions": [
            USERS_VIEW.name,
            USERS_EDIT.name,
            USERS_VIEW_CONTACT.name,
            USERS_UPDATE_ROLES.name,
            MEMBERS_VIEW.name,
            MEMBERS_MANAGE.name,
            MEMBERS_ASSIGN_ROLES.name,
            ROLES_VIEW.name,
            ROLES_CREATE.name,
            ROLES_EDIT.name,
            ROLES_UPDATE.name,
            ROLES_MANAGE_PERMISSIONS.name,
            ORGANIZATION_VIEW.name,
            ORGANIZATION_EDIT.name,
            ORGANIZATION_UPDATE_SETTINGS.name,
            SETTINGS_VIEW.name,
            SETTINGS_EDIT.name,
            SETTINGS_MANAGE_CONTACT_VISIBILITY.name,
            TRAINING_VIEW.name,
            TRAINING_MANAGE.name,
            COMPLIANCE_VIEW.name,
            COMPLIANCE_MANAGE.name,
            SCHEDULING_VIEW.name,
            SCHEDULING_MANAGE.name,
            INVENTORY_VIEW.name,
            INVENTORY_MANAGE.name,
            MEETINGS_VIEW.name,
            MEETINGS_MANAGE.name,
            FUNDRAISING_VIEW.name,
            FUNDRAISING_MANAGE.name,
            AUDIT_VIEW.name,
            AUDIT_EXPORT.name,
            EVENTS_VIEW.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            EVENTS_DELETE.name,
            EVENTS_MANAGE.name,
            LOCATIONS_VIEW.name,
            LOCATIONS_CREATE.name,
            LOCATIONS_EDIT.name,
            LOCATIONS_DELETE.name,
            LOCATIONS_MANAGE.name,
            FORMS_VIEW.name,
            FORMS_MANAGE.name,
            MINUTES_VIEW.name,
            MINUTES_MANAGE.name,
            DOCUMENTS_VIEW.name,
            DOCUMENTS_MANAGE.name,
            APPARATUS_VIEW.name,
            APPARATUS_CREATE.name,
            APPARATUS_EDIT.name,
            APPARATUS_DELETE.name,
            APPARATUS_MAINTENANCE.name,
            APPARATUS_MANAGE.name,
            ANALYTICS_VIEW.name,
            INTEGRATIONS_MANAGE.name,
            NOTIFICATIONS_VIEW.name,
            NOTIFICATIONS_MANAGE.name,
            REPORTS_VIEW.name,
            MEMBERS_CREATE.name,
            TRAINING_VIEW_ALL.name,
        ],
    },
    "vice_president": {
        "name": "Vice President",
        "slug": "vice_president",
        "description": "Organization vice president",
        "is_system": True,
        "priority": 80,
        "permissions": [
            USERS_VIEW.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            MEMBERS_MANAGE.name,
            ROLES_VIEW.name,
            ORGANIZATION_VIEW.name,
            SETTINGS_VIEW.name,
            MEETINGS_VIEW.name,
            MEETINGS_MANAGE.name,
            FUNDRAISING_VIEW.name,
            FUNDRAISING_MANAGE.name,
            MINUTES_VIEW.name,
            MINUTES_MANAGE.name,
            DOCUMENTS_VIEW.name,
            APPARATUS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
            REPORTS_VIEW.name,
        ],
    },
    "quartermaster": {
        "name": "Quartermaster",
        "slug": "quartermaster",
        "description": "Manages department inventory, equipment, and gear assignments",
        "is_system": True,
        "priority": 85,
        "permissions": [
            USERS_VIEW.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            ROLES_VIEW.name,
            ORGANIZATION_VIEW.name,
            SETTINGS_VIEW.name,
            INVENTORY_VIEW.name,
            INVENTORY_MANAGE.name,
            COMPLIANCE_VIEW.name,  # To see equipment certifications
            APPARATUS_VIEW.name,
        ],
    },
    "secretary": {
        "name": "Secretary",
        "slug": "secretary",
        "description": "Organization secretary with record-keeping access",
        "is_system": True,
        "priority": 75,
        "permissions": [
            USERS_VIEW.name,
            USERS_CREATE.name,
            USERS_VIEW_CONTACT.name,
            USERS_UPDATE_ROLES.name,
            MEMBERS_VIEW.name,
            MEMBERS_MANAGE.name,
            MEMBERS_ASSIGN_ROLES.name,
            ROLES_VIEW.name,
            ORGANIZATION_VIEW.name,
            SETTINGS_VIEW.name,
            SETTINGS_MANAGE_CONTACT_VISIBILITY.name,
            MEETINGS_VIEW.name,
            MEETINGS_MANAGE.name,
            COMPLIANCE_VIEW.name,
            TRAINING_VIEW.name,
            ELECTIONS_VIEW.name,
            ELECTIONS_MANAGE.name,
            EVENTS_VIEW.name,
            EVENTS_MANAGE.name,
            LOCATIONS_VIEW.name,
            FORMS_VIEW.name,
            FORMS_MANAGE.name,
            MINUTES_VIEW.name,
            MINUTES_MANAGE.name,
            DOCUMENTS_VIEW.name,
            DOCUMENTS_MANAGE.name,
            APPARATUS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
            REPORTS_VIEW.name,
            MEMBERS_CREATE.name,
        ],
    },
    "assistant_secretary": {
        "name": "Assistant Secretary",
        "slug": "assistant_secretary",
        "description": "Assistant to the secretary",
        "is_system": True,
        "priority": 70,
        "permissions": [
            USERS_VIEW.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            ROLES_VIEW.name,
            ORGANIZATION_VIEW.name,
            SETTINGS_VIEW.name,
            MEETINGS_VIEW.name,
            MEETINGS_MANAGE.name,
            COMPLIANCE_VIEW.name,
            TRAINING_VIEW.name,
            MINUTES_VIEW.name,
            MINUTES_MANAGE.name,
            DOCUMENTS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
        ],
    },
    "member": {
        "name": "Member",
        "slug": "member",
        "description": "Regular department member",
        "is_system": True,
        "priority": 10,
        "permissions": [
            MEMBERS_VIEW.name,
            ORGANIZATION_VIEW.name,
            TRAINING_VIEW.name,
            COMPLIANCE_VIEW.name,
            SCHEDULING_VIEW.name,
            MEETINGS_VIEW.name,
            EVENTS_VIEW.name,
            FORMS_VIEW.name,
            MINUTES_VIEW.name,
            DOCUMENTS_VIEW.name,
            APPARATUS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
        ],
    },
    "training_officer": {
        "name": "Training Officer",
        "slug": "training_officer",
        "description": "Manages training programs and events",
        "is_system": True,
        "priority": 65,
        "permissions": [
            USERS_VIEW.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            ROLES_VIEW.name,
            ORGANIZATION_VIEW.name,
            TRAINING_VIEW.name,
            TRAINING_MANAGE.name,
            COMPLIANCE_VIEW.name,
            EVENTS_VIEW.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            EVENTS_MANAGE.name,
            LOCATIONS_VIEW.name,
            LOCATIONS_CREATE.name,
            LOCATIONS_EDIT.name,
            LOCATIONS_MANAGE.name,
        ],
    },
    "public_outreach_coordinator": {
        "name": "Public Outreach Coordinator",
        "slug": "public_outreach_coordinator",
        "description": "Manages public education and outreach events",
        "is_system": True,
        "priority": 65,
        "permissions": [
            USERS_VIEW.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            ROLES_VIEW.name,
            ORGANIZATION_VIEW.name,
            EVENTS_VIEW.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            EVENTS_MANAGE.name,
            LOCATIONS_VIEW.name,
            LOCATIONS_CREATE.name,
            LOCATIONS_EDIT.name,
            LOCATIONS_MANAGE.name,
        ],
    },
    "meeting_hall_coordinator": {
        "name": "Meeting Hall Coordinator",
        "slug": "meeting_hall_coordinator",
        "description": "Manages meeting hall and location bookings",
        "is_system": True,
        "priority": 60,
        "permissions": [
            USERS_VIEW.name,
            MEMBERS_VIEW.name,
            ROLES_VIEW.name,
            ORGANIZATION_VIEW.name,
            EVENTS_VIEW.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            LOCATIONS_VIEW.name,
            LOCATIONS_CREATE.name,
            LOCATIONS_EDIT.name,
            LOCATIONS_MANAGE.name,
        ],
    },
    "officers": {
        "name": "Officers",
        "slug": "officers",
        "description": "General officer role with broad operational access",
        "is_system": True,
        "priority": 70,
        "permissions": [
            USERS_VIEW.name,
            USERS_EDIT.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            MEMBERS_MANAGE.name,
            ROLES_VIEW.name,
            ORGANIZATION_VIEW.name,
            SETTINGS_VIEW.name,
            TRAINING_VIEW.name,
            COMPLIANCE_VIEW.name,
            SCHEDULING_VIEW.name,
            SCHEDULING_MANAGE.name,
            INVENTORY_VIEW.name,
            INVENTORY_MANAGE.name,
            MEETINGS_VIEW.name,
            EVENTS_VIEW.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            EVENTS_MANAGE.name,
            LOCATIONS_VIEW.name,
            FORMS_VIEW.name,
            FORMS_MANAGE.name,
            APPARATUS_VIEW.name,
        ],
    },
    "apparatus_manager": {
        "name": "Apparatus Manager",
        "slug": "apparatus_manager",
        "description": "Day-to-day fleet tracking, maintenance logging, and equipment checks",
        "is_system": True,
        "priority": 50,
        "permissions": [
            USERS_VIEW.name,
            MEMBERS_VIEW.name,
            ROLES_VIEW.name,
            ORGANIZATION_VIEW.name,
            INVENTORY_VIEW.name,
            INVENTORY_MANAGE.name,
            COMPLIANCE_VIEW.name,
            LOCATIONS_VIEW.name,
            APPARATUS_VIEW.name,
            APPARATUS_CREATE.name,
            APPARATUS_EDIT.name,
            APPARATUS_MAINTENANCE.name,
        ],
    },
    "membership_coordinator": {
        "name": "Membership Coordinator",
        "slug": "membership_coordinator",
        "description": "Manages member records, applications, and onboarding/offboarding",
        "is_system": True,
        "priority": 55,
        "permissions": [
            USERS_VIEW.name,
            USERS_CREATE.name,
            USERS_EDIT.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            MEMBERS_MANAGE.name,
            MEMBERS_ASSIGN_ROLES.name,
            ROLES_VIEW.name,
            ORGANIZATION_VIEW.name,
            SETTINGS_VIEW.name,
            EVENTS_VIEW.name,
        ],
    },
    "communications_officer": {
        "name": "Communications Officer",
        "slug": "communications_officer",
        "description": "Website, social media, newsletters, and notification management",
        "is_system": True,
        "priority": 55,
        "permissions": [
            USERS_VIEW.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            ROLES_VIEW.name,
            ORGANIZATION_VIEW.name,
            EVENTS_VIEW.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            EVENTS_MANAGE.name,
            LOCATIONS_VIEW.name,
        ],
    },
}


def get_admin_role_slugs() -> List[str]:
    """
    Get list of role slugs that should have access to the Members admin page
    """
    return [
        "it_administrator",
        "chief",
        "assistant_chief",
        "president",
        "quartermaster",
        "vice_president",
        "secretary",
        "assistant_secretary",
        "officers",
        "membership_coordinator",
    ]
