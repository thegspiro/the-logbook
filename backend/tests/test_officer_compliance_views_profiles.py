"""
The officer-facing compliance views grade a member on what their compliance
profile requires (owner decision 2026-11-20, "officer compliance views").

The compliance matrix resolves each member through
``ComplianceGrading.for_member``: the highest-priority matching active profile
narrows the requirements to its ``required_requirement_ids`` and may override
the thresholds. Five officer views skipped the profile and graded every
applicable requirement against the department's own settings:

* the period roster (``GET /training/records/member-status``),
* the competency matrix (``CompetencyMatrixService``),
* the compliance CSV and PDF export cells (``ReportExportService``),
* the compliance forecast (``ReportExportService.generate_compliance_forecast``),
* Scheduling's Shift Compliance report (``SchedulingService.get_shift_compliance``).

These tests pin each of them to the matrix's answer for the same member
(CLAUDE.md pitfall 29). The views that classify a standing (the roster, and
the forecast through its new ``current_standing``) also take the profile's
threshold overrides; the others show no standing, so the profile narrows
their cells only.

Members, positions, the compliance configuration and profiles are inserted
with raw SQL, so no member sits in the session's identity map with
``positions`` already loaded: a view that reads a profile without loading
positions fails here instead of passing on a warm cache. Each hours
requirement takes its own training type, so a record credits exactly one of
them. Profiles never share a priority: equal priorities resolve in an
undefined order.
"""

import json
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.api.v1.endpoints import training as training_endpoints
from app.api.v1.endpoints.training import (
    get_compliance_matrix,
    get_member_period_status,
)
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import User
from app.services import training_compliance
from app.services import training_enhancement_service as export_mod
from app.services.competency_matrix_service import CompetencyMatrixService
from app.services.scheduling_service import SchedulingService
from app.services.training_enhancement_service import ReportExportService
from app.utils.org_timezone import resolve_org_today

pytestmark = [pytest.mark.integration]


def _now() -> datetime:
    # Read when a row is written, not at import (CLAUDE.md pitfall 40).
    return datetime.now(timezone.utc)


# The roster's colour for each matrix standing, written out rather than
# imported so a wrong map in the endpoint fails here.
COLOUR = {
    "compliant": "green",
    "at_risk": "yellow",
    "non_compliant": "red",
    "not_applicable": "not_applicable",
}

HOURS_TYPES = {
    "Alpha": TrainingType.CONTINUING_EDUCATION,
    "Bravo": TrainingType.SKILLS_PRACTICE,
    "Charlie": TrainingType.ORIENTATION,
}


def _uid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------- fixtures


async def _org(db) -> tuple[str, date]:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Officer Views Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"officer-{org_id[:8]}"},
    )
    await db.flush()
    return org_id, await resolve_org_today(db, org_id)


async def _member(db, org_id: str, last: str, membership_type: str = "active") -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, email, "
            "password_hash, status, membership_type, compliance_exempt, hire_date) "
            "VALUES (:id, :org, :un, 'Test', :ln, :em, 'x', 'active', :mt, 0, :hd)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u-{user_id[:8]}",
            "ln": last,
            "em": f"u-{user_id[:8]}@officer.test",
            "mt": membership_type,
            # Long-standing, so no requirement is in a catch-up period.
            "hd": date.today() - timedelta(days=3650),
        },
    )
    await db.flush()
    return user_id


async def _position(db, org_id: str, user_id: str) -> str:
    position_id = _uid()
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug) "
            "VALUES (:id, :org, 'Engine Company', :slug)"
        ),
        {"id": position_id, "org": org_id, "slug": f"engine-{position_id[:8]}"},
    )
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    await db.flush()
    return position_id


async def _hours_req(db, org_id: str, name: str) -> str:
    req = TrainingRequirement(
        id=_uid(),
        organization_id=org_id,
        name=name,
        requirement_type=RequirementType.HOURS,
        training_type=HOURS_TYPES[name],
        required_hours=1,
        frequency=RequirementFrequency.ANNUAL,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        period_start_month=1,
        period_start_day=1,
        applies_to_all=True,
        shift_credited=False,
        active=True,
    )
    db.add(req)
    await db.flush()
    return req.id


