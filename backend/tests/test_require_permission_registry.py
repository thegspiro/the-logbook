"""
Guard: every permission-gated endpoint must be reachable by an assignable
permission, not only by a global "*" admin.

require_permission("x.y", ...) grants access if the user holds any listed
permission. If *none* of the listed permissions exists in the registry
(get_all_permissions), no role can ever be granted access — the endpoint is
silently reachable only by a "*" superadmin. That is how the entire
medical-screening feature became unreachable (it gated on the unregistered
medical_screening.view / .manage).

Legacy/renamed names left in an OR with a valid permission (e.g.
positions.view OR roles.view) are fine — the valid one carries it. This test
scans app/api for require_permission/require_all_permissions calls and fails
if any call lists no resolvable permission.
"""

import glob
import os
import re

from app.core.permissions import get_all_permissions

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_DIR = os.path.join(BACKEND_ROOT, "app", "api")

# Permissions that are intentionally global-admin-only sentinels: they are NOT
# registered (so no role can hold them) by design, restricting the endpoint to
# "*" superadmins. Cross-organization maintenance jobs use this.
_INTENTIONAL_SUPERADMIN_ONLY = {"system.admin"}

_CALL_RE = re.compile(r"require_(?:all_)?permissions?\(([^)]*)\)", re.DOTALL)
_STR_RE = re.compile(r"""['"]([a-z_]+\.[a-z_*]+|\*)['"]""")


def _resolvable(perm: str, known: set, modules: set) -> bool:
    if perm == "*" or perm in _INTENTIONAL_SUPERADMIN_ONLY:
        return True
    if perm in known:
        return True
    if perm.endswith(".*") and perm.split(".")[0] in modules:
        return True
    return False


def test_every_gated_endpoint_has_an_assignable_permission():
    known = set(get_all_permissions())
    modules = {p.split(".")[0] for p in known}

    violations = []
    for path in glob.glob(os.path.join(API_DIR, "**", "*.py"), recursive=True):
        src = open(path, encoding="utf-8").read()
        for m in _CALL_RE.finditer(src):
            perms = _STR_RE.findall(m.group(1))
            if not perms:
                continue
            if not any(_resolvable(p, known, modules) for p in perms):
                line = src[: m.start()].count("\n") + 1
                rel = os.path.relpath(path, BACKEND_ROOT)
                violations.append(f"{rel}:{line}: gated only on {perms}")

    assert not violations, (
        "Endpoint reachable only by a '*' admin (no assignable permission):\n"
        + "\n".join(violations)
    )
