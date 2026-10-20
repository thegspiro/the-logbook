"""A session issued before onboarding completed must not outlive it.

``validate_session`` checks that an onboarding session exists and has not
idled out; it says nothing about whether setup is already finished. A session
issued before completion stays valid until it idles out or reaches
``SESSION_MAX_LIFETIME_HOURS``, and completing onboarding does not revoke it.
Every state-changing session route therefore has to refuse on its own once
``needs_onboarding()`` is false, which ONB-3, ONB-9 and ONB2-30-3 added route
by route.

``POST /onboarding/test/email`` was the one that missed it. It opens outbound
SMTP connections to a host the caller chooses, so a still-valid session could
keep probing from inside the deployment's network after setup was done.

The structural test makes the omission impossible to repeat: a new mutating
route that takes a session but forgets the completion check fails here, rather
than waiting for a review to notice.
"""

import ast
import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1 import onboarding
from app.api.v1.onboarding import verify_email_configuration
from app.core.error_codes import ErrorCode

pytestmark = pytest.mark.unit

_REQUEST = SimpleNamespace(
    platform="selfhosted",
    config={
        "smtpHost": "mail.dept.example",
        "smtpPort": 25,
        "fromEmail": "fd@dept.example",
    },
)


def _service(needs_onboarding: bool):
    service = MagicMock()
    service.needs_onboarding = AsyncMock(return_value=needs_onboarding)
    return service


class TestTestEmailRefusesAfterCompletion:
    async def test_a_completed_setup_is_refused_before_any_smtp_connection(self):
        validate = AsyncMock()
        with (
            patch("app.api.v1.onboarding.validate_session", validate),
            patch(
                "app.api.v1.onboarding.OnboardingService",
                return_value=_service(needs_onboarding=False),
            ),
            patch("app.api.v1.onboarding.test_smtp_connection_uniform") as smtp_test,
        ):
            with pytest.raises(HTTPException) as exc:
                await verify_email_configuration(_REQUEST, MagicMock(), db=MagicMock())

        assert exc.value.status_code == 400
        assert "already been completed" in exc.value.detail
        assert exc.value.error_code == ErrorCode.ONBD_ALREADY_COMPLETED
        validate.assert_awaited_once()
        smtp_test.assert_not_called()

    async def test_a_setup_in_progress_still_runs_the_connection_test(self):
        with (
            patch("app.api.v1.onboarding.validate_session", AsyncMock()),
            patch(
                "app.api.v1.onboarding.OnboardingService",
                return_value=_service(needs_onboarding=True),
            ),
            patch(
                "app.api.v1.onboarding.test_smtp_connection_uniform",
                return_value=(True, "SMTP connection successful", {}),
            ) as smtp_test,
        ):
            response = await verify_email_configuration(
                _REQUEST, MagicMock(), db=MagicMock()
            )

        assert response.success is True
        smtp_test.assert_called_once()


def _own_calls(fn: ast.AsyncFunctionDef) -> set[str]:
    return {
        node.func.id
        for node in ast.walk(fn)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }


def _mentions(fn: ast.AsyncFunctionDef, marker: str) -> bool:
    return any(
        isinstance(node, ast.Attribute) and node.attr == marker for node in ast.walk(fn)
    )


class TestEveryMutatingSessionRouteChecksCompletion:
    def test_no_state_changing_session_route_skips_the_completion_check(self):
        tree = ast.parse(inspect.getsource(onboarding))
        functions = {
            node.name: node
            for node in tree.body
            if isinstance(node, ast.AsyncFunctionDef)
        }

        def reaches(fn, wanted, seen=()):
            """True if *fn*, or a handler it delegates to, satisfies *wanted*."""
            if wanted(fn):
                return True
            return any(
                reaches(functions[name], wanted, (*seen, fn.name))
                for name in _own_calls(fn)
                if name in functions and name not in seen and name != fn.name
            )

        def uses_session(fn):
            return "validate_session" in _own_calls(fn)

        # /reset checks is_completed on the status row itself rather than going
        # through needs_onboarding(); either refuses a finished setup.
        def checks_completion(fn):
            return _mentions(fn, "needs_onboarding") or _mentions(fn, "is_completed")

        unguarded = []
        for name, fn in functions.items():
            mutating = any(
                isinstance(dec, ast.Call)
                and isinstance(dec.func, ast.Attribute)
                and dec.func.attr in {"post", "put", "patch", "delete"}
                for dec in fn.decorator_list
            )
            if (
                mutating
                and reaches(fn, uses_session)
                and not reaches(fn, checks_completion)
            ):
                unguarded.append(name)

        assert unguarded == [], (
            "These onboarding routes accept a session but never refuse once "
            f"onboarding is complete: {unguarded}. Add the needs_onboarding() "
            "check that the sibling /session/* routes carry."
        )
