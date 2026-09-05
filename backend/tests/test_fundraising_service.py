"""
Tests for the fundraising service (app/services/fundraising_service.py).

Focus on the money math: the fundraising report aggregation (totals,
average gift, by-method and monthly breakdowns, unique donors), the
campaign-total and donor-stats recomputation helpers, and the conditional
aggregate updates when a donation is recorded (only COMPLETED donations
roll up). DB mocked; no MySQL.
"""

from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.grant import PaymentStatus
from app.services.fundraising_service import FundraisingService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalar(value):
    return MagicMock(scalar=MagicMock(return_value=value))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _row(values):
    return MagicMock(one=MagicMock(return_value=values))


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.flush = AsyncMock()
    # The creates reload the row after flushing, because these models carry
    # server-side column defaults that are unloaded until they do. Awaitable
    # here or the service's `await db.refresh(...)` fails on a plain MagicMock.
    db.refresh = AsyncMock()
    return db


def _donation(amount, donor_id="d1", method="cash", day="2026-01-15"):
    return SimpleNamespace(
        amount=amount,
        donor_id=donor_id,
        payment_method=method,
        donation_date=datetime.strptime(day, "%Y-%m-%d").date(),
    )


class TestFundraisingReport:
    async def test_empty_report_is_zeroed(self):
        db = _db([_scalars([])])
        out = await FundraisingService(db).get_fundraising_report("org-1")
        assert out["total_donations"] == 0
        assert out["donation_count"] == 0
        assert out["average_gift"] == 0
        assert out["unique_donors"] == 0
        assert out["monthly_totals"] == []

    async def test_aggregates_totals_and_average(self):
        donations = [
            _donation(100, "d1", "cash", "2026-01-10"),
            _donation(300, "d2", "card", "2026-01-20"),
            _donation(200, "d1", "cash", "2026-02-05"),
        ]
        db = _db([_scalars(donations)])
        out = await FundraisingService(db).get_fundraising_report("org-1")
        assert out["total_donations"] == 600.0
        assert out["donation_count"] == 3
        assert out["unique_donors"] == 2
        assert out["average_gift"] == 200.0

    async def test_breakdowns_by_method_and_month(self):
        donations = [
            _donation(100, "d1", "cash", "2026-01-10"),
            _donation(300, "d2", "card", "2026-01-20"),
            _donation(200, "d1", "cash", "2026-02-05"),
        ]
        db = _db([_scalars(donations)])
        out = await FundraisingService(db).get_fundraising_report("org-1")
        assert out["donations_by_method"] == {"cash": 300.0, "card": 300.0}
        # Monthly totals are sorted ascending by month key.
        assert out["monthly_totals"] == [
            {"month": "2026-01", "total": 400.0},
            {"month": "2026-02", "total": 200.0},
        ]


class TestUpdateCampaignTotal:
    async def test_sets_current_amount_from_sum(self):
        campaign = SimpleNamespace(id="c1", current_amount=0)
        # Campaign row lock happens first, then the (also locking) SUM read.
        db = _db([_one(campaign), _scalar(750)])
        await FundraisingService(db)._update_campaign_total("c1", "org-1")
        assert campaign.current_amount == 750

    async def test_missing_campaign_is_noop(self):
        db = _db([_one(None)])
        # Should not raise, and must not attempt the SUM query.
        await FundraisingService(db)._update_campaign_total("c1", "org-1")
        db.execute.assert_awaited_once()


class TestUpdateDonorStats:
    async def test_sets_rollup_fields(self):
        donor = SimpleNamespace(
            id="d1",
            total_donated=0,
            donation_count=0,
            first_donation_date=None,
            last_donation_date=None,
        )
        row = (500, 3, datetime(2026, 1, 1), datetime(2026, 6, 1))
        # Donor row lock happens first, then the (also locking) aggregate read.
        db = _db([_one(donor), _row(row)])
        await FundraisingService(db)._update_donor_stats("d1", "org-1")
        assert donor.total_donated == 500
        assert donor.donation_count == 3
        assert donor.first_donation_date == date(2026, 1, 1)
        assert donor.last_donation_date == date(2026, 6, 1)

    async def test_handles_no_donations(self):
        donor = SimpleNamespace(
            id="d1",
            total_donated=0,
            donation_count=0,
            first_donation_date=None,
            last_donation_date=None,
        )
        db = _db([_one(donor), _row((0, 0, None, None))])
        await FundraisingService(db)._update_donor_stats("d1", "org-1")
        assert donor.first_donation_date is None
        assert donor.last_donation_date is None

    async def test_missing_donor_is_noop(self):
        db = _db([_one(None)])
        # Should not raise, and must not attempt the aggregate query.
        await FundraisingService(db)._update_donor_stats("d1", "org-1")
        db.execute.assert_awaited_once()


