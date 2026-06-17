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
        db = _db([_scalar(750), _one(campaign)])
        await FundraisingService(db)._update_campaign_total("c1")
        assert campaign.current_amount == 750

    async def test_missing_campaign_is_noop(self):
        db = _db([_scalar(750), _one(None)])
        # Should not raise even when the campaign row is gone.
        await FundraisingService(db)._update_campaign_total("c1")


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
        db = _db([_row(row), _one(donor)])
        await FundraisingService(db)._update_donor_stats("d1")
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
        db = _db([_row((0, 0, None, None)), _one(donor)])
        await FundraisingService(db)._update_donor_stats("d1")
        assert donor.first_donation_date is None
        assert donor.last_donation_date is None


class TestCreateDonation:
    async def test_completed_donation_rolls_up_aggregates(self):
        db = _db([])  # create_donation only flushes; helpers are patched
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
        svc._update_campaign_total.assert_awaited_once_with("c1")
        svc._update_donor_stats.assert_awaited_once_with("d1")

    async def test_pending_donation_does_not_roll_up(self):
        db = _db([])
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


class TestUpdateDonationReassignment:
    """Editing a donation onto a different campaign/donor must recompute both
    the old and new parent, or the previous one is left overstated."""

    async def test_reassigning_campaign_recomputes_old_and_new(self):
        donation = SimpleNamespace(
            id="dn1", organization_id="o", campaign_id="cOLD", donor_id=None
        )
        svc = FundraisingService(_db([_one(donation)]))
        recomputed: list = []
        svc._update_campaign_total = AsyncMock(
            side_effect=lambda cid: recomputed.append(cid)
        )
        svc._update_donor_stats = AsyncMock()

        out = await svc.update_donation("dn1", "o", {"campaign_id": "cNEW"})

        assert out is donation
        assert set(recomputed) == {"cOLD", "cNEW"}

    async def test_reassigning_donor_recomputes_old_and_new(self):
        donation = SimpleNamespace(
            id="dn1", organization_id="o", campaign_id=None, donor_id="dOLD"
        )
        svc = FundraisingService(_db([_one(donation)]))
        svc._update_campaign_total = AsyncMock()
        recomputed: list = []
        svc._update_donor_stats = AsyncMock(
            side_effect=lambda did: recomputed.append(did)
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


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
