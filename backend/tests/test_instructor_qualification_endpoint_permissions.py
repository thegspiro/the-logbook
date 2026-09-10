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
place). First fixed by gating all three to ``training.manage`` only,
matching the file's write-side routes on the same resource.

**Correction, caught by a second Codex review round on the same PR:**
gating to ``training.manage`` alone silently dropped read-only officer
access. ``training.view_all`` is this codebase's established read-only
officer tier for training data — ``training_programs.py``'s own
``get_program_enrollments`` already gates the equivalent org-wide
enrollment read with
``require_permission("training.view_all", "training.manage")``, and this
file's own ``can_view_officer_training_data`` helper treats the two as
equally sufficient everywhere else it gates a read. The three routes here
now use the same two-permission OR-gate as `get_program_enrollments`,
so a custom read-only role holding ``training.view_all`` without
``training.manage`` keeps seeing qualification data while an ordinary
member still cannot. The write-side POST/PATCH routes are deliberately
unchanged — creating or editing a qualification stays ``training.manage``
only.

Follows the ``_permission_set`` introspection pattern from
``test_equipment_check_endpoint_permissions.py``: no HTTP round-trip, no DB,
just confirms the route's ``Depends(require_permission(...))`` wiring.
"""

from types import SimpleNamespace

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


def _permission_dependency(path: str, method: str):
    for route in router.routes:
        if route.path == path and method in route.methods:
            return next(
                dependency.call
                for dependency in route.dependant.dependencies
                if getattr(dependency.call, "required_permissions", None) is not None
            )
    pytest.fail(f"Permission dependency not found for {method} {path}")


def _user_with(*permissions: str):
    return SimpleNamespace(
        id="user-1",
        organization_id="org-1",
        rank=None,
        positions=[SimpleNamespace(permissions=list(permissions))],
    )


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/instructors/qualifications", "GET"),
        ("/instructors/qualifications/{course_id}/qualified", "GET"),
        ("/instructors/validate/{user_id}/{course_id}", "GET"),
    ],
)
def test_instructor_qualification_reads_accept_view_all_or_manage(path, method):
    assert _permission_set(path, method) == {"training.view_all", "training.manage"}


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


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/instructors/qualifications", "GET"),
        ("/instructors/qualifications/{course_id}/qualified", "GET"),
        ("/instructors/validate/{user_id}/{course_id}", "GET"),
    ],
)
@pytest.mark.parametrize(
    "permissions",
    [("training.view_all",), ("training.manage",)],
    ids=["view-all-only", "manage"],
)
async def test_view_all_or_manage_holder_is_authorized(path, method, permissions):
    user = _user_with(*permissions)

    assert await _permission_dependency(path, method)(current_user=user) is user


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/instructors/qualifications", "GET"),
        ("/instructors/qualifications/{course_id}/qualified", "GET"),
        ("/instructors/validate/{user_id}/{course_id}", "GET"),
    ],
)
async def test_member_with_neither_permission_is_rejected(path, method):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        await _permission_dependency(path, method)(current_user=_user_with())

    assert exc_info.value.status_code == 403
