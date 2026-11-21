"""
The compliance CSV and PDF grade each requirement as the Compliance Matrix
does, as of the department's today; the report period scopes only the hours
and completed-record columns (owner decision 2026-11-21, CLAUDE.md pitfall 29).

The exports used to grade Met / Not Met from the records completed inside the
report period, so a certification earned before 1 January printed "Not Met"
beside a matrix that showed it met, and so did a one-time requirement finished
in an earlier year and a rolling requirement whose window reaches back past
the period's start.

The matrix snapshot at the end pins ``get_compliance_matrix``'s response for a
fixed day, recorded before the matrix moved onto the shared batch grader
(``training_compliance.grade_members``), so that move is proven not to change
what the screen shows.
"""

import csv
import io
import json
import uuid
from datetime import date, timedelta
from typing import Any

import pytest
from sqlalchemy import text

from app.api.v1.endpoints import training as training_endpoints
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.services import training_enhancement_service as export_mod
from app.services.training_enhancement_service import ReportExportService
from app.utils import streamed_query
from tests.test_officer_compliance_views_profiles import (
    _config,
    _csv,
    _csv_requirement_cells,
    _matrix,
    _member,
    _org,
    _profile,
)

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


def _requirement(db, org_id: str, name: str, **fields) -> TrainingRequirement:
    values: dict[str, Any] = {
        "id": _uid(),
        "organization_id": org_id,
        "name": name,
        "due_date_type": DueDateType.CALENDAR_PERIOD,
        "applies_to_all": True,
        "shift_credited": False,
        "active": True,
    }
    values.update(fields)
    req = TrainingRequirement(**values)
    db.add(req)
    return req


def _certification(db, org_id: str, name: str = "EMT") -> TrainingRequirement:
    return _requirement(
        db,
        org_id,
        name,
        requirement_type=RequirementType.CERTIFICATION,
        training_type=TrainingType.CERTIFICATION,
        frequency=RequirementFrequency.ONE_TIME,
    )


def _hours_requirement(
    db, org_id: str, name: str, training_type: TrainingType, **fields
) -> TrainingRequirement:
    fields.setdefault("frequency", RequirementFrequency.ANNUAL)
    fields.setdefault("period_start_month", 1)
    fields.setdefault("period_start_day", 1)
    return _requirement(
        db,
        org_id,
        name,
        requirement_type=RequirementType.HOURS,
        training_type=training_type,
        required_hours=1,
        **fields,
    )


def _record(
    db,
    org_id: str,
    user_id: str,
    on: date,
    training_type: TrainingType,
    *,
    hours: float = 1.0,
    status: TrainingStatus = TrainingStatus.COMPLETED,
    expires: date | None = None,
    course_name: str = "Company Drill",
) -> None:
    db.add(
        TrainingRecord(
            id=_uid(),
            organization_id=org_id,
            user_id=user_id,
            course_name=course_name,
            training_type=training_type,
            status=status,
            completion_date=on if status == TrainingStatus.COMPLETED else None,
            expiration_date=expires,
            certification_number=(
                f"C-{uuid.uuid4().hex[:6]}"
                if training_type == TrainingType.CERTIFICATION
                else None
            ),
            hours_completed=hours,
        )
    )


def _years_ago(today: date, years: int, month: int = 3, day: int = 1) -> date:
    return date(today.year - years, month, day)


async def _pdf_cells(db, org_id: str, monkeypatch, **kwargs) -> list[list[str]]:
    """The requirement cells the PDF prints, one list per member row."""
    printed: list[list[str]] = []
    real = export_mod._requirement_cells

    def capture(*args, **kw):
        cells = real(*args, **kw)
        printed.append(cells)
        return cells

    monkeypatch.setattr(export_mod, "_requirement_cells", capture)
    await ReportExportService(db).generate_compliance_pdf(org_id, **kwargs)
    return printed


async def _csv_rows(db, org_id: str, **kwargs) -> list[list[str]]:
    body = await ReportExportService(db).generate_compliance_csv(org_id, **kwargs)
    return list(csv.reader(io.StringIO(body)))


def _cell_for(status_item: dict | None) -> str:
    """The export's word for a matrix cell, written out rather than imported
    so a wrong mapping in the service fails here."""
    if status_item is None:
        return "N/A"
    status = status_item["status"]
    if status == "completed":
        return "Met"
    if status == "catch_up":
        return f"Due {status_item['catch_up_deadline']}"
    if status == "not_applicable":
        return "No sessions yet"
    return "Not Met"


