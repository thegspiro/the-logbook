"""Ownership-checked renewal for the in-process scheduler's Redis claim.

Only one worker may run the scheduled-task loops, and it says so by holding a
Redis key stamped with its PID (`startup_task:<name>`, taken with SETNX). The
claim expires, so the holder has to keep extending it — and *how* it extends it
is the whole problem this module exists to solve.

A plain ``SET key pid EX ttl`` renewal is not a renewal. It is an
unconditional write, so a worker whose claim has already lapsed and been taken
by somebody else **takes it back** on its next pass, without ever discovering
it had lost it. Both workers then believe they own the loop and both run every
scheduled task, permanently:

    worker A  claims (SETNX)        -> key = A
    worker A  starts a long batch, longer than the TTL
              key expires
    worker B  claims (SETNX)        -> key = B, B starts its own run loop
    worker A  finishes, "renews"    -> key = A again, A never noticed
    ...both now run every task, every cycle, for the life of the process

That is not a tight race: the losing workers retry on a fixed interval, so a
single overrun is enough to seat a second runner, and nothing after it ever
removes one. Production runs four workers, so members receive event reminders,
shift reminders, cert-expiry alerts and inactivity warnings two or more times,
and every "stamp it as sent" write becomes a cross-worker race.

So renewal has to be conditional on still being the owner, and the check and
the extension have to be one atomic step — reading the key and then extending
it in two calls reopens the same window on a smaller scale. Redis evaluates a
script atomically, which is what makes compare-and-swap expressible here.

This module is deliberately mechanism only: it reports whether the claim was
still held and raises if Redis could not answer. What to do about either is
policy, and it lives at the call site in ``main.py`` where the fail-open
posture for an unreachable Redis is already established and commented.
"""

from typing import Any

CLAIM_KEY_PREFIX = "startup_task:"

# Extend the TTL only if the value is still ours. `expire` returns 1 on
# success and 0 for a missing key, so a nil/other-owner read falls through to
# an explicit 0 and the caller stands down. Keep this a single script: the
# atomicity is the point, not an optimization.
RENEW_IF_OWNER_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('expire', KEYS[1], ARGV[2])
end
return 0
"""


# Release on shutdown, for the same reason renewal is conditional: a worker
# exiting must drop its own claim and leave a live sibling's alone. An
# unconditional DEL frees a claim another worker is still working under, and
# then several workers race to replace it.
RELEASE_IF_OWNER_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""


def claim_key(task_name: str) -> str:
    """The Redis key a background task's claim is held under."""
    return f"{CLAIM_KEY_PREFIX}{task_name}"


async def renew_claim(
    redis_client: Any, task_name: str, owner: str, ttl_seconds: int
) -> bool:
    """Extend this worker's claim, and report whether it still held it.

    ``False`` means the claim is somebody else's now, or expired and gone —
    in both cases the caller must stop doing the work it believed it owned.
    Returning ``False`` for a *missing* key rather than re-taking it is
    deliberate: re-creating the key here would be the unconditional write this
    module exists to avoid, and the caller's SETNX path already reacquires it
    safely on the next pass.

    Raises whatever the client raises if Redis cannot answer. The caller
    decides whether an unreachable Redis should stop the loop; this function
    does not guess.
    """
    held = await redis_client.eval(
        RENEW_IF_OWNER_LUA,
        1,
        claim_key(task_name),
        owner,
        str(int(ttl_seconds)),
    )
    # redis-py hands back an int for a Lua number, but a decoding client can
    # return it as bytes/str; compare on the coerced value rather than trusting
    # the shape.
    if isinstance(held, (bytes, bytearray)):
        held = held.decode()
    return str(held) == "1"


async def release_claim(redis_client: Any, task_name: str, owner: str) -> bool:
    """Drop this worker's claim on shutdown; leave anybody else's alone.

    ``True`` when our own claim was removed, so the next worker can take it
    immediately instead of waiting out the TTL — the point of releasing at all.
    ``False`` means the key held someone else's PID (or had already expired)
    and was left untouched.

    Raises on a Redis failure, like ``renew_claim``: a shutdown path that
    cannot reach Redis should log and carry on, and that is the caller's call.
    """
    released = await redis_client.eval(
        RELEASE_IF_OWNER_LUA, 1, claim_key(task_name), owner
    )
    if isinstance(released, (bytes, bytearray)):
        released = released.decode()
    return str(released) == "1"
