"""Who sees department-wide shift-report analytics.

Every company officer holds ``training.manage`` to file reports, so the
"Written by me" summary must cover only the caller's reports; the department
totals need ``training.view_analytics``. The endpoint is called directly with a
stand-in user and a stubbed service — what is under test is the gate and which
officer the service is asked about, not the SQL (covered in
``test_shift_completion.py``).
"""

import importlib.util
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import shift_completion as endpoint
from app.core.permissions import DEFAULT_POSITIONS, OPERATIONAL_RANKS

pytestmark = [pytest.mark.unit]

_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261004_1459_84819ea78a79_grant_training_view_analytics_to_.py"
)


def _user(*permissions: str):
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        organization_id=str(uuid.uuid4()),
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
    )


@pytest.fixture
def analytics(monkeypatch):
    stub = AsyncMock(return_value={"total_reports": 0})
    monkeypatch.setattr(endpoint.ShiftCompletionService, "get_officer_analytics", stub)
    return stub


class TestEndpointScope:
    async def test_mine_is_the_default_and_names_the_caller(self, analytics):
        user = _user("training.manage")
        await endpoint.get_officer_analytics(scope="mine", db=None, current_user=user)
        analytics.assert_awaited_once_with(
            organization_id=user.organization_id, officer_id=user.id
        )

    async def test_department_is_refused_without_the_analytics_permission(
        self, analytics
    ):
        with pytest.raises(HTTPException) as exc:
            await endpoint.get_officer_analytics(
                scope="department", db=None, current_user=_user("training.manage")
            )
        assert exc.value.status_code == 403
        analytics.assert_not_awaited()

    async def test_department_is_served_to_leadership_unscoped(self, analytics):
        user = _user("training.manage", "training.view_analytics")
        await endpoint.get_officer_analytics(
            scope="department", db=None, current_user=user
        )
        analytics.assert_awaited_once_with(
            organization_id=user.organization_id, officer_id=None
        )


class TestRegistryGrants:
    @pytest.mark.parametrize("rank", ["fire_chief", "deputy_chief", "assistant_chief"])
    def test_chief_ranks_hold_it(self, rank):
        assert (
            "training.view_analytics" in OPERATIONAL_RANKS[rank]["default_permissions"]
        )

    @pytest.mark.parametrize("rank", ["captain", "lieutenant"])
    def test_company_officers_do_not(self, rank):
        # They hold training.manage to file reports; that must not carry the
        # department's totals with it.
        perms = OPERATIONAL_RANKS[rank]["default_permissions"]
        assert "training.manage" in perms
        assert "training.view_analytics" not in perms

    @pytest.mark.parametrize("slug", ["president", "training_officer"])
    def test_leadership_positions_hold_it(self, slug):
        assert "training.view_analytics" in DEFAULT_POSITIONS[slug]["permissions"]


def _migration():
    spec = importlib.util.spec_from_file_location("_va_migration", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestMigrationGate:
    def test_migration_slugs_match_the_registry(self):
        # Frozen in the migration; this keeps the two from drifting apart.
        registry = {
            slug
            for slug, pos in DEFAULT_POSITIONS.items()
            if "training.view_analytics" in (pos.get("permissions") or [])
        }
        assert set(_migration()._SLUGS) == registry

    def test_grants_a_row_that_still_manages_training(self):
        assert _migration().grant(["training.manage", "users.view"]) == [
            "training.manage",
            "users.view",
            "training.view_analytics",
        ]

    def test_leaves_a_row_whose_training_access_was_removed(self):
        assert _migration().grant(["users.view"]) is None

    @pytest.mark.parametrize("held", ["*", "training.*", "training.view_analytics"])
    def test_leaves_a_row_already_covered(self, held):
        assert _migration().grant(["training.manage", held]) is None

    def test_downgrade_removes_only_the_grant(self):
        assert _migration().revoke(["training.manage", "training.view_analytics"]) == [
            "training.manage"
        ]
        assert _migration().revoke(["training.manage"]) is None