class TestCreateDonation:
    async def test_completed_donation_rolls_up_aggregates(self):
        # Two _entity_in_org checks (campaign, donor) resolve in-org, then
        # the pre-insert campaign/donor locks (results discarded).
        db = _db([_one("c1"), _one("d1"), MagicMock(), MagicMock()])
        svc = FundraisingService(db)
        svc._update_campaign_total = AsyncMock()
        svc._update_donor_stats = AsyncMock()
        await svc.create_donation(
            "org-1",
            {
                "campaign_id": "c1",
                "donor_id": "d1",
                "amount": 100,
                "payment_status": PaymentStatus.COMPLETED,
            },
            "user-1",
        )
        svc._update_campaign_total.assert_awaited_once_with("c1", "org-1")
        svc._update_donor_stats.assert_awaited_once_with("d1", "org-1")

    async def test_pending_donation_does_not_roll_up(self):
        # Two _entity_in_org checks (campaign, donor) resolve in-org.
        db = _db([_one("c1"), _one("d1")])
        svc = FundraisingService(db)
        svc._update_campaign_total = AsyncMock()
        svc._update_donor_stats = AsyncMock()
        await svc.create_donation(
            "org-1",
            {
                "campaign_id": "c1",
                "donor_id": "d1",
                "amount": 100,
                "payment_status": PaymentStatus.PENDING,
            },
            "user-1",
        )
        svc._update_campaign_total.assert_not_awaited()
        svc._update_donor_stats.assert_not_awaited()


class TestDonationParentLockOrdering:
    """Codex (PR #1904 review): Donation.campaign_id/donor_id are FK columns,
    so inserting/updating a donation before locking its campaign/donor takes
    an implicit shared FK-check lock on the parent ahead of the exclusive
    FOR UPDATE lock the recompute takes — two concurrent completed donations
    to the same campaign/donor deadlock. The parent locks must happen before
    the donation is added to the session."""

    async def test_create_locks_campaign_and_donor_before_adding_donation(self):
        order = []

        async def execute(stmt, *_a, **_kw):
            order.append(("execute", str(stmt)))
            result = MagicMock()
            result.scalar_one_or_none.return_value = "ok"
            return result

        db = MagicMock()
        db.execute = execute
        db.add = MagicMock(side_effect=lambda obj: order.append(("add", obj)))
        db.flush = AsyncMock(side_effect=lambda: order.append(("flush", None)))
        db.refresh = AsyncMock()

        svc = FundraisingService(db)
        svc._update_campaign_total = AsyncMock()
        svc._update_donor_stats = AsyncMock()

        await svc.create_donation(
            "org-1",
            {
                "campaign_id": "c1",
                "donor_id": "d1",
                "amount": 100,
                "payment_status": PaymentStatus.COMPLETED,
            },
            "user-1",
        )

        add_index = next(i for i, (kind, _) in enumerate(order) if kind == "add")
        # The two entity_in_org validation checks come first (not locks);
        # the last two execute calls before "add" are the FOR UPDATE locks.
        lock_calls = [stmt for kind, stmt in order[:add_index] if kind == "execute"][
            -2:
        ]
        assert len(lock_calls) == 2
        assert all("FOR UPDATE" in stmt for stmt in lock_calls)
        assert any("fundraising_campaigns" in stmt.lower() for stmt in lock_calls)
        assert any("donors" in stmt.lower() for stmt in lock_calls)

    async def test_update_locks_old_and_new_parents_before_flush(self):
        donation = SimpleNamespace(
            id="dn1", organization_id="o", campaign_id="cOLD", donor_id=None
        )
        order = []

        async def execute(stmt, *_a, **_kw):
            order.append(str(stmt))
            result = MagicMock()
            result.scalar_one_or_none.return_value = donation
            return result

        db = MagicMock()
        db.execute = execute
        db.flush = AsyncMock(side_effect=lambda: order.append("FLUSH"))
        svc = FundraisingService(db)
        svc._update_campaign_total = AsyncMock()
        svc._update_donor_stats = AsyncMock()

        await svc.update_donation("dn1", "o", {"campaign_id": "cNEW"})

        flush_index = order.index("FLUSH")
        # Everything before FLUSH is: donation fetch, in-org check, then the
        # two campaign locks (old + new) — both must render FOR UPDATE.
        pre_flush = order[:flush_index]
        lock_stmts = [s for s in pre_flush if "FOR UPDATE" in s]
        assert len(lock_stmts) == 2
        assert all("fundraising_campaigns" in s.lower() for s in lock_stmts)


