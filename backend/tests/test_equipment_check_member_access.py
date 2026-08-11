"""
A member who may submit an equipment check must be able to open one.

EC-7 widened `GET /shifts/{id}/checklists` to accept `equipment_check.view` OR
`equipment_check.submit`, on the stated grounds that a member holds `.submit`
and the check-performing flow has to keep working. Its siblings were left
view-only — and the compartments and items on a template *are* the check form.

So a member saw "Engine Daily Check — 0/9 items — Start Check" on My Equipment
Checklists, clicked it, and got a 403. Every route into the form went the same
way: opening a due checklist, starting an ad-hoc one, and resuming a
part-finished one all call `GET /templates/{id}`, and the "Start a Check"
picker calls `GET /templates`. The member-facing page could list work it could
not begin.

Signature assertions — the defect was in the dependency, and reproducing it
end-to-end needs a member session against a live database.
"""

import inspect

import pytest

from app.api.v1.endpoints import equipment_check

# Every endpoint the member's own checklist page calls, and the permissions it
# has to accept for that page to function.
MEMBER_FLOW_ENDPOINTS = [
    "get_shift_checklists",
    "get_template",
    "list_templates",
]


def _permission_names(handler) -> set[str]:
    """The permission strings named in a handler's `require_permission` call."""
    source = inspect.getsource(handler)
    start = source.find("require_permission(")
    assert start != -1, f"{handler.__name__} has no require_permission dependency"
    end = source.find(")", start)
    return {
        part.strip().strip("\"'")
        for part in source[start + len("require_permission(") : end].split(",")
        if part.strip()
    }


@pytest.mark.parametrize("name", MEMBER_FLOW_ENDPOINTS)
def test_the_member_flow_accepts_submit(name):
    """`.submit` is the permission the default member position carries."""
    names = _permission_names(getattr(equipment_check, name))
    assert "equipment_check.submit" in names, (
        f"{name} does not accept equipment_check.submit — a member can be shown "
        "a checklist they are then refused"
    )


@pytest.mark.parametrize("name", MEMBER_FLOW_ENDPOINTS)
def test_the_member_flow_still_accepts_view(name):
    """Widening must not have narrowed: an officer holds `.view`, not `.submit`."""
    assert "equipment_check.view" in _permission_names(getattr(equipment_check, name))


def test_writes_are_not_widened():
    """Only the reads the form needs. Editing a template stays a manage right."""
    for name in ("update_template", "delete_template"):
        handler = getattr(equipment_check, name, None)
        if handler is None:
            continue
        assert "equipment_check.submit" not in _permission_names(
            handler
        ), f"{name} accepts equipment_check.submit — members can edit templates"
