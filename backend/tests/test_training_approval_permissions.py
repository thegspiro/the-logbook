"""Authorization regression tests for the training approval workflow."""

import ast
from pathlib import Path


def _permission_names(handler_name: str) -> set[str]:
    endpoint_path = (
        Path(__file__).parents[1] / "app/api/v1/endpoints/training_sessions.py"
    )
    tree = ast.parse(endpoint_path.read_text())
    handler = next(
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == handler_name
    )
    permission_call = next(
        node
        for node in ast.walk(handler.args)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "require_permission"
    )
    return {ast.literal_eval(argument) for argument in permission_call.args}


def test_training_approval_roster_requires_training_manage():
    """Event-only roles must not receive attendee PII from approval links."""
    assert _permission_names("get_training_approval") == {"training.manage"}


def test_training_approval_submission_requires_training_manage():
    """Approving matches the roster behind it. Submission used to require
    events.manage while the roster required training.manage, so only a holder
    of both could use the approval page at all — and an events-only role could
    approve attendance it was not allowed to see."""
    assert _permission_names("submit_training_approval") == {"training.manage"}


def test_attaching_training_details_is_an_event_edit():
    assert _permission_names("attach_training_details") == {"events.manage"}


def test_the_event_approval_summary_admits_either_side():
    """The event page shows the status to the event's managers and to training
    officers; only the latter get the approval link's token."""
    assert _permission_names("get_event_training_approval") == {
        "events.manage",
        "training.manage",
    }