class TestUpdateDonationReassignment:
    """Editing a donation onto a different campaign/donor must recompute both
    the old and new parent, or the previous one is left overstated."""

    async def test_reassigning_campaign_recomputes_old_and_new(self):
        donation = SimpleNamespace(
            id="dn1", organization_id="o", campaign_id="cOLD", donor_id=None
        )
        # Donation fetch, the in-org check for the reassigned campaign, then
        # the old+new campaign locks (results discarded).
        svc = FundraisingService(
            _db([_one(donation), _one("cNEW"), MagicMock(), MagicMock()])
        )
        recomputed: list = []
        svc._update_campaign_total = AsyncMock(
            side_effect=lambda cid, org_id: recomputed.append(cid)
        )
        svc._update_donor_stats = AsyncMock()

        out = await svc.update_donation("dn1", "o", {"campaign_id": "cNEW"})

        assert out is donation
        assert set(recomputed) == {"cOLD", "cNEW"}

    async def test_reassigning_donor_recomputes_old_and_new(self):
        donation = SimpleNamespace(
            id="dn1", organization_id="o", campaign_id=None, donor_id="dOLD"
        )
        # Donation fetch, the in-org check for the reassigned donor, then
        # the old+new donor locks (results discarded).
        svc = FundraisingService(
            _db([_one(donation), _one("dNEW"), MagicMock(), MagicMock()])
        )
        svc._update_campaign_total = AsyncMock()
        recomputed: list = []
        svc._update_donor_stats = AsyncMock(
            side_effect=lambda did, org_id: recomputed.append(did)
        )

        await svc.update_donation("dn1", "o", {"donor_id": "dNEW"})

        assert set(recomputed) == {"dOLD", "dNEW"}


class TestCrudGuards:
    async def test_update_campaign_missing_returns_none(self):
        db = _db([_one(None)])
        assert await FundraisingService(db).update_campaign("c1", "org-1", {}) is None

    async def test_delete_campaign_soft_deactivates(self):
        campaign = SimpleNamespace(id="c1", active=True)
        db = _db([_one(campaign)])
        assert await FundraisingService(db).delete_campaign("c1", "org-1") is True
        assert campaign.active is False

    async def test_update_donation_missing_returns_none(self):
        db = _db([_one(None)])
        assert await FundraisingService(db).update_donation("x", "org-1", {}) is None


class TestPledgeFkValidation:
    """GF-6: pledge campaign_id / donor_id must be in the caller's org."""

    async def test_create_pledge_rejects_foreign_campaign(self):
        db = _db([_one(None)])  # campaign not in org
        with pytest.raises(ValueError, match="Campaign not found"):
            await FundraisingService(db).create_pledge(
                "org-1", {"campaign_id": "cFOREIGN"}, "u1"
            )

    async def test_create_pledge_rejects_foreign_donor(self):
        db = _db([_one("c1"), _one(None)])  # campaign ok, donor not in org
        with pytest.raises(ValueError, match="Donor not found"):
            await FundraisingService(db).create_pledge(
                "org-1", {"campaign_id": "c1", "donor_id": "dFOREIGN"}, "u1"
            )

    async def test_create_pledge_in_org_fks_pass(self):
        db = _db([_one("c1"), _one("d1")])
        pledge = await FundraisingService(db).create_pledge(
            "org-1", {"campaign_id": "c1", "donor_id": "d1"}, "u1"
        )
        assert pledge is not None

    async def test_update_pledge_rejects_foreign_donor(self):
        pledge = SimpleNamespace(id="p1", organization_id="org-1")
        db = _db([_one(pledge), _one(None)])  # pledge fetch, then donor not in org
        with pytest.raises(ValueError, match="Donor not found"):
            await FundraisingService(db).update_pledge(
                "p1", "org-1", {"donor_id": "dFOREIGN"}
            )


class TestFundraisingEventFkValidation:
    """GF-6: fundraising-event campaign_id / event_id must be in-org."""

    async def test_create_event_rejects_foreign_event(self):
        db = _db([_one("c1"), _one(None)])  # campaign ok, event not in org
        with pytest.raises(ValueError, match="Event not found"):
            await FundraisingService(db).create_fundraising_event(
                "org-1", {"campaign_id": "c1", "event_id": "eFOREIGN"}, "u1"
            )

    async def test_update_event_rejects_foreign_campaign(self):
        event = SimpleNamespace(id="fe1", organization_id="org-1")
        db = _db([_one(event), _one(None)])  # event fetch, campaign not in org
        with pytest.raises(ValueError, match="Campaign not found"):
            await FundraisingService(db).update_fundraising_event(
                "fe1", "org-1", {"campaign_id": "cFOREIGN"}
            )


