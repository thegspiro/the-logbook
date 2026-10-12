"""``rows_affected`` reads a DML result's row count and refuses anything else."""

from unittest.mock import MagicMock

import pytest
from sqlalchemy.engine import CursorResult, Result

from app.utils.sql_results import rows_affected

pytestmark = [pytest.mark.unit]


class TestRowsAffected:
    def test_returns_the_cursor_results_rowcount(self):
        assert rows_affected(MagicMock(spec=CursorResult, rowcount=3)) == 3

    def test_zero_is_reported_as_zero(self):
        assert rows_affected(MagicMock(spec=CursorResult, rowcount=0)) == 0

    def test_a_result_without_a_rowcount_is_refused(self):
        # A guard reading "no rows moved" from a SELECT's result would take a
        # programming error for a lost race; refusing makes it loud instead.
        with pytest.raises(TypeError, match="UPDATE, DELETE or INSERT"):
            rows_affected(MagicMock(spec=Result))