# ------------------------------------------------- cells graded as of today


class TestRequirementCellsAreTheCurrentStanding:
    async def test_certification_completed_before_the_period_reads_met(
        self, db_session, monkeypatch
    ):
        # Before: "Not Met" in both the CSV and the PDF, because the record
        # predates 1 January and the export loaded only the period's records.
        org_id, today = await _org(db_session)
        _certification(db_session, org_id)
        member = await _member(db_session, org_id, "Mike")
        _record(
            db_session,
            org_id,
            member,
            _years_ago(today, 1),
            TrainingType.CERTIFICATION,
            hours=0,
            expires=date(today.year + 1, 6, 1),
            course_name="EMT",
        )
        await db_session.flush()

        header, rows = await _csv(db_session, org_id)
        assert _csv_requirement_cells(header, rows["Mike"]) == {"EMT": "Met"}
        assert await _pdf_cells(db_session, org_id, monkeypatch) == [["Met"]]

    async def test_one_time_requirement_completed_in_an_earlier_year_reads_met(
        self, db_session
    ):
        org_id, today = await _org(db_session)
        _hours_requirement(
            db_session,
            org_id,
            "Orientation",
            TrainingType.ORIENTATION,
            frequency=RequirementFrequency.ONE_TIME,
        )
        member = await _member(db_session, org_id, "Mike")
        _record(
            db_session, org_id, member, _years_ago(today, 2), TrainingType.ORIENTATION
        )
        await db_session.flush()

        header, rows = await _csv(db_session, org_id)
        assert _csv_requirement_cells(header, rows["Mike"]) == {"Orientation": "Met"}

    async def test_rolling_window_reaching_back_past_the_period_reads_met(
        self, db_session
    ):
        # Fifteen months ago is always before 1 January of this year, and
        # inside a 24-month rolling window.
        org_id, today = await _org(db_session)
        _hours_requirement(
            db_session,
            org_id,
            "Rolling",
            TrainingType.CONTINUING_EDUCATION,
            due_date_type=DueDateType.ROLLING,
            rolling_period_months=24,
        )
        member = await _member(db_session, org_id, "Mike")
        _record(
            db_session,
            org_id,
            member,
            today - timedelta(days=455),
            TrainingType.CONTINUING_EDUCATION,
        )
        await db_session.flush()

        header, rows = await _csv(db_session, org_id)
        assert _csv_requirement_cells(header, rows["Mike"]) == {"Rolling": "Met"}

    async def test_a_past_period_still_grades_as_of_today(self, db_session):
        # An annual requirement met today; the export asked for last calendar
        # year. The cell is the current standing, so Met.
        org_id, today = await _org(db_session)
        _hours_requirement(
            db_session, org_id, "Annual", TrainingType.CONTINUING_EDUCATION
        )
        member = await _member(db_session, org_id, "Mike")
        _record(db_session, org_id, member, today, TrainingType.CONTINUING_EDUCATION)
        await db_session.flush()

        rows = await _csv_rows(
            db_session,
            org_id,
            start_date=date(today.year - 1, 1, 1),
            end_date=date(today.year - 1, 12, 31),
        )
        header, row = rows[0], rows[1]
        assert _csv_requirement_cells(header, row) == {"Annual": "Met"}


