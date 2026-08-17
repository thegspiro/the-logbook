"""Authorization regressions for member leave scheduling side effects."""

import pytest

from app.api.dependencies import AllPermissionChecker
from app.api.v1.endpoints.member_leaves import router


def test_create_leave_requires_member_and_scheduling_permissions():
    """Member managers alone must not be able to cancel shift assignments."""
    for route in router.routes:
        if route.path == "/leaves-of-absence" and "POST" in route.methods:
            permission_dependencies = [
                dependency.call
                for dependency in route.dependant.dependencies
                if hasattr(dependency.call, "required_permissions")
            ]
            assert len(permission_dependencies) == 1
            checker = permission_dependencies[0]
            assert isinstance(checker, AllPermissionChecker)
            assert set(checker.required_permissions) == {
                "members.manage",
                "scheduling.assign",
            }
            return

    pytest.fail("POST /leaves-of-absence route not found")
