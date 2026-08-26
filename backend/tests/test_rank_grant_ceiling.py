"""
ORU-7d: a member's operational rank grants that rank's default permissions
(see _collect_user_permissions), so setting a rank must clear the same
permission-grant ceiling as assigning a role — otherwise a members.manage
holder (e.g. a secretary) could set rank="fire_chief" and escalate to
settings.manage / security.manage through an unguarded permission source.
DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.users import (
    _canonical_rank_or_400,
    _enforce_rank_grant_ceiling,
)


def _user(perms):
    return SimpleNamespace(
        id="u1",
        positions=[SimpleNamespace(permissions=list(perms))],
        rank=None,
    )


class TestRankGrantCeiling:
    async def test_members_manage_cannot_grant_chief_rank(self):
        # A secretary-level caller (members.manage but not settings/security)
        # must not be able to hand out a chief rank that carries them.
        caller = _user(["members.manage", "users.create"])
        db = MagicMock()
        with patch(
            "app.api.v1.endpoints.users.report_privilege_escalation_attempt",
            new=AsyncMock(),
        ) as reported:
            with pytest.raises(HTTPException) as exc:
                await _enforce_rank_grant_ceiling(caller, "fire_chief", db, "1.2.3.4")
        assert exc.value.status_code == 403
        assert "beyond your own" in exc.value.detail
        reported.assert_awaited_once()

    async def test_wildcard_caller_can_grant_chief_rank(self):
        caller = _user(["*"])
        db = MagicMock()
        with patch(
            "app.api.v1.endpoints.users.report_privilege_escalation_attempt",
            new=AsyncMock(),
        ) as reported:
            # `*` covers every rank permission -> no raise, nothing reported.
            await _enforce_rank_grant_ceiling(caller, "fire_chief", db, None)
        reported.assert_not_awaited()

    async def test_no_rank_is_noop(self):
        caller = _user(["members.manage"])
        db = MagicMock()
        await _enforce_rank_grant_ceiling(caller, None, db, None)

    async def test_unknown_rank_carries_no_permissions(self):
        # An unrecognized rank resolves to [] default permissions, so there is
        # nothing to exceed and the ceiling does not block it.
        caller = _user(["members.manage"])
        db = MagicMock()
        await _enforce_rank_grant_ceiling(caller, "not_a_real_rank", db, None)


class TestRankIsConfigured:
    """The other half of the pair, and the reason the ceiling alone is not enough.

    ``test_unknown_rank_carries_no_permissions`` above is correct and is also
    the whole problem: an unrecognised rank clears the escalation ceiling
    precisely because it grants nothing. So the ceiling waves through exactly
    the value that then breaks the member — ``fire_cheif`` resolves to no
    default permissions and no eligible seats, and every shift signup is
    refused with no indication that a typo is the cause.

    ``OperationalRankService.validate_ranks`` already existed to *report*
    members whose stored rank matches nothing. This asks the same question one
    step earlier, where it can still be answered by refusing the write.
    """

    @staticmethod
    def _service(canonical):
        """A rank service resolving every input to ``canonical`` (None = unknown)."""
        service = MagicMock()
        service.resolve_rank_code = AsyncMock(return_value=canonical)
        return service

    async def test_an_unconfigured_rank_is_refused(self):
        with patch(
            "app.api.v1.endpoints.users.OperationalRankService",
            return_value=self._service(None),
        ):
            with pytest.raises(HTTPException) as exc:
                await _canonical_rank_or_400("fire_cheif", "org-1", MagicMock())
        assert exc.value.status_code == 400
        # The message has to name the typo and where to fix it; "not
        # qualified" three screens later is what this replaces.
        assert "fire_cheif" in exc.value.detail
        assert "configured" in exc.value.detail

    async def test_a_configured_rank_passes(self):
        with patch(
            "app.api.v1.endpoints.users.OperationalRankService",
            return_value=self._service("firefighter"),
        ):
            await _canonical_rank_or_400("firefighter", "org-1", MagicMock())

    @pytest.mark.parametrize("blank", [None, "", "   "])
    async def test_clearing_a_rank_stays_allowed(self, blank):
        """An empty value is "no rank", not a bad one.

        A member can hold no operational rank at all — an administrative member
        normally does — so the guard must not turn "remove this rank" into a
        400. It also must not spend a query deciding that.
        """
        service = self._service(None)
        with patch(
            "app.api.v1.endpoints.users.OperationalRankService",
            return_value=service,
        ):
            await _canonical_rank_or_400(blank, "org-1", MagicMock())
        service.resolve_rank_code.assert_not_awaited()

    async def test_the_create_path_uses_the_same_guard(self):
        """Three endpoints write a rank; all three have to refuse the same one.

        A member *created* at a mistyped rank is the worse of the two cases: no
        one watches a new record fail to appear on a shift roster, and the
        department has no reason to suspect the rank field.
        """
        import inspect

        from app.api.v1.endpoints import users as users_ep

        for name in ("create_member", "update_user_profile"):
            source = inspect.getsource(getattr(users_ep, name))
            assert "_canonical_rank_or_400" in source, (
                f"{name} writes User.rank without checking it is a rank the "
                "department has; a typo there fails silently at signup"
            )
        # Checking is only half of it: the canonical value has to be the one
        # that gets stored, or the check waves through a string that matches
        # no dictionary key downstream.
        create_src = inspect.getsource(users_ep.create_member)
        assert "rank=canonical_rank," in create_src
        update_src = inspect.getsource(users_ep.update_user_profile)
        assert 'update_data["rank"] = await _canonical_rank_or_400' in update_src

    async def test_the_prospect_transfer_path_checks_too(self):
        """The third writer, and the one furthest from the users endpoints.

        ``_do_transfer`` creates a User from a prospect with a caller-supplied
        rank. It returns its refusals as ``{"success": False, "message": ...}``
        rather than raising, which is the convention its endpoint translates to
        a 400 — so the check has to live in that shape rather than reuse the
        endpoint helper.
        """
        import inspect

        from app.services.membership_pipeline_service import (
            MembershipPipelineService,
        )

        source = inspect.getsource(MembershipPipelineService._do_transfer)
        assert "resolve_rank_code" in source
        assert "rank_not_configured_message" in source
        # And stores what it resolved, rather than the caller's spelling.
        assert "rank = canonical" in source

    async def test_every_path_refuses_in_the_same_words(self):
        """A member told "not configured" by one screen and something else by
        another has no way to tell they are the same problem."""
        from app.services.operational_rank_service import (
            rank_not_configured_message,
        )

        message = rank_not_configured_message("fire_cheif")
        assert "fire_cheif" in message
        with patch(
            "app.api.v1.endpoints.users.OperationalRankService",
            return_value=self._service(None),
        ):
            with pytest.raises(HTTPException) as exc:
                await _canonical_rank_or_400("fire_cheif", "org-1", MagicMock())
        assert exc.value.detail == message


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
