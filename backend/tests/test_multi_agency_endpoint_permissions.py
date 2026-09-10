"""
Security-review finding (training extended, 2026-09-10): TRX4-6.

``GET /multi-agency`` (``training_enhancements.py``) depended only on
``get_current_user`` — no permission dependency at all — while the sibling
POST/PATCH routes on the same resource already require ``training.manage``.
The response (``MultiAgencyTrainingResponse``) carries each participating
organization's ``contact_name``/``contact_email``, ``ics_position_assignments``
(per-position user ids), ``created_by``, and free-text after-action material
(TRX4-4's own findings). Its only frontend consumer,
``MultiAgencySection`` in ``TrainingEnhancementsTab.tsx``, is reachable only
through the ``training.manage``-gated ``/training/admin`` route, so the
backend route let any authenticated member bypass that gate entirely.

Caught by a Codex review round on PR #2460 while verifying TRX4-4 (which had
only added the route to ``UNCACHEABLE_PREFIXES`` — a fix for stale
retention, not for the underlying unauthorized read). Fixed with the same
``training.view_all``/``training.manage`` OR-gate TRX4-2 already established
for this file's other under-gated reads.

Follows the ``_permission_set`` introspection pattern from
``test_equipment_check_endpoint_permissions.py`` /
``test_instructor_qualification_endpoint_permissions.py``.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

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


def test_get_multi_agency_exercises_accepts_view_all_or_manage():
    assert _permission_set("/multi-agency", "GET") == {
        "training.view_all",
        "training.manage",
    }


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/multi-agency", "POST"),
        ("/multi-agency/{exercise_id}", "PATCH"),
    ],
)
def test_multi_agency_writes_still_require_training_manage(path, method):
    """Unchanged by this fix."""
    assert _permission_set(path, method) == {"training.manage"}


@pytest.mark.parametrize(
    "permissions",
    [("training.view_all",), ("training.manage",)],
    ids=["view-all-only", "manage"],
)
async def test_view_all_or_manage_holder_is_authorized(permissions):
    user = _user_with(*permissions)

    assert (
        await _permission_dependency("/multi-agency", "GET")(current_user=user) is user
    )


async def test_member_with_neither_permission_is_rejected():
    with pytest.raises(HTTPException) as exc_info:
        await _permission_dependency("/multi-agency", "GET")(current_user=_user_with())

    assert exc_info.value.status_code == 403
