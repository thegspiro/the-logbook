"""
Permission System

Defines the permission taxonomy and constants for the application.

Terminology
-----------
- **Position**: A corporate/organisational position that carries
  permissions (e.g., President, Treasurer, IT Manager).
- **Operational Rank**: A fire-service rank (e.g., Fire Chief, Captain).
  Ranks carry *default* permissions that are combined with position
  permissions at runtime.
- **Membership Type**: A classification with *no* permissions
  (e.g., Active, Retired, Honorary, Administrative).
"""

from typing import Dict, List
from enum import Enum


class PermissionCategory(str, Enum):
    """Categories of permissions"""
    ADMIN = "admin"
    USERS = "users"
    POSITIONS = "positions"
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
    FACILITIES = "facilities"
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
USERS_UPDATE_POSITIONS = Permission("users.update_positions", "Update user positions", PermissionCategory.USERS)

MEMBERS_VIEW = Permission("members.view", "View member list", PermissionCategory.MEMBERS)
MEMBERS_MANAGE = Permission("members.manage", "Manage member profiles", PermissionCategory.MEMBERS)
MEMBERS_ASSIGN_POSITIONS = Permission("members.assign_positions", "Assign positions to members", PermissionCategory.MEMBERS)

# ============================================
# Position Management Permissions
# ============================================

POSITIONS_VIEW = Permission("positions.view", "View positions", PermissionCategory.POSITIONS)
POSITIONS_CREATE = Permission("positions.create", "Create new positions", PermissionCategory.POSITIONS)
POSITIONS_EDIT = Permission("positions.edit", "Edit positions", PermissionCategory.POSITIONS)
POSITIONS_UPDATE = Permission("positions.update", "Update positions", PermissionCategory.POSITIONS)
POSITIONS_DELETE = Permission("positions.delete", "Delete positions", PermissionCategory.POSITIONS)
POSITIONS_MANAGE_PERMISSIONS = Permission("positions.manage_permissions", "Manage position permissions", PermissionCategory.POSITIONS)

# ============================================
# Organization & Settings Permissions
# ============================================

ORGANIZATION_VIEW = Permission("organization.view", "View organization info", PermissionCategory.ORGANIZATION)
ORGANIZATION_EDIT = Permission("organization.edit", "Edit organization info", PermissionCategory.ORGANIZATION)
ORGANIZATION_UPDATE_SETTINGS = Permission("organization.update_settings", "Update organization settings", PermissionCategory.ORGANIZATION)

SETTINGS_VIEW = Permission("settings.view", "View settings", PermissionCategory.SETTINGS)
SETTINGS_EDIT = Permission("settings.edit", "Edit settings", PermissionCategory.SETTINGS)
SETTINGS_MANAGE = Permission("settings.manage", "Full settings and admin management", PermissionCategory.SETTINGS)
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
SCHEDULING_ASSIGN = Permission("scheduling.assign", "Assign members to shifts", PermissionCategory.SCHEDULING)
SCHEDULING_SWAP = Permission("scheduling.swap", "Request and manage shift swaps", PermissionCategory.SCHEDULING)
SCHEDULING_REPORT = Permission("scheduling.report", "View shift reports and analytics", PermissionCategory.SCHEDULING)

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

