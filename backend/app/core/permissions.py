"""
Permission System

Defines the permission taxonomy and constants for the application.
"""

from typing import Dict, List
from enum import Enum


class PermissionCategory(str, Enum):
    """Categories of permissions"""
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
    ELECTIONS = "elections"
    FUNDRAISING = "fundraising"
    AUDIT = "audit"


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

MEMBERS_VIEW = Permission("members.view", "View member list", PermissionCategory.MEMBERS)
MEMBERS_MANAGE = Permission("members.manage", "Manage member profiles", PermissionCategory.MEMBERS)
MEMBERS_ASSIGN_ROLES = Permission("members.assign_roles", "Assign roles to members", PermissionCategory.MEMBERS)

# ============================================
# Role Management Permissions
# ============================================

ROLES_VIEW = Permission("roles.view", "View roles", PermissionCategory.ROLES)
ROLES_CREATE = Permission("roles.create", "Create new roles", PermissionCategory.ROLES)
ROLES_EDIT = Permission("roles.edit", "Edit roles", PermissionCategory.ROLES)
ROLES_DELETE = Permission("roles.delete", "Delete roles", PermissionCategory.ROLES)
ROLES_MANAGE_PERMISSIONS = Permission("roles.manage_permissions", "Manage role permissions", PermissionCategory.ROLES)

# ============================================
# Organization & Settings Permissions
# ============================================

ORGANIZATION_VIEW = Permission("organization.view", "View organization info", PermissionCategory.ORGANIZATION)
ORGANIZATION_EDIT = Permission("organization.edit", "Edit organization info", PermissionCategory.ORGANIZATION)

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
    MEMBERS_VIEW,
    MEMBERS_MANAGE,
    MEMBERS_ASSIGN_ROLES,

    # Roles
    ROLES_VIEW,
    ROLES_CREATE,
    ROLES_EDIT,
    ROLES_DELETE,
    ROLES_MANAGE_PERMISSIONS,

    # Organization & Settings
    ORGANIZATION_VIEW,
    ORGANIZATION_EDIT,
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
        "permissions": get_all_permissions(),  # All permissions
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
            MEMBERS_VIEW.name,
            MEMBERS_MANAGE.name,
            MEMBERS_ASSIGN_ROLES.name,
            ROLES_VIEW.name,
            ROLES_CREATE.name,
            ROLES_EDIT.name,
            ROLES_MANAGE_PERMISSIONS.name,
            ORGANIZATION_VIEW.name,
            ORGANIZATION_EDIT.name,
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
            ELECTIONS_VIEW.name,
            ELECTIONS_MANAGE.name,
            FUNDRAISING_VIEW.name,
            FUNDRAISING_MANAGE.name,
            AUDIT_VIEW.name,
            AUDIT_EXPORT.name,
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
            MEMBERS_VIEW.name,
            MEMBERS_MANAGE.name,
            MEMBERS_ASSIGN_ROLES.name,
            ROLES_VIEW.name,
            ROLES_CREATE.name,
            ROLES_EDIT.name,
            ROLES_MANAGE_PERMISSIONS.name,
            ORGANIZATION_VIEW.name,
            ORGANIZATION_EDIT.name,
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
            ELECTIONS_VIEW.name,
            ELECTIONS_MANAGE.name,
            FUNDRAISING_VIEW.name,
            FUNDRAISING_MANAGE.name,
            AUDIT_VIEW.name,
            AUDIT_EXPORT.name,
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
            ELECTIONS_VIEW.name,
            FUNDRAISING_VIEW.name,
            FUNDRAISING_MANAGE.name,
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
            USERS_VIEW_CONTACT.name,
            MEMBERS_VIEW.name,
            MEMBERS_MANAGE.name,
            ROLES_VIEW.name,
            ORGANIZATION_VIEW.name,
            SETTINGS_VIEW.name,
            SETTINGS_MANAGE_CONTACT_VISIBILITY.name,
            MEETINGS_VIEW.name,
            MEETINGS_MANAGE.name,
            COMPLIANCE_VIEW.name,
            TRAINING_VIEW.name,
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
        "vice_president",
        "secretary",
        "assistant_secretary",
    ]
