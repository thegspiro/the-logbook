"""Every ``log_audit_event(...)`` call binds to the signature it forwards to.

``log_audit_event`` takes ``event_type``, ``event_category``, ``severity`` and
``event_data`` as required arguments and passes everything else through
``**kwargs`` to ``AuditLogger.create_log_entry``, which accepts only a fixed set
of keywords. A call written against some other audit API — ``action=``,
``resource_type=``, ``details=`` — is therefore a ``TypeError`` the moment it
runs, and because every endpoint audits *after* its service has committed, the
user sees a 500 for a change that was in fact saved, and no audit row is
written. Four endpoints shipped that way (importing a training program,
creating and ending a standing shift, registering a browser for push), each
reached only by a request no test made.

The check is static, over the AST, so it covers every call site without having
to drive each endpoint: bind the call's argument shape against both
signatures, the way the interpreter would.
"""

import ast
import inspect
from pathlib import Path

from app.core.audit import AuditLogger, log_audit_event

BACKEND = Path(__file__).resolve().parents[1]
APP = BACKEND / "app"


def _create_log_entry_signature() -> inspect.Signature:
    """``create_log_entry`` as ``log_audit_event`` calls it: no ``self``."""
    sig = inspect.signature(AuditLogger.create_log_entry)
    params = [p for name, p in sig.parameters.items() if name != "self"]
    return sig.replace(parameters=params)


def _bind_errors(call: ast.Call) -> list[str]:
    """Why this call would raise ``TypeError`` before doing anything, if it would."""
    positional = [None] * len(call.args)
    keywords = {k.arg: None for k in call.keywords if k.arg is not None}
    errors = []
    for label, sig in (
        ("log_audit_event", inspect.signature(log_audit_event)),
        ("create_log_entry", _create_log_entry_signature()),
    ):
        try:
            sig.bind(*positional, **keywords)
        except TypeError as exc:
            errors.append(f"{label}: {exc}")
    return errors


def _audit_calls(tree: ast.AST):
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
        if name != "log_audit_event":
            continue
        # A ``*args`` / ``**kwargs`` splat cannot be checked statically.
        if any(isinstance(a, ast.Starred) for a in node.args) or any(
            k.arg is None for k in node.keywords
        ):
            continue
        yield node


def _all_audit_calls():
    for path in sorted(APP.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for call in _audit_calls(tree):
            yield path, call


def test_every_audit_call_binds_to_the_audit_signature():
    failures = [
        f"{path.relative_to(BACKEND)}:{call.lineno}: {'; '.join(errors)}"
        for path, call in _all_audit_calls()
        if (errors := _bind_errors(call))
    ]
    assert not failures, "log_audit_event called with arguments it rejects:\n" + (
        "\n".join(failures)
    )


def test_the_sweep_actually_looks_at_the_call_sites():
    # Several hundred endpoints audit; a sweep that found a handful would mean
    # the walk stopped matching, not that the codebase is clean.
    assert sum(1 for _ in _all_audit_calls()) > 300


def test_a_call_in_the_wrong_shape_is_reported():
    wrong = ast.parse(
        "log_audit_event(db, user_id='u', organization_id='o',"
        " action='standing_shift.create', resource_type='x', resource_id='1')"
    )
    right = ast.parse(
        "log_audit_event(db=db, event_type='t', event_category='c',"
        " severity='info', event_data={}, user_id='u', organization_id='o')"
    )
    (wrong_call,) = _audit_calls(wrong)
    (right_call,) = _audit_calls(right)
    assert _bind_errors(wrong_call)
    assert _bind_errors(right_call) == []