# Facilities
FACILITIES_VIEW = Permission("facilities.view", "View facilities and buildings", PermissionCategory.FACILITIES)
FACILITIES_CREATE = Permission("facilities.create", "Create new facility records", PermissionCategory.FACILITIES)
FACILITIES_EDIT = Permission("facilities.edit", "Edit facility records", PermissionCategory.FACILITIES)
FACILITIES_DELETE = Permission("facilities.delete", "Delete facility records", PermissionCategory.FACILITIES)
FACILITIES_MAINTENANCE = Permission("facilities.maintenance", "Log and manage facility maintenance", PermissionCategory.FACILITIES)
FACILITIES_MANAGE = Permission("facilities.manage", "Full facility management", PermissionCategory.FACILITIES)

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
    USERS_UPDATE_POSITIONS,
    MEMBERS_VIEW,
    MEMBERS_MANAGE,
    MEMBERS_ASSIGN_POSITIONS,

    # Positions
    POSITIONS_VIEW,
    POSITIONS_CREATE,
    POSITIONS_EDIT,
    POSITIONS_UPDATE,
    POSITIONS_DELETE,
    POSITIONS_MANAGE_PERMISSIONS,

    # Organization & Settings
    ORGANIZATION_VIEW,
    ORGANIZATION_EDIT,
    ORGANIZATION_UPDATE_SETTINGS,
    SETTINGS_VIEW,
    SETTINGS_EDIT,
    SETTINGS_MANAGE,
    SETTINGS_MANAGE_CONTACT_VISIBILITY,

    # Modules
    TRAINING_VIEW,
    TRAINING_MANAGE,
    COMPLIANCE_VIEW,
    COMPLIANCE_MANAGE,
    SCHEDULING_VIEW,
    SCHEDULING_MANAGE,
    SCHEDULING_ASSIGN,
    SCHEDULING_SWAP,
    SCHEDULING_REPORT,
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

    # Facilities
    FACILITIES_VIEW,
    FACILITIES_CREATE,
    FACILITIES_EDIT,
    FACILITIES_DELETE,
    FACILITIES_MAINTENANCE,
    FACILITIES_MANAGE,

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
    categorized: Dict[str, List[Permission]] = {}
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
# Backward-compatible permission name aliases
# ============================================
# During migration, code that references the old "roles.*" permission
# names will still work via these aliases.  The canonical names are
# now "positions.*".

ROLES_VIEW = POSITIONS_VIEW
ROLES_CREATE = POSITIONS_CREATE
ROLES_EDIT = POSITIONS_EDIT
ROLES_UPDATE = POSITIONS_UPDATE
ROLES_DELETE = POSITIONS_DELETE
ROLES_MANAGE_PERMISSIONS = POSITIONS_MANAGE_PERMISSIONS
USERS_UPDATE_ROLES = USERS_UPDATE_POSITIONS
MEMBERS_ASSIGN_ROLES = MEMBERS_ASSIGN_POSITIONS


# ============================================
# Membership Types (no permissions)
# ============================================

MEMBERSHIP_TYPES = [
    {"value": "prospective", "label": "Prospective", "description": "Interested/applying, no department ID or email yet (separate table)"},
    {"value": "probationary", "label": "Probationary", "description": "Accepted but in trial period"},
    {"value": "active", "label": "Active / Regular Member", "description": "Full department member"},
    {"value": "life", "label": "Life Member", "description": "Lifetime membership status"},
    {"value": "retired", "label": "Retired", "description": "No longer active duty"},
    {"value": "honorary", "label": "Honorary Member", "description": "Ceremonial/recognition membership"},
    {"value": "administrative", "label": "Administrative", "description": "Organisational/clerical classification, no special permissions"},
]


# ============================================
# Operational Rank Definitions (with default permissions)
# ============================================
# Each rank carries default permissions that are combined with the
# member's position permissions at runtime.  These are NOT positions —
# they are stored in User.rank (one per member).

_LEADERSHIP_VIEW_PERMISSIONS = [
    USERS_VIEW.name,
    USERS_VIEW_CONTACT.name,
    MEMBERS_VIEW.name,
    POSITIONS_VIEW.name,
    ORGANIZATION_VIEW.name,
    SETTINGS_VIEW.name,
    TRAINING_VIEW.name,
    TRAINING_VIEW_ALL.name,
    COMPLIANCE_VIEW.name,
    SCHEDULING_VIEW.name,
    INVENTORY_VIEW.name,
    MEETINGS_VIEW.name,
    ELECTIONS_VIEW.name,
    FUNDRAISING_VIEW.name,
    AUDIT_VIEW.name,
    EVENTS_VIEW.name,
    LOCATIONS_VIEW.name,
    FORMS_VIEW.name,
    MINUTES_VIEW.name,
    DOCUMENTS_VIEW.name,
    APPARATUS_VIEW.name,
    FACILITIES_VIEW.name,
    ANALYTICS_VIEW.name,
    NOTIFICATIONS_VIEW.name,
    REPORTS_VIEW.name,
]

