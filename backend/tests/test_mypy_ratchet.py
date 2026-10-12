"""The mypy ratchet's parsing and pass/fail rule."""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "mypy_ratchet.py"
_spec = importlib.util.spec_from_file_location("mypy_ratchet", SCRIPT)
assert _spec is not None
assert _spec.loader is not None
mypy_ratchet = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mypy_ratchet)

pytestmark = [pytest.mark.unit]


class TestParseErrorCount:
    def test_reads_the_summary_line(self):
        output = (
            "app/a.py:1: error: Bad  [arg-type]\n"
            "Found 548 errors in 111 files (checked 523 source files)\n"
        )
        assert mypy_ratchet.parse_error_count(output) == 548

    def test_singular_forms(self):
        output = "Found 1 error in 1 file (checked 1 source file)\n"
        assert mypy_ratchet.parse_error_count(output) == 1

    def test_a_clean_run_is_zero(self):
        output = "Success: no issues found in 523 source files\n"
        assert mypy_ratchet.parse_error_count(output) == 0

    def test_a_run_with_no_summary_is_refused(self):
        # A crash or a bad config prints no summary. Reading that as zero
        # would pass a run that checked nothing.
        with pytest.raises(ValueError, match="no summary line"):
            mypy_ratchet.parse_error_count("mypy.ini: [mypy]: bad option\n")

    def test_an_error_message_quoting_a_summary_is_not_the_summary(self):
        output = (
            'app/a.py:1: error: Name "Found 3 errors in 1 file" is odd  [misc]\n'
            "Found 1 error in 1 file (checked 1 source file)\n"
        )
        assert mypy_ratchet.parse_error_count(output) == 1


class TestVerdict:
    def test_above_the_baseline_fails(self):
        ok, message = mypy_ratchet.verdict(552, 548)
        assert not ok
        assert "4 more" in message

    def test_at_the_baseline_passes(self):
        ok, _ = mypy_ratchet.verdict(548, 548)
        assert ok

    def test_below_the_baseline_passes_and_asks_for_a_lower_bar(self):
        ok, message = mypy_ratchet.verdict(540, 548)
        assert ok
        assert "--update" in message


class TestBaselineFile:
    def test_round_trips_and_skips_comments(self, tmp_path):
        path = tmp_path / "mypy-baseline.txt"
        mypy_ratchet.write_baseline(548, path)
        assert path.read_text().startswith("#")
        assert mypy_ratchet.read_baseline(path) == 548

    def test_a_file_with_no_count_is_refused(self, tmp_path):
        path = tmp_path / "mypy-baseline.txt"
        path.write_text("# nothing here\n")
        with pytest.raises(ValueError, match="holds no count"):
            mypy_ratchet.read_baseline(path)

    def test_the_committed_baseline_is_readable(self):
        assert mypy_ratchet.read_baseline() >= 0