async def _shifts_req(db, org_id: str, name: str) -> str:
    req = TrainingRequirement(
        id=_uid(),
        organization_id=org_id,
        name=name,
        requirement_type=RequirementType.SHIFTS,
        required_shifts=1,
        frequency=RequirementFrequency.ANNUAL,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        period_start_month=1,
        period_start_day=1,
        applies_to_all=True,
        shift_credited=True,
        active=True,
    )
    db.add(req)
    await db.flush()
    return req.id


async def _hours(db, org_id: str, user_id: str, name: str, on: date) -> None:
    db.add(
        TrainingRecord(
            id=_uid(),
            organization_id=org_id,
            user_id=user_id,
            course_name="Company Drill",
            training_type=HOURS_TYPES[name],
            status=TrainingStatus.COMPLETED,
            completion_date=on,
            hours_completed=1.0,
        )
    )
    await db.flush()


async def _expiring_cert(db, org_id: str, user_id: str, today: date, days: int):
    """A certificate no requirement here grades, expiring in ``days``."""
    db.add(
        TrainingRecord(
            id=_uid(),
            organization_id=org_id,
            user_id=user_id,
            course_name="Hazmat Awareness",
            training_type=TrainingType.CERTIFICATION,
            status=TrainingStatus.COMPLETED,
            completion_date=today - timedelta(days=700),
            expiration_date=today + timedelta(days=days),
            certification_number=f"HZ-{uuid.uuid4().hex[:6]}",
            hours_completed=0,
        )
    )
    await db.flush()


async def _config(
    db,
    org_id: str,
    *,
    compliant: float = 100.0,
    at_risk: float = 75.0,
    include_current_month: bool = True,
) -> str:
    config_id = _uid()
    await db.execute(
        text(
            "INSERT INTO compliance_configs "
            "(id, organization_id, compliant_threshold, at_risk_threshold, "
            "threshold_type, include_current_month, created_at, updated_at) "
            "VALUES (:id, :org, :c, :a, 'percentage', :icm, :now, :now)"
        ),
        {
            "id": config_id,
            "org": org_id,
            "c": compliant,
            "a": at_risk,
            "icm": 1 if include_current_month else 0,
            "now": _now(),
        },
    )
    await db.flush()
    return config_id


async def _profile(
    db,
    config_id: str,
    *,
    priority: int,
    membership_types: list[str] | None = None,
    role_ids: list[str] | None = None,
    required: list[str] | None = None,
    compliant_override: float | None = None,
    at_risk_override: float | None = None,
) -> None:
    await db.execute(
        text(
            "INSERT INTO compliance_profiles "
            "(id, config_id, name, membership_types, role_ids, "
            "required_requirement_ids, compliant_threshold_override, "
            "at_risk_threshold_override, priority, is_active, created_at, "
            "updated_at) "
            "VALUES (:id, :cfg, :name, :mt, :ri, :rr, :co, :ao, :prio, 1, "
            ":now, :now)"
        ),
        {
            "id": _uid(),
            "cfg": config_id,
            "name": f"Profile {priority}",
            "mt": json.dumps(membership_types) if membership_types else None,
            "ri": json.dumps(role_ids) if role_ids else None,
            "rr": json.dumps(required) if required is not None else None,
            "co": compliant_override,
            "ao": at_risk_override,
            "prio": priority,
            "now": _now(),
        },
    )
    await db.flush()


