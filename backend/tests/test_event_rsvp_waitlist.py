"""
Tests for event RSVP + waitlist logic (app/services/event_service.py).

Covers create_or_update_rsvp guards (event missing/cancelled, RSVP not
required, deadline passed, disallowed status), capacity-driven
auto-waitlisting, and promote_from_waitlist (no event, no capacity cap,
at-capacity no-op, no waitlisted member, and earliest-waitlisted promotion).
DB mocked; no MySQL.
"""

from datetime import datetime, timedelta
from datetime import timezone as tz
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.models.event import RSVPStatus
from app.schemas.event import RSVPCreate
from app.services.event_service import EventService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalar(value):
    return MagicMock(scalar=MagicMock(return_value=value))


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _event(**kw):
    return SimpleNamespace(
        id="e1",
        title=kw.get("title", "Test Event"),
        organization_id="org-1",
        is_cancelled=kw.get("is_cancelled", False),
        # EV-6: default a published, not-yet-ended event so the draft/past guards
        # pass; tests that exercise those pass explicit values.
        is_draft=kw.get("is_draft", False),
        end_datetime=kw.get("end_datetime", datetime.now(tz.utc) + timedelta(days=1)),
        requires_rsvp=kw.get("requires_rsvp", True),
        rsvp_deadline=kw.get("rsvp_deadline"),
        allowed_rsvp_statuses=kw.get("allowed_rsvp_statuses", ["going", "not_going"]),
        max_attendees=kw.get("max_attendees"),
        allow_guests=kw.get("allow_guests", True),
    )


def _waitlisted(guest_count=0, **kw):
    return SimpleNamespace(
        id=kw.get("id", "r1"),
        user_id=kw.get("user_id", "u9"),
        status=RSVPStatus.WAITLISTED,
        updated_at=None,
        guest_count=guest_count,
    )


class TestRsvpGuards:
    @staticmethod
    def _svc(db):
        """EventService with the training phase gate stubbed.

        Same reason as TestRsvpCapacity._svc: the gate has its own suite and
        its extra queries would desync the positional execute() mocks. Only
        needed by the tests that reach past the guards to a successful write.
        """
        svc = EventService(db)
        svc._evaluate_session_phase_warning = AsyncMock(return_value=None)
        return svc

    async def _run(self, db, status="going"):
        return await EventService(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status=status), "org-1"
        )

    async def test_event_not_found(self):
        rsvp, err = await self._run(_db([_one(None)]))
        assert rsvp is None
        assert err == "Event not found"

    async def test_cancelled_event(self):
        rsvp, err = await self._run(_db([_one(_event(is_cancelled=True))]))
        assert err == "Cannot RSVP to cancelled event"

    async def test_rsvp_permitted_on_an_event_that_does_not_require_one(self):
        """requires_rsvp means "a response is expected", not "responses are allowed".

        It drives the Required badge, the deadline and the non-respondent
        reminder audience. Blocking voluntary responses as well left a member
        with nothing to do on most events, which is what this change is for.
        """
        db = _db([_one(_event(requires_rsvp=False)), _one(None)])
        rsvp, err = await self._svc(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going"), "org-1"
        )
        assert err is None
        assert rsvp is not None
        assert rsvp.status == "going"

    async def test_guests_rejected_when_the_event_disallows_them(self):
        """allow_guests existed on the model for years and was read nowhere."""
        # event, no existing RSVP — fetched ahead of this guard now so
        # effective_guest_count can be resolved for it (EV-25).
        db = _db([_one(_event(allow_guests=False)), _one(None)])
        rsvp, err = await EventService(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going", guest_count=2), "org-1"
        )
        assert rsvp is None
        assert err == "This event does not allow guests"

    async def test_a_legacy_guest_party_can_still_decline(self):
        """The guard is scoped to a going response, and for a reason.

        Existing installations hold rows with guests on allow_guests=false
        events, because the old code never enforced the flag. The modal
        prefills that historical count, so an unconditional guard rejected the
        member's decline outright and left them holding seats they had tried to
        give back.
        """
        db = _db([_one(_event(allow_guests=False)), _one(None)])
        rsvp, err = await self._svc(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="not_going", guest_count=2), "org-1"
        )
        assert err is None
        assert rsvp is not None
        # And the stale party is zeroed, so it stops occupying seats.
        assert rsvp.guest_count == 0

    async def test_zero_guests_is_fine_when_the_event_disallows_them(self):
        """The guard keys off the incoming count, so the common path is untouched."""
        db = _db([_one(_event(allow_guests=False)), _one(None)])
        rsvp, err = await self._svc(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going", guest_count=0), "org-1"
        )
        assert err is None
        assert rsvp is not None

    async def test_deadline_passed(self):
        past = datetime.now(tz.utc) - timedelta(hours=1)
        rsvp, err = await self._run(_db([_one(_event(rsvp_deadline=past))]))
        assert err == "RSVP deadline has passed"

    async def test_disallowed_status(self):
        ev = _event(allowed_rsvp_statuses=["going"])
        # event, no existing RSVP — fetched ahead of this guard now (EV-25).
        rsvp, err = await self._run(_db([_one(ev), _one(None)]), status="not_going")
        assert "is not allowed" in err

    async def test_draft_event_rejected(self):
        # EV-6: a member who knows a draft's id cannot RSVP before publication.
        rsvp, err = await self._run(_db([_one(_event(is_draft=True))]))
        assert rsvp is None
        assert err == "Cannot RSVP to an unpublished event"

    async def test_ended_event_rejected(self):
        # EV-6: no rsvp_deadline set, but the event already ended.
        ended = datetime.now(tz.utc) - timedelta(hours=1)
        rsvp, err = await self._run(_db([_one(_event(end_datetime=ended))]))
        assert rsvp is None
        assert err == "Cannot RSVP to an event that has already ended"


