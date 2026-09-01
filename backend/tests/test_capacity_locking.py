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
import io
import re
import textwrap
import tokenize

from app.services import (
    event_request_service,
    event_service,
    finance_service,
    scheduling_service,
)


def _strip_comments(source: str) -> str:
    """Blank out comment text, preserving every line and column.

    The scan below is a regex over source, so a comment that merely *mentions*
    ``func.count`` or ``func.sum`` would otherwise register as a capacity query
    and throw the expected-count assertions off. That is not hypothetical: the
    comment explaining why the RSVP capacity check sums seats instead of
    counting rows names both aggregates, and tripped this file the moment it
    was written.

    Columns are preserved (comments become spaces rather than being deleted) so
    the parenthesis-balancing in _count_query_expressions still sees the same
    statement boundaries.
    """
    lines = source.splitlines(keepends=True)
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (tokenize.TokenError, IndentationError):
        # A partial source that will not tokenize is scanned as-is rather than
        # silently returning nothing to check.
        return source

    for token in tokens:
        if token.type != tokenize.COMMENT:
            continue
        row, col = token.start
        line = lines[row - 1]
        lines[row - 1] = (
            line[:col] + " " * len(token.string) + line[col + len(token.string) :]
        )
    return "".join(lines)


def _source_of(obj) -> str:
    # Dedented so a method body tokenizes; comments blanked so prose about a
    # capacity check is never mistaken for one.
    return _strip_comments(textwrap.dedent(inspect.getsource(obj)))


def _count_query_expressions(source: str):
    """Yield (assigned_name, expression_text) for every capacity-tally query.

    Matches ``func.sum`` as well as ``func.count``. Both are how a cap gets
    measured here, and which one a given site uses is an implementation detail
    of what it counts: the event RSVP path moved from counting *rows* to
    summing *seats* when guests began consuming capacity, and a count-only
    detector would have quietly stopped covering it — the site would vanish
    from the scan rather than fail, and the invariant would retire itself
    without anyone deciding to retire it.

    The expression is extracted by balancing parentheses from the start of the
    statement, so a multi-line query builder is captured whole rather than by
    the line the aggregate happens to sit on.
    """
    for match in re.finditer(r"func\.(?:count|sum)\b", source):
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

    def test_a_seat_sum_is_detected(self):
        """A capacity tally written as a sum is still a capacity tally.

        The RSVP path counts seats (1 + guest_count) rather than rows, so a
        detector that only knew func.count would have silently stopped
        watching it.
        """
        source = (
            "q = (\n"
            "    select(func.coalesce(func.sum(1 + EventRSVP.guest_count), 0))\n"
            "    .where(x)\n"
            "    .with_for_update()\n"
            ")\n"
        )
        found = list(_count_query_expressions(source))
        assert len(found) == 1
        name, expression = found[0]
        assert _count_is_locking(source, name, expression)

    def test_a_plain_seat_sum_is_rejected(self):
        source = "q = select(func.coalesce(func.sum(1 + x.guests), 0)).where(y)\n"
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
            expected=3,
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


class TestFinanceApprovalStepLocking:
    """approve_step/deny_step read-then-write the same status field
    approve_by_token/deny_by_token already lock. Two authorized approvers
    acting on the same pending step both pass the not-pending check off a
    plain SELECT unless that read is locking too — the same shape as a
    seat-capacity race, just with a status transition instead of a count."""

    def test_approve_step_locks_the_record(self):
        source = _source_of(finance_service.FinanceService.approve_step)
        assert "with_for_update()" in source, (
            "Two approvers acting on the same step concurrently both see "
            "PENDING off a plain SELECT and both finalize -- double-"
            "encumbering the budget -- unless this read locks the row, "
            "matching approve_by_token."
        )

    def test_deny_step_locks_the_record(self):
        source = _source_of(finance_service.FinanceService.deny_step)
        assert "with_for_update()" in source, (
            "Same race as approve_step, on the deny path -- matching " "deny_by_token."
        )


class TestFinanceBudgetCeilingOnUpdate:
    """PUT /budgets/{id} sets amount_budgeted directly and is a second way
    to move the same value _mutate_budget's hard ceiling protects. A plain
    read-then-write here is the same shape as the capacity races above:
    the row has to be locked, and the reduction has to be checked against
    the locked row's current amount_spent + amount_encumbered."""

    def test_update_budget_locks_the_row(self):
        source = _source_of(finance_service.FinanceService.update_budget)
        assert "with_for_update()" in source, (
            "update_budget must lock the budget row before checking a "
            "reduced amount_budgeted against amount_spent + "
            "amount_encumbered, or a concurrent spend can race past the "
            "check the same way an unlocked capacity count does."
        )
        assert "BudgetLimitExceededError" in source, (
            "A reduction below what is already committed must raise the "
            "same ceiling error _mutate_budget raises, not silently persist."
        )
