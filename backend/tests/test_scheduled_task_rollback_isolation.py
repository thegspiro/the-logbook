"""One organization's failure must not end a scheduled task's pass.

The runners below load their rows before the loop and roll the shared session
back when one organization fails. That rollback expires every instance the
session holds, and reading an expired attribute on an AsyncSession lazy-loads
outside the greenlet (MissingGreenlet). A runner that went on reading the rows
it loaded up front failed every later organization too — and, because its
handler read the same expired row to log the failure, the error escaped the
handler and ended the whole task.

These drive the real session through that rollback: the first of two test
organizations the runner reaches fails, and the other must still be reached.
"""

import json
import uuid
from datetime import date

import pytest
from sqlalchemy import text

from app.models.compliance_config import ComplianceConfig
from app.services import scheduled_tasks as st

pytestmark = pytest.mark.integration


async def _make_org(db_session) -> str:
    org_id = str(uuid.uuid4())
    # Days-before-event reminders are off by default; on, so
    # run_event_request_reminders reaches its per-org queries.
    settings = {
        "events": {
            "request_pipeline": {
                "email_triggers": {"days_before_event": {"enabled": True}}
            }
        }
    }
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC', :settings)"
        ),
        {
            "id": org_id,
            "name": f"Dept {org_id[:8]}",
            "slug": f"rb-{org_id[:8]}",
            "settings": json.dumps(settings),
        },
    )
    return org_id


def _bound_values(statement) -> set[str]:
    try:
        params = statement.compile().params
    except Exception:
        return set()
    values: set[str] = set()
    for value in params.values():
        if isinstance(value, (list, tuple, set)):
            values.update(str(v) for v in value)
        elif value is not None:
            values.add(str(value))
    return values


@pytest.mark.parametrize(
    "runner",
    [
        "run_event_reminders",
        "run_post_event_validation",
        "run_post_shift_validation",
        "run_shift_reminders",
        "run_end_of_shift_summary",
        "run_trainee_report_escalation",
        "run_series_end_reminders",
        "run_event_request_reminders",
        "run_shift_auto_checkout",
    ],
)
async def test_a_failing_org_does_not_stop_the_orgs_after_it(
    db_session, monkeypatch, runner
):
    org_ids = {await _make_org(db_session), await _make_org(db_session)}
    # Released as a savepoint by the fixture, so the runner's rollback cannot
    # take the setup rows with it.
    await db_session.commit()

    logged: list[str] = []

    async def fake_persist(org_id, _task, _exc, *_a, **_kw):
        logged.append(str(org_id))
        return True

    monkeypatch.setattr(st, "persist_task_error_log", fake_persist)

    # The first query bound to either test org raises, standing in for any
    # failure inside that org's unit of work; the runner's own handler then
    # rolls the session back.
    reached: list[str] = []
    real_execute = db_session.execute

    async def execute(statement, *args, **kwargs):
        ours = _bound_values(statement) & org_ids
        for org_id in ours:
            if org_id not in reached:
                reached.append(org_id)
                if len(reached) == 1:
                    raise RuntimeError("simulated failure")
        return await real_execute(statement, *args, **kwargs)

    monkeypatch.setattr(db_session, "execute", execute)

    result = await getattr(st, runner)(db_session)

    assert len(reached) == 2, "the org after the failing one was never reached"
    failed_org, later_org = reached
    assert later_org not in logged
    if logged:
        assert failed_org in logged
    errored = {
        entry.get("org_id")
        for entry in result.get("organizations", [])
        if "error" in entry
    }
    assert later_org not in errored


async def test_a_failing_compliance_report_does_not_stop_the_rest(
    db_session, monkeypatch
):
    org_ids = {await _make_org(db_session), await _make_org(db_session)}
    for org_id in org_ids:
        db_session.add(
            ComplianceConfig(
                organization_id=org_id,
                auto_report_frequency="monthly",
                report_day_of_month=15,
            )
        )
    await db_session.commit()

    async def fake_today(_db, _org_id):
        return date(2026, 3, 15)

    monkeypatch.setattr("app.utils.org_timezone.resolve_org_today", fake_today)

    async def fake_persist(*_a, **_kw):
        return True

    monkeypatch.setattr(st, "persist_task_error_log", fake_persist)

    attempted: list[str] = []

    async def fake_generate(_self, *, organization_id, **_kw):
        if organization_id in org_ids:
            attempted.append(organization_id)
            if len(attempted) == 1:
                raise RuntimeError("report generation failed")

    monkeypatch.setattr(
        "app.services.compliance_config_service.ComplianceReportService"
        ".generate_report",
        fake_generate,
    )

    result = await st.run_compliance_auto_reports(db_session)

    assert len(attempted) == 2, "the config after the failing one was never run"
    failed_org, later_org = attempted
    details = [d for d in result["details"] if d["org_id"] in org_ids]
    assert {"org_id": failed_org, "error": "report generation failed"} in details
    assert {"org_id": later_org, "type": "monthly", "period": "2026-02"} in details
