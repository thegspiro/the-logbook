"""A route's permission gate admits every grant the route's own body tests for.

`permission_matches` is literal — an exact name, `module.*` or `*` — so
`scheduling.manage` does not imply `scheduling.view`, and the same holds for
every other module. A handler that gates on `X.view` and then branches on
`user_has_permission(current_user, "X.manage")` to widen what it returns has
therefore put that branch behind a door the grant it tests for cannot open:
the holder it was written for is refused before the branch is ever reached.

The failure is quiet from both sides. The endpoint answers 403 to exactly the
position the branch exists to serve, and a caller that swallows the rejection
renders it as an empty list rather than an error — which is how
`GET /prospects/{id}/events` came to show a president "no linked events" on a
default install while letting them keep adding links.

Seven routes carried it at once when this sweep was written (#2511 and #2524
had already fixed seven more in scheduling), across four modules that share
nothing but the shape. That is the signature of a defect nobody can catch by
reading one file, so it is swept here rather than pinned per module.

A second shape lives here because it is the same sentence from the other
side: a gate can refuse a grant the handler never mentions. `GET
/prospects/{id}/events` had no branch at all — it simply gated on
`prospective_members.view`, which four seeded positions do not hold even
though they hold `prospective_members.manage` and are the pipeline's whole
audience. `test_a_view_gate_admits_the_manage_grant_seeded_beside_it` catches
that class, and it is the one that reaches a default install rather than a
hand-configured position.

**Scope, stated because a green run is not full coverage.** This sees a
permission named as a literal in a `user_has_permission` call on
`current_user` inside the handler itself. It does not follow a helper the
handler calls — `_can_view_platoon_roster`, `can_view_kiosk_display_codes` and
fourteen other indirect pairings were checked by hand when this was written and
none was a lockout, because each modulates output rather than gating entry.
A permission assembled at runtime is invisible to it too.
"""

import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
API = BACKEND / "app" / "api"

#: Functions that test a permission against a user.
CHECKERS = {"user_has_permission", "has_permission"}

#: Names the authenticated caller is bound to in a handler signature.
CALLER = {"current_user", "user"}

#: Pairings where the excluded permission modulates the *output* and the gate
#: is the correct entry requirement — so a holder of the branched permission
#: alone has no business on the route and is rightly refused. Each entry is a
#: judgement made by reading the handler, not a permission to skip the rule.
ALLOWED = {
    # `members.manage` selects the contact-visibility policy, deciding whether
    # member emails are redacted. Reading an event's eligible members is what
    # `events.manage` is for.
    ("events.py", "GET", "/{event_id}/eligible-members", "members.manage"),
    # The documents grants decide whether folder *counts* are shown, not
    # whether the facility's folders may be listed. A related narrowness for
    # `facilities.view`-only callers is tracked as FAC-13 in
    # docs/security-review/FAC-12-facilities.md.
    ("facilities.py", "GET", "/{facility_id}/folders", "documents.view"),
    ("facilities.py", "GET", "/{facility_id}/folders", "documents.manage"),
    # `training.manage` is passed into the service as extra authority over the
    # training record. Finalising an event's session is `events.manage`.
    (
        "training_sessions.py",
        "POST",
        "/{training_session_id}/finalize",
        "training.manage",
    ),
    ("training_sessions.py", "POST", "/approve/{token}", "training.manage"),
    # `inventory.check_view` lifts a submitter's restriction to their assigned
    # templates, exactly as GET /equipment-checks/templates/{id} does. Tapping
    # a tag during a check is part of performing one, which view alone cannot.
    ("inventory_nfc.py", "POST", "/nfc/resolve-check", "inventory.check_view"),
}


