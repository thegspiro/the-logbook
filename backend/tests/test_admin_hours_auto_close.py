"""run_admin_hours_auto_close wires the stale-session cleanup into the scheduler.

AdminHoursService.auto_close_stale_sessions caps a forgotten admin-hours
clock-in to the category's max-hours limit, but it was only reachable from a
manual admin endpoint — nothing ran it on a schedule, so a member who forgot to
clock out accrued unbounded time. This test confirms the scheduled runner
invokes it, commits, and reports the count, without a real database.
"""

from unittest.mock import AsyncMock, MagicMock, patch

from app.services.scheduled_tasks import run_admin_hours_auto_close


async def test_returns_count_and_commits():
    db = MagicMock()
    db.commit = AsyncMock()
    with patch(
        "app.services.admin_hours_service.AdminHoursService.auto_close_stale_sessions",
        new=AsyncMock(return_value=3),
    ):
        out = await run_admin_hours_auto_close(db)
    assert out == {"task": "admin_hours_auto_close", "closed": 3}
    db.commit.assert_awaited_once()


async def test_zero_when_nothing_stale():
    db = MagicMock()
    db.commit = AsyncMock()
    with patch(
        "app.services.admin_hours_service.AdminHoursService.auto_close_stale_sessions",
        new=AsyncMock(return_value=0),
    ):
        out = await run_admin_hours_auto_close(db)
    assert out["closed"] == 0