class TestExportCellsAgreeWithTheMatrix:
    async def test_every_cell_matches_the_matrix_row(self, db_session, monkeypatch):
        org_id, today = await _org(db_session)
        reqs = {
            "Cert": _certification(db_session, org_id, "Cert"),
            "OneTime": _hours_requirement(
                db_session,
                org_id,
                "OneTime",
                TrainingType.ORIENTATION,
                frequency=RequirementFrequency.ONE_TIME,
            ),
            "Rolling": _hours_requirement(
                db_session,
                org_id,
                "Rolling",
                TrainingType.CONTINUING_EDUCATION,
                due_date_type=DueDateType.ROLLING,
                rolling_period_months=24,
            ),
            "Annual": _hours_requirement(
                db_session, org_id, "Annual", TrainingType.SKILLS_PRACTICE
            ),
            "Sessions": _requirement(
                db_session,
                org_id,
                "Sessions",
                requirement_type=RequirementType.SESSION_ATTENDANCE,
                frequency=RequirementFrequency.ANNUAL,
                period_start_month=1,
                period_start_day=1,
            ),
            "CatchUp": _hours_requirement(
                db_session,
                org_id,
                "CatchUp",
                TrainingType.REFRESHER,
                new_member_cutoff_date=today + timedelta(days=1),
                existing_member_deadline=today + timedelta(days=60),
            ),
            "Skills": _requirement(
                db_session,
                org_id,
                "Skills",
                requirement_type=RequirementType.SKILLS_EVALUATION,
                training_type=TrainingType.SKILLS_PRACTICE,
                frequency=RequirementFrequency.ONE_TIME,
            ),
            "Outside": _hours_requirement(
                db_session, org_id, "Outside", TrainingType.CERTIFICATION
            ),
        }
        profiled = await _member(db_session, org_id, "Profiled")
        plain = await _member(db_session, org_id, "Plain", membership_type="reserve")
        idle = await _member(db_session, org_id, "Idle", membership_type="reserve")
        for member in (profiled, plain):
            _record(
                db_session,
                org_id,
                member,
                _years_ago(today, 1),
                TrainingType.CERTIFICATION,
                hours=0,
                expires=date(today.year + 1, 6, 1),
                course_name="Cert",
            )
            _record(
                db_session,
                org_id,
                member,
                _years_ago(today, 2),
                TrainingType.ORIENTATION,
            )
            _record(
                db_session,
                org_id,
                member,
                today - timedelta(days=455),
                TrainingType.CONTINUING_EDUCATION,
            )
        # A fallback type with only an in-progress record: unmet on both.
        _record(
            db_session,
            org_id,
            plain,
            today,
            TrainingType.SKILLS_PRACTICE,
            status=TrainingStatus.IN_PROGRESS,
        )
        await db_session.flush()
        config_id = await _config(db_session, org_id)
        await _profile(
            db_session,
            config_id,
            priority=10,
            membership_types=["active"],
            required=[r.id for name, r in reqs.items() if name != "Outside"],
        )

        matrix = await _matrix(db_session, org_id)
        header, csv_rows = await _csv(db_session, org_id)
        pdf = await _pdf_cells(db_session, org_id, monkeypatch)
        names = sorted(reqs)

        # The PDF prints members by last name: Idle, Plain, Profiled.
        members = [("Idle", idle), ("Plain", plain), ("Profiled", profiled)]
        assert len(pdf) == len(members)
        for (last, member), pdf_cells in zip(members, pdf):
            by_id = {
                str(c["requirement_id"]): c for c in matrix[member]["requirements"]
            }
            expected = {
                name: _cell_for(by_id.get(str(reqs[name].id))) for name in names
            }
            assert _csv_requirement_cells(header, csv_rows[last]) == expected
            assert pdf_cells == [expected[name] for name in names]

        # The fixture reaches every word the export can print.
        printed = {cell for cells in pdf for cell in cells}
        assert {"Met", "Not Met", "N/A", "No sessions yet"} <= printed
        assert any(cell.startswith("Due ") for cell in printed)
        # And the records before the period are what make the difference.
        assert expected_met(matrix[profiled], reqs) >= 3


def expected_met(row: dict, reqs: dict) -> int:
    ids = {str(reqs[n].id) for n in ("Cert", "OneTime", "Rolling")}
    return sum(
        1
        for c in row["requirements"]
        if str(c["requirement_id"]) in ids and c["status"] == "completed"
    )


# ------------------------------------------------ what the period controls


class TestPeriodScopesOnlyHoursAndRecords:
    async def test_period_columns_carry_the_dates_and_count_only_the_period(
        self, db_session
    ):
        # Guard on the values, which were already period-scoped; red before
        # the change only because the headers now carry the period.
        org_id, today = await _org(db_session)
        _hours_requirement(
            db_session, org_id, "Annual", TrainingType.CONTINUING_EDUCATION
        )
        member = await _member(db_session, org_id, "Mike")
        start = date(today.year, 1, 1)
        _record(
            db_session,
            org_id,
            member,
            start - timedelta(days=1),
            TrainingType.CONTINUING_EDUCATION,
            hours=5,
        )
        _record(
            db_session,
            org_id,
            member,
            start,
            TrainingType.CONTINUING_EDUCATION,
            hours=2.5,
        )
        await db_session.flush()

        rows = await _csv_rows(db_session, org_id)
        header, row = rows[0], rows[1]
        period = f"{start.isoformat()} to {today.isoformat()}"
        assert header[:4] == [
            "Member Name",
            "Email",
            f"Total Hours ({period})",
            f"Completed Records ({period})",
        ]
        assert row[2:4] == ["2.5", "1"]

    async def test_csv_with_no_active_requirements_still_lists_members(
        self, db_session
    ):
        # Guard: green before and after.
        org_id, today = await _org(db_session)
        for last in ("Able", "Baker"):
            member = await _member(db_session, org_id, last)
            _record(
                db_session, org_id, member, today, TrainingType.CONTINUING_EDUCATION
            )
        await db_session.flush()

        rows = await _csv_rows(db_session, org_id)
        assert len(rows) == 3
        assert all(len(r) == 4 for r in rows)
        assert [r[2] for r in rows[1:]] == ["1.0", "1.0"]


