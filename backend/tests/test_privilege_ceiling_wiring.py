"""
Guard test: the privilege-escalation ceiling calls stay wired at their
call sites.

``_enforce_role_grant_ceiling`` and ``_enforce_rank_grant_ceiling`` are each
covered by their own unit tests (``test_rank_grant_ceiling.py``,
``test_role_edit_ceiling.py`` for the sibling roles.py helper) -- but those
call the helper functions directly, not through ``create_member`` or
``update_user_profile``. Mocking those two routes end-to-end is fragile (many
sequential DB round-trips ahead of the ceiling check), so this instead
source-inspects the route bodies: cheap, and it still fails loudly if the
call is ever silently dropped from either wiring point, which is what
actually caused ORU-1 (HIGH) and ORU-7d (CRITICAL) in the first place --
both were *removed or never-added* call sites, not broken helper logic.
"""

import inspect

from app.api.v1.endpoints.membership_pipeline import transfer_prospect
from app.api.v1.endpoints.operational_ranks import update_rank
from app.api.v1.endpoints.users import create_member, update_user_profile


def test_create_member_calls_both_ceilings():
    source = inspect.getsource(create_member)
    assert "_enforce_role_grant_ceiling(" in source, (
        "create_member no longer calls _enforce_role_grant_ceiling -- "
        "this is the exact ORU-1 privilege-escalation regression"
    )
    assert "_enforce_rank_grant_ceiling(" in source, (
        "create_member no longer calls _enforce_rank_grant_ceiling -- "
        "this is the exact ORU-7d privilege-escalation regression"
    )


def test_update_user_profile_calls_rank_ceiling():
    source = inspect.getsource(update_user_profile)
    assert "_enforce_rank_grant_ceiling(" in source, (
        "update_user_profile no longer calls _enforce_rank_grant_ceiling on "
        "its rank-change branch -- this is the exact ORU-7d self-escalation "
        "regression (a caller setting their own rank to gain permissions)"
    )


def test_create_member_ceiling_check_runs_before_the_user_is_flushed():
    """A denied _enforce_role_grant_ceiling call reports a CRITICAL alert via
    report_privilege_escalation_attempt, which commits the whole transaction
    so the alert survives the 403 about to be raised (see its docstring).
    If db.add(new_user) / db.flush() ran BEFORE that check, the commit would
    also persist the should-be-rejected user -- a live, ACTIVE, password-set
    account with no roles, behind a request the caller believes failed
    outright. The check must appear before the flush in source order."""
    source = inspect.getsource(create_member)
    ceiling_at = source.index("_enforce_role_grant_ceiling(")
    flush_at = source.index("db.flush()")
    assert ceiling_at < flush_at, (
        "create_member now flushes the new user before the role-grant "
        "ceiling check -- a denied check's alert-commit would persist the "
        "orphaned, should-be-rejected user account"
    )


def test_transfer_prospect_calls_rank_ceiling():
    """AUTH-adjacent PERM-3 (2026-08-27 pass 2): transfer_prospect creates a
    new User row with a client-supplied rank via
    MembershipPipelineService._do_transfer, gated only on members.manage /
    prospective_members.manage -- neither implies settings.manage or
    security.manage. Without this call, a bare members.manage holder could
    transfer a prospect in at rank="fire_chief" and mint a tenant admin,
    exactly the escalation _enforce_rank_grant_ceiling's own docstring
    describes for create_member."""
    source = inspect.getsource(transfer_prospect)
    assert "_enforce_rank_grant_ceiling(" in source, (
        "transfer_prospect no longer enforces the rank-grant ceiling before "
        "transferring a prospect to a full User account -- PERM-3 regression"
    )
    ceiling_at = source.index("_enforce_rank_grant_ceiling(")
    transfer_at = source.index("service.transfer_to_membership(")
    assert ceiling_at < transfer_at, (
        "transfer_prospect now creates the User account before the "
        "rank-grant ceiling check runs"
    )


def test_update_rank_calls_rank_ceiling_before_renaming():
    """PERM-4 (2026-08-27 pass 2): OperationalRankService.update_rank
    bulk-rewrites User.rank for every member holding the old code when a
    rank's rank_code is renamed. get_rank_default_permissions() resolves
    purely by code string, so renaming a rank to a reserved code (e.g.
    "fire_chief") instantly grants every member currently holding it that
    rank's permissions -- and the endpoint requires only settings.manage,
    not the security.manage/users.delete the ceiling is meant to gate."""
    source = inspect.getsource(update_rank)
    assert "_enforce_rank_grant_ceiling(" in source, (
        "update_rank no longer enforces the rank-grant ceiling on a "
        "rank_code rename -- PERM-4 regression"
    )
    ceiling_at = source.index("_enforce_rank_grant_ceiling(")
    rename_at = source.index("service.update_rank(")
    assert ceiling_at < rename_at, (
        "update_rank now renames the rank code (cascading to every current "
        "holder) before the rank-grant ceiling check runs"
    )
