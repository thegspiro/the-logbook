"""Who may edit the operational rank ladder.

The ladder moved from the global settings screen into Members Administration,
and the gate moved with it: every write here accepted ``settings.manage``
alone, so a roster officer arrived on a page whose every control 403'd. The
endpoints now accept ``members.manage`` as well.

Widening a gate is only safe because of what does *not* live in the row. A
rank's permissions come from the hardcoded ``OPERATIONAL_RANKS`` table keyed by
``rank_code`` -- not from anything an editor can type -- and both the create and
update paths run ``_enforce_rank_grant_ceiling`` against that code. The ceiling
is caller-relative, so it binds a ``members.manage`` caller more tightly than
the ``settings.manage`` caller who could reach these handlers before.

DB mocked; no MySQL.
"""

import inspect
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.dependencies import PermissionChecker
from app.api.v1.endpoints import operational_ranks


def _caller(perms):
    return SimpleNamespace(
        id="u1",
        organization_id="org1",
        positions=[SimpleNamespace(permissions=list(perms))],
        rank=None,
    )


def _gate_permissions(handler):
    """The permission strings a handler's require_permission dependency accepts."""
    for param in inspect.signature(handler).parameters.values():
        dependency = getattr(param.default, "dependency", None)
        if isinstance(dependency, PermissionChecker):
            return set(dependency.required_permissions)
    raise AssertionError(f"{handler.__name__} has no PermissionChecker dependency")


class TestLadderGates:
    """Every write the roster officer needs, and nothing that was taken away."""

    @pytest.mark.parametrize(
        "handler",
        [
            operational_ranks.create_rank,
            operational_ranks.update_rank,
            operational_ranks.delete_rank,
            operational_ranks.reorder_ranks,
            operational_ranks.validate_ranks,
        ],
    )
    def test_accepts_members_manage(self, handler):
        assert "members.manage" in _gate_permissions(handler)

    @pytest.mark.parametrize(
        "handler",
        [
            operational_ranks.create_rank,
            operational_ranks.update_rank,
            operational_ranks.delete_rank,
            operational_ranks.reorder_ranks,
            operational_ranks.validate_ranks,
        ],
    )
    def test_still_accepts_settings_manage(self, handler):
        # Additive, not a swap. require_permission is OR logic, so every
        # existing settings.manage holder keeps exactly the access they had.
        assert "settings.manage" in _gate_permissions(handler)

    def test_reads_are_not_gated_on_either(self):
        # list/get were open to any authenticated member before this change and
        # stay that way -- widening the writes must not narrow the reads.
        for handler in (operational_ranks.list_ranks, operational_ranks.get_rank):
            with pytest.raises(AssertionError):
                _gate_permissions(handler)


class TestCreateCeiling:
    """create_rank had no ceiling while only settings.manage could reach it."""

    async def test_members_manage_cannot_author_a_chief_coded_rung(self):
        caller = _caller(["members.manage"])
        data = SimpleNamespace(rank_code="fire_chief")

        with patch(
            "app.api.v1.endpoints.users.report_privilege_escalation_attempt",
            new=AsyncMock(),
        ):
            with pytest.raises(HTTPException) as exc:
                await operational_ranks.create_rank(
                    request=MagicMock(client=None, headers={}),
                    data=data,
                    db=MagicMock(),
                    current_user=caller,
                )

        assert exc.value.status_code == 403

    async def test_the_ceiling_runs_before_the_row_is_written(self):
        # Ordering is the whole point: a refused create that had already written
        # the row would leave a chief-coded rung in the ladder behind a request
        # the caller was told had failed.
        caller = _caller(["members.manage"])
        created = AsyncMock()

        with patch.object(
            operational_ranks.OperationalRankService, "create_rank", new=created
        ):
            with patch(
                "app.api.v1.endpoints.users.report_privilege_escalation_attempt",
                new=AsyncMock(),
            ):
                with pytest.raises(HTTPException):
                    await operational_ranks.create_rank(
                        request=MagicMock(client=None, headers={}),
                        data=SimpleNamespace(rank_code="fire_chief"),
                        db=MagicMock(),
                        current_user=caller,
                    )

        created.assert_not_awaited()

    async def test_a_rung_within_the_caller_s_own_grants_is_allowed(self):
        caller = _caller(["*"])
        rank = SimpleNamespace(
            id="00000000-0000-0000-0000-000000000001",
            organization_id="00000000-0000-0000-0000-000000000002",
            rank_code="probationary",
            display_name="Probationary",
            description=None,
            sort_order=0,
            is_active=True,
            eligible_positions=[],
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )

        with patch.object(
            operational_ranks.OperationalRankService,
            "create_rank",
            new=AsyncMock(return_value=rank),
        ):
            result = await operational_ranks.create_rank(
                request=MagicMock(client=None, headers={}),
                data=SimpleNamespace(rank_code="probationary"),
                db=MagicMock(),
                current_user=caller,
            )

        assert result.rank_code == "probationary"
