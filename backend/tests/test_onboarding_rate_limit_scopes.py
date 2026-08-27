"""
ONB2-30-4: all 7 rate-limited onboarding routes (/start, /system-info,
/security-check, /database-check, /system-owner, /test/email, /reset) used
bare Depends(check_rate_limit) and so shared one "auth" bucket with every
other bare use of check_rate_limit in the app — a department retrying
/test/email while fixing an SMTP typo, or /reset after a validation error,
could lock its IP out of /system-owner or /reset for 30 minutes. Each route
now has its own scoped wrapper. No DB/Redis needed — asserts each wrapper
calls check_rate_limit with a distinct scope.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1 import onboarding as ob


@pytest.mark.parametrize(
    "wrapper_name",
    [
        "_rate_limit_onboarding_start",
        "_rate_limit_onboarding_system_info",
        "_rate_limit_onboarding_security_check",
        "_rate_limit_onboarding_database_check",
        "_rate_limit_onboarding_system_owner",
        "_rate_limit_onboarding_test_email",
        "_rate_limit_onboarding_reset",
    ],
)
async def test_wrapper_calls_check_rate_limit_with_a_scope(wrapper_name):
    wrapper = getattr(ob, wrapper_name)
    with patch.object(ob, "check_rate_limit", new=AsyncMock()) as mock_check:
        await wrapper(MagicMock())
    mock_check.assert_awaited_once()
    scope = mock_check.await_args.kwargs.get("scope")
    assert scope, f"{wrapper_name} did not pass a scope to check_rate_limit"


async def test_all_seven_scopes_are_distinct():
    wrapper_names = [
        "_rate_limit_onboarding_start",
        "_rate_limit_onboarding_system_info",
        "_rate_limit_onboarding_security_check",
        "_rate_limit_onboarding_database_check",
        "_rate_limit_onboarding_system_owner",
        "_rate_limit_onboarding_test_email",
        "_rate_limit_onboarding_reset",
    ]
    scopes = []
    for name in wrapper_names:
        with patch.object(ob, "check_rate_limit", new=AsyncMock()) as mock_check:
            await getattr(ob, name)(MagicMock())
        scopes.append(mock_check.await_args.kwargs["scope"])
    assert len(scopes) == len(set(scopes)), scopes


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
