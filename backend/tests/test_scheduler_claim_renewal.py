"""The scheduler claim may be extended by its owner and by nobody else.

CRON-40. Only one worker runs the scheduled-task loops, decided by a Redis key
stamped with its PID. The loops used to extend that key with a plain
``SET key pid EX ttl``, which is an unconditional write: a worker whose claim
had lapsed and been taken by another took it back on its next pass without ever
learning it had lost it, and both then ran every task forever. Production runs
four workers, so members got event reminders, shift reminders, cert-expiry
alerts and inactivity warnings two or more times over.

The renewal is now a compare-and-swap. Two things have to hold and both are
asserted here: it reports loss (so the loop can stand down), and it does not
write the key when it is not ours (so the claim cannot be stolen back).

The CAS half runs against the real Redis rather than a stand-in, because the
condition lives in a Lua script and a fake would be asserting my own
re-implementation of the semantics instead of the semantics. The stand-in is
used only for the two things real Redis cannot be made to do on demand: fail,
and answer in a different reply type.
"""

import uuid

import pytest
import redis.asyncio as redis

from app.core.background_claim import claim_key, release_claim, renew_claim

pytestmark = [pytest.mark.integration]

_OURS = "4242"
_THEIRS = "9999"


@pytest.fixture
async def client():
    c = redis.Redis(host="localhost", port=6379, decode_responses=True)
    try:
        await c.ping()
    except Exception as exc:  # pragma: no cover - environment guard
        pytest.skip(f"Redis is not reachable: {exc}")
    yield c
    await c.aclose()


@pytest.fixture
def task_name():
    """A unique task name per test, so a run cannot collide with a real claim
    or with a parallel copy of this file."""
    return f"test_claim_{uuid.uuid4().hex}"


class TestRenewalRequiresOwnership:
    async def test_the_owner_can_extend_its_own_claim(self, client, task_name):
        key = claim_key(task_name)
        await client.set(key, _OURS, ex=5)

        assert await renew_claim(client, task_name, _OURS, 120) is True

        ttl = await client.ttl(key)
        assert ttl > 5, f"the TTL should have been pushed out, got {ttl}"
        await client.delete(key)

    async def test_a_worker_that_lost_the_claim_is_told_so(self, client, task_name):
        """The case the plain SET could not see."""
        key = claim_key(task_name)
        # The claim lapsed and another worker took it — exactly the state the
        # old renewal overwrote.
        await client.set(key, _THEIRS, ex=120)

        assert await renew_claim(client, task_name, _OURS, 120) is False
        await client.delete(key)

    async def test_losing_the_claim_does_not_steal_it_back(self, client, task_name):
        """The actual defect: reporting loss is useless if the key is rewritten.

        A renewal that returns False but still writes leaves the other worker's
        claim replaced by ours, so both keep running — which is the permanent
        double-run this guards. Assert on the stored value, not just the
        return.
        """
        key = claim_key(task_name)
        await client.set(key, _THEIRS, ex=120)

        await renew_claim(client, task_name, _OURS, 999)

        assert await client.get(key) == _THEIRS, (
            "the renewal overwrote another worker's claim — this is CRON-40 "
            "itself, not merely a wrong return value"
        )
        ttl = await client.ttl(key)
        assert ttl <= 120, f"it also extended somebody else's claim (ttl={ttl})"
        await client.delete(key)

    async def test_an_expired_claim_is_not_recreated(self, client, task_name):
        """A missing key reports loss rather than being re-taken.

        Re-creating it here would be the unconditional write this module
        exists to avoid: the key being absent does not mean no other worker is
        mid-SETNX for it. The caller's own SETNX path reacquires it safely.
        """
        key = claim_key(task_name)
        await client.delete(key)

        assert await renew_claim(client, task_name, _OURS, 120) is False
        assert await client.exists(key) == 0, "renewal created the key it did not own"


