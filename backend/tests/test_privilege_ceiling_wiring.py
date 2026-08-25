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
