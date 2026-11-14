"""An open swap puts a bell entry in front of the members who could take it.

Owner decision 2026-11-01 (W33-4, "Bell entry only"): when an open swap is
posted, every member cleared for its seat gets an in-app notice — and nothing
else: no email, no SMS, no push. Pinned here:

* **The same members the pickup list offers it to** (Pitfall #29). Recipients
  are compared against ``get_open_swaps_for_member`` for every member, so the
  two cannot drift apart.
* **Never the poster, a member already on the shift, or another department.**
* **Safe to run twice** (Pitfall #36): a rerun, or a second open swap posted for
  the same seat, tells nobody twice. The seat-and-recipient key is unique.
"""

import uuid
from datetime import date, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.notification import NotificationLog
from app.models.shift_swap_notice import OpenSwapNotice
from app.services.scheduling_service import SchedulingService
from tests.test_open_swap_pickup import (
    _add_member,
    _add_org,
    _open_swap,
    _seat,
    _shift,
)

pytestmark = [pytest.mark.integration]


@pytest.fixture(autouse=True)
def _department_today(monkeypatch):
    monkeypatch.setattr(
        "app.services.scheduling_service.resolve_org_today",
        AsyncMock(return_value=date.today()),
    )


@pytest.fixture
async def department(db_session):
    """The pickup suite's department: a lieutenant (officer, driver or
    firefighter), two engineers (driver or firefighter), a firefighter, and a
    rankless manager who is cleared for nothing."""
    org_id = await _add_org(db_session)
    members = {
        "lieutenant": await _add_member(db_session, org_id, "lieutenant"),
        "engineer": await _add_member(db_session, org_id, "engineer"),
        "engineer2": await _add_member(db_session, org_id, "engineer"),
        "firefighter": await _add_member(db_session, org_id, "firefighter"),
        "manager": await _add_member(db_session, org_id, None),
    }
    return org_id, members


_CATEGORY = SchedulingService.OPEN_SWAP_NOTICE_CATEGORY


async def _bells(db_session, org_id: str) -> dict:
    rows = (
        await db_session.execute(
            select(NotificationLog).where(
                NotificationLog.organization_id == org_id,
                NotificationLog.category == _CATEGORY,
            )
        )
    ).scalars()
    found: dict = {}
    for row in rows:
        found.setdefault(str(row.recipient_id), []).append(row)
    return found


async def _offered_to(svc, org_id: str, members: dict, swap_id: str) -> set:
    offered = set()
    for user_id in members.values():
        listing = await svc.get_open_swaps_for_member(
            uuid.UUID(org_id), uuid.UUID(user_id)
        )
        if any(o["swap_request_id"] == swap_id for o in listing):
            offered.add(user_id)
    return offered


@pytest.fixture
def no_email():
    with patch(
        "app.services.email_service.EmailService.send_email", new=AsyncMock()
    ) as send:
        yield send


class TestWhoIsTold:
    async def test_the_members_the_pickup_list_offers_it_to_and_nobody_else(
        self, db_session, department, no_email
    ):
        org_id, m = department
        # Cleared for the seat by rank, but in another department.
        other_org = await _add_org(db_session)
        outsider = await _add_member(db_session, other_org, "engineer")
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        # Cleared for the driver seat, but already on the shift.
        await _seat(svc, org_id, shift, m["lieutenant"], m["manager"], "officer")

        swap = await _open_swap(svc, org_id, m["engineer"], shift)

        bells = await _bells(db_session, org_id)
        assert set(bells) == {m["engineer2"]}
        assert set(bells) == await _offered_to(svc, org_id, m, str(swap.id))
        assert outsider not in bells
        entry = bells[m["engineer2"]][0]
        assert getattr(entry.channel, "value", entry.channel) == "in_app"
        assert entry.action_url == "/scheduling?tab=requests"
        assert (entry.notification_metadata or {})["swap_request_id"] == str(swap.id)

    async def test_bell_only_no_email(self, db_session, department, no_email):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")

        with patch(
            "app.services.scheduling_service.SchedulingService._send_notification",
            new=AsyncMock(),
        ):
            await _open_swap(svc, org_id, m["engineer"], shift)

        assert m["engineer2"] in await _bells(db_session, org_id)
        no_email.assert_not_called()

    async def test_a_swap_naming_a_member_is_not_broadcast(
        self, db_session, department, no_email
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")

        swap, err = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(m["engineer"]),
            {"offering_shift_id": shift.id, "target_user_id": m["engineer2"]},
        )
        assert err is None, err

        assert await _bells(db_session, org_id) == {}


class TestSafeToRunTwice:
    async def test_a_rerun_tells_nobody_again(self, db_session, department, no_email):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        swap = await _open_swap(svc, org_id, m["engineer"], shift)

        again = await svc.notify_members_of_open_swap(str(swap.id), org_id)

        assert again == 0
        bells = await _bells(db_session, org_id)
        # Both members cleared to drive were told, each once.
        assert {k: len(v) for k, v in bells.items()} == {
            m["engineer2"]: 1,
            m["lieutenant"]: 1,
        }

    async def test_a_second_post_for_the_same_seat_tells_nobody_again(
        self, db_session, department, no_email
    ):
        """A double-tapped "Ask for cover", or a POST retried after it timed
        out, creates a second open swap for the same seat."""
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        await _seat(svc, org_id, shift, m["engineer"], m["manager"], "driver")
        await _open_swap(svc, org_id, m["engineer"], shift)

        await _open_swap(svc, org_id, m["engineer"], shift)

        assert {k: len(v) for k, v in (await _bells(db_session, org_id)).items()} == {
            m["engineer2"]: 1,
            m["lieutenant"]: 1,
        }

    async def test_the_key_is_held_by_the_database(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        for _ in range(2):
            db_session.add(
                OpenSwapNotice(
                    id=str(uuid.uuid4()),
                    organization_id=org_id,
                    offering_shift_id=shift.id,
                    offered_by_id=m["engineer"],
                    recipient_id=m["engineer2"],
                    created_at=datetime.now(),
                )
            )
        with pytest.raises(IntegrityError):
            await db_session.flush()
