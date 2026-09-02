"""`medical_screening.{record,requirement}_created` audit events must carry
the id of the row they describe.

Every other audit event on this router (`requirement_updated`,
`requirement_deleted`, `record_updated`, `record_deleted`) includes the
subject's id in `event_data` — only the two `_created` events did not,
because `requirement`/`record` weren't dereferenced for it even though both
are already available (freshly created and refreshed) at the call site. On a
PHI write path this undermines the HIPAA §164.312(b) audit trail the
`log_audit_event` call exists for: an auditor investigating "what happened to
screening record X" cannot find its own creation entry by id, only by
correlating user + timestamp + type, which is ambiguous the moment the same
subject gets two screenings of the same type close together (e.g. a redo
after a failed one).

No DB, no MySQL — this inspects the endpoint source directly, in the manner
of test_my_medical_compliance_route.py, rather than asserting against a real
audit_logs row.
"""

import ast
import inspect

from app.api.v1.endpoints import medical_screening as ep


def _event_data_keys(func) -> set:
    """Keys of the dict literal passed as `event_data=` to `log_audit_event`."""
    source = inspect.getsource(func)
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if not (
            isinstance(node, ast.Call)
            and getattr(node.func, "id", None) == "log_audit_event"
        ):
            continue
        for kw in node.keywords:
            if kw.arg == "event_data" and isinstance(kw.value, ast.Dict):
                return {
                    key.value
                    for key in kw.value.keys
                    if isinstance(key, ast.Constant) and isinstance(key.value, str)
                }
    raise AssertionError(
        f"no log_audit_event(event_data={{...}}) call found in {func.__name__}"
    )


def test_requirement_created_audit_includes_the_new_id():
    assert "requirement_id" in _event_data_keys(ep.create_requirement)


def test_record_created_audit_includes_the_new_id():
    assert "record_id" in _event_data_keys(ep.create_record)


def test_requirement_updated_and_deleted_still_include_the_id():
    """Guards the invariant on the two sites it already held, so a future
    edit can't drop it there while "fixing" the create side."""
    assert "requirement_id" in _event_data_keys(ep.update_requirement)
    assert "requirement_id" in _event_data_keys(ep.delete_requirement)


def test_record_updated_and_deleted_still_include_the_id():
    assert "record_id" in _event_data_keys(ep.update_record)
    assert "record_id" in _event_data_keys(ep.delete_record)
