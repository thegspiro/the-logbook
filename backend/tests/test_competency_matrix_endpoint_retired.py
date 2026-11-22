"""``GET /training/competency-matrix`` is retired (owner decision 2026-11-21).

Nothing in the product called it: no frontend code, no MCP tool. The
Training heat map reads the skills-evaluation view
(``/training/competency/department``) instead. Kept, it was a third grader
of training requirements to keep in step with the compliance matrix
(CLAUDE.md pitfall #29). The route and its service are gone, not stubbed.
No database.
"""

import importlib.util

import pytest

from app.api.v1.endpoints import training

pytestmark = pytest.mark.unit


def test_the_route_is_not_registered():
    paths = {getattr(route, "path", None) for route in training.router.routes}
    assert "/competency-matrix" not in paths


def test_the_service_is_gone():
    assert importlib.util.find_spec("app.services.competency_matrix_service") is None


def test_the_position_skill_matrices_are_untouched():
    # A different feature with a similar name: the per-position skill
    # matrices of the training-enhancements module keep their endpoints.
    from app.api.v1.endpoints import training_enhancements

    names = {route.name for route in training_enhancements.router.routes}
    assert {"create_competency_matrix", "update_competency_matrix"} <= names
