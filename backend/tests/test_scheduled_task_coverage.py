"""Guard: every scheduled task is actually wired into the in-process runner.

The default deployment has no external cron — main.py's _scheduled_task_loop
runs periodic tasks in-process, building its schedule from
TASK_INTERVALS_SECONDS. A task registered in TASK_RUNNERS (and documented in
SCHEDULE / the crontab docstring) but absent from both the interval schedule
and the manual-only set is silently never run in production.

That is exactly what happened to shift_auto_checkout, end_of_shift_summary,
end_of_shift_checklist_reminders, trainee_report_escalation, and
external_training_auto_sync — defined, documented, manually triggerable, but
never auto-fired. These tests fail if such a gap reappears.
"""

from app.services.scheduled_tasks import (
    _MANUAL_ONLY_TASKS,
    SCHEDULE,
    TASK_INTERVALS_SECONDS,
    TASK_RUNNERS,
)


def test_every_runner_is_scheduled_or_manual():
    auto = set(TASK_INTERVALS_SECONDS)
    manual = set(_MANUAL_ONLY_TASKS)
    never_run = set(TASK_RUNNERS) - auto - manual
    assert not never_run, (
        "Task(s) registered in TASK_RUNNERS but never auto-run by the "
        "in-process scheduler — add an interval to TASK_INTERVALS_SECONDS or, "
        "if driven by a dedicated loop, add to _MANUAL_ONLY_TASKS:\n"
        + "\n".join(f"  {t}" for t in sorted(never_run))
    )


def test_no_phantom_scheduled_tasks():
    known = set(TASK_RUNNERS)
    unknown = (set(TASK_INTERVALS_SECONDS) | set(_MANUAL_ONLY_TASKS)) - known
    assert not unknown, (
        "Scheduled/manual task name(s) with no matching runner in "
        "TASK_RUNNERS (typo or stale entry):\n"
        + "\n".join(f"  {t}" for t in sorted(unknown))
    )


def test_intervals_are_positive():
    bad = {
        k: v
        for k, v in TASK_INTERVALS_SECONDS.items()
        if not isinstance(v, int) or v <= 0
    }
    assert not bad, f"Non-positive interval(s): {bad}"


def test_auto_and_manual_sets_are_disjoint():
    overlap = set(TASK_INTERVALS_SECONDS) & set(_MANUAL_ONLY_TASKS)
    assert (
        not overlap
    ), f"Task(s) both auto-scheduled and manual-only: {sorted(overlap)}"


def test_scheduled_tasks_are_documented():
    # Every auto-run task should also appear in SCHEDULE (admin UI / docs).
    undocumented = set(TASK_INTERVALS_SECONDS) - set(SCHEDULE)
    assert (
        not undocumented
    ), "Auto-scheduled task(s) missing from SCHEDULE documentation:\n" + "\n".join(
        f"  {t}" for t in sorted(undocumented)
    )
