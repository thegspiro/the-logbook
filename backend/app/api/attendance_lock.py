"""
Attendance-lock refusals, as the client should receive them.

Finalizing an event closes its attendance, and the services refuse every write
that would change what it credited with ``attendance_locked_error``: a sentence
behind the internal ``ATTENDANCE_LOCKED::`` prefix. The prefix is how the
endpoint layer recognises a refusal as a conflict with the event's state — a
409, not a bad request — and it must be stripped before anything is sent.

Routes that mapped the refusal by hand drifted: some forgot the prefix and
sent it raw, and some sanitized the message first, where a refusal naming many
fields ran past ``safe_error_detail``'s length cap and was replaced by a
generic error. This is the one mapping every route uses.
"""

from typing import Optional, Union

from fastapi import HTTPException, status

from app.services.event_service import attendance_lock_reason


def attendance_lock_http_error(
    error: Union[str, BaseException],
) -> Optional[HTTPException]:
    """A 409 carrying the refusal's sentence, or None if it is not one.

    Call it on the raw service error, *before* ``safe_error_detail``: the
    sentence holds nothing the sanitizer screens for, but a refusal that lists
    many fields is longer than its cap. None leaves the route's own mapping in
    charge of every other error, so a call site reads::

        except ValueError as e:
            raise attendance_lock_http_error(e) or HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=safe_error_detail(e),
            )
    """
    reason = attendance_lock_reason(error)
    if reason is None:
        return None
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=reason)