class TestListPagination:
    """GF-35: every list_* method applies skip/limit in SQL rather than
    fetching the whole org-wide table and slicing in Python (Checklist #6 —
    an unbounded list endpoint). A mocked session can't prove the *row
    count* is bounded, but it can prove the LIMIT/OFFSET clause the
    endpoint's `pagination.skip`/`pagination.limit` feed actually reaches
    the compiled statement, which is the part a regression would silently
    drop (e.g. reverting to `results[skip:skip+limit]` in Python)."""

    @staticmethod
    async def _compiled_sql(coro):
        from sqlalchemy.dialects import mysql

        captured = []

        async def execute(stmt, *_a, **_kw):
            captured.append(stmt)
            return _scalars([])

        db = MagicMock()
        db.execute = execute
        await coro(db)
        assert captured, "list method never executed a query"
        return str(
            captured[-1].compile(
                dialect=mysql.dialect(), compile_kwargs={"literal_binds": True}
            )
        ).lower()

    # MySQL's dialect renders LIMIT/OFFSET as a single clause,
    # `LIMIT <offset>, <count>` — there is no separate "offset" keyword to
    # assert on.

    async def test_list_campaigns_applies_skip_and_limit(self):
        sql = await self._compiled_sql(
            lambda db: FundraisingService(db).list_campaigns("org-1", skip=10, limit=5)
        )
        assert "limit 10, 5" in sql

    async def test_list_donors_applies_skip_and_limit(self):
        sql = await self._compiled_sql(
            lambda db: FundraisingService(db).list_donors("org-1", skip=20, limit=7)
        )
        assert "limit 20, 7" in sql

    async def test_list_donations_applies_skip_and_limit(self):
        sql = await self._compiled_sql(
            lambda db: FundraisingService(db).list_donations("org-1", skip=15, limit=3)
        )
        assert "limit 15, 3" in sql

    async def test_list_pledges_applies_skip_and_limit(self):
        sql = await self._compiled_sql(
            lambda db: FundraisingService(db).list_pledges("org-1", skip=1, limit=2)
        )
        assert "limit 1, 2" in sql

    async def test_list_fundraising_events_applies_skip_and_limit(self):
        sql = await self._compiled_sql(
            lambda db: FundraisingService(db).list_fundraising_events(
                "org-1", skip=4, limit=9
            )
        )
        assert "limit 4, 9" in sql

    async def test_list_campaigns_defaults_are_bounded(self):
        # No caller passes skip/limit explicitly except the endpoint layer —
        # the defaults themselves must still bound the query, not fetch
        # everything (an unbounded query would compile with no LIMIT clause
        # at all).
        sql = await self._compiled_sql(
            lambda db: FundraisingService(db).list_campaigns("org-1")
        )
        assert "limit 0, 100" in sql

    # --- Codex finding 1 (GF-35 follow-up): every ORDER BY above must end
    # with the model's id as a tie-breaker, or two executions of the same
    # paginated query can order tied rows differently and a page can
    # duplicate or drop rows. ---

    @staticmethod
    def _order_by_clause(sql: str) -> str:
        return sql.split("order by", 1)[1].split("limit", 1)[0].strip()

    async def test_list_campaigns_orders_by_id_last(self):
        sql = await self._compiled_sql(
            lambda db: FundraisingService(db).list_campaigns("org-1")
        )
        assert self._order_by_clause(sql).endswith("fundraising_campaigns.id asc")

    async def test_list_donors_orders_by_id_last(self):
        sql = await self._compiled_sql(
            lambda db: FundraisingService(db).list_donors("org-1")
        )
        assert self._order_by_clause(sql).endswith("donors.id asc")

    async def test_list_donations_orders_by_id_last(self):
        sql = await self._compiled_sql(
            lambda db: FundraisingService(db).list_donations("org-1")
        )
        assert self._order_by_clause(sql).endswith("donations.id asc")

    async def test_list_pledges_orders_by_id_last(self):
        sql = await self._compiled_sql(
            lambda db: FundraisingService(db).list_pledges("org-1")
        )
        assert self._order_by_clause(sql).endswith("pledges.id asc")

    async def test_list_fundraising_events_orders_by_id_last(self):
        sql = await self._compiled_sql(
            lambda db: FundraisingService(db).list_fundraising_events("org-1")
        )
        assert self._order_by_clause(sql).endswith("fundraising_events.id asc")


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
