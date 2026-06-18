"""run_membership_inactivity_warnings wires prospect inactivity processing in.

MembershipPipelineService.process_inactivity_warnings logs warnings and
auto-marks stale prospects inactive once they pass their configured timeout.
It is documented to run "via a scheduled job" but had no scheduled caller, so
stale prospects only transitioned when an admin manually hit the endpoint. This
test confirms the runner invokes it per org and aggregates the counts, DB mocked.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.scheduled_tasks import run_membership_inactivity_warnings


async def test_processes_each_org_and_aggregates_counts():
    orgs = [SimpleNamespace(id="org-1"), SimpleNamespace(id="org-2")]
    org_result = MagicMock()
    org_result.scalars.return_value.all.return_value = orgs
    db = MagicMock()
    db.execute = AsyncMock(return_value=org_result)

    with patch(
        "app.services.membership_pipeline_service.MembershipPipelineService"
    ) as MockSvc:
        instance = MockSvc.return_value
        instance.process_inactivity_warnings = AsyncMock(
            side_effect=[
                {"warnings_sent": 2, "marked_inactive": 1, "total_checked": 5},
                {"warnings_sent": 0, "marked_inactive": 3, "total_checked": 3},
            ]
        )

        out = await run_membership_inactivity_warnings(db)

    # 2 orgs processed; total = (2+1) + (0+3) = 6
    assert out == {
        "task": "membership_inactivity_warnings",
        "total": 6,
        "errors": [],
    }
    assert instance.process_inactivity_warnings.await_count == 2
    instance.process_inactivity_warnings.assert_any_await(
        organization_id="org-1", processed_by=None
    )
