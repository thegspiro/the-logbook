"""
The course lookup binds a UUID against a String(36) column.

`TrainingCourse.id` is `String(36)`, but `course_id` reaches the session
service as a `UUID` object from the schema. Comparing the two raw matches
nothing, so `create_training_session` and its recurring counterpart returned
"Training course not found" for a course that plainly existed.

Nothing in the demo data exercised it: the path is only reached with
`use_existing_course=True`, which is how *cohort classes* are created. The
first cohort ever seeded failed on all five of its classes at once, leaving
every row reading "No event" under a red "Create N missing events" button.

The organization filter one line below was already cast with `str()`, which is
what makes the omission legible in the source — so these tests assert on that
asymmetry directly.
"""

import inspect
import re

import pytest

from app.services.training_session_service import TrainingSessionService

SOURCE = inspect.getsource(TrainingSessionService)

# Each `select(TrainingCourse)` block, up to the closing paren of the execute.
COURSE_LOOKUPS = re.findall(
    r"select\(TrainingCourse\)[^)]*\.where\(\s*TrainingCourse\.id\s*==\s*([^)]+?)\s*\)",
    SOURCE,
)


def test_the_lookups_are_still_there():
    """Guards the guard: a rename would otherwise make these tests vacuous."""
    assert len(COURSE_LOOKUPS) >= 2


@pytest.mark.parametrize("bound", COURSE_LOOKUPS)
def test_course_id_is_cast_to_str(bound):
    assert bound.startswith("str("), (
        f"TrainingCourse.id is compared against {bound!r} — a UUID bound "
        "against a String(36) column matches nothing"
    )


def test_organization_filter_is_cast_too():
    # The pair has to stay symmetric; it was the asymmetry that hid the bug.
    assert "TrainingCourse.organization_id == str(organization_id)" in SOURCE
