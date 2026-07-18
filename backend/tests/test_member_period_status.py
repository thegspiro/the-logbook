"""
Month-at-a-glance member status endpoint (/training/records/member-status):
  * activity is scoped to the selected window (completions, hours, last activity)
  * compliance standing maps met/total through the org thresholds
  * exempt members are surfaced as 'exempt'
DB and the shared evaluators are mocked.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1.endpoints import training as mod
from app.models.training import TrainingStatus


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


class _DB:
    """Returns queued execute() results in order (members, requirements, records)."""

    def __init__(self, results):
        self._results = list(results)

    async def execute(self, *a, **k):
        return self._results.pop(0) if self._results else _scalars([])


def _member(uid, first, last, exempt=False):
    return SimpleNamespace(
        id=uid,
        organization_id="org-1",
        first_name=first,
        last_name=last,
        username=first.lower(),
        membership_type="active",
        compliance_exempt=exempt,
    )


def _record(uid, when, hours):
    return SimpleNamespace(
        user_id=uid,
        status=TrainingStatus.COMPLETED,
        completion_date=when,
        hours_completed=hours,
    )


def _req(rid):
    return SimpleNamespace(id=rid, required_membership_types=None)


async def _call(monkeypatch, members, requirements, records, evaluate):
    monkeypatch.setattr(mod, "fetch_org_waivers", AsyncMock(return_value={}))
    monkeypatch.setattr(
        mod, "get_org_include_current_month", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(mod, "_load_compliance_config", AsyncMock(return_value=None))
    monkeypatch.setattr(mod, "_evaluate_member_requirement", evaluate)

    db = _DB([_scalars(members), _scalars(requirements), _scalars(records)])
    user = SimpleNamespace(organization_id="org-1")
    return await mod.get_member_period_status(
        start_date=date(2026, 7, 1),
        end_date=date(2026, 7, 31),
        db=db,
        current_user=user,
    )


class TestMemberPeriodStatus:
    async def test_activity_scoped_to_window_and_status_from_requirements(
        self, monkeypatch
    ):
        m = _member("u1", "Jane", "Recruit")
        records = [
            _record("u1", date(2026, 7, 5), 4.0),  # in window
            _record("u1", date(2026, 7, 20), 2.0),  # in window (latest)
            _record("u1", date(2026, 6, 30), 9.0),  # BEFORE window — excluded
        ]
        reqs = [_req("r1"), _req("r2")]

        # One requirement met, one not → 1/2 = 50% → below 75% at-risk → red.
        def evaluate(req, *_a, **_k):
            return (
                TrainingStatus.COMPLETED.value if req.id == "r1" else "not_started",
                None,
                None,
            )

        result = await _call(monkeypatch, [m], reqs, records, evaluate)
        row = result["members"][0]

        assert row["trainings_completed"] == 2  # only in-window records
        assert row["hours_completed"] == 6.0  # 4 + 2, not the June 9
        assert row["last_activity"] == "2026-07-20"
        assert row["requirements_met"] == 1
        assert row["requirements_total"] == 2
        assert row["compliance_status"] == "red"

    async def test_all_requirements_met_is_green(self, monkeypatch):
        m = _member("u1", "Sam", "Veteran")

        def evaluate(req, *_a, **_k):
            return (TrainingStatus.COMPLETED.value, None, None)

        result = await _call(monkeypatch, [m], [_req("r1")], [], evaluate)
        row = result["members"][0]
        assert row["compliance_status"] == "green"
        assert row["trainings_completed"] == 0
        assert row["last_activity"] is None

    async def test_exempt_member_surfaced_as_exempt(self, monkeypatch):
        m = _member("u1", "Chief", "Boss", exempt=True)

        def evaluate(*_a, **_k):  # pragma: no cover - should not be called
            raise AssertionError("exempt members skip requirement evaluation")

        result = await _call(monkeypatch, [m], [_req("r1")], [], evaluate)
        row = result["members"][0]
        assert row["compliance_status"] == "exempt"
        assert row["requirements_total"] == 0

    async def test_end_before_start_is_rejected(self, monkeypatch):
        from fastapi import HTTPException

        db = _DB([])
        user = SimpleNamespace(organization_id="org-1")
        with pytest.raises(HTTPException) as exc:
            await mod.get_member_period_status(
                start_date=date(2026, 7, 31),
                end_date=date(2026, 7, 1),
                db=db,
                current_user=user,
            )
        assert exc.value.status_code == 400
