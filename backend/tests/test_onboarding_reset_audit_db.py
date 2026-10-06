"""The onboarding reset's audit record survives the reset's rollback (ONB-8).

``_audit_reset_durably`` writes in a session of its own and commits, so the
row is visible to another connection at once and nothing the request's own
transaction does afterwards can take it back.
"""

import uuid

import pytest
from sqlalchemy import select, text

from app.api.v1.onboarding import _audit_reset_durably
from app.core.database import async_session_factory
from app.models.audit import AuditLog

pytestmark = pytest.mark.integration


@pytest.mark.usefixtures("_initialize_database")
async def test_the_record_is_committed_by_its_own_transaction():
    marker = f"reset-test-{uuid.uuid4().hex}"

    await _audit_reset_durably("onboarding.reset_initiated", "198.51.100.7", marker)

    async with async_session_factory() as other:
        rows = (
            await other.execute(
                select(AuditLog.event_type).where(
                    AuditLog.event_type == "onboarding.reset_initiated",
                    AuditLog.ip_address == "198.51.100.7",
                )
            )
        ).all()
        assert rows
        # Leave the chain as found for the integrity checks other tests run.
        await other.execute(
            text("DELETE FROM audit_logs WHERE ip_address = '198.51.100.7'")
        )
        await other.commit()
