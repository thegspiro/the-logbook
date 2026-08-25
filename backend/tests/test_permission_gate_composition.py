"""What a baseline grant may be OR'd with, across the whole endpoint layer.

``require_permission("a", "b", "c")`` accepts *any* of its arguments. That is
the right shape for ``x.view`` OR ``x.manage`` — viewers and managers both read
the module's own data — and it is used that way at some seventy endpoints.

It is the wrong shape when the only thing letting a member in is a grant from
*another* module, because then a permission nobody thinks of as privileged
silently opens an officer endpoint to the whole department. ``compliance.view``
did exactly this until 2026-08-24: it sat beside ``training.manage`` and
``reports.view`` on ``GET /compliance-officer/contributed-hours``, which
returns hours for *all* members, and every seeded member carried it.

The tell was never the permission's name — ``compliance.view`` reads as
innocuous and opened no page of its own. The tell is the **composition**, which
is what this file checks, so the next one is caught by shape rather than by
somebody recognising the name.

Asserted against the endpoint source (AST) the same way
``test_compliance_config_permissions.py`` does: the gate is a decorator or
signature argument, and a request-level test would need the full auth stack.
"""

import ast
from pathlib import Path

from app.core.permissions import DEFAULT_POSITIONS, OPERATIONAL_RANKS

ENDPOINTS = Path(__file__).parents[1] / "app/api/v1/endpoints"

#: Grants a plain volunteer is seeded with — the ``member`` position plus the
#: ``firefighter`` one, whose list is the firefighter *rank*'s (see
#: ``test_baseline_member_grants``).
BASELINE = set(DEFAULT_POSITIONS["member"]["permissions"]) | set(
    DEFAULT_POSITIONS["firefighter"]["permissions"]
)


def _elevated() -> set[str]:
    """Every seeded grant that is *not* in the day-one set.

    Derived rather than pattern-matched. A suffix rule (``*.manage`` plus a
    handful of named reads) misses the action-specific grants the registry is
    full of — ``events.edit``, ``scheduling.assign``,
    ``members.manage_id_cards``, ``inventory.manage_medical`` — every one of
    which is officer-held and none of which ends in ``.manage``. Deriving from
    the registry means a new officer grant is covered the day it is added.
    """
    granted: set[str] = set()
    for registry, field in (
        (DEFAULT_POSITIONS, "permissions"),
        (OPERATIONAL_RANKS, "default_permissions"),
    ):
        for entry in registry.values():
            granted.update(entry.get(field, []))
    return granted - BASELINE


ELEVATED = _elevated()

#: Endpoints where a cross-module pairing is tolerated. Each entry says an
#: officer endpoint is reachable on a grant the whole department holds, so it
#: carries a reason beside it rather than being a silent addition — and a
#: reason honest about whether anyone has actually decided. Keep this short.
ALLOWED: dict[tuple[str, str], str] = {
    # The one case this rule flagged when it was introduced (2026-08-24), and
    # it is NOT settled. `/supply/item-deployments/{id}` takes
    # `equipment_check.view` OR `inventory.view`, while the sibling its own
    # docstring calls "the reverse" of it — `/supply/expiring-items` — takes
    # `equipment_check.view` OR `inventory.manage`. One of the two is wrong.
    #
    # Left alone here because tightening it is a behaviour change, not a
    # guard: the endpoint feeds StockLotsPanel on the item-detail page, which
    # a member can open for their own issued gear, and that panel already
    # degrades a refusal to an empty list. Whether a member should see which
    # apparatus carry an item is a product call, not a test's.
    #
    # Remove this entry once it is decided, in either direction.
    ("equipment_check.py", "get_item_deployments"): (
        "unadjudicated: inventory.view here vs inventory.manage on its sibling"
    ),
}


def _module(permission: str) -> str:
    return permission.split(".")[0]


def _permission_gates() -> list[tuple[str, str, list[str]]]:
    """Every ``require_permission`` gate in the endpoint layer.

    Both supported syntaxes: the signature default
    (``Depends(require_permission(...))``) and the route decorator's
    ``dependencies=[...]`` list, which ``equipment_check.py`` uses. Reading
    only the signature misses the latter silently.

    Gates built from anything other than string literals are skipped — there
    are none today, and a computed gate would need reading rather than
    asserting on.
    """
    gates = []
    for path in sorted(ENDPOINTS.glob("*.py")):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for scope in (node.args, *node.decorator_list):
                for call in ast.walk(scope):
                    if not (
                        isinstance(call, ast.Call)
                        and isinstance(call.func, ast.Name)
                        and call.func.id == "require_permission"
                    ):
                        continue
                    if not all(isinstance(a, ast.Constant) for a in call.args):
                        continue
                    gates.append((path.name, node.name, [a.value for a in call.args]))
    return gates


def test_every_written_gate_is_actually_reached():
    """Guard the guard: a walk that silently stops matching passes otherwise.

    A floor ("more than 200") is what let the decorator syntax go unnoticed —
    the scoped walk found 1201 of 1202 gates and looked healthy. So this counts
    every ``require_permission`` call in each module against the ones the
    scoped walk reaches, and requires them equal.

    Counted by AST on both sides rather than by regex. A text needle has to
    guess at formatting, and ``users.py`` already breaks the obvious one by
    putting a comment between ``Depends(`` and ``require_permission(``, while a
    docstring in ``skills_testing.py`` mentions the call in prose. Neither
    confuses the parser.
    """
    reached_by_file: dict[str, int] = {}
    for name, _handler, _perms in _permission_gates():
        reached_by_file[name] = reached_by_file.get(name, 0) + 1

    unreached = []
    for path in sorted(ENDPOINTS.glob("*.py")):
        written = sum(
            1
            for node in ast.walk(ast.parse(path.read_text()))
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "require_permission"
        )
        reached = reached_by_file.get(path.name, 0)
        if written != reached:
            unreached.append(f"{path.name}: {written} written, {reached} reached")

    assert not unreached, (
        "a gate syntax is invisible to this check — every require_permission "
        "call must be reachable by _permission_gates():\n  " + "\n  ".join(unreached)
    )


def test_no_baseline_grant_is_the_only_way_into_an_officer_endpoint():
    """A member must not get in solely on a grant from another module.

    Same-module pairing is the intended pattern: ``apparatus.view`` OR
    ``apparatus.manage`` on a GET, where the view grant is what the module's
    own pages already run on.

    A gate is fine, too, when it names a baseline grant from the *same* module
    as its officer grant — ``equipment_check.submit`` beside
    ``equipment_check.view`` on the apparatus-inventory reads means that
    endpoint is deliberately crew-facing, and its own comment says so. A
    second baseline grant from elsewhere adds no exposure there.

    What is flagged is the case where *every* baseline grant in the gate is
    cross-module, so removing them would close the endpoint to members — which
    is precisely what ``compliance.view`` did to the contributed-hours report.
    """
    violations = []
    for filename, handler, permissions in _permission_gates():
        baseline = [p for p in permissions if p in BASELINE]
        officer = [p for p in permissions if p in ELEVATED]
        if not (baseline and officer):
            continue
        officer_modules = {_module(p) for p in officer}
        if any(_module(p) in officer_modules for p in baseline):
            continue
        if (filename, handler) in ALLOWED:
            continue
        violations.append(
            f"{filename}::{handler} is reachable by every member through "
            f"{sorted(baseline)}, which is the only baseline grant on a gate "
            f"otherwise limited to {sorted(officer)}"
        )

    assert not violations, (
        "an officer endpoint is open to the whole department through a "
        "cross-module grant:\n  " + "\n  ".join(violations)
    )