class TestRsvpCapacity:
    @staticmethod
    def _svc(db):
        """EventService with the training phase gate stubbed — the gate has
        its own suite (test_event_phase_gate.py) and its extra queries would
        desync the positional execute() mocks here."""
        svc = EventService(db)
        svc._evaluate_session_phase_warning = AsyncMock(return_value=None)
        return svc

    async def test_new_going_under_capacity_stays_going(self):
        ev = _event(max_attendees=5)
        db = _db([_one(ev), _one(None), _scalar(2)])  # event, no existing, 2 going
        rsvp, err = await self._svc(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going"), "org-1"
        )
        assert err is None
        assert rsvp.status == "going"
        db.commit.assert_awaited()

    async def test_new_going_at_capacity_is_waitlisted(self):
        ev = _event(max_attendees=2)
        db = _db([_one(ev), _one(None), _scalar(2)])  # 2 seats taken == cap
        rsvp, err = await self._svc(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going"), "org-1"
        )
        assert err is None
        assert rsvp.status == RSVPStatus.WAITLISTED

    # The capacity tally is a sum of seats (1 + guest_count per going row),
    # not a row count. Before this, guests were accepted and then excluded
    # from the check, so a capped event could be oversubscribed by however
    # many guests attendees brought.

    async def test_a_guest_consumes_a_seat(self):
        """4 seats taken of 5, and a member bringing one guest needs two."""
        ev = _event(max_attendees=5)
        db = _db([_one(ev), _one(None), _scalar(4)])
        rsvp, err = await self._svc(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going", guest_count=1), "org-1"
        )
        assert err is None
        assert rsvp.status == RSVPStatus.WAITLISTED

    async def test_a_party_that_exactly_fills_the_roster_stays_going(self):
        """Boundary: 2 seats taken, a party of 3, a cap of 5. Fits exactly.

        The comparison is `occupied + requested > cap`, not `>=` against the
        tally — an off-by-one here would waitlist the member who exactly fills
        the event.
        """
        ev = _event(max_attendees=5)
        db = _db([_one(ev), _one(None), _scalar(2)])
        rsvp, err = await self._svc(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going", guest_count=2), "org-1"
        )
        assert err is None
        assert rsvp.status == "going"

    async def test_one_seat_over_is_waitlisted(self):
        ev = _event(max_attendees=5)
        db = _db([_one(ev), _one(None), _scalar(2)])
        rsvp, err = await self._svc(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going", guest_count=3), "org-1"
        )
        assert err is None
        assert rsvp.status == RSVPStatus.WAITLISTED

    async def test_a_party_bigger_than_the_event_is_rejected_not_queued(self):
        """There is no queue position for a party that cannot fit an empty event.

        And because promote_from_waitlist refuses to skip the head of the
        queue, admitting one would block every member behind it indefinitely.
        """
        ev = _event(max_attendees=3)
        db = _db([_one(ev), _one(None), _scalar(0)])
        rsvp, err = await self._svc(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going", guest_count=5), "org-1"
        )
        assert rsvp is None
        assert "cannot be accommodated" in err

    async def test_a_party_exactly_the_size_of_the_event_is_allowed(self):
        """Boundary: 3 seats on a cap of 3 fits, and must not be rejected."""
        ev = _event(max_attendees=3)
        db = _db([_one(ev), _one(None), _scalar(0)])
        rsvp, err = await self._svc(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going", guest_count=2), "org-1"
        )
        assert err is None
        assert rsvp.status == "going"

    async def test_an_empty_roster_sums_to_zero_not_null(self):
        """SUM over zero rows is NULL in SQL.

        Without coalesce the first RSVP on a capped event would compare None
        against an int and blow up — or, worse, silently skip waitlisting
        forever after.
        """
        ev = _event(max_attendees=1)
        db = _db([_one(ev), _one(None), _scalar(0)])
        rsvp, err = await self._svc(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going"), "org-1"
        )
        assert err is None
        assert rsvp.status == "going"


