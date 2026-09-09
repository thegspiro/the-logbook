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
from uuid import uuid4

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


class TestLadderOrdering:
    """Ordering is an access-control axis, so it did not move with the page.

    ``OperationalRank.sort_order`` is read by the inventory rule as a predicate:
    a member whose rank sits at or above an item's ``min_rank_order`` may see it.
    Left writable by members.manage, a roster officer could create a rung at
    order 0, assign it to themselves through the profile endpoint that grant
    already opens -- the rank ceiling permits it, because a custom code carries
    no default permissions -- and clear every restriction in the catalogue
    without touching a single permission.
    """

    async def test_reorder_is_refused_without_the_ordering_grant(self):
        with pytest.raises(HTTPException) as exc:
            await operational_ranks.reorder_ranks(
                data=SimpleNamespace(ranks=[]),
                db=MagicMock(),
                current_user=_caller(["members.manage"]),
            )

        assert exc.value.status_code == 403
        assert "restricted inventory" in exc.value.detail

    async def test_reorder_is_allowed_with_it(self):
        with patch.object(
            operational_ranks.OperationalRankService,
            "reorder_ranks",
            new=AsyncMock(return_value=[]),
        ) as reordered:
            result = await operational_ranks.reorder_ranks(
                data=SimpleNamespace(ranks=[]),
                db=MagicMock(),
                current_user=_caller(["settings.manage"]),
            )

        assert result == []
        reordered.assert_awaited_once()

    async def test_moving_an_existing_rank_is_refused_without_it(self):
        with pytest.raises(HTTPException) as exc:
            await operational_ranks.update_rank(
                request=MagicMock(client=None, headers={}),
                rank_id=uuid4(),
                data=SimpleNamespace(model_dump=lambda **_: {"sort_order": 0}),
                db=MagicMock(),
                current_user=_caller(["members.manage"]),
            )

        assert exc.value.status_code == 403

    async def test_a_new_rung_lands_at_the_end_rather_than_where_it_asked(self):
        # Appended rather than refused: the UI already asks for the end, so a
        # roster officer sees no difference, and a request that asked for the
        # top is answered with a rung at the bottom instead of a 403 for a field
        # they never chose.
        caller = _caller(["members.manage"])
        created = AsyncMock(
            return_value=SimpleNamespace(
                id="00000000-0000-0000-0000-000000000001",
                organization_id="00000000-0000-0000-0000-000000000002",
                rank_code="probationary",
                display_name="Probationary",
                description=None,
                sort_order=3,
                is_active=True,
                eligible_positions=[],
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
        )
        payload = SimpleNamespace(
            rank_code="probationary",
            sort_order=0,
            model_copy=lambda update: SimpleNamespace(
                rank_code="probationary", **update
            ),
        )

        with patch.object(
            operational_ranks.OperationalRankService,
            "list_ranks",
            new=AsyncMock(return_value=[object(), object(), object()]),
        ):
            with patch.object(
                operational_ranks.OperationalRankService, "create_rank", new=created
            ):
                with patch(
                    "app.api.v1.endpoints.users.report_privilege_escalation_attempt",
                    new=AsyncMock(),
                ):
                    await operational_ranks.create_rank(
                        request=MagicMock(client=None, headers={}),
                        data=payload,
                        db=MagicMock(),
                        current_user=caller,
                    )

        # Three ranks already exist, so the new one is the fourth -- not the 0
        # the request asked for.
        assert created.await_args.kwargs["data"].sort_order == 3

    async def test_the_requested_order_is_honoured_with_the_grant(self):
        # Wildcard so the rank ceiling is not what this measures: `captain`
        # carries default permissions a bare settings.manage holder lacks, and
        # the subject here is the ordering carve-out.
        caller = _caller(["*"])
        created = AsyncMock(
            return_value=SimpleNamespace(
                id="00000000-0000-0000-0000-000000000001",
                organization_id="00000000-0000-0000-0000-000000000002",
                rank_code="captain",
                display_name="Captain",
                description=None,
                sort_order=0,
                is_active=True,
                eligible_positions=[],
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
        )
        payload = SimpleNamespace(rank_code="captain", sort_order=0)

        with patch.object(
            operational_ranks.OperationalRankService, "create_rank", new=created
        ):
            with patch(
                "app.api.v1.endpoints.users.report_privilege_escalation_attempt",
                new=AsyncMock(),
            ):
                await operational_ranks.create_rank(
                    request=MagicMock(client=None, headers={}),
                    data=payload,
                    db=MagicMock(),
                    current_user=caller,
                )

        assert created.await_args.kwargs["data"] is payload


class TestRenameCeiling:
    """A rename is checked at both ends, because it can strip as well as grant."""

    async def _rename(self, caller, frm, to, service_update):
        existing = SimpleNamespace(rank_code=frm)
        with patch.object(
            operational_ranks.OperationalRankService,
            "get_rank",
            new=AsyncMock(return_value=existing),
        ):
            with patch.object(
                operational_ranks.OperationalRankService,
                "update_rank",
                new=service_update,
            ):
                with patch(
                    "app.api.v1.endpoints.users.report_privilege_escalation_attempt",
                    new=AsyncMock(),
                ):
                    return await operational_ranks.update_rank(
                        request=MagicMock(client=None, headers={}),
                        rank_id=uuid4(),
                        data=SimpleNamespace(
                            model_dump=lambda **_: {"rank_code": to},
                            rank_code=to,
                        ),
                        db=MagicMock(),
                        current_user=caller,
                    )

    async def test_cannot_rename_a_rank_that_grants_more_than_the_caller(self):
        # The mirror image of escalation, and the one a destination-only check
        # misses: an unrecognized destination grants nothing, so it clears the
        # ceiling trivially -- and update_rank then rewrites `rank` on every
        # member holding fire_chief, stripping each of them.
        updated = AsyncMock()
        with pytest.raises(HTTPException) as exc:
            await self._rename(
                _caller(["members.manage"]), "fire_chief", "retired_rung", updated
            )

        assert exc.value.status_code == 403
        updated.assert_not_awaited()

    async def test_cannot_rename_into_a_rank_that_grants_more_than_the_caller(self):
        updated = AsyncMock()
        with pytest.raises(HTTPException) as exc:
            await self._rename(
                _caller(["members.manage"]), "probationary", "fire_chief", updated
            )

        assert exc.value.status_code == 403
        updated.assert_not_awaited()

    async def test_a_rename_within_the_caller_s_own_grants_is_allowed(self):
        rank = SimpleNamespace(
            id="00000000-0000-0000-0000-000000000001",
            organization_id="00000000-0000-0000-0000-000000000002",
            rank_code="probationary_v2",
            display_name="Probationary",
            description=None,
            sort_order=0,
            is_active=True,
            eligible_positions=[],
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        result = await self._rename(
            _caller(["*"]),
            "probationary",
            "probationary_v2",
            AsyncMock(return_value=rank),
        )

        assert result.rank_code == "probationary_v2"


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
