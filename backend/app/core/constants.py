"""
Centralized Constants

Single source of truth for role group slugs, business configuration defaults,
and other values that were previously scattered as string literals across services.

All configurable values should be referenced by constant, never by raw string.
"""

# ============================================
# Role Group Constants
# ============================================
# These define the canonical slug lists used for role-based lookups.
# If the set of roles in a group changes, update it here — every
# consumer picks up the change automatically.

# Leadership roles notified on critical events (election rollbacks, deletions, etc.)
LEADERSHIP_ROLE_SLUGS: list[str] = [
    "chief",
    "president",
    "vice_president",
    "secretary",
]

# Admin-level roles CC'd on member drops, archive notifications, etc.
ADMIN_NOTIFY_ROLE_SLUGS: list[str] = [
    "admin",
    "quartermaster",
    "chief",
]

# Roles that grant officer-level access in training module config
TRAINING_OFFICER_ROLE_SLUGS: list[str] = [
    "admin",
    "training_officer",
    "chief",
]

# Operational (line) role slugs.
#
# NOTE: These are *position* slugs, NOT voter-eligibility categories.
# Election voter eligibility (eligible_voter_types) is determined by
# the member's ``membership_type`` field (active, administrative, life,
# etc.), not by which role slugs they hold.  See
# ``ElectionService._user_has_role_type()`` for the full mapping.
OPERATIONAL_ROLE_SLUGS: list[str] = [
    "chief",
    "assistant_chief",
    "captain",
    "lieutenant",
    "firefighter",
    "driver",
    "emt",
    "paramedic",
]

# Administrative (corporate) role slugs.
#
# Same caveat as above: these are position slugs used for permission
# lookups and UI grouping, not for election voter-type eligibility.
ADMINISTRATIVE_ROLE_SLUGS: list[str] = [
    "president",
    "vice_president",
    "secretary",
    "assistant_secretary",
    "treasurer",
]

# Default training officer roles for cert alert config fallback
DEFAULT_TRAINING_OFFICER_ROLES: list[str] = [
    "training_officer",
    "assistant_training_officer",
]

DEFAULT_COMPLIANCE_OFFICER_ROLES: list[str] = [
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
# Department Offices (email signature holders)
# ============================================
# The offices a department signs correspondence from.  Each entry becomes
# four email-template variables ({{<key>_name}}, {{<key>_title}},
# {{<key>_email}}, {{<key>_phone}}) so a notice can be signed by whoever
# currently holds the office, regardless of who triggered the send.
#
# ``position_slugs`` drives auto-detection: when an office has not been
# assigned explicitly, the holder is inferred from the members carrying one
# of those position slugs.  ``default_title`` is the signature line used when
# an admin has not overridden it.
#
# Adding an entry here is all that is needed to expose a new office — the
# variable catalogue, the admin UI, and the render-time directory are all
# generated from this list.

OFFICE_CATALOG: list[dict[str, object]] = [
    {
        "key": "chief",
        "label": "Chief",
        "default_title": "Chief",
        "category": "operational",
        "position_slugs": ["fire_chief", "chief"],
    },
    {
        "key": "deputy_chief",
        "label": "Deputy Chief",
        "default_title": "Deputy Chief",
        "category": "operational",
        "position_slugs": ["deputy_chief"],
    },
    {
        "key": "assistant_chief",
        "label": "Assistant Chief",
        "default_title": "Assistant Chief",
        "category": "operational",
        "position_slugs": ["assistant_chief"],
    },
    {
        "key": "safety_officer",
        "label": "Safety Officer",
        "default_title": "Safety Officer",
        "category": "operational",
        "position_slugs": ["safety_officer"],
    },
    {
        "key": "training_officer",
        "label": "Training Officer",
        "default_title": "Training Officer",
        "category": "operational",
        "position_slugs": ["training_officer"],
    },
    {
        "key": "president",
        "label": "President",
        "default_title": "President",
        "category": "administrative",
        "position_slugs": ["president"],
    },
    {
        "key": "vice_president",
        "label": "Vice President",
        "default_title": "Vice President",
        "category": "administrative",
        "position_slugs": ["vice_president"],
    },
    {
        "key": "secretary",
        "label": "Secretary",
        "default_title": "Secretary",
        "category": "administrative",
        "position_slugs": ["secretary"],
    },
    {
        "key": "assistant_secretary",
        "label": "Assistant Secretary",
        "default_title": "Assistant Secretary",
        "category": "administrative",
        "position_slugs": ["assistant_secretary"],
    },
    {
        "key": "treasurer",
        "label": "Treasurer",
        "default_title": "Treasurer",
        "category": "administrative",
        "position_slugs": ["treasurer"],
    },
    {
        "key": "quartermaster",
        "label": "Quartermaster",
        "default_title": "Quartermaster",
        "category": "administrative",
        "position_slugs": ["quartermaster"],
    },
]

# Per-office variable suffixes, paired with the description shown in the
# template editor's variable palette ("{label}" is the office label).
OFFICE_VARIABLE_SUFFIXES: list[tuple[str, str]] = [
    ("name", "Full name of the current {label}"),
    ("title", "Signature title for the {label}"),
    ("email", "Email address of the current {label}"),
    ("phone", "Phone number of the current {label}"),
]

OFFICE_KEYS: list[str] = [str(office["key"]) for office in OFFICE_CATALOG]

# Every variable name the office directory may contribute.  Render-time
# injection is filtered through this set so a malformed settings blob can
# never introduce arbitrary template variables.
OFFICE_VARIABLE_NAMES: frozenset[str] = frozenset(
    f"{key}_{suffix}" for key in OFFICE_KEYS for suffix, _ in OFFICE_VARIABLE_SUFFIXES
)

# Key under ``Organization.settings`` holding the flattened, render-ready
# office directory ({"president_name": "...", ...}).  It is a denormalized
# snapshot of the ``organization_officers`` table, rebuilt by
# ``OfficerService.sync_directory`` so that template rendering — which is
# synchronous and already receives the organization — needs no extra query.
ORG_SETTINGS_OFFICER_KEY = "officer_directory"


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
