"""
Self-service medical compliance route (GET /medical-screening/compliance/me).

A member reads their own screening compliance without holding
``medical_screening.view``, which is the officer permission that reads
*anybody's*. Two properties keep that from widening access, and both are
structural rather than checked at runtime — so they are asserted here:

  1. The route takes no id. The subject comes from the authenticated session,
     so there is nothing for a caller to substitute and no IDOR surface.
  2. It is registered before ``/compliance/{user_id}``. FastAPI matches routes
     in registration order; reversed, "me" would be captured as a user id by
     the permission-gated route and the member's own read would 403.

No DB, no MySQL — this inspects the router.
"""

import inspect

from app.api.dependencies import PermissionChecker, get_current_user
from app.api.v1.endpoints import medical_screening as ep


def _route(path: str):
    for route in ep.router.routes:
        if getattr(route, "path", None) == path:
            return route
    raise AssertionError(f"no route registered for {path}")


def _route_index(path: str) -> int:
    for i, route in enumerate(ep.router.routes):
        if getattr(route, "path", None) == path:
            return i
    raise AssertionError(f"no route registered for {path}")


class TestSelfScoping:
    def test_route_exists(self):
        assert _route("/compliance/me") is not None

    def test_takes_no_id_parameter(self):
        """Nothing for a caller to substitute — the subject is the session."""
        params = inspect.signature(ep.get_my_compliance).parameters

        assert "user_id" not in params
        assert "prospect_id" not in params
        assert set(params) == {"db", "current_user"}

    def test_subject_comes_from_the_authenticated_session(self):
        """current_user resolves via get_current_user, not a permission gate."""
        dependency = inspect.signature(ep.get_my_compliance).parameters["current_user"]

        assert dependency.default.dependency is get_current_user

    def test_registered_before_the_admin_route(self):
        """Otherwise "me" is captured as a user id by the gated route."""
        assert _route_index("/compliance/me") < _route_index("/compliance/{user_id}")

    def test_admin_route_still_requires_the_permission(self):
        """The self-service route must not have loosened the other one."""
        dependency = inspect.signature(ep.get_user_compliance).parameters[
            "current_user"
        ]
        checker = dependency.default.dependency

        # require_permission builds a PermissionChecker holding the strings.
        assert checker is not get_current_user
        assert isinstance(checker, PermissionChecker)
        assert "medical_screening.view" in checker.required_permissions


class TestResponseShape:
    def test_returns_the_counts_only_schema(self):
        """The dashboard must not be handed the itemised summary."""
        from app.schemas.medical_screening import ComplianceSummary, MyComplianceSummary

        assert _route("/compliance/me").response_model is MyComplianceSummary
        assert _route("/compliance/{user_id}").response_model is ComplianceSummary

    def test_counts_schema_has_no_itemised_fields(self):
        from app.schemas.medical_screening import MyComplianceSummary

        fields = set(MyComplianceSummary.model_fields)

        assert "items" not in fields
        for leaky in (
            "requirement_name",
            "screening_type",
            "status",
            "expiration_date",
        ):
            assert leaky not in fields