async def _profiled_org(db, *, required_names=("Alpha", "Bravo"), **profile):
    """Alpha, Bravo, Charlie hours requirements; member M meets Alpha only.

    The department grades at 100 / 75. Profile P (membership "active") lists
    ``required_names`` and, by default, lowers the bars to 50 / 25.
    """
    org_id, today = await _org(db)
    reqs = {name: await _hours_req(db, org_id, name) for name in HOURS_TYPES}
    member = await _member(db, org_id, "Mike")
    await _hours(db, org_id, member, "Alpha", today)
    config_id = await _config(db, org_id)
    profile.setdefault("compliant_override", 50)
    profile.setdefault("at_risk_override", 25)
    await _profile(
        db,
        config_id,
        priority=10,
        membership_types=["active"],
        required=(
            [reqs[n] for n in required_names] if required_names is not None else None
        ),
        **profile,
    )
    return SimpleNamespace(org=org_id, today=today, reqs=reqs, member=member)


# ------------------------------------------------------------------ views


def _caller(org_id: str) -> User:
    return User(id=_uid(), organization_id=org_id)


async def _matrix(db, org_id: str) -> dict[str, dict]:
    payload = await get_compliance_matrix(db=db, current_user=_caller(org_id))
    return {str(m["user_id"]): m for m in payload["members"]}


def _matrix_ids(row: dict) -> set[str]:
    return {str(c["requirement_id"]) for c in row["requirements"]}


async def _roster(db, org_id: str, today: date) -> dict[str, dict]:
    payload = await get_member_period_status(
        start_date=date(today.year, 1, 1),
        end_date=today,
        db=db,
        current_user=_caller(org_id),
    )
    return {str(m["user_id"]): m for m in payload["members"]}


async def _competency(db, org_id: str) -> dict[str, dict]:
    payload = await CompetencyMatrixService(db).get_competency_matrix(org_id)
    return payload


async def _csv(db, org_id: str) -> tuple[list[str], dict[str, list[str]]]:
    """The compliance CSV's header and each member's row, keyed by last name."""
    import csv
    import io

    body = await ReportExportService(db).generate_compliance_csv(org_id)
    rows = list(csv.reader(io.StringIO(body)))
    header, data = rows[0], rows[1:]
    return header, {r[0].split(" ")[-1]: r for r in data}


async def _forecast(db, org_id: str) -> dict[str, dict]:
    rows = await ReportExportService(db).generate_compliance_forecast(org_id)
    return {r["user_id"]: r for r in rows}


async def _shift_report(db, org_id: str) -> dict[str, set[str]]:
    """Each shift-credited requirement's listed member ids."""
    data = await SchedulingService(db).get_shift_compliance(org_id)
    return {
        str(r["requirement_id"]): {str(m["user_id"]) for m in r["members"]}
        for r in data
    }


def _csv_requirement_cells(header, row) -> dict[str, str]:
    return {
        col.removesuffix(" (Status)"): value
        for col, value in zip(header, row)
        if col.endswith(" (Status)")
    }


# ------------------------------------------------------------------ roster


class TestPeriodRosterFollowsTheProfile:
    async def test_requirements_narrow_to_the_profile(self, db_session):
        # Before: 1 of 3, Charlie included.
        dept = await _profiled_org(db_session)
        row = (await _roster(db_session, dept.org, dept.today))[dept.member]
        assert (row["requirements_met"], row["requirements_total"]) == (1, 2)

    async def test_profile_threshold_overrides_colour_the_row(self, db_session):
        # 1 of 2 is 50%, the profile's compliant bar. Before: 1 of 3 = 33.3%
        # against the department's 100 / 75, red.
        dept = await _profiled_org(db_session)
        row = (await _roster(db_session, dept.org, dept.today))[dept.member]
        assert row["compliance_status"] == "green"

    async def test_threshold_only_profile_overrides_apply(self, db_session):
        # The profile sets no requirement list, only a 60% bar. Alpha and
        # Bravo met of three is 66.7%. Before: red against 100 / 75.
        dept = await _profiled_org(
            db_session,
            required_names=None,
            compliant_override=60,
            at_risk_override=None,
        )
        await _hours(db_session, dept.org, dept.member, "Bravo", dept.today)
        row = (await _roster(db_session, dept.org, dept.today))[dept.member]
        assert (row["requirements_met"], row["requirements_total"]) == (2, 3)
        assert row["compliance_status"] == "green"

    async def test_compliance_config_is_loaded_once(self, db_session, monkeypatch):
        # Before: twice, once inside get_org_include_current_month and once
        # for the thresholds.
        dept = await _profiled_org(db_session)
        real = training_compliance._load_compliance_config
        calls = []

        async def counting(db, org_id):
            calls.append(org_id)
            return await real(db, org_id)

        monkeypatch.setattr(training_compliance, "_load_compliance_config", counting)
        monkeypatch.setattr(training_endpoints, "_load_compliance_config", counting)

        await _roster(db_session, dept.org, dept.today)

        assert len(calls) == 1


