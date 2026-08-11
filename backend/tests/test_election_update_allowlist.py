"""
`update_election` applies only fields on an explicit allowlist, so that a
widened Pydantic schema can never reach a read-only column. The cost of that
design is that a field left off the list is dropped in silence — PATCH still
answers 200 and reports the old value.

`event_id` was in exactly that state: the handler validated it was in-org
(the XC-1 check) and then never wrote it, so an election could not be linked
to an event after creation and nothing said so. This asserts the allowlist
covers every link field the update schema accepts.
"""

import ast
from pathlib import Path

ENDPOINT = (
    Path(__file__).resolve().parent.parent
    / "app"
    / "api"
    / "v1"
    / "endpoints"
    / "elections.py"
)


def _allowlist() -> set[str]:
    """Read ALLOWED_ELECTION_UPDATE_FIELDS out of the endpoint module.

    Parsed rather than imported: the constant is local to the handler, so it
    is not importable without standing up the whole FastAPI app.
    """
    tree = ast.parse(ENDPOINT.read_text())
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
        if "ALLOWED_ELECTION_UPDATE_FIELDS" in targets:
            return {
                element.value
                for element in node.value.elts
                if isinstance(element, ast.Constant)
            }
    raise AssertionError("ALLOWED_ELECTION_UPDATE_FIELDS not found")


class TestElectionUpdateAllowlist:
    def test_event_link_is_writable(self):
        # The regression: validated, then silently discarded.
        assert "event_id" in _allowlist()

    def test_meeting_link_is_writable(self):
        assert "meeting_id" in _allowlist()

    def test_every_update_schema_field_is_either_allowed_or_deliberate(self):
        """Nothing on ElectionUpdate should be silently dropped.

        A field the schema accepts but the handler ignores is indistinguishable
        from one that was applied. The exceptions below are the fields the
        handler consumes itself rather than assigning.
        """
        from app.schemas.election import ElectionUpdate

        # `status` moves through the dedicated transition endpoints, which
        # enforce the lifecycle rules a bare assignment would bypass.
        handled_elsewhere = {"status"}
        schema_fields = set(ElectionUpdate.model_fields) - handled_elsewhere
        assert schema_fields <= _allowlist(), sorted(schema_fields - _allowlist())
