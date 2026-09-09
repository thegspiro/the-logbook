"""Codex review of PR #2435 (SCH-15, pass 4): an administrator deleting a
department's call type can race a concurrent close-out that names that same
type, orphaning history that refers to a slug no longer in the org's
configured list.

``_reject_deleting_a_used_call_type`` (``api/v1/endpoints/scheduling.py``)
decides whether a slug can be dropped from settings by checking current
``OrgCall``/``ShiftCompletionReport`` usage. ``CallTrackingService.
record_shift_calls`` decides whether a submitted breakdown names a valid slug
by reading current settings. Both were plain (non-locking) reads: under
InnoDB's default REPEATABLE READ, a plain ``SELECT`` answers from the
snapshot taken at the transaction's first read, not from whatever is current
when the statement runs (CLAUDE.md Pitfall #27). Two requests overlapping —
one deleting "brush", one recording a call under "brush" — could each pass
its own check against a stale read of the other's in-flight change, and both
commit: the department is left with a call on record for a type its own
settings no longer list.

The fix makes both checks serialize on the organization row
(``ShiftEligibilityService._get_org(..., for_update=True)``) and makes the
usage-count check itself a locking read (``CallTrackingService.
type_usage_counts(..., for_update=True)``) rather than merely locking a
resource and then reading it plainly — the same "the row is locked and the
count is stale anyway" trap FORM-10 (``test_forms_service.py``) closed for
duplicate form submissions, and the FAC-45/MSG-13/AP-13 precedent this
codebase already applies to other read-then-write races.

This test uses two REAL, independently-committing sessions (not the
savepoint-based ``db_session`` fixture, which never truly commits and so
can never demonstrate cross-transaction visibility) and pins both
transactions' REPEATABLE READ snapshots before either request's real work
begins — otherwise ``asyncio.gather`` gives no guarantee that both reach
their first read before either commits, and a lucky scheduling order would
pass the assertion without ever exercising the staleness this test exists to
catch.
"""

import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.core.database import database_manager
from app.models.call_tracking import CallTrackingMode
from app.models.training import Shift
from app.models.user import Organization
from app.schemas.scheduling import CallTrackingSettings
from app.services.call_tracking_service import CallTrackingService
from app.services.shift_eligibility_service import ShiftEligibilityService

pytestmark = pytest.mark.integration


async def _make_org_and_shift(slug):
    async with database_manager.session_factory() as session:
        org = Organization(
            name="Call Type Race Test VFD",
            slug=slug,
            organization_type="fire_department",
            settings={
                "scheduling": {
                    "call_tracking": {
                        "mode": CallTrackingMode.COUNT_ONLY,
                        "call_types": [{"slug": "brush", "label": "Brush Fire"}],
                    }
                }
            },
        )
        session.add(org)
        await session.flush()
        start = datetime(2026, 8, 18, 8, 0, tzinfo=timezone.utc)
        shift = Shift(
            organization_id=org.id,
            shift_date=date(2026, 8, 18),
            start_time=start,
            end_time=start + timedelta(hours=12),
        )
        session.add(shift)
        await session.commit()
        return org.id, shift.id


async def _cleanup_org(org_id: str) -> None:
    async with database_manager.session_factory() as session:
        await session.execute(
            text("DELETE FROM org_call_responses WHERE organization_id = :o"),
            {"o": org_id},
        )
        await session.execute(
            text("DELETE FROM org_calls WHERE organization_id = :o"), {"o": org_id}
        )
        await session.execute(
            text("DELETE FROM shifts WHERE organization_id = :o"), {"o": org_id}
        )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :o"), {"o": org_id}
        )
        await session.commit()


@pytest.mark.usefixtures("_initialize_database")
class TestCallTypeDeletionRace:
    async def test_deleting_a_type_cannot_race_a_close_out_into_orphaning_it(self):
        """Winner-agnostic: whichever request the database happens to
        serialize first, the other must lose cleanly. What must never happen
        is both committing — a settings save with "brush" gone *and* an
        ``OrgCall`` row recorded under "brush" existing at the same time.
        """
        from app.api.v1.endpoints.scheduling import (
            _reject_deleting_a_used_call_type,
        )

        org_id, shift_id = await _make_org_and_shift(f"ctrace-{uuid.uuid4().hex[:12]}")

        session_a = database_manager.session_factory()
        session_b = database_manager.session_factory()
        try:
            # Pin both transactions' REPEATABLE READ snapshot before either
            # coroutine's real work starts — see the module docstring for why
            # a throwaway read that actually touches InnoDB is required here.
            pin = text("SELECT id FROM organizations WHERE id = :o")
            await session_a.execute(pin, {"o": org_id})
            await session_b.execute(pin, {"o": org_id})

            async def record_the_call():
                shift = await session_a.get(Shift, shift_id)
                _, error = await CallTrackingService(session_a).record_shift_calls(
                    shift=shift,
                    organization_id=org_id,
                    total_calls=1,
                    type_counts={"brush": 1},
                )
                await session_a.commit()
                return error

            async def delete_the_type():
                incoming = CallTrackingSettings(
                    mode=CallTrackingMode.COUNT_ONLY, call_types=[]
                )
                try:
                    await _reject_deleting_a_used_call_type(session_b, org_id, incoming)
                except ValueError as e:
                    await session_b.rollback()
                    return str(e)
                await ShiftEligibilityService(session_b).update_scheduling_settings(
                    organization_id=org_id,
                    call_tracking={
                        "mode": CallTrackingMode.COUNT_ONLY,
                        "call_types": [],
                    },
                )
                return None

            call_error, delete_error = await asyncio.gather(
                record_the_call(), delete_the_type(), return_exceptions=True
            )

            for label, outcome in (("record", call_error), ("delete", delete_error)):
                assert not isinstance(
                    outcome, BaseException
                ), f"{label} raised {outcome!r} instead of completing"

            async with database_manager.session_factory() as check:
                org = await check.get(Organization, org_id)
                settings_has_brush = any(
                    t.get("slug") == "brush"
                    for t in (org.settings or {})
                    .get("scheduling", {})
                    .get("call_tracking", {})
                    .get("call_types", [])
                )
                brush_call_exists = (
                    await check.execute(
                        text(
                            "SELECT 1 FROM org_calls WHERE organization_id = :o "
                            "AND call_type = 'brush' LIMIT 1"
                        ),
                        {"o": org_id},
                    )
                ).first() is not None

            assert not (brush_call_exists and not settings_has_brush), (
                "orphan reproduced: a call is recorded under 'brush' but the "
                "org's settings no longer configure it "
                f"(record error={call_error!r}, delete error={delete_error!r})"
            )
        finally:
            await session_a.rollback()
            await session_b.rollback()
            await session_a.close()
            await session_b.close()
            await _cleanup_org(org_id)
