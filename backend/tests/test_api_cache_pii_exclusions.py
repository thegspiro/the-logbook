"""Member PII does not land in the frontend response cache.

``frontend/src/utils/apiCache.ts`` is a stale-while-revalidate cache in front
of the shared axios instance: a GET response is held for 30s fresh / 90s
stale, keyed by URL and **carrying no user identity**. Its own comment says
what that means — ``clearCache()`` on logout is the only thing standing
between one member's responses and the next member to sign in on the same tab,
which on a shared station terminal is a real sequence, not a hypothetical one.

The cache is therefore **cache-by-default**: ``UNCACHEABLE_PREFIXES`` and
``UNCACHEABLE_SUBSTRINGS`` are a denylist, and an endpoint added to the backend
is cached unless someone remembers to write a line in a TypeScript file in the
other half of the repository. CLAUDE.md's HIPAA section states the rule ("when
adding endpoints that return PII … add them to this list") and nothing checked
it, which is the shape pitfall #16 warns about: the ban on blocking browser
dialogs held across 58 call sites on review discipline alone and then regressed
anyway, because unlike every other invariant in that document it had no machine
check behind it. On 2026-09-07 a sweep found ten member-PII routes cached,
among them ``/inventory/items/{id}/exposures`` (a member's contamination and
decon history) and ``/inventory/clearances`` (who is leaving, and what they
still owe).

**This is a ratchet, not a rule** — the same construction as
``test_org_scoping_ratchet.py`` and ``test_endpoint_auth_coverage.py``'s
``ALLOWLISTED_PUBLIC``. It cannot decide whether a given field is really
personal information; it freezes today's judgement and fails on anything new.
A baselined route that stops flagging fails too, so the list shrinks rather
than growing into a blanket suppression.

Scope, and its limits — read these before trusting a green run:

* **Response-model routes only.** A handler with no ``response_model``
  returns whatever its service built and is invisible here. 141 GET routes are
  in that state.
* **Field *names*, not values.** ``emails_sent_this_month`` is a count and
  matches nothing; a free-text ``notes`` column holding a home address matches
  nothing either. The marker set is deliberately narrow — widening it to
  ``name`` alone put most of the API in the baseline, which is how a guard
  stops guarding.
* **It does not know which axios instance serves a route.** Module clients
  built by ``createApiClient`` do not cache at all, so an exclusion for one of
  their routes is a harmless no-op rather than a finding. Being conservative
  in that direction is the point: a route can move between clients without
  anybody re-deriving this.
"""

import ast
import json
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ENDPOINTS = BACKEND / "app" / "api" / "v1" / "endpoints"
SCHEMAS = BACKEND / "app" / "schemas"
API_PY = BACKEND / "app" / "api" / "v1" / "api.py"
CACHE_TS = BACKEND.parent / "frontend" / "src" / "utils" / "apiCache.ts"
BASELINE = Path(__file__).with_name("api_cache_pii_baseline.txt")

#: Field names that identify or describe a *member*, not the department.
#:
#: Narrow on purpose. A facility's street address and a vendor's phone number
#: are organizational records that belong in the cache; a member's are not, and
#: no set of field names separates the two — which is why ``address`` is absent
#: and ``address_street`` (a ``User`` column) is present.
PII_FIELDS = {
    "personal_email",
    "date_of_birth",
    "dob",
    "ssn",
    "social_security_number",
    "address_street",
    "emergency_contacts",
    "emergency_contact_name",
    "emergency_contact_phone",
    "driver_license_number",
    "user_name",
    "member_name",
    "requester_name",
    "reviewer_name",
    "assignee_name",
    "instructor_name",
    "member_notes",
    "first_name",
    "last_name",
    "full_name",
}

#: Nested-model recursion depth. Four levels reaches a list item's own nested
#: model without walking the entire schema graph from every route.
MAX_DEPTH = 4


def _schema_classes() -> dict[str, dict]:
    """Every Pydantic class in ``app/schemas`` with its bases and annotations."""
    classes: dict[str, dict] = {}
    for path in sorted(SCHEMAS.rglob("*.py")):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            fields = {
                stmt.target.id: ast.unparse(stmt.annotation)
                for stmt in node.body
                if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name)
            }
            classes[node.name] = {
                "bases": [ast.unparse(b).split("[")[0].strip() for b in node.bases],
                "fields": fields,
            }
    return classes


CLASSES = _schema_classes()


def _fields_of(name: str, seen: frozenset[str] = frozenset(), depth: int = 0):
    """Field names reachable from a schema, through bases and nested models."""
    if depth > MAX_DEPTH or name in seen or name not in CLASSES:
        return set()
    seen = seen | {name}
    info = CLASSES[name]
    out: set[str] = set()
    for base in info["bases"]:
        out |= _fields_of(base, seen, depth + 1)
    for field, annotation in info["fields"].items():
        out.add(field)
        for ref in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", annotation):
            if ref in CLASSES and ref != name:
                out |= _fields_of(ref, seen, depth + 1)
    return out


