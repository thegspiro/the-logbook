"""
Test the scheduled recert-sweep runner (scheduled_tasks.run_recert_resets):
it runs the pipeline recert sweep once per org and sums the reset counts.
DB mocked.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.scheduled_tasks import run_recert_resets


class FakeSession:
    """Minimal session whose execute() returns the org list for _for_each_org."""

    def __init__(self, orgs):
        self._orgs = orgs

    async def execute(self, *args, **kwargs):
        scalars = MagicMock()
        scalars.all.return_value = self._orgs
        return MagicMock(scalars=MagicMock(return_value=scalars))


async def test_runner_sweeps_each_org_and_sums(monkeypatch):
    orgs = [SimpleNamespace(id="org-1"), SimpleNamespace(id="org-2")]
    sweep = AsyncMock(return_value=(3, None))
    monkeypatch.setattr(
        "app.services.training_program_service."
        "TrainingProgramService.run_due_recert_resets",
        sweep,
    )

    result = await run_recert_resets(FakeSession(orgs))

    assert result["task"] == "recert_resets"
    assert result["total"] == 6  # 3 per org × 2 orgs
    assert sweep.await_count == 2


async def test_runner_isolates_a_failing_org(monkeypatch):
    orgs = [SimpleNamespace(id="org-1"), SimpleNamespace(id="org-2")]

    async def _sweep(self, organization_id):
        if organization_id == "org-1":
            raise RuntimeError("boom")
        return (2, None)

    monkeypatch.setattr(
        "app.services.training_program_service."
        "TrainingProgramService.run_due_recert_resets",
        _sweep,
    )

    result = await run_recert_resets(FakeSession(orgs))

    # One org failed, the other still swept; the failure is recorded, not raised.
    assert result["total"] == 2
    assert len(result["errors"]) == 1
    assert result["errors"][0]["org_id"] == "org-1"
