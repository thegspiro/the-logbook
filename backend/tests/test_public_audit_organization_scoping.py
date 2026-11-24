"""A public-surface audit event must say which organization it belongs to.

``AuditLogger.create_log_entry`` (``app/core/audit.py``) only stamps
``AuditLog.organization_id`` from the ``organization_id=`` keyword a caller
passes, or — failing that — from ``user_id=`` (it looks the acting user's own
organization up). It never reads a same-named key out of the ``event_data``
dict. Every department-facing audit reader filters on the real column
(``audit_logs.py``, ``security_monitoring.py``, ``users.py``'s own audit tab,
``compliance_officer_service.py``, …), so a row stamped with neither keyword
is written **platform-level** — real, searchable by anyone who can query the
table directly, but invisible to the one department's own Audit Logs and
Security Monitoring screens, exactly the gap PUB-8
(``docs/security-review/PUB-03-public-surface-webhooks.md``) fixed for a
401-refusal row.

``app/api/public/`` has no ``current_user`` to resolve an organization from —
every handler here is unauthenticated, so ``user_id=`` is never available and
``organization_id=`` must be passed explicitly, taken from whatever token,
display code or webhook integration the handler already resolved the request
against. ``zeffy_webhook.py`` gets this right and says why in a comment ("No
acting user to infer it from: without this the record is missing from the
department's own audit views") — five sibling call sites
(``paypal_webhook.py``, ``salesforce_webhook.py``,
``integrations_webhook.py`` twice, and ``shift_evaluations.py``) wrote the
same shape of event with neither keyword, which this sweep now catches.

Matching is done on the AST, in the manner of ``test_csv_writer_sweep.py`` and
``test_log_call_shape.py``, so a docstring or comment quoting the banned shape
is not mistaken for one.
"""

import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
PUBLIC_DIR = BACKEND / "app" / "api" / "public"

#: A call site that is genuinely organization-less may name itself here, with
#: a comment saying why — e.g. a route with no org context at all. Empty on
#: purpose: every current call in ``app/api/public/`` resolves one.
ALLOWED: frozenset[str] = frozenset()


def _public_sources():
    return sorted(PUBLIC_DIR.glob("*.py"))


def _unstamped_audit_calls(tree: ast.AST):
    """Yield the line of each ``log_audit_event(...)`` call with neither
    ``organization_id=`` nor ``user_id=`` among its keyword arguments."""
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)):
            continue
        if node.func.id != "log_audit_event":
            continue
        keyword_names = {kw.arg for kw in node.keywords if kw.arg is not None}
        if "organization_id" in keyword_names or "user_id" in keyword_names:
            continue
        yield node.lineno


def test_every_public_audit_event_is_organization_stamped():
    offenders = []
    for path in _public_sources():
        source = path.read_text(encoding="utf-8")
        for lineno in _unstamped_audit_calls(ast.parse(source)):
            rel = path.relative_to(BACKEND)
            tag = f"{rel}:{lineno}"
            if str(rel) in ALLOWED:
                continue
            offenders.append(tag)

    assert not offenders, (
        "These app/api/public/ calls log an audit event with no "
        "organization_id= (and no user_id= to resolve one from), so "
        "create_log_entry() stamps the row platform-level and it never "
        "appears in the department's own Audit Logs or Security Monitoring "
        "screens — the same gap PUB-8 fixed for a different write path. Pass "
        "organization_id=<the id this handler already resolved the request "
        "against>, as zeffy_webhook.py's own call does:\n  " + "\n  ".join(offenders)
    )


def _calls(source: str):
    return list(_unstamped_audit_calls(ast.parse(source)))


def test_the_sweep_flags_the_unstamped_shape():
    assert _calls(
        'log_audit_event(db, "x", "cat", "info", {"organization_id": org_id})\n'
    ) == [1]
    assert _calls(
        "log_audit_event(\n"
        "    db=db,\n"
        '    event_type="x",\n'
        '    event_category="cat",\n'
        '    severity="info",\n'
        "    event_data={},\n"
        ")\n"
    ) == [1]


def test_the_sweep_leaves_a_stamped_call_alone():
    assert (
        _calls('log_audit_event(db, "x", "cat", "info", {}, organization_id=org_id)\n')
        == []
    )
    assert (
        _calls('log_audit_event(db, "x", "cat", "info", {}, user_id=user_id)\n') == []
    )
    # A call to something else named similarly is not matched.
    assert _calls('audit_logger.log_audit_event(db, "x")\n') == []


def test_the_sweep_actually_reaches_every_public_audit_call():
    """A sweep that silently stopped finding calls would pass forever."""
    seen = 0
    for path in _public_sources():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "log_audit_event"
            ):
                seen += 1
    # 17 call sites existed across app/api/public/ when this was written.
    assert seen >= 15
