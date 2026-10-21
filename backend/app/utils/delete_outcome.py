"""Report whether a DELETE removed a row or only deactivated it.

Some records are deactivated rather than deleted while other records still use
them, so history keeps its references (budget categories, shift templates,
basic apparatus). Those endpoints answered 204 before the rule existed, and
callers rely on it, so the outcome travels in a header instead of a body:
``X-Delete-Outcome: deleted`` or ``deactivated``. The frontend reads it with
``readDeleteOutcome`` in ``src/utils/deleteOutcome.ts`` to tell the officer
which happened. ``main.py`` exposes the header to a cross-origin frontend.
"""

from starlette.responses import Response

DELETE_OUTCOME_HEADER = "X-Delete-Outcome"
DELETED = "deleted"
DEACTIVATED = "deactivated"


def set_delete_outcome(response: Response, deleted: bool) -> None:
    """Stamp *response* with what the delete actually did."""
    response.headers[DELETE_OUTCOME_HEADER] = DELETED if deleted else DEACTIVATED