class TestReleaseRequiresOwnership:
    """Shutdown drops its own claim and leaves a live sibling's alone.

    Found while fixing the renewal, and the same defect class: the shutdown
    path deleted both keys unconditionally, so a worker exiting freed whatever
    claim was in them — including one a live worker was still running under.
    """

    async def test_the_owner_releases_its_own_claim(self, client, task_name):
        key = claim_key(task_name)
        await client.set(key, _OURS, ex=120)

        assert await release_claim(client, task_name, _OURS) is True
        assert await client.exists(key) == 0

    async def test_a_sibling_worker_s_claim_is_left_alone(self, client, task_name):
        key = claim_key(task_name)
        await client.set(key, _THEIRS, ex=120)

        assert await release_claim(client, task_name, _OURS) is False
        assert await client.get(key) == _THEIRS, (
            "shutdown deleted a claim another worker still holds; it will be "
            "contested by every worker on the next pass"
        )
        await client.delete(key)

    async def test_releasing_an_absent_claim_is_not_an_error(self, client, task_name):
        await client.delete(claim_key(task_name))
        assert await release_claim(client, task_name, _OURS) is False


class TestRenewalPolicyIsTheCallersChoice:
    async def test_a_redis_failure_propagates(self, task_name):
        """The helper reports mechanism; `main.py` decides fail-open.

        Swallowing the error here would bake the policy into the wrong layer
        and make the call site's comment about it unverifiable.
        """

        class Failing:
            async def eval(self, *args, **kwargs):
                raise ConnectionError("redis is gone")

        with pytest.raises(ConnectionError):
            await renew_claim(Failing(), task_name, _OURS, 120)

    @pytest.mark.parametrize(
        ("reply", "expected"),
        [(1, True), ("1", True), (b"1", True), (0, False)],
    )
    async def test_the_reply_shape_does_not_change_the_answer(
        self, task_name, reply, expected
    ):
        """A decoding client can hand back the Lua number as str or bytes."""

        class Replying:
            async def eval(self, *args, **kwargs):
                return reply

        assert await renew_claim(Replying(), task_name, _OURS, 120) is expected


class TestTheLoopsActOnTheAnswer:
    """Source guards. The loops live in `main.py`'s lifespan closure and are
    not callable from a test without standing up the whole app, so the
    behaviour that matters — renew by CAS, and stand down when it says no — is
    pinned by reading the source. A renewal that reports loss and is ignored
    leaves the defect intact.
    """

    @staticmethod
    def _main_source() -> str:
        from pathlib import Path

        return (Path(__file__).resolve().parents[1] / "main.py").read_text()

    def test_neither_loop_renews_with_an_unconditional_set(self):
        source = self._main_source()
        for key in (
            "startup_task:scheduled_task_loop",
            "startup_task:scheduled_email_loop",
        ):
            assert f'"{key}"' not in source, (
                f"{key} is written directly in main.py. The claim is renewed "
                "through _renew_background_task_claim, which compares the "
                "stored PID first; a bare SET on this key is CRON-40."
            )

    def test_shutdown_releases_through_the_checked_helper(self):
        source = self._main_source()
        assert "release_claim(" in source, (
            "shutdown must drop its claims through release_claim, which checks "
            "the stored PID — an unconditional delete frees a live sibling's "
            "claim"
        )
        assert (
            "redis_client.delete(" not in source
        ), "a bare delete on a claim key is the same defect as a bare SET"

    def test_both_loops_renew_through_the_checked_helper(self):
        source = self._main_source()
        assert source.count("_renew_background_task_claim(") >= 4, (
            "expected the email loop and the task loop (end of cycle and "
            "mid-batch) to renew through the checked helper"
        )

    def test_both_loops_stand_down_when_the_claim_is_gone(self):
        source = self._main_source()
        for marker in ("standing down", "standing down mid-batch"):
            assert marker in source, (
                f"no '{marker}' path in main.py — a loop that learns it lost "
                "the claim must stop doing the work it no longer owns"
            )

    def test_the_task_loop_renews_inside_the_batch(self):
        """On the first pass every task is due at once, which can outlast the
        TTL; renewing only at the end of the cycle lets the claim lapse
        mid-batch and seats a second runner."""
        source = self._main_source()
        batch_start = source.index("async def _run_scheduled_task_cycles")
        batch_end = source.index("_cron_task = asyncio.create_task")
        body = source[batch_start:batch_end]
        for_at = body.index("for entry in task_schedule:")
        sleep_at = body.index("await asyncio.sleep(check_interval)")
        renewals_in_loop = body[for_at:sleep_at].count("_renew_background_task_claim(")
        assert renewals_in_loop >= 2, (
            "expected a renewal inside the per-task loop as well as after it; "
            f"found {renewals_in_loop} between the `for` and the sleep"
        )