class TestSeatReleaseTriggersPromotion:
    """Promotion fires whenever this write frees seats, not only on a decline.

    Three paths release capacity and only the first used to be covered:
    declining, lowering a guest count while staying going, and being waitlisted
    after asking for a larger party than fits. Missing the latter two stranded
    waitlisted members behind seats that were already empty.
    """

    @staticmethod
    def _svc(db):
        svc = EventService(db)
        svc._evaluate_session_phase_warning = AsyncMock(return_value=None)
        svc.promote_from_waitlist = AsyncMock(return_value=None)
        return svc

    def _existing(self, guest_count, status=RSVPStatus.GOING):
        return SimpleNamespace(
            id="r1",
            status=status,
            guest_count=guest_count,
            notes=None,
            dietary_restrictions=None,
            accessibility_needs=None,
            updated_at=None,
        )

    async def test_lowering_a_guest_count_promotes(self):
        """3 seats down to 1 frees two, without the status ever changing."""
        ev = _event(max_attendees=10)
        db = _db([_one(ev), _one(self._existing(2)), _scalar(4)])
        svc = self._svc(db)
        await svc.create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going", guest_count=0), "org-1"
        )
        svc.promote_from_waitlist.assert_awaited_once()

    async def test_raising_a_guest_count_does_not_promote(self):
        ev = _event(max_attendees=10)
        db = _db([_one(ev), _one(self._existing(0)), _scalar(1)])
        svc = self._svc(db)
        await svc.create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going", guest_count=2), "org-1"
        )
        svc.promote_from_waitlist.assert_not_awaited()

    async def test_a_multi_seat_release_keeps_promoting(self):
        """Freeing four seats can admit four members, not one.

        promote_from_waitlist returns None as soon as the head no longer fits,
        so the loop stops on its own; what is asserted here is that it does not
        stop after the first success and leave seats idle.
        """
        ev = _event(max_attendees=10)
        db = _db([_one(ev), _one(self._existing(3)), _scalar(4)])
        svc = self._svc(db)
        svc.promote_from_waitlist = AsyncMock(
            side_effect=[object(), object(), object(), None]
        )

        await svc.create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="not_going"), "org-1"
        )

        assert svc.promote_from_waitlist.await_count == 4

    async def test_the_promotion_loop_is_bounded(self):
        """A regression in the "no longer fits" condition must not spin."""
        from app.services.event_service import MAX_WAITLIST_PROMOTIONS_PER_RELEASE

        ev = _event(max_attendees=10)
        db = _db([_one(ev), _one(self._existing(3)), _scalar(4)])
        svc = self._svc(db)
        svc.promote_from_waitlist = AsyncMock(return_value=object())

        await svc.create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="not_going"), "org-1"
        )

        assert (
            svc.promote_from_waitlist.await_count == MAX_WAITLIST_PROMOTIONS_PER_RELEASE
        )

    async def test_declining_still_promotes(self):
        ev = _event(max_attendees=10)
        db = _db([_one(ev), _one(self._existing(1))])
        svc = self._svc(db)
        await svc.create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="not_going"), "org-1"
        )
        svc.promote_from_waitlist.assert_awaited_once()

    async def test_being_waitlisted_for_a_larger_party_promotes(self):
        """The seats they held are released even though they asked for more.

        A member going alone in a full event who then asks to bring two guests
        is waitlisted — and the one seat they had is now free, which is exactly
        the case that used to strand the queue.
        """
        ev = _event(max_attendees=5)
        db = _db([_one(ev), _one(self._existing(0)), _scalar(4)])
        svc = self._svc(db)
        rsvp, err = await svc.create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going", guest_count=2), "org-1"
        )
        assert err is None
        assert rsvp.status == RSVPStatus.WAITLISTED
        svc.promote_from_waitlist.assert_awaited_once()