def _router_prefixes() -> dict[str, str]:
    """Module name -> the prefix ``api.py`` mounts its router under."""
    source = API_PY.read_text()
    prefixes: dict[str, str] = {}
    pattern = re.compile(
        r"([\w_]+)\.router\s*,\s*\n?\s*prefix=\"([^\"]*)\"", re.MULTILINE
    )
    for match in pattern.finditer(source):
        prefixes.setdefault(match.group(1), match.group(2))
    return prefixes


def _get_routes():
    """Yield ``(url, module, handler, response_model)`` for every v1 GET."""
    prefixes = _router_prefixes()
    for path in sorted(ENDPOINTS.glob("*.py")):
        tree = ast.parse(path.read_text())

        local_prefix = ""
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "APIRouter"
            ):
                for kw in node.keywords:
                    if kw.arg == "prefix" and isinstance(kw.value, ast.Constant):
                        local_prefix = kw.value.value

        base = prefixes.get(path.stem)
        if base is None:
            # Not mounted by api.py under a literal prefix; its URL cannot be
            # reconstructed, so it cannot be checked against a URL denylist.
            continue

        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for dec in node.decorator_list:
                if not isinstance(dec, ast.Call):
                    continue
                func = dec.func
                if not (isinstance(func, ast.Attribute) and func.attr == "get"):
                    continue
                if not (isinstance(func.value, ast.Name) and "router" in func.value.id):
                    continue
                route = (
                    dec.args[0].value
                    if dec.args and isinstance(dec.args[0], ast.Constant)
                    else ""
                )
                model = next(
                    (
                        ast.unparse(kw.value)
                        for kw in dec.keywords
                        if kw.arg == "response_model"
                    ),
                    None,
                )
                yield base + local_prefix + route, path.name, node.name, model


def _ts_list(name: str) -> list[str]:
    """The string entries of a ``const <name> = [...] as const;`` array.

    Line-anchored: several entries carry comments containing an apostrophe
    ("current user's permissions"), and a naive quote-pair scan silently
    swallows the entry after each one.
    """
    source = CACHE_TS.read_text()
    block = source.split(f"const {name} = [")[1].split("] as const;")[0]
    return re.findall(r"^\s*'([^']*)',", block, re.MULTILINE)


def _is_excluded(url: str) -> bool:
    prefixes = _ts_list("UNCACHEABLE_PREFIXES")
    substrings = _ts_list("UNCACHEABLE_SUBSTRINGS")
    return any(url.startswith(p) for p in prefixes) or any(s in url for s in substrings)


def _cached_pii_routes() -> dict[str, str]:
    """URL -> the PII fields that put it here, for every cached GET route."""
    findings: dict[str, str] = {}
    for url, module, handler, model in _get_routes():
        if not model or _is_excluded(url):
            continue
        fields: set[str] = set()
        for ref in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", model):
            if ref in CLASSES:
                fields |= _fields_of(ref)
        hits = sorted({f.rsplit(".", 1)[-1] for f in fields} & PII_FIELDS)
        if hits:
            findings[url] = f"{module}::{handler} [{', '.join(hits)}]"
    return findings


def _read_baseline() -> set[str]:
    if not BASELINE.exists():
        return set()
    return {
        line.strip()
        for line in BASELINE.read_text().splitlines()
        if line.strip() and not line.startswith("#")
    }


def test_new_pii_route_is_excluded_from_the_frontend_cache():
    """No GET route may start returning member PII into the SWR cache."""
    findings = _cached_pii_routes()
    baseline = _read_baseline()

    unexpected = sorted(set(findings) - baseline)
    assert not unexpected, (
        "GET route(s) whose response schema carries member PII are cached by "
        "frontend/src/utils/apiCache.ts.\n\n"
        "Add each URL to UNCACHEABLE_PREFIXES (or UNCACHEABLE_SUBSTRINGS) with "
        "a comment naming the PII, per CLAUDE.md's HIPAA section. If the field "
        "is departmental rather than personal — a station address, a vendor "
        "contact — add the URL to tests/api_cache_pii_baseline.txt with the "
        "reason on the line above, which is a deliberate privacy decision.\n\n"
        + "\n".join(f"  {url}  {findings[url]}" for url in unexpected)
    )


def test_baseline_has_no_stale_entries():
    """A baselined route that no longer flags must leave the baseline.

    Same reason the screenshot audit fails on a baselined image that stops
    flagging: without this the file only ever grows, and a denylist that only
    grows is a suppression, not a ratchet.
    """
    findings = _cached_pii_routes()
    stale = sorted(_read_baseline() - set(findings))
    assert not stale, (
        "These routes are in tests/api_cache_pii_baseline.txt but no longer "
        "flag — they were excluded from the cache, removed, or their schema "
        "changed. Delete these lines (and the comment above each):\n"
        + "\n".join(f"  {url}" for url in stale)
    )


if __name__ == "__main__":  # pragma: no cover - baseline regeneration helper
    print(json.dumps(_cached_pii_routes(), indent=2, sort_keys=True))