OPERATIONAL_RANKS: Dict[str, dict] = {
    "fire_chief": {
        "label": "Fire Chief",
        "priority": 95,
        "default_permissions": _LEADERSHIP_VIEW_PERMISSIONS + [
            USERS_CREATE.name,
            USERS_EDIT.name,
            USERS_DELETE.name,
            USERS_UPDATE_POSITIONS.name,
            MEMBERS_MANAGE.name,
            MEMBERS_ASSIGN_POSITIONS.name,
            MEMBERS_CREATE.name,
            POSITIONS_CREATE.name,
            POSITIONS_EDIT.name,
            POSITIONS_UPDATE.name,
            POSITIONS_DELETE.name,
            POSITIONS_MANAGE_PERMISSIONS.name,
            ORGANIZATION_EDIT.name,
            ORGANIZATION_UPDATE_SETTINGS.name,
            SETTINGS_EDIT.name,
            SETTINGS_MANAGE.name,
            SETTINGS_MANAGE_CONTACT_VISIBILITY.name,
            TRAINING_MANAGE.name,
            COMPLIANCE_MANAGE.name,
            SCHEDULING_MANAGE.name,
            SCHEDULING_ASSIGN.name,
            SCHEDULING_SWAP.name,
            SCHEDULING_REPORT.name,
            INVENTORY_MANAGE.name,
            MEETINGS_MANAGE.name,
            ELECTIONS_MANAGE.name,
            FUNDRAISING_MANAGE.name,
            AUDIT_EXPORT.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            EVENTS_DELETE.name,
            EVENTS_MANAGE.name,
            LOCATIONS_CREATE.name,
            LOCATIONS_EDIT.name,
            LOCATIONS_DELETE.name,
            LOCATIONS_MANAGE.name,
            FORMS_MANAGE.name,
            MINUTES_MANAGE.name,
            DOCUMENTS_MANAGE.name,
            APPARATUS_CREATE.name,
            APPARATUS_EDIT.name,
            APPARATUS_DELETE.name,
            APPARATUS_MAINTENANCE.name,
            APPARATUS_MANAGE.name,
            FACILITIES_CREATE.name,
            FACILITIES_EDIT.name,
            FACILITIES_DELETE.name,
            FACILITIES_MAINTENANCE.name,
            FACILITIES_MANAGE.name,
            INTEGRATIONS_MANAGE.name,
            NOTIFICATIONS_MANAGE.name,
            ADMIN_ACCESS.name,
        ],
    },
    "deputy_chief": {
        "label": "Deputy Chief",
        "priority": 90,
        "default_permissions": _LEADERSHIP_VIEW_PERMISSIONS + [
            USERS_CREATE.name,
            USERS_EDIT.name,
            USERS_UPDATE_POSITIONS.name,
            MEMBERS_MANAGE.name,
            MEMBERS_ASSIGN_POSITIONS.name,
            MEMBERS_CREATE.name,
            TRAINING_MANAGE.name,
            COMPLIANCE_MANAGE.name,
            SCHEDULING_MANAGE.name,
            SCHEDULING_ASSIGN.name,
            SCHEDULING_SWAP.name,
            SCHEDULING_REPORT.name,
            INVENTORY_MANAGE.name,
            MEETINGS_MANAGE.name,
            ELECTIONS_MANAGE.name,
            FUNDRAISING_MANAGE.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            EVENTS_DELETE.name,
            EVENTS_MANAGE.name,
            LOCATIONS_CREATE.name,
            LOCATIONS_EDIT.name,
            LOCATIONS_DELETE.name,
            LOCATIONS_MANAGE.name,
            FORMS_MANAGE.name,
            MINUTES_MANAGE.name,
            DOCUMENTS_MANAGE.name,
            APPARATUS_CREATE.name,
            APPARATUS_EDIT.name,
            APPARATUS_DELETE.name,
            APPARATUS_MAINTENANCE.name,
            APPARATUS_MANAGE.name,
            FACILITIES_CREATE.name,
            FACILITIES_EDIT.name,
            FACILITIES_DELETE.name,
            FACILITIES_MAINTENANCE.name,
            FACILITIES_MANAGE.name,
            INTEGRATIONS_MANAGE.name,
            NOTIFICATIONS_MANAGE.name,
        ],
    },
    "assistant_chief": {
        "label": "Assistant Chief",
        "priority": 85,
        "default_permissions": _LEADERSHIP_VIEW_PERMISSIONS + [
            USERS_CREATE.name,
            USERS_EDIT.name,
            USERS_UPDATE_POSITIONS.name,
            MEMBERS_MANAGE.name,
            MEMBERS_ASSIGN_POSITIONS.name,
            MEMBERS_CREATE.name,
            TRAINING_MANAGE.name,
            COMPLIANCE_MANAGE.name,
            SCHEDULING_MANAGE.name,
            SCHEDULING_ASSIGN.name,
            SCHEDULING_SWAP.name,
            SCHEDULING_REPORT.name,
            INVENTORY_MANAGE.name,
            MEETINGS_MANAGE.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            EVENTS_MANAGE.name,
            LOCATIONS_CREATE.name,
            LOCATIONS_EDIT.name,
            LOCATIONS_MANAGE.name,
            FORMS_MANAGE.name,
            MINUTES_MANAGE.name,
            DOCUMENTS_MANAGE.name,
            APPARATUS_CREATE.name,
            APPARATUS_EDIT.name,
            APPARATUS_MAINTENANCE.name,
            APPARATUS_MANAGE.name,
            FACILITIES_CREATE.name,
            FACILITIES_EDIT.name,
            FACILITIES_MAINTENANCE.name,
            FACILITIES_MANAGE.name,
            NOTIFICATIONS_MANAGE.name,
        ],
    },
    "captain": {
        "label": "Captain",
        "priority": 70,
        "default_permissions": _LEADERSHIP_VIEW_PERMISSIONS + [
            MEMBERS_MANAGE.name,
            TRAINING_MANAGE.name,
            COMPLIANCE_MANAGE.name,
            SCHEDULING_MANAGE.name,
            SCHEDULING_ASSIGN.name,
            SCHEDULING_SWAP.name,
            SCHEDULING_REPORT.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            APPARATUS_EDIT.name,
            APPARATUS_MAINTENANCE.name,
            FACILITIES_MAINTENANCE.name,
        ],
    },
    "lieutenant": {
        "label": "Lieutenant",
        "priority": 60,
        "default_permissions": _LEADERSHIP_VIEW_PERMISSIONS + [
            TRAINING_MANAGE.name,
            SCHEDULING_MANAGE.name,
            SCHEDULING_ASSIGN.name,
            SCHEDULING_SWAP.name,
            SCHEDULING_REPORT.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            APPARATUS_MAINTENANCE.name,
        ],
    },
    "engineer": {
        "label": "Engineer",
        "priority": 40,
        "default_permissions": [
            MEMBERS_VIEW.name,
            ORGANIZATION_VIEW.name,
            TRAINING_VIEW.name,
            COMPLIANCE_VIEW.name,
            SCHEDULING_VIEW.name,
            SCHEDULING_SWAP.name,
            INVENTORY_VIEW.name,
            MEETINGS_VIEW.name,
            ELECTIONS_VIEW.name,
            EVENTS_VIEW.name,
            FORMS_VIEW.name,
            MINUTES_VIEW.name,
            DOCUMENTS_VIEW.name,
            APPARATUS_VIEW.name,
            APPARATUS_MAINTENANCE.name,
            FACILITIES_VIEW.name,
            LOCATIONS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
        ],
    },
    "firefighter": {
        "label": "Firefighter",
        "priority": 10,
        "default_permissions": [
            MEMBERS_VIEW.name,
            ORGANIZATION_VIEW.name,
            TRAINING_VIEW.name,
            COMPLIANCE_VIEW.name,
            SCHEDULING_VIEW.name,
            SCHEDULING_SWAP.name,
            INVENTORY_VIEW.name,
            MEETINGS_VIEW.name,
            ELECTIONS_VIEW.name,
            EVENTS_VIEW.name,
            FORMS_VIEW.name,
            MINUTES_VIEW.name,
            DOCUMENTS_VIEW.name,
            APPARATUS_VIEW.name,
            FACILITIES_VIEW.name,
            LOCATIONS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
        ],
    },
}