# ------------------------------------------------------- competency matrix


class TestCompetencyMatrixFollowsTheProfile:
    async def test_out_of_profile_cell_is_not_applicable(self, db_session):
        # Before: Charlie graded not_started, readiness 1 of 3.
        dept = await _profiled_org(db_session)
        payload = await _competency(db_session, dept.org)
        row = next(m for m in payload["members"] if m["user_id"] == dept.member)

        assert row["statuses"][dept.reqs["Charlie"]]["status"] == "not_applicable"
        assert row["statuses"][dept.reqs["Alpha"]]["status"] == "current"
        assert row["statuses"][dept.reqs["Bravo"]]["status"] == "not_started"
        assert payload["summary"]["readiness_percentage"] == 50.0
        assert payload["summary"]["total_requirements"] == 3


# ------------------------------------------------------------------ exports


class TestComplianceExportsFollowTheProfile:
    async def test_csv_prints_out_of_profile_cell_as_na(self, db_session):
        # Before: "Not Met" for Charlie.
        dept = await _profiled_org(db_session)
        header, rows = await _csv(db_session, dept.org)
        cells = _csv_requirement_cells(header, rows["Mike"])
        assert cells == {"Alpha": "Met", "Bravo": "Not Met", "Charlie": "N/A"}

    async def test_pdf_prints_out_of_profile_cell_as_na(self, db_session, monkeypatch):
        # Before: two "Not Met" cells, the unmet KPI reading 2.
        dept = await _profiled_org(db_session)
        printed: list[list[str]] = []
        real = export_mod._requirement_cells

        def capture(*args, **kwargs):
            cells = real(*args, **kwargs)
            printed.append(cells)
            return cells

        monkeypatch.setattr(export_mod, "_requirement_cells", capture)

        await ReportExportService(db_session).generate_compliance_pdf(dept.org)

        # Columns are ordered by requirement name.
        assert printed == [["Met", "Not Met", "N/A"]]


# ------------------------------------------------------------------ forecast


class TestComplianceForecastFollowsTheProfile:
    async def test_current_figure_and_standing_follow_the_profile(self, db_session):
        # 1 of 2 is 50%, compliant on the profile's bar. Before: 33.3, and no
        # current_standing at all.
        dept = await _profiled_org(db_session)
        row = (await _forecast(db_session, dept.org))[dept.member]
        assert row["current_compliance_percentage"] == 50.0
        assert row["current_standing"] == "compliant"
        assert {r["name"] for r in row["at_risk_requirements"]} <= {"Alpha", "Bravo"}

    async def test_projection_charges_an_unrelated_certificate_to_the_profile(
        self, db_session
    ):
        # The projections still subtract every certificate expiring in the
        # window, whatever grades it, now against the profile's two
        # requirements: 100 - 1/2 = 50. Over all three requirements (Alpha
        # and Bravo met) it read 66.7 - 33.3 = 33.3. Pinned so the figure is
        # a decided one.
        dept = await _profiled_org(db_session)
        await _hours(db_session, dept.org, dept.member, "Bravo", dept.today)
        await _expiring_cert(db_session, dept.org, dept.member, dept.today, 20)

        row = (await _forecast(db_session, dept.org))[dept.member]

        assert row["current_compliance_percentage"] == 100.0
        assert row["forecast_30_days"] == 50.0
        assert len(row["expiring_certifications"]) == 1