class TestRsvpToSeries:
    """The series path delegates; it no longer writes RSVPs itself.

    It used to hand-roll the insert, which meant no capacity tally, no event
    row lock, and no allow_guests, deadline or draft guard — a member applying
    to a series was saved as "going" on a full occurrence and a guest party
    overbooked it. Delegating to create_or_update_rsvp restores all of those,
    so what is worth asserting here is the delegation itself: every occurrence
    is offered, failures are skipped rather than aborting the batch, and the
    returned count reflects what actually landed.
    """

    @staticmethod
    def _svc(events, results):
        """Service whose series query yields `events` and whose per-occurrence
        write returns `results` in order."""
        db = MagicMock()
        scalars = MagicMock(all=MagicMock(return_value=events))
        db.execute = AsyncMock(
            return_value=MagicMock(scalars=MagicMock(return_value=scalars))
        )
        db.commit = AsyncMock()
        db.rollback = AsyncMock()
        svc = EventService(db)
        svc.create_or_update_rsvp = AsyncMock(side_effect=results)
        return svc

    def _events(self, count):
        events = []
        for index in range(count):
            ev = _event(requires_rsvp=False)
            ev.id = f"e{index}"
            events.append(ev)
        return events

    async def test_every_occurrence_goes_through_the_single_write_path(self):
        events = self._events(3)
        svc = self._svc(events, [(SimpleNamespace(), None)] * 3)

        count = await svc.rsvp_to_series(
            "parent-1", "u1", "org-1", RSVPCreate(status="going")
        )

        assert count == 3
        assert svc.create_or_update_rsvp.await_count == 3

    async def test_the_phase_gate_is_overridden_for_the_series(self):
        """The member confirmed the warning once; there is no way to re-prompt
        them per occurrence."""
        events = self._events(1)
        svc = self._svc(events, [(SimpleNamespace(), None)])

        await svc.rsvp_to_series("parent-1", "u1", "org-1", RSVPCreate(status="going"))

        assert svc.create_or_update_rsvp.await_args.kwargs["override"] is True

    async def test_a_refused_occurrence_is_skipped_not_fatal(self):
        """Full, finalized, guests-not-allowed — the member is answering for the
        rest of the series, not asking to force one date."""
        events = self._events(3)
        svc = self._svc(
            events,
            [
                (SimpleNamespace(), None),
                (None, "Attendance for this event is closed"),
                (SimpleNamespace(), None),
            ],
        )

        count = await svc.rsvp_to_series(
            "parent-1", "u1", "org-1", RSVPCreate(status="going")
        )

        # All three were offered; the count reports only what landed, so the
        # "applied to N events" toast is true rather than optimistic.
        assert svc.create_or_update_rsvp.await_count == 3
        assert count == 2
        # And the refusal's uncommitted state is discarded rather than left for
        # the next occurrence's commit to persist.
        svc.db.rollback.assert_awaited_once()

    async def test_it_no_longer_writes_rsvps_itself(self):
        """The whole point of the change: one write path, not two."""
        events = self._events(2)
        svc = self._svc(events, [(SimpleNamespace(), None)] * 2)

        await svc.rsvp_to_series("parent-1", "u1", "org-1", RSVPCreate(status="going"))

        svc.db.add.assert_not_called()