def _routes():
    """Yield (path, decorator, function) for every decorated route handler."""
    for path in sorted(API.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for dec in node.decorator_list:
                if (
                    isinstance(dec, ast.Call)
                    and isinstance(dec.func, ast.Attribute)
                    and isinstance(dec.func.value, ast.Name)
                    and dec.func.value.id.endswith("router")
                ):
                    yield path, dec, node
                    break


def _gate(node, dec):
    """Permissions the route's dependencies admit, or None when ungated.

    An ungated route is not in scope: with nothing asserted at the door, a
    body branch is the only check there is and cannot contradict one.
    """
    perms, gated = [], False
    sources = list(node.args.defaults) + [d for d in node.args.kw_defaults if d]
    sources += [kw.value for kw in dec.keywords if kw.arg == "dependencies"]
    for src in sources:
        for n in ast.walk(src):
            if (
                isinstance(n, ast.Call)
                and isinstance(n.func, ast.Name)
                and n.func.id in ("require_permission", "require_all_permissions")
            ):
                gated = True
                perms += [a.value for a in n.args if isinstance(a, ast.Constant)]
    return perms if gated else None


def _branched(node):
    """Permissions the body tests against the caller, with line numbers."""
    for n in ast.walk(node):
        if not (
            isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id in CHECKERS
            and n.args
        ):
            continue
        subject = n.args[0]
        name = (
            subject.id
            if isinstance(subject, ast.Name)
            else getattr(subject, "attr", None)
        )
        # Only the caller's own grants. A check against some *other* user — a
        # target member's permissions, say — says nothing about who may enter.
        if name not in CALLER:
            continue
        for arg in n.args[1:]:
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                yield arg.value, n.lineno


def _admits(gate, perm):
    return any(
        g == perm or g == "*" or (g.endswith(".*") and perm.startswith(g[:-1]))
        for g in gate
    )


def test_a_gate_admits_every_grant_its_own_body_branches_on():
    offenders = []
    for path, dec, node in _routes():
        gate = _gate(node, dec)
        if not gate:
            continue
        route = (
            dec.args[0].value
            if dec.args and isinstance(dec.args[0], ast.Constant)
            else ""
        )
        method = dec.func.attr.upper()
        for perm, lineno in _branched(node):
            if _admits(gate, perm):
                continue
            if (path.name, method, route, perm) in ALLOWED:
                continue
            offenders.append(
                f"{path.relative_to(BACKEND)}:{lineno} {method} {route} "
                f"({node.name}) gates on [{', '.join(gate)}] but branches on "
                f"{perm!r}"
            )

    assert not offenders, (
        "These routes refuse the grant their own body was written to serve. "
        "Pair the branched permission into require_permission(...), or — if "
        "the branch modulates output rather than gating entry — add it to "
        "ALLOWED above with the reason:\n  " + "\n  ".join(offenders)
    )


def test_the_sweep_still_reaches_the_handlers():
    """A sweep that stopped parsing routes would pass forever.

    Anchored on the pairings known to exist rather than on a count, so adding
    a route does not fail this and losing the sweep's reach does.
    """
    seen = set()
    for path, dec, node in _routes():
        gate = _gate(node, dec)
        if not gate:
            continue
        route = (
            dec.args[0].value
            if dec.args and isinstance(dec.args[0], ast.Constant)
            else ""
        )
        for perm, _ in _branched(node):
            seen.add((path.name, dec.func.attr.upper(), route, perm))

    missing = sorted(entry for entry in ALLOWED if entry not in seen)
    assert not missing, (
        "The sweep no longer sees pairings it is exempting, so it is either "
        "parsing nothing or these routes changed. Re-check them and drop the "
        "stale entries from ALLOWED:\n  "
        + "\n  ".join(f"{m} {r} -> {p} in {f}" for f, m, r, p in missing)
    )


def _seeded_grant_sets():
    """Every permission set onboarding actually writes for a position or rank."""
    from app.core.permissions import DEFAULT_POSITIONS, OPERATIONAL_RANKS

    for name, spec in DEFAULT_POSITIONS.items():
        yield f"position {name}", set(spec.get("permissions") or ())
    for name, spec in OPERATIONAL_RANKS.items():
        yield f"rank {name}", set(spec.get("default_permissions") or ())


def _modules_seeded_manage_without_view():
    """Modules where a seeded grant holds `X.manage` but not `X.view`.

    These are the ones where a `.view` gate locks somebody out **on a fresh
    install**, with no hand-editing involved — which is what separates this
    from the sweep above, where the same gate shape needed a custom position
    to reach it.
    """
    from app.core.permissions import get_all_permissions

    known = set(get_all_permissions())
    out = {}
    for holder, perms in _seeded_grant_sets():
        if "*" in perms:
            continue
        for perm in perms:
            if not perm.endswith(".manage"):
                continue
            module = perm.split(".")[0]
            view = f"{module}.view"
            # A module with no `.view` permission at all — integrations,
            # orgchart, security — has nothing to be shut out of.
            if view not in known or view in perms or f"{module}.*" in perms:
                continue
            out.setdefault(module, set()).add(holder)
    return out


def test_a_view_gate_admits_the_manage_grant_seeded_beside_it():
    offenders = []
    seeded = _modules_seeded_manage_without_view()
    for path, dec, node in _routes():
        gate = _gate(node, dec)
        if not gate:
            continue
        route = (
            dec.args[0].value
            if dec.args and isinstance(dec.args[0], ast.Constant)
            else ""
        )
        for module, holders in seeded.items():
            if f"{module}.view" not in gate:
                continue
            if _admits(gate, f"{module}.manage"):
                continue
            offenders.append(
                f"{path.relative_to(BACKEND)}:{node.lineno} "
                f"{dec.func.attr.upper()} {route} ({node.name}) gates on "
                f"{module}.view, which {', '.join(sorted(holders))} do not "
                f"hold — they are seeded {module}.manage without it"
            )

    assert not offenders, (
        "A seeded position is refused a read on a fresh install, with no "
        "hand-editing involved. Pair the module's manage grant into "
        "require_permission(...), or give the seeded position the view grant "
        "in app/core/permissions.py — the endpoint side is usually the "
        "smaller change and needs no migration (pitfall #23):\n  "
        + "\n  ".join(offenders)
    )
