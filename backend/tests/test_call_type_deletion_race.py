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

**Codex review of this fix's first draft found the lock itself was
incomplete in two further ways**, both covered by the classes below:

1. ``TestPopulateExistingRefreshesTheLock`` — ``for_update=True`` alone locks
   the row at the database level, but SQLAlchemy's identity map returns an
   already-loaded ``Organization`` object unrefreshed unless the query also
   carries ``execution_options(populate_existing=True)``
   (``get_shift_by_id`` already documents and handles this identical
   gotcha). ``finalize_shift`` loads ``Organization`` with a plain,
   non-locking read of its own before ever reaching the locking call, so
   this is not a hypothetical shape — it is the real caller SCH-13 exists
   to protect.
2. ``TestReportEditVsDeletionRace`` — the ``shift_completion_reports`` half
   of the usage check was deliberately left a plain read on the theory that
   a report is filed well after its shift's calls, "not in the same race
   window." That reasoning covered report *creation* and missed report
   *editing*: ``ShiftCompletionService.update_report`` /
   ``_edit_preserves_org_slugs`` can change an existing report to newly name
   a type at any time, independent of when its calls were recorded, and
   that edit never took the organization lock at all.
"""

import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app.core.database import database_manager
from app.models.call_tracking import CALL_TYPES_FROM_ORG_CALLS, CallTrackingMode
from app.models.training import Shift, ShiftCompletionReport
from app.models.user import Organization, User
from app.schemas.scheduling import CallTrackingSettings
from app.services.call_tracking_service import CallTrackingService
from app.services.shift_completion_service import ShiftCompletionService
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
            text("DELETE FROM shift_completion_reports WHERE organization_id = :o"),
            {"o": org_id},
        )
        await session.execute(
            text("DELETE FROM shifts WHERE organization_id = :o"), {"o": org_id}
        )
        await session.execute(
            text("DELETE FROM users WHERE organization_id = :o"), {"o": org_id}
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


@pytest.mark.usefixtures("_initialize_database")
class TestPopulateExistingRefreshesTheLock:
    async def test_a_pre_loaded_organization_object_is_refreshed_by_the_lock(self):
        """``finalize_shift``'s own shape: a plain, non-locking read of
        ``Organization`` earlier in the same transaction (its own
        equipment-check/call-tracking-mode lookup) puts the ORM object in the
        session's identity map before ``ShiftEligibilityService._get_org``
        ever takes the lock. Without ``populate_existing=True`` on that
        locking read, SQLAlchemy's default identity-map behavior hands back
        the *same* Python object, unrefreshed: the ``FOR UPDATE`` query still
        correctly blocks and reads the latest committed row at the database
        level, but anything that then reads ``org.settings`` off the object
        ``_get_org`` returned sees the pre-lock, stale value regardless —
        silently defeating SCH-13's entire fix for the one caller it exists
        to protect.
        """
        org_id, _shift_id = await _make_org_and_shift(
            f"populate-{uuid.uuid4().hex[:12]}"
        )

        session_a = database_manager.session_factory()
        try:
            # A's own plain read, matching finalize_shift's own early,
            # non-locking `select(Organization)` -- puts the object in A's
            # identity map with the *original* settings.
            stale = (
                await session_a.execute(
                    select(Organization).where(Organization.id == org_id)
                )
            ).scalar_one()
            assert any(
                t.get("slug") == "brush"
                for t in stale.settings["scheduling"]["call_tracking"]["call_types"]
            )

            # A second, independent session commits a real change while A's
            # transaction is still open.
            async with database_manager.session_factory() as session_b:
                org_b = await session_b.get(Organization, org_id)
                org_b.settings = {
                    "scheduling": {
                        "call_tracking": {
                            "mode": CallTrackingMode.COUNT_ONLY,
                            "call_types": [],
                        }
                    }
                }
                await session_b.commit()

            # A's own locking read of the same row, later in the same
            # transaction -- the exact call
            # _reject_deleting_a_used_call_type / _valid_type_slugs /
            # _edit_preserves_org_slugs all make.
            refreshed = await ShiftEligibilityService(session_a)._get_org(
                org_id, for_update=True
            )

            # Confirms this test actually exercises the identity-map path
            # (not merely a second, unrelated load).
            assert refreshed is stale
            # And that populate_existing actually refreshed it: B's
            # committed change must be visible, not A's own earlier
            # plain-read snapshot.
            assert (
                refreshed.settings["scheduling"]["call_tracking"]["call_types"] == []
            ), (
                "populate_existing did not refresh the identity-mapped "
                "object -- the lock is real at the database level but the "
                "Python object callers read from is still stale"
            )
        finally:
            await session_a.rollback()
            await session_a.close()
            await _cleanup_org(org_id)


async def _make_org_calls_report(org_id, shift_id, call_types):
    async with database_manager.session_factory() as session:
        officer = User(
            organization_id=org_id,
            username=f"o-{uuid.uuid4().hex[:8]}",
            email=f"o-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Off",
            last_name="Icer",
            password_hash="pw",
        )
        session.add(officer)
        await session.flush()
        report = ShiftCompletionReport(
            organization_id=org_id,
            shift_id=shift_id,
            trainee_id=officer.id,
            officer_id=officer.id,
            shift_date=date(2026, 8, 18),
            hours_on_shift=12.0,
            calls_responded=len(call_types),
            call_types=call_types,
            data_sources={"call_types": CALL_TYPES_FROM_ORG_CALLS},
        )
        session.add(report)
        await session.commit()
        return report.id, officer.id


@pytest.mark.usefixtures("_initialize_database")
class TestReportEditVsDeletionRace:
    async def test_editing_a_report_to_a_type_cannot_race_its_deletion(self):
        """The second path into the same orphan: instead of a close-out
        recording a fresh call, an officer edits an *existing* org_calls-
        sourced report (which currently names an unrelated type, "ems") to
        newly reference "brush", while an admin deletes "brush" from
        settings. Winner-agnostic, same invariant as the class above: it
        must never end with settings missing "brush" *and* a committed
        report whose ``call_types`` names "brush" under the ``org_calls``
        marker.
        """
        from app.api.v1.endpoints.scheduling import (
            _reject_deleting_a_used_call_type,
        )

        org_id, shift_id = await _make_org_and_shift(
            f"reportrace-{uuid.uuid4().hex[:12]}"
        )
        report_id, officer_id = await _make_org_calls_report(org_id, shift_id, ["ems"])

        session_a = database_manager.session_factory()
        session_b = database_manager.session_factory()
        try:
            pin = text("SELECT id FROM organizations WHERE id = :o")
            await session_a.execute(pin, {"o": org_id})
            await session_b.execute(pin, {"o": org_id})

            async def edit_the_report():
                # No broad try/except here on purpose (Codex review): this
                # edit has no legitimate domain-level rejection path in this
                # scenario (no review-status change, ownership already
                # matches), so any exception here — a database deadlock
                # included — is a bug, not an expected outcome. Swallowing
                # it into a string would make the assertion below pass on
                # the exact failure this test exists to catch: an
                # implementation where the edit and the deletion deadlock
                # each other, aborting the edit, still "orphan-free" by the
                # letter of the final check because the edit never
                # committed. `asyncio.gather(..., return_exceptions=True)`
                # captures it as a real exception object instead, and the
                # loop below fails loudly on it.
                await ShiftCompletionService(session_a).update_report(
                    report_id, org_id, officer_id, {"call_types": ["brush"]}
                )
                return None

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

            edit_error, delete_error = await asyncio.gather(
                edit_the_report(), delete_the_type(), return_exceptions=True
            )

            for label, outcome in (("edit", edit_error), ("delete", delete_error)):
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
                report = await check.get(ShiftCompletionReport, report_id)
                report_claims_brush_as_org_slug = (report.data_sources or {}).get(
                    "call_types"
                ) == CALL_TYPES_FROM_ORG_CALLS and "brush" in (report.call_types or [])

            assert not (report_claims_brush_as_org_slug and not settings_has_brush), (
                "orphan reproduced: a report claims 'brush' as an org slug "
                "but the org's settings no longer configure it "
                f"(edit error={edit_error!r}, delete error={delete_error!r})"
            )
        finally:
            await session_a.rollback()
            await session_b.rollback()
            await session_a.close()
            await session_b.close()
            await _cleanup_org(org_id)
