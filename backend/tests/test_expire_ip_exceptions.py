"""run_expire_ip_exceptions wires the IP-exception expiry into the scheduler.

IPSecurityService.expire_old_exceptions marks approved IP exceptions past their
valid_until as EXPIRED and is documented to run on a daily cron, but it had no
caller — so expired allowlist/blocklist entries kept their APPROVED status. This
test confirms the scheduled runner invokes it and reports the count, DB mocked.
"""

from unittest.mock import AsyncMock, patch

from app.services.scheduled_tasks import run_expire_ip_exceptions


async def test_invokes_expire_and_returns_count():
    db = object()
    with patch(
        "app.services.ip_security_service.ip_security_service.expire_old_exceptions",
        new=AsyncMock(return_value=4),
    ) as mock_expire:
        out = await run_expire_ip_exceptions(db)
    assert out == {"task": "expire_ip_exceptions", "expired": 4}
    mock_expire.assert_awaited_once_with(db)