# ---------------------------------------------------------------- ordering


class TestCsvOrdering:
    async def test_requirement_columns_are_ordered_by_name(self, db_session):
        org_id, _ = await _org(db_session)
        _hours_requirement(
            db_session,
            org_id,
            "Zulu",
            TrainingType.CONTINUING_EDUCATION,
            id="00000000-0000-0000-0000-" + uuid.uuid4().hex[:12],
        )
        _hours_requirement(
            db_session,
            org_id,
            "Alpha",
            TrainingType.SKILLS_PRACTICE,
            id="ffffffff-ffff-ffff-ffff-" + uuid.uuid4().hex[:12],
        )
        await _member(db_session, org_id, "Mike")
        await db_session.flush()

        header = (await _csv_rows(db_session, org_id))[0]
        assert header[4:] == ["Alpha (Status)", "Zulu (Status)"]

    async def test_member_rows_are_ordered_by_last_name(self, db_session):
        org_id, _ = await _org(db_session)
        # Ids sort against name order, so an unordered read by primary key
        # comes back Zimmer first.
        for last, prefix in (("Zimmer", "00000000"), ("Adams", "ffffffff")):
            user_id = f"{prefix}-0000-0000-0000-{uuid.uuid4().hex[:12]}"
            await db_session.execute(
                text(
                    "INSERT INTO users (id, organization_id, username, first_name, "
                    "last_name, email, password_hash, status, membership_type, "
                    "compliance_exempt) VALUES (:id, :org, :un, 'Test', :ln, :em, "
                    "'x', 'active', 'active', 0)"
                ),
                {
                    "id": user_id,
                    "org": org_id,
                    "un": f"u-{user_id[-12:]}",
                    "ln": last,
                    "em": f"u-{user_id[-12:]}@order.test",
                },
            )
        await db_session.flush()

        rows = await _csv_rows(db_session, org_id)
        assert [r[0] for r in rows[1:]] == ["Test Adams", "Test Zimmer"]


# ---------------------------------------------------------------- batching


class TestCsvGradesInBatches:
    @pytest.mark.parametrize(("size", "chunks"), [(2, 4), (5, 2)])
    async def test_one_chunk_per_batch(self, db_session, monkeypatch, size, chunks):
        # The batch size is read from streamed_query when the export runs, so
        # the patch takes effect; size 5 proves it is not bound at import.
        monkeypatch.setattr(streamed_query, "EXPORT_BATCH_SIZE", size)
        org_id, today = await _org(db_session)
        _hours_requirement(
            db_session, org_id, "Annual", TrainingType.CONTINUING_EDUCATION
        )
        lasts = ["Able", "Baker", "Charlie", "Delta", "Echo"]
        for index, last in enumerate(lasts):
            member = await _member(db_session, org_id, last)
            if index % 2 == 0:
                _record(
                    db_session, org_id, member, today, TrainingType.CONTINUING_EDUCATION
                )
        await db_session.flush()

        stream = await ReportExportService(db_session).stream_compliance_csv(org_id)
        parts = [part async for part in stream]

        assert len(parts) == chunks
        rows = list(csv.reader(io.StringIO("".join(parts))))
        assert [(r[0], r[4]) for r in rows[1:]] == [
            ("Test Able", "Met"),
            ("Test Baker", "Not Met"),
            ("Test Charlie", "Met"),
            ("Test Delta", "Not Met"),
            ("Test Echo", "Met"),
        ]


# --------------------------------------------------------------------- PDF


