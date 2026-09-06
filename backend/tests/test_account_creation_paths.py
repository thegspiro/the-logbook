"""Every path that can put a live account in the database, and what gates it.

`users.create` reads like the answer to "who can create an account here". It is
not, and a security review that assumed it would have been wrong by four paths.
Three places in ``app/`` construct a ``User`` row, and five request-reachable
routes reach them:

| Route                                | Gate                                          |
| ------------------------------------ | --------------------------------------------- |
| ``POST /users``                      | ``users.create``                              |
| ``POST /prospects/{id}/transfer``    | ``members.manage``/``prospective_members.manage`` |
| ``POST /prospects/{id}/complete-step`` | same, when the stage is final and the pipeline auto-transfers |
| ``POST /prospects/{id}/approve-step``  | authentication, plus holding the stage's configured approval role |
| ``POST /auth/register``              | no permission — the ``REGISTRATION_ENABLED`` setting, off by default |

Onboarding's ``create_system_owner`` is the sixth caller and needs no separate
entry: it delegates to ``AuthService.register_user``, so it shares the register
path's construction site.

None of this is a hole. The transfer paths enforce the same rank and role grant
ceilings as ``POST /users`` (``tests/test_privilege_ceiling_wiring.py``) and
refuse the administrative-class-plus-rank pair the same way
(``tests/test_administrative_rank_restriction.py``), and the two auto-transfer
routes pass neither rank nor roles, so they mint a plain probationary member
carrying the default ``member`` position. What is missing is a record: nothing
made the *set* visible, so a sixth path could be added without anyone noticing
that the answer to the question had changed again.

That is what these tests are. The construction sweep is the ratchet — it fails
on a new ``User(...)`` anywhere under ``app/`` — and the gate assertions state
what each known route asks today, so a silent widening or narrowing fails here
rather than in a review that happens to look.
"""

import ast
import pathlib

import pytest

from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.membership_pipeline import router as pipeline_router
from app.api.v1.endpoints.users import router as users_router
from app.core.config import settings

APP_ROOT = pathlib.Path(__file__).resolve().parents[1] / "app"

# Every site that constructs a User row, as "<path relative to app/>:<function>".
# Adding one means adding an account-creation path: say in the docstring above
# which route reaches it and what gates it, then add it here.
KNOWN_CONSTRUCTION_SITES = {
    "api/v1/endpoints/users.py:create_member",
    "services/auth_service.py:register_user",
    "services/membership_pipeline_service.py:_do_transfer",
}


def _user_construction_sites() -> set[str]:
    """Walk app/ for every construction of a User row.

    Resolves ``from ... import User as X`` aliases and matches attribute
    access (``models.User(...)``) as well as a bare name, so the sweep cannot
    be sidestepped by an import style. ``insert(User)`` counts too — a Core
    insert puts a row in the table just as an ORM object does.
    """
    sites: set[str] = set()
    for path in sorted(APP_ROOT.rglob("*.py")):
        if "__pycache__" in str(path):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))

        aliases = {"User"}
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    if alias.name == "User" and alias.asname:
                        aliases.add(alias.asname)

        # Map each line to its enclosing function so a failure names something
        # a reader can open, rather than a line number that moves every commit.
        # ast.walk is breadth-first, so a nested function is visited after the
        # one containing it and overwrites it -- which is what we want, the
        # innermost function being the honest answer.
        enclosing: dict[int, str] = {}
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for line in range(node.lineno, (node.end_lineno or node.lineno) + 1):
                    enclosing[line] = node.name

        rel = path.relative_to(APP_ROOT).as_posix()
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = (
                func.id
                if isinstance(func, ast.Name)
                else func.attr if isinstance(func, ast.Attribute) else None
            )
            constructs = name in aliases
            if name == "insert":
                constructs = any(
                    isinstance(arg, ast.Name) and arg.id in aliases for arg in node.args
                )
            if constructs:
                where = enclosing.get(node.lineno, "<module>")
                sites.add(f"{rel}:{where}")
    return sites


def _permissions(router, path: str, method: str) -> list[list[str]]:
    """The permission dependencies on one route, in declaration order."""
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(
            route, "methods", ()
        ):
            return [
                dependency.call.required_permissions
                for dependency in route.dependant.dependencies
                if hasattr(dependency.call, "required_permissions")
            ]
    pytest.fail(f"{method} {path} not found on {router}")


def test_no_new_path_creates_an_account() -> None:
    """A fourth construction site is a fifth way to get an account.

    If this fails on code you added: the row you are creating is a live login.
    Decide what gates it, record it in this module's docstring, and add the
    site below. If it fails on code you only moved, the function name changed
    and the entry needs updating with it.
    """
    assert _user_construction_sites() == KNOWN_CONSTRUCTION_SITES


def test_direct_creation_requires_users_create() -> None:
    """The one path whose whole purpose is minting an account."""
    assert _permissions(users_router, "", "POST") == [["users.create"]]


@pytest.mark.parametrize("route", ["transfer", "complete-step"])
def test_pipeline_conversion_answers_to_the_membership_grants(route: str) -> None:
    """Converting a vetted prospect is a recruitment act, not an IT one.

    Deliberately not ``users.create``: the three positions that run recruitment
    without it -- Captain, Vice President, Assistant Secretary -- would
    otherwise be unable to convert the prospects they shepherded. Narrowing
    this to match ``POST /users`` would be a breaking change for them, so it is
    pinned rather than assumed.
    """
    assert _permissions(
        pipeline_router, f"/prospects/{{prospect_id}}/{route}", "POST"
    ) == [["members.manage", "prospective_members.manage"]]


def test_approve_step_is_authorized_by_the_role_not_a_permission() -> None:
    """Signers hold the configured approval role, not members.manage.

    The service accepts an approval only for a role the caller currently holds,
    which is the real gate; a permission dependency here would lock out the
    chief or president a multi-approval stage exists to collect. This asserts
    the *absence* on purpose -- if a permission is ever added, the reasoning
    above needs revisiting rather than the test relaxing.
    """
    assert (
        _permissions(pipeline_router, "/prospects/{prospect_id}/approve-step", "POST")
        == []
    )


def test_self_registration_is_gated_by_settings_and_off_by_default() -> None:
    """The one account-creating route with no permission at all.

    It answers to ``REGISTRATION_ENABLED``, checked in the handler rather than
    by a dependency, so nothing in the route's signature records that it is
    gated. A default flip here opens unauthenticated account creation on every
    deployment that never set the variable.
    """
    assert _permissions(auth_router, "/register", "POST") == []
    assert settings.REGISTRATION_ENABLED is False
