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

#: Grants a plain volunteer holds: the ``member`` position plus the
#: ``firefighter`` rank, which is what a new sign-up is given. The two
#: registries spell the field differently — positions store ``permissions``,
#: ranks store ``default_permissions`` — so each is read by its own key rather
#: than a shared one.
BASELINE_SOURCES = (
    ("member position", DEFAULT_POSITIONS, "member", "permissions"),
    ("firefighter rank", OPERATIONAL_RANKS, "firefighter", "default_permissions"),
)


def _baseline_permissions() -> set[str]:
    granted: set[str] = set()
    for _label, registry, slug, field in BASELINE_SOURCES:
        granted.update(registry[slug][field])
    return granted


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