class TestPdfSaysWhatThePeriodControls:
    async def test_header_and_kpi_labels(self, db_session):
        from pypdf import PdfReader

        org_id, today = await _org(db_session)
        _hours_requirement(
            db_session, org_id, "Annual", TrainingType.CONTINUING_EDUCATION
        )
        await _member(db_session, org_id, "Mike")
        await db_session.flush()

        buf = await ReportExportService(db_session).generate_compliance_pdf(org_id)
        content = " ".join(page.extract_text() or "" for page in PdfReader(buf).pages)
        flat = " ".join(content.split())

        assert f"Status graded as of: {today}" in flat
        assert f"Hours and records: {date(today.year, 1, 1)} to {today}" in flat
        assert "Training hours in period" in flat
        assert "Period:" not in flat


# --------------------------------------------------------- matrix snapshot


SNAPSHOT_TODAY = date(2026, 6, 15)

# get_compliance_matrix's response for the fixture below on SNAPSHOT_TODAY,
# recorded from the matrix's own loop before it moved onto grade_members.
# Requirement and member ids are replaced by their names.
MATRIX_SNAPSHOT: dict[str, Any] = {
    "as_of": "2026-06-15",
    "members": [
        {
            "completion_pct": 100.0,
            "member_class": "operational",
            "member_name": "Adams, Test",
            "membership_type": "active",
            "requirements": [
                {
                    "as_of": "2026-06-15",
                    "base_required": None,
                    "catch_up_deadline": None,
                    "completion_date": "2025-03-01",
                    "expiry_date": "2027-06-01",
                    "leave_months": 0,
                    "monthly_average": None,
                    "monthly_needed": None,
                    "overridden": False,
                    "progress_current": None,
                    "progress_required": None,
                    "progress_unit": None,
                    "requirement_id": "Cert",
                    "requirement_name": "Cert",
                    "status": "completed",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": None,
                    "window_start": None,
                },
                {
                    "as_of": "2026-06-15",
                    "base_required": 1.0,
                    "catch_up_deadline": None,
                    "completion_date": "2026-02-03",
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": 0.17,
                    "monthly_needed": 0.08,
                    "overridden": False,
                    "progress_current": 1.0,
                    "progress_required": 1.0,
                    "progress_unit": "hours",
                    "requirement_id": "Annual",
                    "requirement_name": "Annual",
                    "status": "completed",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": "2026-12-31",
                    "window_start": "2026-01-01",
                },
                {
                    "as_of": "2026-06-15",
                    "base_required": 1.0,
                    "catch_up_deadline": None,
                    "completion_date": "2025-03-10",
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": 0.12,
                    "monthly_needed": 0.04,
                    "overridden": False,
                    "progress_current": 3.0,
                    "progress_required": 1.0,
                    "progress_unit": "hours",
                    "requirement_id": "Rolling",
                    "requirement_name": "Rolling",
                    "status": "completed",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": "2026-06-15",
                    "window_start": "2024-07-01",
                },
                {
                    "as_of": "2026-06-15",
                    "base_required": 1.0,
                    "catch_up_deadline": "2026-09-30",
                    "completion_date": None,
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": 0.0,
                    "monthly_needed": 0.08,
                    "overridden": False,
                    "progress_current": 0.0,
                    "progress_required": 1.0,
                    "progress_unit": "hours",
                    "requirement_id": "CatchUp",
                    "requirement_name": "CatchUp",
                    "status": "catch_up",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": "2026-12-31",
                    "window_start": "2026-01-01",
                },
                {
                    "as_of": "2026-06-15",
                    "base_required": 0.0,
                    "catch_up_deadline": None,
                    "completion_date": None,
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": None,
                    "monthly_needed": None,
                    "overridden": False,
                    "progress_current": 0.0,
                    "progress_required": 0.0,
                    "progress_unit": "sessions",
                    "requirement_id": "Sessions",
                    "requirement_name": "Sessions",
                    "status": "not_applicable",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": "2026-12-31",
                    "window_start": "2026-01-01",
                },
            ],
            "requirements_met": 3,
            "requirements_total": 3,
            "standing": "compliant",
            "user_id": "Adams",
        },
        {
            "completion_pct": 50.0,
            "member_class": None,
            "member_name": "Baker, Test",
            "membership_type": "reserve",
            "requirements": [
                {
                    "as_of": "2026-06-15",
                    "base_required": 1.0,
                    "catch_up_deadline": None,
                    "completion_date": None,
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": 0.0,
                    "monthly_needed": 0.08,
                    "overridden": False,
                    "progress_current": 0.0,
                    "progress_required": 1.0,
                    "progress_unit": "hours",
                    "requirement_id": "Annual",
                    "requirement_name": "Annual",
                    "status": "not_started",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": "2026-12-31",
                    "window_start": "2026-01-01",
                },
                {
                    "as_of": "2026-06-15",
                    "base_required": 1.0,
                    "catch_up_deadline": "2026-09-30",
                    "completion_date": None,
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": 0.0,
                    "monthly_needed": 0.08,
                    "overridden": False,
                    "progress_current": 0.0,
                    "progress_required": 1.0,
                    "progress_unit": "hours",
                    "requirement_id": "CatchUp",
                    "requirement_name": "CatchUp",
                    "status": "catch_up",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": "2026-12-31",
                    "window_start": "2026-01-01",
                },
                {
                    "as_of": "2026-06-15",
                    "base_required": None,
                    "catch_up_deadline": None,
                    "completion_date": "2025-03-01",
                    "expiry_date": "2027-06-01",
                    "leave_months": 0,
                    "monthly_average": None,
                    "monthly_needed": None,
                    "overridden": False,
                    "progress_current": None,
                    "progress_required": None,
                    "progress_unit": None,
                    "requirement_id": "Cert",
                    "requirement_name": "Cert",
                    "status": "completed",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": None,
                    "window_start": None,
                },
                {
                    "as_of": "2026-06-15",
                    "base_required": 1.0,
                    "catch_up_deadline": None,
                    "completion_date": None,
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": 0.0,
                    "monthly_needed": 0.08,
                    "overridden": False,
                    "progress_current": 0.0,
                    "progress_required": 1.0,
                    "progress_unit": "hours",
                    "requirement_id": "Outside",
                    "requirement_name": "Outside",
                    "status": "not_started",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": "2026-12-31",
                    "window_start": "2026-01-01",
                },
                {
                    "as_of": "2026-06-15",
                    "base_required": 1.0,
                    "catch_up_deadline": None,
                    "completion_date": "2025-03-10",
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": 0.12,
                    "monthly_needed": 0.04,
                    "overridden": False,
                    "progress_current": 3.0,
                    "progress_required": 1.0,
                    "progress_unit": "hours",
                    "requirement_id": "Rolling",
                    "requirement_name": "Rolling",
                    "status": "completed",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": "2026-06-15",
                    "window_start": "2024-07-01",
                },
                {
                    "as_of": "2026-06-15",
                    "base_required": 0.0,
                    "catch_up_deadline": None,
                    "completion_date": None,
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": None,
                    "monthly_needed": None,
                    "overridden": False,
                    "progress_current": 0.0,
                    "progress_required": 0.0,
                    "progress_unit": "sessions",
                    "requirement_id": "Sessions",
                    "requirement_name": "Sessions",
                    "status": "not_applicable",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": "2026-12-31",
                    "window_start": "2026-01-01",
                },
            ],
            "requirements_met": 2,
            "requirements_total": 4,
            "standing": "at_risk",
            "user_id": "Baker",
        },
        {
            "completion_pct": 0.0,
            "member_class": None,
            "member_name": "Clark, Test",
            "membership_type": "reserve",
            "requirements": [
                {
                    "as_of": "2026-06-15",
                    "base_required": 1.0,
                    "catch_up_deadline": None,
                    "completion_date": "2026-04-20",
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": 0.08,
                    "monthly_needed": 0.08,
                    "overridden": False,
                    "progress_current": 0.5,
                    "progress_required": 1.0,
                    "progress_unit": "hours",
                    "requirement_id": "Annual",
                    "requirement_name": "Annual",
                    "status": "in_progress",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": "2026-12-31",
                    "window_start": "2026-01-01",
                },
                {
                    "as_of": "2026-06-15",
                    "base_required": 1.0,
                    "catch_up_deadline": "2026-09-30",
                    "completion_date": None,
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": 0.0,
                    "monthly_needed": 0.08,
                    "overridden": False,
                    "progress_current": 0.0,
                    "progress_required": 1.0,
                    "progress_unit": "hours",
                    "requirement_id": "CatchUp",
                    "requirement_name": "CatchUp",
                    "status": "catch_up",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": "2026-12-31",
                    "window_start": "2026-01-01",
                },
                {
                    "as_of": "2026-06-15",
                    "base_required": None,
                    "catch_up_deadline": None,
                    "completion_date": None,
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": None,
                    "monthly_needed": None,
                    "overridden": False,
                    "progress_current": None,
                    "progress_required": None,
                    "progress_unit": None,
                    "requirement_id": "Cert",
                    "requirement_name": "Cert",
                    "status": "not_started",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": None,
                    "window_start": None,
                },
                {
                    "as_of": "2026-06-15",
                    "base_required": 1.0,
                    "catch_up_deadline": None,
                    "completion_date": None,
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": 0.0,
                    "monthly_needed": 0.08,
                    "overridden": False,
                    "progress_current": 0.0,
                    "progress_required": 1.0,
                    "progress_unit": "hours",
                    "requirement_id": "Outside",
                    "requirement_name": "Outside",
                    "status": "not_started",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": "2026-12-31",
                    "window_start": "2026-01-01",
                },
                {
                    "as_of": "2026-06-15",
                    "base_required": 1.0,
                    "catch_up_deadline": None,
                    "completion_date": None,
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": 0.0,
                    "monthly_needed": 0.04,
                    "overridden": False,
                    "progress_current": 0.0,
                    "progress_required": 1.0,
                    "progress_unit": "hours",
                    "requirement_id": "Rolling",
                    "requirement_name": "Rolling",
                    "status": "not_started",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": "2026-06-15",
                    "window_start": "2024-07-01",
                },
                {
                    "as_of": "2026-06-15",
                    "base_required": 0.0,
                    "catch_up_deadline": None,
                    "completion_date": None,
                    "expiry_date": None,
                    "leave_months": 0,
                    "monthly_average": None,
                    "monthly_needed": None,
                    "overridden": False,
                    "progress_current": 0.0,
                    "progress_required": 0.0,
                    "progress_unit": "sessions",
                    "requirement_id": "Sessions",
                    "requirement_name": "Sessions",
                    "status": "not_applicable",
                    "waived_months": 0,
                    "waiver_months": 0,
                    "window_end": "2026-12-31",
                    "window_start": "2026-01-01",
                },
            ],
            "requirements_met": 0,
            "requirements_total": 4,
            "standing": "non_compliant",
            "user_id": "Clark",
        },
    ],
    "requirements": [
        {
            "can_override": False,
            "frequency": "annual",
            "id": "Annual",
            "name": "Annual",
            "requirement_type": "hours",
            "target": 1.0,
            "target_unit": "hours",
        },
        {
            "can_override": False,
            "frequency": "annual",
            "id": "CatchUp",
            "name": "CatchUp",
            "requirement_type": "hours",
            "target": 1.0,
            "target_unit": "hours",
        },
        {
            "can_override": False,
            "frequency": "one_time",
            "id": "Cert",
            "name": "Cert",
            "requirement_type": "certification",
            "target": None,
            "target_unit": None,
        },
        {
            "can_override": False,
            "frequency": "annual",
            "id": "Outside",
            "name": "Outside",
            "requirement_type": "hours",
            "target": 1.0,
            "target_unit": "hours",
        },
        {
            "can_override": False,
            "frequency": "annual",
            "id": "Rolling",
            "name": "Rolling",
            "requirement_type": "hours",
            "target": 1.0,
            "target_unit": "hours",
        },
        {
            "can_override": False,
            "frequency": "annual",
            "id": "Sessions",
            "name": "Sessions",
            "requirement_type": "session_attendance",
            "target": None,
            "target_unit": "percent_of_sessions",
        },
    ],
    "threshold_type": "percentage",
}


