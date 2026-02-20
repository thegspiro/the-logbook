"""
Centralized Constants

Single source of truth for role group slugs, business configuration defaults,
and other values that were previously scattered as string literals across services.

All configurable values should be referenced by constant, never by raw string.
"""

from typing import List


# ============================================
# Role Group Constants
# ============================================
# These define the canonical slug lists used for role-based lookups.
# If the set of roles in a group changes, update it here — every
# consumer picks up the change automatically.

# Leadership roles notified on critical events (election rollbacks, deletions, etc.)
LEADERSHIP_ROLE_SLUGS: List[str] = [
    "chief",
    "president",
    "vice_president",
    "secretary",
]

# Admin-level roles CC'd on member drops, archive notifications, etc.
ADMIN_NOTIFY_ROLE_SLUGS: List[str] = [
    "admin",
    "quartermaster",
    "chief",
]

# Roles that grant officer-level access in training module config
TRAINING_OFFICER_ROLE_SLUGS: List[str] = [
    "admin",
    "training_officer",
    "chief",
]

# Operational (line) roles for election eligibility categorisation
OPERATIONAL_ROLE_SLUGS: List[str] = [
    "chief",
    "assistant_chief",
    "captain",
    "lieutenant",
    "firefighter",
    "driver",
    "emt",
    "paramedic",
]

# Administrative (corporate) roles for election eligibility categorisation
ADMINISTRATIVE_ROLE_SLUGS: List[str] = [
    "president",
    "vice_president",
    "secretary",
    "assistant_secretary",
    "treasurer",
]

# Default training officer roles for cert alert config fallback
DEFAULT_TRAINING_OFFICER_ROLES: List[str] = [
    "training_officer",
    "assistant_training_officer",
]

DEFAULT_COMPLIANCE_OFFICER_ROLES: List[str] = [
    "compliance_officer",
]


# ============================================
# Well-Known Role Slugs
# ============================================
# Individual role slug constants for point lookups (e.g. querying a
# specific role by slug).

ROLE_TRAINING_OFFICER = "training_officer"
ROLE_IT_MANAGER = "it_manager"
ROLE_MEMBER = "member"
ROLE_CHIEF = "chief"


# ============================================
# Well-Known Folder Slugs
# ============================================

FOLDER_FACILITIES = "facilities"
FOLDER_EVENTS = "events"


# ============================================
# Analytics Event Types
# ============================================

ANALYTICS_QR_SCAN = "qr_scan"
ANALYTICS_CHECK_IN_SUCCESS = "check_in_success"
ANALYTICS_CHECK_IN_FAILURE = "check_in_failure"


# ============================================
# Audit Event Categories
# ============================================

AUDIT_CATEGORY_ELECTIONS = "elections"
AUDIT_EVENT_LOGIN_FAILED = "login_failed"
