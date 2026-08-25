"""What a baseline grant may be OR'd with, across the whole endpoint layer.

``require_permission("a", "b", "c")`` accepts *any* of its arguments. That is
the right shape for ``x.view`` OR ``x.manage`` — viewers and managers both read
the module's own data — and it is used that way at some seventy endpoints.

It is the wrong shape when one of the alternatives is a grant every member
holds and another belongs to a different module's officers, because then the
narrower-looking grant silently opens the officer endpoint to the whole
department. ``compliance.view`` did exactly this until 2026-08-24: it appeared
beside ``training.manage`` and ``reports.view`` on
``GET /compliance-officer/contributed-hours``, which returns hours for *all*
members, and every seeded member carried it.

The tell was never the permission's name — ``compliance.view`` reads as
innocuous, and it opened no page of its own. The tell is the **composition**:
a baseline grant OR'd with an officer grant from another module. That is what
this file checks, so the next one is caught by shape rather than by somebody
recognising the name.

Asserted against the endpoint source (AST) the same way
``test_compliance_config_permissions.py`` does: the gate is a decorator
argument, and a request-level test would need the full auth stack to reach it.
"""

import ast
from pathlib import Path

from app.core.permissions import DEFAULT_POSITIONS

ENDPOINTS = Path(__file__).parents[1] / "app/api/v1/endpoints"

#: Grants a plain volunteer is seeded with — the ``member`` position plus the
#: ``firefighter`` one, whose list is the firefighter *rank*'s (see
#: ``test_baseline_member_grants``). Read from the registry rather than
#: restated, so removing a grant there narrows this check automatically.
BASELINE = set(DEFAULT_POSITIONS["member"]["permissions"]) | set(
    DEFAULT_POSITIONS["firefighter"]["permissions"]
)

#: Reads that aggregate across members, plus every management grant. These are
#: what a baseline grant must not be able to stand in for.
AGGREGATING_READS = {
    "reports.view",
    "audit.view",
    "analytics.view",
    "training.view_all",
}

#: Endpoints where a cross-module pairing is deliberate. Empty, and worth
#: keeping that way: an entry here is a decision that some officer endpoint is
#: reachable on a grant the whole department holds, so it needs a reason beside
#: it rather than a silent addition.
ALLOWED: dict[tuple[str, str], str] = {}


def _is_officer(permission: str) -> bool:
    return permission.endswith(".manage") or permission in AGGREGATING_READS


def _module(permission: str) -> str:
    return permission.split(".")[0]


def _permission_gates() -> list[tuple[str, str, list[str]]]:
    """Every ``require_permission`` gate in the endpoint layer.

    Returns ``(file, handler, permissions)``. Handlers whose gate is built
    from anything other than string literals are skipped — there are none
    today, and a computed gate would need reading rather than asserting on.
    """
    gates = []
    for path in sorted(ENDPOINTS.glob("*.py")):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for call in ast.walk(node.args):
                if not (
                    isinstance(call, ast.Call)
                    and isinstance(call.func, ast.Name)
                    and call.func.id == "require_permission"
                ):
                    continue
                if not all(isinstance(a, ast.Constant) for a in call.args):
                    continue
                gates.append(
                    (path.name, node.name, [a.value for a in call.args]),
                )
    return gates


def test_the_endpoint_layer_is_actually_being_read():
    """Guard the guard: an AST walk that silently matches nothing passes."""
    gates = _permission_gates()
    assert len(gates) > 200, f"only found {len(gates)} permission gates — parse broke"


def test_no_baseline_grant_stands_in_for_another_modules_officer_grant():
    """A baseline grant may pair with its *own* module's manage grant only.

    ``apparatus.view`` OR ``apparatus.manage`` on a GET is the intended
    pattern — same module, and the view grant is what the module's own pages
    already run on. Pairing across modules is the anomaly, and it is how an
    officer report came to be readable by every member of the department.
    """
    violations = []
    for filename, handler, permissions in _permission_gates():
        baseline = [p for p in permissions if p in BASELINE]
        officer = [p for p in permissions if _is_officer(p)]
        if not (baseline and officer):
            continue
        officer_modules = {_module(p) for p in officer}
        cross = [p for p in baseline if _module(p) not in officer_modules]
        if not cross:
            continue
        if (filename, handler) in ALLOWED:
            continue
        violations.append(
            f"{filename}::{handler} accepts {sorted(cross)} (held by every "
            f"member) as an alternative to {sorted(officer)}"
        )

    assert not violations, (
        "a grant every member holds is an accepted alternative on an officer "
        "endpoint:\n  " + "\n  ".join(violations)
    )