async def _snapshot_fixture(db) -> tuple[str, dict[str, str], dict[str, str]]:
    org_id, _ = await _org(db)
    reqs = {
        "Cert": _certification(db, org_id, "Cert"),
        "Annual": _hours_requirement(
            db, org_id, "Annual", TrainingType.CONTINUING_EDUCATION
        ),
        "Rolling": _hours_requirement(
            db,
            org_id,
            "Rolling",
            TrainingType.SKILLS_PRACTICE,
            due_date_type=DueDateType.ROLLING,
            rolling_period_months=24,
        ),
        "CatchUp": _hours_requirement(
            db,
            org_id,
            "CatchUp",
            TrainingType.REFRESHER,
            new_member_cutoff_date=date(2026, 7, 1),
            existing_member_deadline=date(2026, 9, 30),
        ),
        "Sessions": _requirement(
            db,
            org_id,
            "Sessions",
            requirement_type=RequirementType.SESSION_ATTENDANCE,
            frequency=RequirementFrequency.ANNUAL,
            period_start_month=1,
            period_start_day=1,
        ),
        "Outside": _hours_requirement(db, org_id, "Outside", TrainingType.ORIENTATION),
    }
    members: dict[str, str] = {}
    for last, membership in (
        ("Adams", "active"),
        ("Baker", "reserve"),
        ("Clark", "reserve"),
    ):
        user_id = _uid()
        await db.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status, membership_type, "
                "compliance_exempt, hire_date) VALUES (:id, :org, :un, 'Test', "
                ":ln, :em, 'x', 'active', :mt, 0, '2010-01-01')"
            ),
            {
                "id": user_id,
                "org": org_id,
                "un": f"u-{user_id[:8]}",
                "ln": last,
                "em": f"u-{user_id[:8]}@snap.test",
                "mt": membership,
            },
        )
        members[last] = user_id
    for last in ("Adams", "Baker"):
        _record(
            db,
            org_id,
            members[last],
            date(2025, 3, 1),
            TrainingType.CERTIFICATION,
            hours=0,
            expires=date(2027, 6, 1),
            course_name="Cert",
        )
        _record(
            db,
            org_id,
            members[last],
            date(2025, 3, 10),
            TrainingType.SKILLS_PRACTICE,
            hours=3,
        )
    _record(
        db,
        org_id,
        members["Adams"],
        date(2026, 2, 3),
        TrainingType.CONTINUING_EDUCATION,
    )
    _record(
        db,
        org_id,
        members["Clark"],
        date(2026, 4, 20),
        TrainingType.CONTINUING_EDUCATION,
        hours=0.5,
    )
    await db.flush()
    config_id = await _config(db, org_id, compliant=90, at_risk=50)
    await _profile(
        db,
        config_id,
        priority=10,
        membership_types=["active"],
        required=[r.id for n, r in reqs.items() if n != "Outside"],
        compliant_override=60,
        at_risk_override=40,
    )
    return (
        org_id,
        {str(r.id): n for n, r in reqs.items()},
        {v: k for k, v in members.items()},
    )


