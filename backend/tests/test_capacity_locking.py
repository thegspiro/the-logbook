"""Capacity checks count with a locking read, not just under a lock.

A limit — seats on a shift, `max_attendees` on an event, a role on an outreach
signup sheet — is enforced by counting what is there and then inserting. Two
requests arriving together both read the count before either commits, both
decide there is room, and the cap is exceeded by however many people tapped at
once. One request never races itself, so it survives every test that is not
this one (CLAUDE.md pitfall #27).

Locking the parent row is necessary and *not sufficient*, which is the part
that is easy to get wrong and impossible to see in review. Under InnoDB's
default REPEATABLE READ a plain SELECT answers from the snapshot taken at the
transaction's first read. Acquiring a row lock does not refresh that snapshot,
so a transaction that already read anything — every one of these runs behind an
endpoint that loaded the shift or event first — can take the lock, count, and
still see the tally from before the request that beat it committed. Only a
locking read is guaranteed to see the latest committed version.

So these assert two separate things: that the contended parent row is locked
(which serializes the decision), and that each capacity count is itself a
locking read (which makes the number current).
"""

import inspect
import re

from app.services import event_request_service, event_service, scheduling_service


def _source_of(obj) -> str:
    return inspect.getsource(obj)


def _count_query_expressions(source: str):
    """Yield (assigned_name, expression_text) for every `func.count` query.

    The expression is extracted by balancing parentheses from the start of the
    statement, so a multi-line query builder is captured whole rather than by
    the line the count happens to sit on.
    """
    for match in re.finditer(r"func\.count\b", source):
        start = source.rfind("\n", 0, match.start()) + 1
        # Walk back over continuation lines to the statement that opens the
        # expression — the first line at or above this one whose parentheses
        # are not already unbalanced-open from an earlier line.
        while start > 0:
            prefix = source[:start]
            if prefix.count("(") == prefix.count(")"):
                break
            start = source.rfind("\n", 0, start - 1) + 1

        # Run to the end of the *statement*, not the first balanced paren: a
        # chained builder returns to depth 0 after `select(...)` and carries
        # the lock several calls later.
        depth = 0
        end = len(source)
        for index in range(start, len(source)):
            char = source[index]
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
            elif char == "\n" and depth == 0:
                end = index
                break

        expression = source[start:end]
        name_match = re.match(r"\s*(\w+)\s*=", expression)
        yield (name_match.group(1) if name_match else None, expression)


def _count_is_locking(source: str, name, expression: str) -> bool:
    """True when this count reaches the database as a locking read.

    Either the lock is chained onto the expression itself, or the query was
    assigned to a name and locked in a later statement (the shape used where
    optional filters are appended before execution).
    """
    if "with_for_update()" in expression:
        return True
    if name:
        return bool(
            re.search(
                rf"\b{re.escape(name)}\s*=\s*{re.escape(name)}\.with_for_update\(\)",
                source,
            )
        )
    return False


def _assert_every_count_locks(func, expected: int) -> None:
    source = _source_of(func)
    found = list(_count_query_expressions(source))
    assert len(found) == expected, (
        f"{func.__qualname__} has {len(found)} count queries, expected "
        f"{expected}. If a capacity check was added or removed, update this "
        f"count deliberately rather than loosening the assertion."
    )
    for name, expression in found:
        assert _count_is_locking(source, name, expression), (
            f"The capacity count in {func.__qualname__} is a plain read. "
            f"Under REPEATABLE READ it can return a stale tally even while "
            f"the parent row is locked, so the last seat goes to both "
            f"claimants. Add .with_for_update().\n\n{expression}"
        )


class TestTheExtractionItself:
    """The detector has to actually distinguish the two shapes."""

    def test_a_chained_lock_is_recognized(self):
        source = "q = select(func.count()).where(x).with_for_update()\n"
        name, expression = next(iter(_count_query_expressions(source)))
        assert _count_is_locking(source, name, expression)

    def test_a_plain_count_is_rejected(self):
        source = "q = select(func.count()).where(x)\n"
        name, expression = next(iter(_count_query_expressions(source)))
        assert not _count_is_locking(source, name, expression)

    def test_a_lock_applied_in_a_later_statement_is_recognized(self):
        source = "q = select(func.count()).where(x)\nq = q.with_for_update()\n"
        name, expression = next(iter(_count_query_expressions(source)))
        assert name == "q"
        assert _count_is_locking(source, name, expression)

    def test_another_querys_lock_does_not_count(self):
        """The load-bearing case: a lock elsewhere in the function must not
        exempt the count. This is how "locked, therefore consistent" got
        written down as true."""
        source = (
            "row = select(Event).where(x).with_for_update()\n"
            "q = select(func.count()).where(y)\n"
        )
        name, expression = next(iter(_count_query_expressions(source)))
        assert not _count_is_locking(source, name, expression)

    def test_a_multi_line_builder_is_captured_whole(self):
        source = (
            "q = (\n"
            "    select(func.count())\n"
            "    .where(x)\n"
            "    .with_for_update()\n"
            ")\n"
        )
        name, expression = next(iter(_count_query_expressions(source)))
        assert ".where(x)" in expression
        assert _count_is_locking(source, name, expression)


class TestShiftSeatCapacity:
    def test_get_shift_by_id_can_lock(self):
        signature = inspect.signature(
            scheduling_service.SchedulingService.get_shift_by_id
        )
        assert "for_update" in signature.parameters

    def test_every_assignment_path_locks_the_shift(self):
        """The named-seat cap applies to officer-made assignments too — a seat
        on a crew is one seat whoever fills it — so the lock cannot be
        conditional on self_signup."""
        source = _source_of(scheduling_service.SchedulingService.create_assignment)

        assert "for_update=True" in source, (
            "create_assignment must lock the shift row on every path. "
            "_validate_assignment_candidate enforces the named-seat cap "
            "regardless of enforce_capacity, so an officer assignment races "
            "a self-signup for the last Driver seat."
        )
        assert "for_update=self_signup" not in source

    def test_both_seat_counts_are_locking_reads(self):
        _assert_every_count_locks(
            scheduling_service.SchedulingService._validate_assignment_candidate,
            expected=2,
        )


class TestEventRsvpCapacity:
    def test_the_event_row_is_locked_before_counting(self):
        source = _source_of(event_service.EventService.create_or_update_rsvp)
        assert "with_for_update()" in source

    def test_the_rsvp_count_is_a_locking_read(self):
        _assert_every_count_locks(
            event_service.EventService.create_or_update_rsvp, expected=1
        )

    def test_waitlist_promotion_is_locked_too(self):
        """Promotion reads capacity and inserts a going RSVP — same shape."""
        source = _source_of(event_service.EventService.promote_from_waitlist)
        assert "with_for_update()" in source

    def test_the_promotion_count_is_a_locking_read(self):
        _assert_every_count_locks(
            event_service.EventService.promote_from_waitlist, expected=1
        )


class TestOutreachRoleSeats:
    def test_the_request_row_is_locked_before_counting_a_role(self):
        source = _source_of(event_request_service.resolve_outreach_signup_role)
        assert "with_for_update()" in source, (
            "Two members claiming the last Educator seat both read '0 taken' "
            "unless the request row serializes them."
        )

    def test_the_role_seat_count_is_a_locking_read(self):
        _assert_every_count_locks(
            event_request_service.resolve_outreach_signup_role, expected=1
        )