class TestDepartmentCutOffReachesExportsAndForecast:
    async def test_include_current_month_off_matches_the_matrix(self, db_session):
        # The department leaves the current month out, so expiry is judged as
        # of the end of last month: a certificate that lapsed this month is
        # still met on the matrix. The exports and forecast graded with the
        # current month in regardless, and read Not Met / 0% beside it.
        org_id, today = await _org(db_session)
        if today.day == 1 or today.month == 1:
            pytest.skip("needs a day of this month, and of this year, before today")
        cert = TrainingRequirement(
            id=_uid(),
            organization_id=org_id,
            name="EMT",
            requirement_type=RequirementType.CERTIFICATION,
            training_type=TrainingType.CERTIFICATION,
            frequency=RequirementFrequency.ONE_TIME,
            due_date_type=DueDateType.CALENDAR_PERIOD,
            applies_to_all=True,
            shift_credited=False,
            active=True,
        )
        db_session.add(cert)
        member = await _member(db_session, org_id, "Mike")
        # Completed inside the exports' default period (this year), so the
        # period-bounded export loads it.
        db_session.add(
            TrainingRecord(
                id=_uid(),
                organization_id=org_id,
                user_id=member,
                course_name="EMT",
                training_type=TrainingType.CERTIFICATION,
                status=TrainingStatus.COMPLETED,
                completion_date=date(today.year, 1, 2),
                expiration_date=today.replace(day=1),
                certification_number="EMT-1",
                hours_completed=0,
            )
        )
        await db_session.flush()
        await _config(db_session, org_id, include_current_month=False)

        row = (await _matrix(db_session, org_id))[member]
        assert row["requirements"][0]["status"] == "completed"
        assert row["completion_pct"] == 100.0

        header, rows = await _csv(db_session, org_id)
        assert _csv_requirement_cells(header, rows["Mike"]) == {"EMT": "Met"}
        forecast = (await _forecast(db_session, org_id))[member]
        assert forecast["current_compliance_percentage"] == 100.0
        assert forecast["current_standing"] == "compliant"


# ------------------------------------------------------ shift compliance


class TestShiftComplianceFollowsTheProfile:
    async def test_member_listed_only_under_profile_requirements(self, db_session):
        # Before: M listed under both shift requirements.
        org_id, _ = await _org(db_session)
        s1 = await _shifts_req(db_session, org_id, "Shifts One")
        s2 = await _shifts_req(db_session, org_id, "Shifts Two")
        member = await _member(db_session, org_id, "Mike")
        config_id = await _config(db_session, org_id)
        await _profile(
            db_session,
            config_id,
            priority=10,
            membership_types=["active"],
            required=[s1],
        )

        report = await _shift_report(db_session, org_id)

        assert member in report[s1]
        assert member not in report[s2]
        assert report[s2] == set()

    async def test_profile_matched_by_position_loads_positions(self, db_session):
        # A profile matching on position ids reads every graded member's
        # positions. Before, both members were listed under both
        # requirements; a fix that reads the profile without loading
        # positions raises MissingGreenlet here, because nothing has loaded
        # them for these members.
        org_id, _ = await _org(db_session)
        s1 = await _shifts_req(db_session, org_id, "Shifts One")
        s2 = await _shifts_req(db_session, org_id, "Shifts Two")
        holder = await _member(db_session, org_id, "Holder")
        other = await _member(db_session, org_id, "Other")
        position = await _position(db_session, org_id, holder)
        config_id = await _config(db_session, org_id)
        await _profile(
            db_session, config_id, priority=20, role_ids=[position], required=[s1]
        )
        await _profile(
            db_session,
            config_id,
            priority=10,
            membership_types=["active"],
            required=[s2],
        )
        db_session.expire_all()

        report = await _shift_report(db_session, org_id)

        assert report[s1] == {holder}
        assert report[s2] == {other}


# ------------------------------------------------------------- agreement