def get_rank_default_permissions(rank: str) -> List[str]:
    """
    Get the default permissions for an operational rank.

    Returns an empty list if the rank is not recognised.
    """
    rank_def = OPERATIONAL_RANKS.get(rank)
    if rank_def:
        return rank_def["default_permissions"]
    return []


# ============================================
# Default Position Definitions (Corporate Positions)
# ============================================
# These are created for every new organisation during onboarding.

DEFAULT_POSITIONS: Dict[str, dict] = {
    "it_manager": {
        "name": "IT Manager",
        "slug": "it_manager",
        "description": "System Owner – full system access for IT administration",
        "is_system": True,
        "priority": 100,
        "permissions": ["*"],  # Wildcard grants all current and future permissions
    },
    "president": {
        "name": "President",
        "slug": "president",
        "description": "Organisation president with full administrative access",
        "is_system": True,
        "priority": 95,
        "permissions": [
            USERS_VIEW.name,
            USERS_CREATE.name,
            USERS_EDIT.name,
            USERS_DELETE.name,
            USERS_VIEW_CONTACT.name,
            USERS_UPDATE_POSITIONS.name,
            MEMBERS_VIEW.name,
            MEMBERS_MANAGE.name,
            MEMBERS_ASSIGN_POSITIONS.name,
            MEMBERS_CREATE.name,
            POSITIONS_VIEW.name,
            POSITIONS_CREATE.name,
            POSITIONS_EDIT.name,
            POSITIONS_UPDATE.name,
            POSITIONS_DELETE.name,
            POSITIONS_MANAGE_PERMISSIONS.name,
            ORGANIZATION_VIEW.name,
            ORGANIZATION_EDIT.name,
            ORGANIZATION_UPDATE_SETTINGS.name,
            SETTINGS_VIEW.name,
            SETTINGS_EDIT.name,
            SETTINGS_MANAGE.name,
            SETTINGS_MANAGE_CONTACT_VISIBILITY.name,
            TRAINING_VIEW.name,
            TRAINING_MANAGE.name,
            TRAINING_VIEW_ALL.name,
            COMPLIANCE_VIEW.name,
            COMPLIANCE_MANAGE.name,
            SCHEDULING_VIEW.name,
            SCHEDULING_MANAGE.name,
            SCHEDULING_ASSIGN.name,
            SCHEDULING_SWAP.name,
            SCHEDULING_REPORT.name,
            INVENTORY_VIEW.name,
            INVENTORY_MANAGE.name,
            MEETINGS_VIEW.name,
            MEETINGS_MANAGE.name,
            ELECTIONS_VIEW.name,
            ELECTIONS_MANAGE.name,
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
            FACILITIES_VIEW.name,
            FACILITIES_CREATE.name,
            FACILITIES_EDIT.name,
            FACILITIES_DELETE.name,
            FACILITIES_MAINTENANCE.name,
            FACILITIES_MANAGE.name,
            ANALYTICS_VIEW.name,
            INTEGRATIONS_MANAGE.name,
            NOTIFICATIONS_VIEW.name,
            NOTIFICATIONS_MANAGE.name,
            REPORTS_VIEW.name,
            ADMIN_ACCESS.name,
        ],
    },
    "vice_president": {
        "name": "Vice President",
        "slug": "vice_president",
        "description": "Organisation vice president",
        "is_system": True,
        "priority": 80,
        "permissions": [
            USERS_VIEW.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            MEMBERS_MANAGE.name,
            MEMBERS_ASSIGN_POSITIONS.name,
            POSITIONS_VIEW.name,
            ORGANIZATION_VIEW.name,
            SETTINGS_VIEW.name,
            TRAINING_VIEW.name,
            COMPLIANCE_VIEW.name,
            SCHEDULING_VIEW.name,
            INVENTORY_VIEW.name,
            MEETINGS_VIEW.name,
            MEETINGS_MANAGE.name,
            ELECTIONS_VIEW.name,
            ELECTIONS_MANAGE.name,
            FUNDRAISING_VIEW.name,
            FUNDRAISING_MANAGE.name,
            AUDIT_VIEW.name,
            EVENTS_VIEW.name,
            FORMS_VIEW.name,
            MINUTES_VIEW.name,
            MINUTES_MANAGE.name,
            DOCUMENTS_VIEW.name,
            APPARATUS_VIEW.name,
            FACILITIES_VIEW.name,
            ANALYTICS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
            REPORTS_VIEW.name,
        ],
    },
    "treasurer": {
        "name": "Treasurer",
        "slug": "treasurer",
        "description": "Financial oversight, fundraising management, and budget reporting",
        "is_system": True,
        "priority": 75,
        "permissions": [
            USERS_VIEW.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            POSITIONS_VIEW.name,
            ORGANIZATION_VIEW.name,
            SETTINGS_VIEW.name,
            FUNDRAISING_VIEW.name,
            FUNDRAISING_MANAGE.name,
            MEETINGS_VIEW.name,
            DOCUMENTS_VIEW.name,
            DOCUMENTS_MANAGE.name,
            REPORTS_VIEW.name,
            AUDIT_VIEW.name,
            NOTIFICATIONS_VIEW.name,
        ],
    },
    "secretary": {
        "name": "Secretary",
        "slug": "secretary",
        "description": "Organisation secretary with record-keeping access",
        "is_system": True,
        "priority": 75,
        "permissions": [
            USERS_VIEW.name,
            USERS_CREATE.name,
            USERS_VIEW_CONTACT.name,
            USERS_UPDATE_POSITIONS.name,
            MEMBERS_VIEW.name,
            MEMBERS_MANAGE.name,
            MEMBERS_ASSIGN_POSITIONS.name,
            POSITIONS_VIEW.name,
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
            FACILITIES_VIEW.name,
            NOTIFICATIONS_VIEW.name,
            REPORTS_VIEW.name,
            MEMBERS_CREATE.name,
        ],
    },
    "board_of_directors": {
        "name": "Board of Directors",
        "slug": "board_of_directors",
        "description": "Board member with governance oversight",
        "is_system": True,
        "priority": 70,
        "permissions": [
            USERS_VIEW.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            POSITIONS_VIEW.name,
            ORGANIZATION_VIEW.name,
            SETTINGS_VIEW.name,
            MEETINGS_VIEW.name,
            ELECTIONS_VIEW.name,
            FUNDRAISING_VIEW.name,
            AUDIT_VIEW.name,
            MINUTES_VIEW.name,
            DOCUMENTS_VIEW.name,
            REPORTS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
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
            POSITIONS_VIEW.name,
            ORGANIZATION_VIEW.name,
            SETTINGS_VIEW.name,
            INVENTORY_VIEW.name,
            INVENTORY_MANAGE.name,
            COMPLIANCE_VIEW.name,
            APPARATUS_VIEW.name,
            FACILITIES_VIEW.name,
        ],
    },
    "public_outreach": {
        "name": "Public Outreach",
        "slug": "public_outreach",
        "description": "Manages public education and outreach events",
        "is_system": True,
        "priority": 55,
        "permissions": [
            USERS_VIEW.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            POSITIONS_VIEW.name,
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
    "communications_officer": {
        "name": "Communications Officer / PIO",
        "slug": "communications_officer",
        "description": "Website, social media, newsletters, and notification management",
        "is_system": True,
        "priority": 55,
        "permissions": [
            USERS_VIEW.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            POSITIONS_VIEW.name,
            ORGANIZATION_VIEW.name,
            EVENTS_VIEW.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            EVENTS_MANAGE.name,
            LOCATIONS_VIEW.name,
            DOCUMENTS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
            NOTIFICATIONS_MANAGE.name,
        ],
    },
    "historian": {
        "name": "Historian",
        "slug": "historian",
        "description": "Preserves department history, photos, and records",
        "is_system": True,
        "priority": 50,
        "permissions": [
            USERS_VIEW.name,
            MEMBERS_VIEW.name,
            ORGANIZATION_VIEW.name,
            MEETINGS_VIEW.name,
            MINUTES_VIEW.name,
            DOCUMENTS_VIEW.name,
            DOCUMENTS_MANAGE.name,
            EVENTS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
        ],
    },
    "apparatus_officer": {
        "name": "Apparatus Officer",
        "slug": "apparatus_officer",
        "description": "Day-to-day fleet tracking, maintenance logging, and equipment checks",
        "is_system": True,
        "priority": 50,
        "permissions": [
            USERS_VIEW.name,
            MEMBERS_VIEW.name,
            POSITIONS_VIEW.name,
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
    "membership_committee_chair": {
        "name": "Membership Committee Chair",
        "slug": "membership_committee_chair",
        "description": "Manages member records, applications, and onboarding/offboarding",
        "is_system": True,
        "priority": 55,
        "permissions": [
            USERS_VIEW.name,
            USERS_CREATE.name,
            USERS_EDIT.name,
            USERS_VIEW_CONTACT.name,
            USERS_UPDATE_POSITIONS.name,
            MEMBERS_VIEW.name,
            MEMBERS_MANAGE.name,
            MEMBERS_ASSIGN_POSITIONS.name,
            MEMBERS_CREATE.name,
            POSITIONS_VIEW.name,
            ORGANIZATION_VIEW.name,
            SETTINGS_VIEW.name,
            COMPLIANCE_VIEW.name,
            EVENTS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
        ],
    },
    "safety_officer": {
        "name": "Safety Officer",
        "slug": "safety_officer",
        "description": "Safety compliance, regulatory oversight, and department rule enforcement",
        "is_system": True,
        "priority": 65,
        "permissions": [
            USERS_VIEW.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            POSITIONS_VIEW.name,
            ORGANIZATION_VIEW.name,
            TRAINING_VIEW.name,
            TRAINING_MANAGE.name,
            TRAINING_VIEW_ALL.name,
            COMPLIANCE_VIEW.name,
            COMPLIANCE_MANAGE.name,
            EVENTS_VIEW.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            INVENTORY_VIEW.name,
            LOCATIONS_VIEW.name,
            FORMS_VIEW.name,
            FORMS_MANAGE.name,
            DOCUMENTS_VIEW.name,
            DOCUMENTS_MANAGE.name,
            REPORTS_VIEW.name,
            APPARATUS_VIEW.name,
            FACILITIES_VIEW.name,
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
            POSITIONS_VIEW.name,
            ORGANIZATION_VIEW.name,
            TRAINING_VIEW.name,
            TRAINING_MANAGE.name,
            TRAINING_VIEW_ALL.name,
            COMPLIANCE_VIEW.name,
            COMPLIANCE_MANAGE.name,
            SCHEDULING_VIEW.name,
            APPARATUS_VIEW.name,
            FACILITIES_VIEW.name,
            EVENTS_VIEW.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            EVENTS_MANAGE.name,
            LOCATIONS_VIEW.name,
            LOCATIONS_CREATE.name,
            LOCATIONS_EDIT.name,
            LOCATIONS_MANAGE.name,
            DOCUMENTS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
            REPORTS_VIEW.name,
        ],
    },
    "fundraising_chair": {
        "name": "Fundraising Chair",
        "slug": "fundraising_chair",
        "description": "Organises and manages department fundraising activities",
        "is_system": True,
        "priority": 55,
        "permissions": [
            USERS_VIEW.name,
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            ORGANIZATION_VIEW.name,
            FUNDRAISING_VIEW.name,
            FUNDRAISING_MANAGE.name,
            EVENTS_VIEW.name,
            EVENTS_CREATE.name,
            EVENTS_EDIT.name,
            LOCATIONS_VIEW.name,
            DOCUMENTS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
        ],
    },
    "member": {
        "name": "Member",
        "slug": "member",
        "description": "Default position assigned to every department member for baseline access",
        "is_system": True,
        "priority": 10,
        "permissions": [
            MEMBERS_VIEW.name,
            ORGANIZATION_VIEW.name,
            TRAINING_VIEW.name,
            COMPLIANCE_VIEW.name,
            SCHEDULING_VIEW.name,
            SCHEDULING_SWAP.name,
            INVENTORY_VIEW.name,
            MEETINGS_VIEW.name,
            ELECTIONS_VIEW.name,
            EVENTS_VIEW.name,
            FORMS_VIEW.name,
            MINUTES_VIEW.name,
            DOCUMENTS_VIEW.name,
            APPARATUS_VIEW.name,
            FACILITIES_VIEW.name,
            LOCATIONS_VIEW.name,
            NOTIFICATIONS_VIEW.name,
        ],
    },
}

# Backward-compatible alias
DEFAULT_ROLES = DEFAULT_POSITIONS


def get_admin_position_slugs() -> List[str]:
    """
    Get list of position slugs that should have access to the Members admin page.
    """
    return [
        "it_manager",
        "president",
        "vice_president",
        "secretary",
        "quartermaster",
        "membership_committee_chair",
    ]


# Backward-compatible alias
get_admin_role_slugs = get_admin_position_slugs
