"""Every route that names an applicant declares the access it needs.

A route with ``{prospect_id}`` in its path reads or changes one applicant, and
since per-applicant access that is decided by require_prospect_access
(app/api/prospect_access.py): view_all, or an assignment to that applicant. A
new route gated by require_permission alone would fall back to the old rule,
where any holder of the pipeline permission saw every applicant, so this
fails on one rather than leaving it to review.
"""

import pytest

from app.api.v1.endpoints.membership_pipeline import router

pytestmark = [pytest.mark.unit]

# Routes that name an applicant on purpose without the per-applicant check,
# each with the reason.
EXEMPT = {
    # A Multi-Signer Approval signer (the Chief, the President) records their
    # own sign-off by the role the stage names; the service checks the role,
    # and holding it is not a grant to read the applicant's file.
    ("POST", "/prospects/{prospect_id}/approve-step"),
}


def _levels(dependant) -> set:
    found = set()
    for dependency in dependant.dependencies:
        level = getattr(dependency.call, "prospect_access_level", None)
        if level is not None:
            found.add(level)
        found |= _levels(dependency)
    return found


def _routes_naming_an_applicant():
    for route in router.routes:
        if "{prospect_id}" not in getattr(route, "path", ""):
            continue
        for method in sorted(route.methods or ()):
            yield method, route.path, route


def test_every_route_naming_an_applicant_declares_its_access():
    missing = [
        f"{method} {path}"
        for method, path, route in _routes_naming_an_applicant()
        if (method, path) not in EXEMPT and not _levels(route.dependant)
    ]

    assert not missing, (
        "These routes name an applicant without require_prospect_access, so "
        "any holder of their permission reaches every applicant:\n  "
        + "\n  ".join(missing)
    )


def test_the_exemptions_still_exist():
    present = {(method, path) for method, path, _ in _routes_naming_an_applicant()}

    assert EXEMPT <= present, EXEMPT - present
