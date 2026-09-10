"""
Security-review finding (training extended, 2026-09-10): TRX4-2.

``GET /instructors/qualifications``, ``GET
/instructors/qualifications/{course_id}/qualified``, and ``GET
/instructors/validate/{user_id}/{course_id}`` (all in
``training_enhancements.py``) depended only on ``get_current_user`` — no
permission dependency at all — while the sibling POST/PATCH routes on the
same resource already required ``training.manage``. The frontend route
(``/training/admin``, which hosts the Instructors tab) and
``docs/training/02-training.md`` both describe instructor-qualification
management as ``training.manage``-gated, so the backend GET routes let any
authenticated member bypass that gate entirely: an org-wide dump of every
instructor's certification number, issuing agency, and expiry
(``get_instructor_qualifications`` with no filters), the qualified-instructor
roster for any course, and a named member's instructor-qualification verdict
for any course — all with no permission check.

Caught by a Codex review round on PR #2460 (which itself only set out to
retire a stale cacheability claim about the third route — TRX4-1 — and, in
verifying that claim, surfaced that the read was reachable in the first
place). Fixed by gating all three the same way the file's other
``training.manage``-only routes already are.

Follows the ``_permission_set`` introspection pattern from
``test_equipment_check_endpoint_permissions.py``: no HTTP round-trip, no DB,
just confirms the route's ``Depends(require_permission(...))`` wiring.
"""

import pytest

from app.api.v1.endpoints.training_enhancements import router


def _permission_set(path: str, method: str) -> set[str]:
    for route in router.routes:
        if route.path == path and method in route.methods:
            for dependency in route.dependant.dependencies:
                permissions = getattr(dependency.call, "required_permissions", None)
                if permissions is not None:
                    return set(permissions)
    pytest.fail(f"Permission dependency not found for {method} {path}")


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/instructors/qualifications", "GET"),
        ("/instructors/qualifications/{course_id}/qualified", "GET"),
        ("/instructors/validate/{user_id}/{course_id}", "GET"),
    ],
)
def test_instructor_qualification_reads_require_training_manage(path, method):
    assert _permission_set(path, method) == {"training.manage"}


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/instructors/qualifications", "POST"),
        ("/instructors/qualifications/{qual_id}", "PATCH"),
    ],
)
def test_instructor_qualification_writes_still_require_training_manage(path, method):
    """Unchanged by this fix — asserted so a future edit cannot silently
    loosen the write side while "fixing" the read side back open."""
    assert _permission_set(path, method) == {"training.manage"}