def _named(payload: dict, req_names: dict, member_names: dict) -> dict:
    """The response without ``generated_at``, as JSON, ids replaced by names."""
    names = {**req_names, **member_names}
    body = {k: v for k, v in payload.items() if k != "generated_at"}

    def rename(value):
        if isinstance(value, dict):
            return {k: rename(v) for k, v in value.items()}
        if isinstance(value, list):
            return [rename(v) for v in value]
        if isinstance(value, str):
            return names.get(value, value)
        return value

    return rename(json.loads(json.dumps(body, default=str)))


class TestMatrixResponseUnchanged:
    async def test_matrix_snapshot(self, db_session, monkeypatch):
        async def fixed_today(_db, _org_id):
            return SNAPSHOT_TODAY

        monkeypatch.setattr(training_endpoints, "resolve_org_today", fixed_today)
        org_id, req_names, member_names = await _snapshot_fixture(db_session)

        payload = await training_endpoints.get_compliance_matrix(
            db=db_session,
            current_user=training_endpoints.User(id=_uid(), organization_id=org_id),
        )

        assert _named(payload, req_names, member_names) == MATRIX_SNAPSHOT


# ---------------------------------------------------------------- forecast


class TestForecastQueriesDoNotGrowWithMembers:
    async def _statements(self, db, org_id: str) -> int:
        from sqlalchemy import event

        engine = db.bind.sync_engine if hasattr(db.bind, "sync_engine") else db.bind
        count = 0

        def tally(*_args, **_kwargs):
            nonlocal count
            count += 1

        event.listen(engine, "before_cursor_execute", tally)
        try:
            await ReportExportService(db).generate_compliance_forecast(org_id)
        finally:
            event.remove(engine, "before_cursor_execute", tally)
        return count

    async def test_one_record_query_per_batch_not_per_member(self, db_session):
        # Before: one training-record query per member, so six members cost
        # four more statements than two.
        counts = []
        for size in (2, 6):
            org_id, today = await _org(db_session)
            _hours_requirement(
                db_session, org_id, "Annual", TrainingType.CONTINUING_EDUCATION
            )
            for index in range(size):
                member = await _member(db_session, org_id, f"M{index}")
                _record(
                    db_session, org_id, member, today, TrainingType.CONTINUING_EDUCATION
                )
            await db_session.flush()
            counts.append(await self._statements(db_session, org_id))

        assert counts[0] == counts[1]
