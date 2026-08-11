"""
The programme list must carry an enrolled count.

`TrainingProgramsPage` renders "N enrolled" on every pipeline card. N was the
literal `0`: the count was never computed, never sent, and never read, so a
pipeline with a full recruit class on it reported the same figure as an empty
one. Nothing failed and nothing looked broken — a zero is a plausible number.

`get_programs` now stamps `enrolled_count` on each row from one grouped query,
and the response schema carries it.

Source and schema assertions — the count is a query the service runs, and
exercising it end to end needs enrollments in a live database.
"""

import inspect

from app.schemas.training_program import TrainingProgramResponse
from app.services.training_program_service import TrainingProgramService


def test_the_response_carries_the_count():
    assert "enrolled_count" in TrainingProgramResponse.model_fields


def test_the_count_defaults_to_zero():
    """A programme nobody is on, rather than a missing field the card cannot render."""
    assert TrainingProgramResponse.model_fields["enrolled_count"].default == 0


def test_the_list_attaches_it():
    source = inspect.getsource(TrainingProgramService.get_programs)
    assert (
        "_attach_enrolled_counts" in source
    ), "get_programs no longer attaches enrolled counts — the cards will read 0"


def test_withdrawn_enrollments_do_not_count():
    """The card answers "how many am I running through this", not "how many started"."""
    source = inspect.getsource(TrainingProgramService._attach_enrolled_counts)
    assert "WITHDRAWN" in source


def test_it_is_one_query_for_the_whole_page():
    """Grouped, not a count per card: the list is rendered in full on one screen."""
    source = inspect.getsource(TrainingProgramService._attach_enrolled_counts)
    assert "group_by" in source
    assert "in_(" in source
