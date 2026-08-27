"""What a plain member is seeded with, and why each exclusion is deliberate.

A department's rank-and-file hold two seeded grant sets at once: the
``member`` position (``DEFAULT_POSITIONS``) and the ``firefighter`` rank
(``OPERATIONAL_RANKS``). Their union is what every volunteer can do on day
one, and a permission added to either is added to everybody.

That makes an innocuous-looking ``*.view`` grant the easiest way to widen
access by accident. It does not have to open a page of its own: it only has to
appear as one alternative in an ``require_permission(a, b, c)`` OR-gate
somewhere, and the endpoint behind it is open to the whole department.

``compliance.view`` did exactly that until 2026-08-24 — see
``test_compliance_view_is_not_a_baseline_grant``.
"""

from app.core.permissions import DEFAULT_POSITIONS, OPERATIONAL_RANKS

#: Grants a plain volunteer holds. Three entries, not two, and the third is the
#: one that bites: ``DEFAULT_POSITIONS["firefighter"]["permissions"]`` *is*
#: ``OPERATIONAL_RANKS["firefighter"]["default_permissions"]`` — the same list
#: object — so onboarding writes a system **position** with slug
#: ``firefighter`` carrying a copy of the rank's grants, and
#: ``dependencies.py`` unions every assigned position's stored permissions.
#:
#: That indirection is why "ranks resolve at runtime, so no data migration is
#: needed" was wrong when this file was first written: the rank's grants do
#: reach the database, by way of a position. Asserted on all three so the
#: persisted path is covered explicitly even while two of them alias.
#:
#: The registries also spell the field differently — positions store
#: ``permissions``, ranks store ``default_permissions``.
#:
#: The EMT rank is the fourth, and shares Firefighter's list object rather
#: than repeating it — same standing, different discipline. It is named here
#: anyway: a future edit could split the two, and a source that stops aliasing
#: must not thereby stop being checked.
BASELINE_SOURCES = (
    ("member position", DEFAULT_POSITIONS, "member", "permissions"),
    ("firefighter position", DEFAULT_POSITIONS, "firefighter", "permissions"),
    ("firefighter rank", OPERATIONAL_RANKS, "firefighter", "default_permissions"),
    ("emt rank", OPERATIONAL_RANKS, "emt", "default_permissions"),
)


def _baseline_permissions() -> set[str]:
    granted: set[str] = set()
    for _label, registry, slug, field in BASELINE_SOURCES:
        granted.update(registry[slug][field])
    return granted


#: Everything the 2026-08-25 ``notifications.view`` revocation covers. The
#: baseline three plus the Engineer rank and the position that mirrors it —
#: Engineer is a driver/operator, not an officer, and the Send Log is no more
#: their business than a firefighter's.
NOTIFICATIONS_REVOKED_SOURCES = BASELINE_SOURCES + (
    ("engineer position", DEFAULT_POSITIONS, "engineer", "permissions"),
    ("engineer rank", OPERATIONAL_RANKS, "engineer", "default_permissions"),
)


def test_notifications_view_is_not_a_baseline_grant():
    """The Send Log it opens is scoped to the org, not to the recipient.

    ``notifications.view`` gates ``GET /notifications/logs``, and
    ``NotificationsService.get_logs`` filters on ``organization_id`` alone —
    there is no recipient scoping anywhere on that path. ``NotificationLog``
    stores ``recipient_email``, ``subject`` and ``message``, so a grant seeded
    to the whole department let any member read the body of every notification
    sent to every other member.

    Withholding it costs a member nothing they can act on: their own inbox is
    ``GET /notifications/my``, which depends on ``get_current_user`` and no
    permission at all. What they lose is three admin tabs, one of which
    (Email Templates) was already a dead end — its only control navigates to a
    route requiring ``settings.manage``.

    Revoked from the seeded rows by migration ``a1f7c34e9b02``; per the
    ``compliance.view`` precedent, the registry edit alone would have left the
    grant live on every department that has already onboarded.
    """
    for label, registry, slug, field in NOTIFICATIONS_REVOKED_SOURCES:
        assert "notifications.view" not in registry[slug][field], (
            f"the seeded {label} carries notifications.view, which opens the "
            "org-wide Send Log — every member's notification subjects and "
            "bodies, readable by anyone"
        )


