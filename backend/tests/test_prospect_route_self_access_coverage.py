"""
Every membership-pipeline route either hides the caller's own application or
says why it does not need to.

The router-wide ``block_self_prospect_access`` guard keys on the
``{prospect_id}`` path parameter, so any route without one gets no protection
from it. Lists, aggregates and body-id bulk actions have to apply
``get_hidden_prospect_ids`` themselves. ``GET /my-sign-offs`` shipped without
it (MP-32) and ``purge-inactive`` had the same gap. Neither was caught by
reading a diff: MP-32 was found only because a review re-listed every route by
hand. This test does that listing on every run, so a new route without
``{prospect_id}`` fails until it either filters or is added to ``EXEMPT`` with
a reason.
"""

import pytest
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from app.api.prospect_privacy import (
    block_self_interview_access,
    get_hidden_prospect_ids,
)
from app.api.v1.endpoints import membership_pipeline as pipeline_endpoints

pytestmark = [pytest.mark.unit]

# Routes that need neither filter. Each reason says what the route returns or
# changes and why that cannot expose or alter the caller's own application.
# A route that lists, counts or acts on applicants does not belong here.
EXEMPT: dict[tuple[str, str], str] = {
    ("GET", "/pipelines"): (
        "pipeline definitions; prospect_count is a bare per-pipeline total"
    ),
    ("POST", "/pipelines"): "creates a pipeline definition",
    ("GET", "/pipelines/{pipeline_id}"): "pipeline definition and its steps",
    ("PUT", "/pipelines/{pipeline_id}"): "edits a pipeline definition",
    ("PATCH", "/pipelines/{pipeline_id}/report-settings"): (
        "edits a pipeline's report settings"
    ),
    ("DELETE", "/pipelines/{pipeline_id}"): (
        "refuses while active or on-hold applicants remain; finished ones are "
        "detached, not deleted"
    ),
    ("POST", "/pipelines/{pipeline_id}/duplicate"): (
        "copies the definition, not its applicants"
    ),
    ("POST", "/pipelines/{pipeline_id}/seed-templates"): "adds template steps",
    ("GET", "/validate-form/{form_id}"): "checks a form's field mapping",
    ("GET", "/pipelines/{pipeline_id}/steps"): "step definitions",
    ("POST", "/pipelines/{pipeline_id}/steps"): "adds a step definition",
    ("PUT", "/pipelines/{pipeline_id}/steps/reorder"): "reorders step definitions",
    ("PUT", "/pipelines/{pipeline_id}/steps/{step_id}"): "edits a step definition",
    ("DELETE", "/pipelines/{pipeline_id}/steps/{step_id}"): (
        "deletes a step definition"
    ),
    ("POST", "/prospects/process-inactivity"): (
        "the scheduled org-wide inactivity sweep run on demand; returns counts "
        "only, and changes nothing the scheduled run would not"
    ),
}


def _dependency_calls(dependant: Dependant):
    for sub in dependant.dependencies:
        yield sub.call
        yield from _dependency_calls(sub)


def _routes_without_prospect_id():
    for route in pipeline_endpoints.router.routes:
        if isinstance(route, APIRoute) and "{prospect_id}" not in route.path:
            for method in route.methods:
                yield method, route.path, set(_dependency_calls(route.dependant))


class TestEveryRouteWithoutProspectIdIsCovered:

    def test_each_route_filters_guards_or_is_exempt(self):
        uncovered = [
            f"{method} {path}"
            for method, path, calls in _routes_without_prospect_id()
            if get_hidden_prospect_ids not in calls
            and block_self_interview_access not in calls
            and (method, path) not in EXEMPT
        ]

        assert not uncovered, (
            "These membership-pipeline routes carry no {prospect_id}, so the "
            "router guard never runs for them. Depend on "
            "get_hidden_prospect_ids, or add them to EXEMPT with a reason: "
            f"{uncovered}"
        )

    def test_exempt_entries_still_name_real_unfiltered_routes(self):
        """A stale entry would quietly exempt whatever is added at that path
        next, and an entry for a route that now filters hides that it does."""
        unfiltered = {
            (method, path)
            for method, path, calls in _routes_without_prospect_id()
            if get_hidden_prospect_ids not in calls
        }

        assert set(EXEMPT) <= unfiltered, set(EXEMPT) - unfiltered

    def test_the_known_filtered_routes_are_still_found(self):
        """Proves the dependency walk sees an endpoint-level Depends, so the
        first test cannot pass by finding nothing."""
        filtered = {
            (method, path)
            for method, path, calls in _routes_without_prospect_id()
            if get_hidden_prospect_ids in calls
        }

        assert {
            ("GET", "/my-sign-offs"),
            ("POST", "/pipelines/{pipeline_id}/purge-inactive"),
            ("POST", "/prospects/bulk-advance"),
            ("POST", "/prospects/check-existing"),
            ("POST", "/prospects"),
        } <= filtered
