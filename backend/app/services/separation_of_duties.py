"""
Separation of duties.

The control every one of these cases implements is the same: the person who
*creates* or *performs* a record must not also be the person who *approves*
it. One pair of eyes on a payment, a certification, or an hours claim is the
condition under which fraud and error survive review.

It is also what an ISO 27001 audit asks for by name — A.5.3 "Segregation of
duties" — and what a fire department's own bylaws normally require for
disbursements. The Logbook enforced neither: every approval endpoint checked
only that the caller held the approval permission, never that they were a
different person from the requester.

Four paths went through unchecked:

  FIN-4  a treasurer could raise a check request and approve it
  CS-8   an examiner could certify their own skills test
  AH-4   an officer could approve their own administrative hours
  TR-5   a member could self-report training that auto-approved

This module is deliberately tiny and shared, so the rule reads the same way
in all four places and a fifth path has an obvious thing to call.
"""

from __future__ import annotations


class SeparationOfDutiesError(ValueError):
    """
    Raised when one person would occupy both sides of a control.

    A ValueError so the endpoint layer's existing `except ValueError` → HTTP
    400 handling surfaces the message unchanged.
    """


def assert_different_person(
    actor_id: str | None,
    subject_id: str | None,
    *,
    action: str,
    record: str,
) -> None:
    """
    Refuse an action where the actor and the subject are the same person.

    Args:
        actor_id: whoever is about to approve, certify, or pay.
        subject_id: whoever created the record, or whom it is about.
        action: verb for the message, e.g. "approve".
        record: noun for the message, e.g. "check request".

    Raises:
        SeparationOfDutiesError: when the two ids match.

    No-ops when either id is missing. An unattributed record cannot be shown
    to be self-approval, and blocking on absence would wedge legacy rows that
    predate the field — the check is a control against a *known* conflict,
    not a completeness assertion.
    """
    if not actor_id or not subject_id:
        return
    if str(actor_id) != str(subject_id):
        return

    raise SeparationOfDutiesError(
        f"You cannot {action} your own {record}. Separation of duties requires "
        "a second person, so this must go to another authorized approver."
    )
