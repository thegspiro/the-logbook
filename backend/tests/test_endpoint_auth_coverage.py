"""
Guard: no NEW unauthenticated v1 endpoint slips in by accident.

Every handler under app/api/v1/endpoints should declare an auth dependency
(get_current_user / require_permission / ...) unless it is intentionally
public (auth bootstrap, token-authenticated, or public reference data). This
test re-runs that audit and fails if an unauthenticated endpoint appears that
is not on the reviewed allowlist below — forcing a deliberate decision rather
than a silent exposure of a sensitive route.
"""

import ast
import glob
import os

AUTH_DEPS = {
    "get_current_user",
    "get_current_active_user",
    "get_current_user_optional",
    "require_permission",
    "require_all_permissions",
    "require_role",
}

# Reviewed, intentionally-public endpoints, keyed by (module, function). These
# are auth bootstrap, token-authenticated (the token is the credential), or
# public reference data. Adding to this set is a deliberate security decision.
ALLOWLISTED_PUBLIC = {
    ("auth.py", "get_login_branding"),
    ("auth.py", "get_oauth_config"),
    ("auth.py", "oauth_google_initiate"),
    ("auth.py", "oauth_google_callback"),
    ("auth.py", "oauth_microsoft_initiate"),
    ("auth.py", "oauth_microsoft_callback"),
    ("auth.py", "register"),
    ("auth.py", "login"),
    ("auth.py", "refresh_token"),
    ("auth.py", "forgot_password"),
    ("auth.py", "reset_password"),
    ("auth.py", "validate_reset_token"),
    ("training_sessions.py", "get_training_approval"),
    ("event_requests.py", "submit_public_event_request"),
    ("event_requests.py", "check_request_status"),
    ("event_requests.py", "public_cancel_request"),
    ("event_requests.py", "get_outreach_type_labels"),
    ("events.py", "get_public_calendar"),
    ("elections.py", "get_ballot_by_token"),
    ("elections.py", "get_ballot_candidates"),
    ("elections.py", "cast_vote_with_token"),
    ("elections.py", "submit_ballot_with_token"),
    ("elections.py", "verify_vote_receipt"),
}

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENDPOINTS_DIR = os.path.join(BACKEND_ROOT, "app", "api", "v1", "endpoints")


def _names(node):
    out = []
    for n in ast.walk(node):
        if isinstance(n, ast.Name):
            out.append(n.id)
        elif isinstance(n, ast.Attribute):
            out.append(n.attr)
    return out


def _unauthenticated_endpoints():
    found = set()
    for path in glob.glob(os.path.join(ENDPOINTS_DIR, "*.py")):
        tree = ast.parse(open(path, encoding="utf-8").read())
        for node in ast.walk(tree):
            if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                continue
            is_route = any(
                isinstance(d, ast.Call)
                and isinstance(d.func, ast.Attribute)
                and d.func.attr in {"get", "post", "put", "patch", "delete"}
                for d in node.decorator_list
            )
            if not is_route:
                continue
            defaults = list(node.args.defaults) + [
                d for d in node.args.kw_defaults if d is not None
            ]
            has_auth = any(
                isinstance(d, ast.Call) and any(n in AUTH_DEPS for n in _names(d))
                for d in defaults
            )
            if not has_auth:
                found.add((os.path.basename(path), node.name))
    return found


def test_no_unreviewed_unauthenticated_endpoints():
    unexpected = _unauthenticated_endpoints() - ALLOWLISTED_PUBLIC
    assert not unexpected, (
        "New unauthenticated v1 endpoint(s) — add an auth dependency or, if "
        "intentionally public, add to ALLOWLISTED_PUBLIC with justification:\n"
        + "\n".join(f"  {m}:{fn}" for m, fn in sorted(unexpected))
    )
