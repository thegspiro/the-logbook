"""`_build_event_response` must name every field `EventResponse` declares.

The builder lists its arguments by hand rather than validating from the ORM
object, so a field it forgets is not an error — Pydantic fills the schema
default and the endpoint answers 200. For a boolean that default is ``False``,
which reads as "the feature is off" rather than as "nobody asked".

That is how guest check-in came to be unreachable: the column stored ``1``, the
read returned ``false``, the edit form loaded the false into its checkbox, and
saving any other change on that form wrote the false back. The feature switched
itself off, and every layer reported success.

An invariant test rather than a per-field one, because the pattern cannot
report its own omissions — the next field added to the schema has exactly the
same failure mode.
"""

import ast
from pathlib import Path

import pytest

from app.schemas.event import EventResponse

pytestmark = [pytest.mark.unit]

ENDPOINT = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "api"
    / "v1"
    / "endpoints"
    / "events.py"
)

# Supplied by callers through **extra_fields, not from the Event row: these are
# per-request aggregates and per-user state, which the builder has no way to
# know. Anything else absent from the call is an omission.
CALLER_SUPPLIED = {
    "rsvp_count",
    "going_count",
    "maybe_count",
    "not_going_count",
    "user_rsvp_status",
}


def _builder_kwargs() -> set[str]:
    tree = ast.parse(ENDPOINT.read_text())
    fn = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "_build_event_response"
    )
    call = next(
        node
        for node in ast.walk(fn)
        if isinstance(node, ast.Call)
        and getattr(node.func, "id", None) == "EventResponse"
    )
    return {kw.arg for kw in call.keywords if kw.arg}


def test_every_response_field_is_passed_explicitly():
    missing = set(EventResponse.model_fields) - _builder_kwargs() - CALLER_SUPPLIED
    assert not missing, (
        "_build_event_response does not pass these EventResponse fields, so they "
        f"silently fall back to their schema defaults: {sorted(missing)}"
    )


def test_the_guest_check_in_flags_are_among_them():
    """Named separately because they are the two that went wrong."""
    passed = _builder_kwargs()
    assert "allow_guest_check_in" in passed
    assert "guest_check_in_creates_prospect" in passed


def test_caller_supplied_names_still_exist_on_the_schema():
    """Keeps the allowlist honest if a field is renamed or dropped."""
    unknown = CALLER_SUPPLIED - set(EventResponse.model_fields)
    assert (
        not unknown
    ), f"CALLER_SUPPLIED names fields EventResponse no longer has: {sorted(unknown)}"