class TestPromoteFromWaitlist:
    async def test_no_event(self):
        out = await EventService(_db([_one(None)])).promote_from_waitlist("e1", "org-1")
        assert out is None

    async def test_no_capacity_cap(self):
        out = await EventService(
            _db([_one(_event(max_attendees=None))])
        ).promote_from_waitlist("e1", "org-1")
        assert out is None

    # Query order below is [event, earliest-waitlisted row, occupied seats].
    # The waitlisted row is now fetched *before* the capacity read, because
    # capacity is measured in seats and how much room is needed depends on how
    # many guests that particular party brings.

    async def test_at_capacity_no_promotion(self):
        ev = _event(max_attendees=2)
        db = _db([_one(ev), _one(_waitlisted()), _scalar(2)])  # already full
        assert await EventService(db).promote_from_waitlist("e1", "org-1") is None

    async def test_capacity_but_no_waitlisted(self):
        ev = _event(max_attendees=5)
        db = _db([_one(ev), _one(None)])  # room, but nobody waiting
        assert await EventService(db).promote_from_waitlist("e1", "org-1") is None

    async def test_promotes_earliest_waitlisted(self):
        ev = _event(max_attendees=5)
        waitlisted = _waitlisted()
        db = _db([_one(ev), _one(waitlisted), _scalar(3)])
        out = await EventService(db).promote_from_waitlist("e1", "org-1")
        assert out is waitlisted
        assert waitlisted.status == RSVPStatus.GOING
        assert waitlisted.updated_at is not None
        db.commit.assert_awaited()

    async def test_party_too_large_for_the_gap_is_not_promoted(self):
        """A member with two guests needs three seats, not one."""
        ev = _event(max_attendees=5)
        db = _db([_one(ev), _one(_waitlisted(guest_count=2)), _scalar(4)])
        assert await EventService(db).promote_from_waitlist("e1", "org-1") is None

    async def test_party_that_exactly_fills_the_gap_is_promoted(self):
        ev = _event(max_attendees=5)
        waitlisted = _waitlisted(guest_count=2)
        db = _db([_one(ev), _one(waitlisted), _scalar(2)])
        out = await EventService(db).promote_from_waitlist("e1", "org-1")
        assert out is waitlisted
        assert waitlisted.status == RSVPStatus.GOING

    async def test_a_party_that_does_not_fit_is_not_skipped_over(self):
        """First in line stays first in line.

        Skipping past a party that does not fit to promote a smaller one behind
        them would silently reorder the queue and contradict the waitlist
        position the member was shown on the event page.
        """
        ev = _event(max_attendees=5)
        db = _db([_one(ev), _one(_waitlisted(guest_count=3)), _scalar(3)])
        assert await EventService(db).promote_from_waitlist("e1", "org-1") is None
        # Exactly three queries: the event, the head of the queue, the tally.
        # A fourth would mean it went looking for somebody smaller.
        assert db.execute.await_count == 3

    def test_the_queue_query_excludes_parties_that_can_never_fit(self):
        """Structural, because the escape hatch lives in SQL.

        Without this filter the earliest waitlisted row is selected even when
        it needs more seats than the event holds — and since promotion refuses
        to skip the head of the queue, that one row blocks everybody behind it
        forever. Checking after the fetch does not help: returning None there
        is the deadlock. It has to be excluded from the selection.
        """
        import inspect

        source = inspect.getsource(EventService.promote_from_waitlist)
        assert "1 + EventRSVP.guest_count <= event.max_attendees" in source

    async def test_promotion_notifies_member(self):
        from app.models.notification import NotificationLog

        ev = _event(max_attendees=5)
        waitlisted = _waitlisted()
        db = _db([_one(ev), _one(waitlisted), _scalar(3)])
        await EventService(db).promote_from_waitlist("e1", "org-1")

        # A waitlist-promotion NotificationLog is created for the promoted
        # member so the silent status flip is surfaced to them.
        added = [c.args[0] for c in db.add.call_args_list if c.args]
        notifs = [n for n in added if isinstance(n, NotificationLog)]
        assert len(notifs) == 1
        assert notifs[0].recipient_id == "u9"
        assert notifs[0].category == "event_waitlist_promotion"


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
