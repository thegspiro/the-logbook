"""
Centralized Constants

Single source of truth for role group slugs, business configuration defaults,
and other values that were previously scattered as string literals across services.

All configurable values should be referenced by constant, never by raw string.
"""

# ============================================
# Configurable Role Defaults
# ============================================
# Position slugs a department may override through its own settings. These are
# fallbacks, not authorities: if a lookup here misses, the department's own
# configuration is the thing to correct.
#
# The *notification* groups — LEADERSHIP_ROLE_SLUGS, ADMIN_NOTIFY_ROLE_SLUGS and
# TRAINING_OFFICER_ROLE_SLUGS — are not here. They are derived from
# OFFICE_CATALOG and so are defined below it, under "Role Groups".

# OPERATIONAL_ROLE_SLUGS and ADMINISTRATIVE_ROLE_SLUGS were removed on
# 2026-08-26. Neither had ever been read: each had exactly one reference in
# the codebase, its own definition. They were not harmless, because they read
# as a third authority on the rank vocabulary and disagreed with both real
# ones — listing ``chief`` where ``operational_ranks`` seeds ``fire_chief``,
# and offering ``driver`` and ``paramedic``, which are not ranks at all and
# grant nothing. Election voter eligibility is decided by the member's
# ``membership_type``; see ``ElectionService._user_has_role_type()``.

# Default training officer roles for cert alert config fallback.
#
# ``assistant_training_officer`` is not a seeded position and resolves to
# nobody; ``training_officer`` carries the list. Left as written because these
# two are fallbacks behind ``cert_alert_config``, which a department fills in
# with its own position slugs — naming a position a department may reasonably
# have invented is the point. ``tests/test_role_group_slugs.py`` allows them
# explicitly so the exception is recorded rather than assumed.
DEFAULT_TRAINING_OFFICER_ROLES: list[str] = [
    "training_officer",
    "assistant_training_officer",
]

# Same, and worth knowing: no position is seeded with this slug, so on a stock
# install this list resolves to the empty set rather than to a smaller one.
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

# ROLE_CHIEF was removed on 2026-08-26. It was ``"chief"``, and no position with
# that slug is ever seeded — the chief's slug is ``fire_chief`` — so every
# lookup through it silently matched nobody. There is no single slug that
# answers "the chief", because a department may hold either spelling, so the
# replacement is a list: CHIEF_POSITION_SLUGS, below.


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
    {
        "key": "ems_supply_officer",
        "label": "EMS Supply Officer",
        "default_title": "EMS Supply Officer",
        "category": "operational",
        "position_slugs": ["ems_supply_officer"],
    },
]

# ============================================
# Role Groups
# ============================================
# Sets of positions a notification or an access check addresses collectively.
#
# **Every member is an office key, expanded through OFFICE_CATALOG.** That
# indirection is the whole point. Until 2026-08-26 these were hand-written slug
# lists naming ``"chief"``, and no position with that slug is ever seeded — the
# seeded slug is ``fire_chief`` — so the chief was silently absent from election
# rollback alerts, member-drop and auto-archive notices, the overdue-property
# report, and the store's admin heads-up. ``OFFICE_CATALOG``'s chief entry
# already knew the two spellings were one office; nothing else did.
#
# Expanding rather than replacing matters: ``"chief"`` remains reachable as a
# real slug, because an admin who names a custom position "Chief" gets it from
# ``slugify`` (``role_service.slugify``) or from the onboarding wizard's custom
# position field. A department on either spelling is now addressed correctly,
# and one holding both resolves to both — so **call sites must dedupe by user**,
# since a member could hold two positions in the same group.
#
# ``tests/test_role_group_slugs.py`` asserts every slug these produce is one a
# department can actually hold.


def position_slugs_for_offices(*office_keys: str) -> list[str]:
    """Expand office keys to the position slugs that hold them.

    A key with no catalog entry passes through unchanged, so a group may name a
    position that is not an office (``it_manager``, ``training_officer``)
    without needing one invented for it.
    """
    by_key = {str(office["key"]): office for office in OFFICE_CATALOG}
    slugs: list[str] = []
    for key in office_keys:
        office = by_key.get(key)
        expanded = (
            [str(slug) for slug in office["position_slugs"]]  # type: ignore[union-attr]
            if office
            else [key]
        )
        for slug in expanded:
            if slug not in slugs:
                slugs.append(slug)
    return slugs


# Leadership roles notified on critical events (election rollbacks, deletions).
LEADERSHIP_ROLE_SLUGS: list[str] = position_slugs_for_offices(
    "chief", "president", "vice_president", "secretary"
)

# Admin-level roles CC'd on member drops, archive notifications, etc.
#
# ``it_manager`` stands where ``"admin"`` used to. There has never been a
# position slugged ``admin``; the System Owner position is ``it_manager``, and
# it is the one that actually carries the authority this group reaches for
# (``get_admin_position_slugs`` in ``core.permissions`` names it first).
ADMIN_NOTIFY_ROLE_SLUGS: list[str] = position_slugs_for_offices(
    "it_manager", "quartermaster", "chief"
)

# Roles that grant officer-level access in training module config.
TRAINING_OFFICER_ROLE_SLUGS: list[str] = position_slugs_for_offices(
    "it_manager", "training_officer", "chief"
)

# Every spelling of "the chief" a department may hold. Replaces ROLE_CHIEF,
# which named only the one spelling no department is ever given.
CHIEF_POSITION_SLUGS: list[str] = position_slugs_for_offices("chief")


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