class TestOfficerViewsAgreeWithTheMatrix:
    """Every view against the matrix row, for a profiled and a plain member.

    Hours and shift-credited shifts requirements only: the competency matrix
    keeps its own evaluator, which reads a session-attendance requirement no
    session has been held for as "not_applicable" while the matrix keeps it in
    the row, so its id set is comparable only for these types.
    """

    async def test_every_view_agrees_for_profiled_and_plain_members(self, db_session):
        org_id, today = await _org(db_session)
        reqs = {
            name: await _hours_req(db_session, org_id, name) for name in HOURS_TYPES
        }
        s1 = await _shifts_req(db_session, org_id, "Shifts One")
        profiled = await _member(db_session, org_id, "Profiled")
        plain = await _member(db_session, org_id, "Plain", membership_type="reserve")
        for member in (profiled, plain):
            await _hours(db_session, org_id, member, "Alpha", today)
        await _hours(db_session, org_id, plain, "Bravo", today)
        config_id = await _config(db_session, org_id)
        await _profile(
            db_session,
            config_id,
            priority=10,
            membership_types=["active"],
            required=[reqs["Alpha"], reqs["Charlie"]],
            compliant_override=50,
            at_risk_override=25,
        )
        names = {v: k for k, v in reqs.items()}

        matrix = await _matrix(db_session, org_id)
        roster = await _roster(db_session, org_id, today)
        competency = await _competency(db_session, org_id)
        header, csv_rows = await _csv(db_session, org_id)
        forecast = await _forecast(db_session, org_id)
        shifts = await _shift_report(db_session, org_id)

        assert matrix[profiled]["standing"] == "compliant"
        assert _matrix_ids(matrix[profiled]) == {reqs["Alpha"], reqs["Charlie"]}
        assert _matrix_ids(matrix[plain]) == set(reqs.values()) | {s1}

        for member, last in ((profiled, "Profiled"), (plain, "Plain")):
            row = matrix[member]
            graded = _matrix_ids(row)

            r = roster[member]
            assert (r["requirements_met"], r["requirements_total"]) == (
                row["requirements_met"],
                row["requirements_total"],
            )
            assert r["compliance_status"] == COLOUR[row["standing"]]

            statuses = next(m for m in competency["members"] if m["user_id"] == member)[
                "statuses"
            ]
            assert {
                rid for rid, s in statuses.items() if s["status"] != "not_applicable"
            } == graded

            cells = _csv_requirement_cells(header, csv_rows[last])
            assert {name for name, value in cells.items() if value != "N/A"} == {
                names.get(rid, "Shifts One") for rid in graded
            }

            f = forecast[member]
            assert f["current_compliance_percentage"] == row["completion_pct"]
            assert f["current_standing"] == row["standing"]

            assert (member in shifts[s1]) == (s1 in graded)


class TestUnchangedWithoutProfiles:
    async def test_department_without_compliance_config(self, db_session):
        # Guard: no configuration, so nothing narrows and the defaults grade.
        # Passes before and after.
        org_id, today = await _org(db_session)
        for name in HOURS_TYPES:
            await _hours_req(db_session, org_id, name)
        s1 = await _shifts_req(db_session, org_id, "Shifts One")
        member = await _member(db_session, org_id, "Mike")
        await _hours(db_session, org_id, member, "Alpha", today)

        row = (await _matrix(db_session, org_id))[member]
        roster = (await _roster(db_session, org_id, today))[member]
        header, csv_rows = await _csv(db_session, org_id)
        forecast = (await _forecast(db_session, org_id))[member]
        shifts = await _shift_report(db_session, org_id)

        assert (row["requirements_met"], row["requirements_total"]) == (1, 4)
        assert (roster["requirements_met"], roster["requirements_total"]) == (1, 4)
        assert roster["compliance_status"] == COLOUR[row["standing"]] == "red"
        assert "N/A" not in _csv_requirement_cells(header, csv_rows["Mike"]).values()
        assert forecast["current_compliance_percentage"] == 25.0
        assert member in shifts[s1]