def test_compliance_view_is_not_a_baseline_grant():
    """``compliance.view`` is an officer grant wearing a view grant's name.

    It is an accepted alternative on two officer-grade checks, so seeding it
    to everyone handed the whole department both:

    * ``GET /compliance-officer/contributed-hours`` — accepts
      ``training.manage`` OR ``reports.view`` OR ``compliance.view``, and
      returns hours contributed by *all* members.
    * ``GET /admin-hours/.../compliance`` — confines non-admins to their own
      record *unless* they hold ``admin_hours.manage``, ``compliance.view`` or
      ``*``. Universally granting it meant that narrowing never applied, and
      any member could read any other member's compliance progress.

    The codebase already reasons this way one line below the removal site,
    where ``equipment_check.view`` is withheld from members precisely because
    "it also opens the compliance/failure reports". Same argument, same answer.
    """
    for label, registry, slug, field in BASELINE_SOURCES:
        assert "compliance.view" not in registry[slug][field], (
            f"the seeded {label} carries compliance.view, which opens other "
            "members' compliance records through OR-gated endpoints"
        )


def test_baseline_holds_no_manage_grant():
    """No ``.manage`` grant belongs in the day-one set.

    A management grant seeded to everybody is not a smaller version of the
    same problem — it is a write. Kept as a standing assertion rather than a
    review habit, because the two seed sites are 400 lines apart and neither
    shows what the other already grants.
    """
    manage = sorted(p for p in _baseline_permissions() if p.endswith(".manage"))
    assert manage == [], f"baseline members would hold management grants: {manage}"


def test_facilities_view_is_not_a_baseline_grant():
    """Facility records are an officer/manager workspace, not a member amenity."""
    for label, registry, slug, field in BASELINE_SOURCES:
        assert "facilities.view" not in registry[slug][field], (
            f"the seeded {label} carries facilities.view, which opens the "
            "leadership facilities workspace to regular members"
        )


def test_baseline_excludes_the_reporting_and_audit_grants():
    """Department-wide reporting stays with the officers who answer for it.

    ``reports.view``, ``audit.view`` and ``analytics.view`` each aggregate
    across members, and ``training.view_all`` reads every member's record
    rather than the holder's own. All four belong to
    ``_LEADERSHIP_VIEW_PERMISSIONS``; none should reach the baseline set.
    """
    granted = _baseline_permissions()
    aggregating = ("reports.view", "audit.view", "analytics.view", "training.view_all")
    for permission in aggregating:
        assert permission not in granted, (
            f"{permission} aggregates across members and must not be seeded "
            "to the whole department"
        )


def test_storefront_browsing_is_a_baseline_grant():
    """Every member can reach the department store.

    The store is a member-facing amenity, not an officer tool: the whole point
    is that the rank and file order their own job shirts instead of a
    quartermaster collecting sizes on paper. ``storefront.view`` gates the
    ``/store`` route and ``storefront.order`` the submit, so a baseline that
    omits either leaves the navigation showing a store that bounces the member
    who taps it.

    The gap this guards is not the registry — it is the *stored* copy. Rank
    defaults resolve at runtime, so every member carrying an operational rank
    holds these regardless; the members who lost the store are the ones with
    no rank at all (administrative, social and support members), who hold only
    the ``member`` position as onboarding wrote it. Migration
    ``a4f8c1b92d17`` backfills the rows written before these grants existed.
    """
    baseline = _baseline_permissions()
    assert "storefront.view" in baseline
    assert "storefront.order" in baseline


def test_storefront_manage_is_not_a_baseline_grant():
    """Running the store is the quartermaster's, not everybody's.

    ``storefront.manage`` is the whole admin console — catalog pricing and
    cost, order windows, every member's orders, and payment reconciliation.
    """
    assert "storefront.manage" not in _baseline_permissions()
