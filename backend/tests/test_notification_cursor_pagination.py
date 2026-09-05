"""Keyset pagination over the notification lists.

Offset paging is only stable while the answer is. These lists are newest-first
and grow at the front, so a notification arriving between two page requests
shifts every later row down one: the next offset page re-serves a row the
client holds and steps over another entirely. The skipped row is the damaging
half, because nothing on the client can tell it was missed.

The tie tests are the ones that would fail against a timestamp-only cursor.
``notification_logs.sent_at`` is MySQL ``datetime`` with no fractional-seconds
precision, so a fan-out to fifty members writes fifty rows carrying the same
value — the case that produces the most rows at once is exactly the case a
single-column cursor mishandles.
"""

import base64
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.notifications import get_my_notifications, list_logs
from app.models.notification import NotificationLog
from app.models.user import Organization, User
from app.schemas.notifications import NotificationLogScope
from app.services.notifications_service import NotificationsService
from app.utils.cursor_pagination import (
    InvalidCursor,
    decode_cursor,
    encode_cursor,
)

pytestmark = pytest.mark.integration


async def _make_org(db):
    org = Organization(name="Cursor FD", slug=f"cur-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_user(db, org):
    user = User(
        organization_id=org.id,
        username=f"member-{uuid.uuid4().hex[:8]}",
        email=f"member-{uuid.uuid4().hex[:8]}@example.org",
        first_name="Member",
        last_name="One",
    )
    db.add(user)
    await db.flush()
    return user


async def _log(db, org, user, *, subject, sent_at, channel="in_app"):
    entry = NotificationLog(
        organization_id=org.id,
        recipient_id=user.id,
        recipient_email=user.email,
        channel=channel,
        subject=subject,
        message="body",
        sent_at=sent_at,
    )
    db.add(entry)
    await db.flush()
    return entry


BASE = datetime(2026, 9, 5, 12, 0, 0)


def _encode_raw(timestamp: str, row_id: str) -> str:
    """Build a well-formed cursor around a timestamp ``encode_cursor`` cannot.

    A hostile cursor is not reachable through ``encode_cursor``: it takes a
    ``datetime``, so a value that only exists as text has to be assembled the
    way a client would.
    """
    payload = f"1|{timestamp}|{row_id}".encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


class _Pagination:
    def __init__(self, skip=0, limit=100):
        self.skip = skip
        self.limit = limit


class TestCursorCodec:
    def test_a_cursor_round_trips(self):
        when = datetime(2026, 9, 5, 12, 0, 0)
        assert decode_cursor(encode_cursor(when, "row-1")) == (when, "row-1")

    def test_an_aware_timestamp_normalizes_to_the_naive_utc_the_column_stores(self):
        # MySQL datetime carries no offset and the app stores UTC, so a value
        # read back from the driver is naive. An aware one built in Python has
        # to reach the comparison in that same shape or the predicate matches
        # nothing at all.
        aware = datetime(2026, 9, 5, 12, 0, 0, tzinfo=timezone.utc)
        assert decode_cursor(encode_cursor(aware, "row-1"))[0].tzinfo is None
        assert decode_cursor(encode_cursor(aware, "row-1"))[0] == datetime(
            2026, 9, 5, 12, 0, 0
        )

    @pytest.mark.parametrize(
        "bad",
        ["", "not-base64!!", "YWJj", "MHxhfGI="],
        ids=["empty", "not base64", "too few fields", "wrong version"],
    )
    def test_a_cursor_this_app_did_not_issue_is_rejected(self, bad):
        # Rejected rather than ignored: silently restarting at the top would
        # hand a caller page one while they believed they were reading page
        # nine, and nothing in the response would say so.
        with pytest.raises(InvalidCursor):
            decode_cursor(bad)

    @pytest.mark.parametrize(
        "timestamp",
        ["0001-01-01T00:00:00+23:59", "9999-12-31T23:59:59-23:59"],
        ids=["underflows below year 1", "overflows past year 9999"],
    )
    def test_a_timestamp_that_cannot_be_shifted_to_utc_is_rejected(self, timestamp):
        # Parsing is not the last thing that can fail. Either end of the
        # representable range paired with an extreme offset parses cleanly and
        # then overflows on the shift to UTC, and OverflowError is not a
        # ValueError — so before this was caught it went straight past the
        # endpoints' InvalidCursor handler and answered 500 for input this
        # module already treats as malformed.
        with pytest.raises(InvalidCursor):
            decode_cursor(_encode_raw(timestamp, "row-1"))


class TestTiesWithinOneSecond:
    """The case a timestamp-only cursor gets wrong."""

    async def test_a_page_boundary_inside_a_tie_group_loses_no_row(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        # One fan-out: five rows, one timestamp.
        for n in range(5):
            await _log(db_session, org, user, subject=f"fanout-{n}", sent_at=BASE)

        service = NotificationsService(db_session)
        seen = []
        cursor = None
        for _ in range(5):
            page, _total, cursor = await service.get_logs(
                org.id, recipient_id=user.id, limit=2, cursor=cursor
            )
            seen.extend(entry.subject for entry in page)
            if cursor is None:
                break

        assert sorted(seen) == [f"fanout-{n}" for n in range(5)]
        assert len(seen) == len(set(seen)), "a row was served twice"

    async def test_the_inbox_pages_a_tie_group_the_same_way(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        for n in range(4):
            await _log(db_session, org, user, subject=f"inbox-{n}", sent_at=BASE)

        service = NotificationsService(db_session)
        first, _total, cursor = await service.get_user_notifications(
            organization_id=org.id, user_id=user.id, limit=2
        )
        assert cursor is not None
        second, _total, _next = await service.get_user_notifications(
            organization_id=org.id, user_id=user.id, limit=2, cursor=cursor
        )

        subjects = [e.subject for e in first] + [e.subject for e in second]
        assert sorted(subjects) == [f"inbox-{n}" for n in range(4)]


class TestInsertionDuringPaging:
    async def test_a_notification_arriving_mid_paging_skips_no_row(self, db_session):
        # The whole reason for the change: under offset paging this insertion
        # shifts every later row down one, and the second page steps over the
        # row that moved across the boundary.
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        for n in range(4):
            await _log(
                db_session,
                org,
                user,
                subject=f"old-{n}",
                sent_at=BASE - timedelta(minutes=n),
            )

        service = NotificationsService(db_session)
        first, _total, cursor = await service.get_logs(
            org.id, recipient_id=user.id, limit=2
        )
        assert [e.subject for e in first] == ["old-0", "old-1"]

        await _log(
            db_session,
            org,
            user,
            subject="arrived-mid-paging",
            sent_at=BASE + timedelta(minutes=5),
        )

        second, _total, _next = await service.get_logs(
            org.id, recipient_id=user.id, limit=2, cursor=cursor
        )

        assert [e.subject for e in second] == ["old-2", "old-3"]

    async def test_offset_paging_still_works_for_callers_that_use_it(self, db_session):
        # skip remains the published contract; a cursor is additive.
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        for n in range(4):
            await _log(
                db_session,
                org,
                user,
                subject=f"row-{n}",
                sent_at=BASE - timedelta(minutes=n),
            )

        service = NotificationsService(db_session)
        page, total, _next = await service.get_logs(
            org.id, recipient_id=user.id, skip=2, limit=2
        )

        assert total == 4
        assert [e.subject for e in page] == ["row-2", "row-3"]


class TestNextCursorContract:
    async def test_a_short_page_ends_the_list(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        await _log(db_session, org, user, subject="only", sent_at=BASE)

        service = NotificationsService(db_session)
        _page, _total, cursor = await service.get_logs(
            org.id, recipient_id=user.id, limit=50
        )

        assert cursor is None

    async def test_a_full_page_with_rows_behind_it_offers_the_next_one(
        self, db_session
    ):
        # Three rows behind a page of two. This asserted merely that a *full*
        # page offers a cursor, which is the behaviour the over-fetch
        # deliberately stopped: fullness alone advertised a page that need not
        # exist.
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        for n in range(3):
            await _log(
                db_session,
                org,
                user,
                subject=f"row-{n}",
                sent_at=BASE - timedelta(minutes=n),
            )

        service = NotificationsService(db_session)
        page, _total, cursor = await service.get_logs(
            org.id, recipient_id=user.id, limit=2
        )

        assert len(page) == 2
        assert cursor is not None

    async def test_an_exactly_full_final_page_does_not_advertise_another(
        self, db_session
    ):
        # Fullness is not evidence. With the row count an exact multiple of the
        # page size, issuing a cursor on a full page showed the member a
        # "Load more (0 remaining)" button and cost them a request to find the
        # end. The over-fetch of one row is what makes the claim true.
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        for n in range(4):
            await _log(
                db_session,
                org,
                user,
                subject=f"row-{n}",
                sent_at=BASE - timedelta(minutes=n),
            )

        service = NotificationsService(db_session)
        first, _total, cursor = await service.get_logs(
            org.id, recipient_id=user.id, limit=2
        )
        assert cursor is not None
        second, _total, next_cursor = await service.get_logs(
            org.id, recipient_id=user.id, limit=2, cursor=cursor
        )

        assert [e.subject for e in second] == ["row-2", "row-3"]
        assert next_cursor is None, "a full last page advertised a page after it"
        assert len(first) == 2, "the over-fetched row must not reach the caller"

    async def test_the_inbox_full_final_page_does_not_advertise_another(
        self, db_session
    ):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        for n in range(2):
            await _log(
                db_session,
                org,
                user,
                subject=f"row-{n}",
                sent_at=BASE - timedelta(minutes=n),
            )

        service = NotificationsService(db_session)
        page, _total, cursor = await service.get_user_notifications(
            organization_id=org.id, user_id=user.id, limit=2
        )

        assert len(page) == 2
        assert cursor is None

    async def test_the_total_describes_the_list_not_the_tail(self, db_session):
        # Counted before the keyset predicate narrows the query, so the
        # "N remaining" label keeps meaning the same thing on every page.
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        for n in range(5):
            await _log(
                db_session,
                org,
                user,
                subject=f"row-{n}",
                sent_at=BASE - timedelta(minutes=n),
            )

        service = NotificationsService(db_session)
        _first, _t, cursor = await service.get_logs(
            org.id, recipient_id=user.id, limit=2
        )
        _second, total, _next = await service.get_logs(
            org.id, recipient_id=user.id, limit=2, cursor=cursor
        )

        assert total == 5


class TestEmptyCursorIsRejected:
    """``?cursor=`` is a caller continuing, not a caller starting over."""

    async def test_an_empty_cursor_raises_rather_than_restarting(self, db_session):
        # Truthiness would send this down the offset branch and answer 200 with
        # the first page — rows the caller already holds, handed back as though
        # they were the next ones.
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        await _log(db_session, org, user, subject="row", sent_at=BASE)

        service = NotificationsService(db_session)
        with pytest.raises(InvalidCursor):
            await service.get_logs(org.id, recipient_id=user.id, cursor="")

    async def test_the_endpoint_turns_an_empty_cursor_into_a_400(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        caller = _Caller(user.id, org.id)

        with pytest.raises(HTTPException) as excinfo:
            await list_logs(
                channel=None,
                scope=NotificationLogScope.MINE,
                cursor="",
                pagination=_Pagination(),
                db=db_session,
                current_user=caller,
            )

        assert excinfo.value.status_code == 400


class TestCursorRespectsFilters:
    async def test_the_channel_filter_survives_the_cursor(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        for n in range(3):
            await _log(
                db_session,
                org,
                user,
                subject=f"email-{n}",
                sent_at=BASE - timedelta(minutes=n),
                channel="email",
            )
            await _log(
                db_session,
                org,
                user,
                subject=f"app-{n}",
                sent_at=BASE - timedelta(minutes=n),
                channel="in_app",
            )

        service = NotificationsService(db_session)
        first, total, cursor = await service.get_logs(
            org.id, recipient_id=user.id, channel="email", limit=2
        )
        second, _total, _next = await service.get_logs(
            org.id, recipient_id=user.id, channel="email", limit=2, cursor=cursor
        )

        assert total == 3
        subjects = [e.subject for e in first] + [e.subject for e in second]
        assert sorted(subjects) == ["email-0", "email-1", "email-2"]

    async def test_the_recipient_filter_survives_the_cursor(self, db_session):
        org = await _make_org(db_session)
        me = await _make_user(db_session, org)
        colleague = await _make_user(db_session, org)
        for n in range(3):
            await _log(
                db_session,
                org,
                me,
                subject=f"mine-{n}",
                sent_at=BASE - timedelta(minutes=n),
            )
            await _log(
                db_session,
                org,
                colleague,
                subject=f"theirs-{n}",
                sent_at=BASE - timedelta(minutes=n),
            )

        service = NotificationsService(db_session)
        first, _total, cursor = await service.get_logs(
            org.id, recipient_id=me.id, limit=2
        )
        second, _total, _next = await service.get_logs(
            org.id, recipient_id=me.id, limit=2, cursor=cursor
        )

        subjects = [e.subject for e in first] + [e.subject for e in second]
        assert sorted(subjects) == ["mine-0", "mine-1", "mine-2"]


class TestEndpointCursorHandling:
    async def test_a_bad_cursor_is_a_400_not_a_500(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        caller = _Caller(user.id, org.id)

        with pytest.raises(HTTPException) as excinfo:
            await list_logs(
                channel=None,
                scope=NotificationLogScope.MINE,
                cursor="not-a-real-cursor!!",
                pagination=_Pagination(),
                db=db_session,
                current_user=caller,
            )

        assert excinfo.value.status_code == 400

    async def test_the_inbox_rejects_a_bad_cursor_the_same_way(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        caller = _Caller(user.id, org.id)

        with pytest.raises(HTTPException) as excinfo:
            await get_my_notifications(
                include_expired=False,
                include_read=True,
                cursor="not-a-real-cursor!!",
                pagination=_Pagination(),
                db=db_session,
                current_user=caller,
            )

        assert excinfo.value.status_code == 400

    async def test_an_out_of_range_timestamp_is_a_400_not_a_500(self, db_session):
        # The codec-level test above proves the exception type. This proves the
        # consequence that made it worth fixing: the endpoint only catches
        # InvalidCursor, so an OverflowError escaping the handler is a 500 on a
        # client-supplied value.
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        caller = _Caller(user.id, org.id)
        hostile = _encode_raw("0001-01-01T00:00:00+23:59", "row-1")

        with pytest.raises(HTTPException) as excinfo:
            await list_logs(
                channel=None,
                scope=NotificationLogScope.MINE,
                cursor=hostile,
                pagination=_Pagination(),
                db=db_session,
                current_user=caller,
            )

        assert excinfo.value.status_code == 400

    async def test_the_inbox_rejects_an_out_of_range_timestamp_the_same_way(
        self, db_session
    ):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        caller = _Caller(user.id, org.id)
        hostile = _encode_raw("9999-12-31T23:59:59-23:59", "row-1")

        with pytest.raises(HTTPException) as excinfo:
            await get_my_notifications(
                include_expired=False,
                include_read=True,
                cursor=hostile,
                pagination=_Pagination(),
                db=db_session,
                current_user=caller,
            )

        assert excinfo.value.status_code == 400

    async def test_the_end_of_the_list_is_a_null_cursor_not_a_missing_key(
        self, db_session
    ):
        # The documented sentinel is the null *value*, so the key has to be
        # there to carry it. If a later change omitted the field instead — via
        # response_model_exclude_none, say — a client testing for the key's
        # presence would never see the end and would ask for page one forever.
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        caller = _Caller(user.id, org.id)
        await _log(db_session, org, user, subject="only", sent_at=BASE)

        for response in (
            await list_logs(
                channel=None,
                scope=NotificationLogScope.MINE,
                cursor=None,
                pagination=_Pagination(),
                db=db_session,
                current_user=caller,
            ),
            await get_my_notifications(
                include_expired=False,
                include_read=True,
                cursor=None,
                pagination=_Pagination(),
                db=db_session,
                current_user=caller,
            ),
        ):
            assert "next_cursor" in response
            assert response["next_cursor"] is None

    async def test_the_response_carries_the_next_cursor(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        for n in range(3):
            await _log(
                db_session,
                org,
                user,
                subject=f"row-{n}",
                sent_at=BASE - timedelta(minutes=n),
            )
        caller = _Caller(user.id, org.id)

        result = await list_logs(
            channel=None,
            scope=NotificationLogScope.MINE,
            cursor=None,
            pagination=_Pagination(limit=2),
            db=db_session,
            current_user=caller,
        )

        assert result["next_cursor"] is not None
        assert len(result["logs"]) == 2


class _Caller:
    """A minimal current_user; the endpoints read only these two fields."""

    def __init__(self, user_id, organization_id):
        self.id = user_id
        self.organization_id = organization_id
        self.rank = None
        self.positions = []
