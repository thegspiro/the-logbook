"""Deleting an equipment-check template must not write to its own changelog.

`template_change_logs.template_id` is a foreign key onto the template with
ON DELETE CASCADE. A row recording the template's *own* deletion is therefore
impossible by construction: written before the delete it is cascaded away,
written after it is rejected.

It used to be written after — and after `delete_template` had already
committed. So every call inserted a child row for a parent that no longer
existed, MySQL refused it with error 1452, and the endpoint returned 500 over
a deletion that had in fact succeeded. Deleting a checklist template could not
be done without an error, and the error described none of what happened.

Asserted at the source rather than through a live request: reproducing 1452
needs a real MySQL with the constraint in place, which the sandboxed suite does
not have, and a mocked session would happily accept the insert the database
rejects — passing against exactly the code that was broken.
"""

from pathlib import Path

import pytest

ENDPOINTS = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "api"
    / "v1"
    / "endpoints"
    / "equipment_check.py"
)

SOURCE = ENDPOINTS.read_text()


def _handler(name: str) -> str:
    """The body of one endpoint handler, up to the next decorator."""
    start = SOURCE.index(f"async def {name}(")
    nxt = SOURCE.find("\n@router.", start)
    return SOURCE[start : nxt if nxt != -1 else len(SOURCE)]


class TestTemplateDeleteChangelog:
    def test_delete_template_writes_no_changelog_entry(self):
        body = _handler("delete_template")
        assert "log_template_change" not in body, (
            "delete_template must not write a changelog row: the FK cascades "
            "with the template, so the insert is rejected and the endpoint "
            "500s over a deletion that already committed"
        )

    def test_delete_template_still_reports_a_missing_template(self):
        # Removing the changelog write must not take the 404 with it.
        body = _handler("delete_template")
        assert "status_code=404" in body

    @pytest.mark.parametrize("handler", ["delete_compartment", "delete_item"])
    def test_child_deletes_still_log_against_the_parent(self, handler):
        # These are unaffected and must stay that way: they log against the
        # template, which survives the child's deletion. Deleting their
        # changelog writes alongside the template's would silently drop the
        # audit trail for every edit that *can* be recorded.
        body = _handler(handler)
        assert "log_template_change" in body, (
            f"{handler} logs against the parent template, which survives — "
            "that write is correct and must not be removed"
        )
