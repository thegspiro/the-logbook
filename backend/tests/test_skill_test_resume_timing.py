"""Resuming a scored evaluation, and what that does to its clock.

Re-entering an in-progress test already worked: the records list offers it, and
the examiner screen restores the clock from ``elapsed_seconds``. What nothing
said was that the restored clock is no longer a stopwatch reading — time
between the last save and the interruption is missing, and time spent getting
back into the test is not.

For an untimed sheet that is immaterial. For a timed evolution, where the
duration may itself be the criterion, it means the recorded seconds are not
evidence — and an officer validating one had no way to know.

So the fact is recorded and the number is marked, rather than corrected. There
is no honest way to reconstruct what the stopwatch would have read.

DB is mocked; no MySQL.
"""

from types import SimpleNamespace

from app.schemas.skills_testing import SkillTestUpdate


def _test(**overrides):
    base = {"resume_count": 0, "version": 3}
    base.update(overrides)
    return SimpleNamespace(**base)


def _apply(test, update: SkillTestUpdate, *, version_conflict=False):
    """The endpoint's resume handling, in the order it runs.

    Mirrors update_test: the flag is popped as a report rather than a column,
    and the increment happens *after* the conflict check so a refused write
    cannot bump the count.
    """
    data = update.model_dump(exclude_unset=True)
    data.pop("expected_version", None)
    resumed = data.pop("resumed", None)
    if version_conflict:
        return data  # endpoint raises 409 here; nothing is written
    if resumed:
        test.resume_count = (test.resume_count or 0) + 1
    return data


class TestResumeReporting:
    def test_a_resume_increments_the_count(self):
        test = _test()
        _apply(test, SkillTestUpdate(resumed=True))

        assert test.resume_count == 1

    def test_an_ordinary_save_leaves_it_alone(self):
        test = _test(resume_count=2)
        _apply(test, SkillTestUpdate(elapsed_seconds=120))

        assert test.resume_count == 2

    def test_resumes_accumulate(self):
        """One pickup is unremarkable; four says the evaluation was run in
        pieces, which is worth an officer seeing."""
        test = _test()
        for _ in range(4):
            _apply(test, SkillTestUpdate(resumed=True))

        assert test.resume_count == 4

    def test_the_flag_never_reaches_the_column_set(self):
        """It is a fact the client reports, not a field it may write — the
        count is incremented server-side so a client cannot set it directly."""
        data = _apply(_test(), SkillTestUpdate(resumed=True, elapsed_seconds=90))

        assert "resumed" not in data
        assert "resume_count" not in data
        assert data == {"elapsed_seconds": 90}

    def test_a_refused_write_does_not_bump_the_count(self):
        """The increment runs after the optimistic-concurrency check, so a 409
        cannot inflate it."""
        test = _test(resume_count=1)
        _apply(
            test,
            SkillTestUpdate(resumed=True, expected_version=2),
            version_conflict=True,
        )

        assert test.resume_count == 1

    def test_the_flag_is_absent_unless_sent(self):
        """exclude_unset means an ordinary save carries no opinion about it."""
        assert "resumed" not in SkillTestUpdate(notes="x").model_dump(
            exclude_unset=True
        )


class TestDerivedTimingVerified:
    """What the response reports, mirroring _build_test_response."""

    def _timing_verified(self, resume_count):
        return not (resume_count or 0)

    def test_an_uninterrupted_test_reports_verified_timing(self):
        assert self._timing_verified(0) is True

    def test_any_resume_marks_the_timing_unverified(self):
        assert self._timing_verified(1) is False
        assert self._timing_verified(5) is False

    def test_a_row_predating_the_column_reads_as_verified(self):
        """Tests recorded before resumes were tracked ran straight through as
        far as anyone knows, and marking every historical result uncertain
        would say something the data does not support."""
        assert self._timing_verified(None) is True
