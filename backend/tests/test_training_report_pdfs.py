"""Training report PDFs print every requirement, every course name in full,
a header on every page, and one continuously numbered bundle.

The compliance report used to be drawn with raw canvas calls: requirement
columns past the right margin were silently dropped, names were cut to ten
characters, the header was drawn on page one only, and there were no page
numbers. The all-member bundle was separate PDFs stitched together, so each
member restarted at "page 1" and the reader's sidebar was empty.
"""

import uuid
from datetime import date
from io import BytesIO

import pytest
from pypdf import PdfReader
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.services.training_enhancement_service import ReportExportService

pytestmark = [pytest.mark.integration]

START = date(2026, 1, 1)
END = date(2026, 6, 30)
LONG_COURSE = "Hazardous Materials Operations Refresher — Module 4: Decontamination"


def _uid() -> str:
    return str(uuid.uuid4())


async def _department(db: AsyncSession, members: int = 2, requirements: int = 9):
    org = Organization(
        id=_uid(),
        name="Oakville FD",
        slug=f"oak-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    users = []
    for index in range(members):
        handle = uuid.uuid4().hex[:10]
        user = User(
            id=_uid(),
            organization_id=org.id,
            username=f"m{index}-{handle}",
            email=f"{handle}@oak.test",
            first_name=f"Member{index:02d}",
            last_name="O'Neill",
            password_hash="x",
            status=UserStatus.ACTIVE,
        )
        db.add(user)
        users.append(user)
    await db.flush()
    for index in range(requirements):
        db.add(
            TrainingRequirement(
                id=_uid(),
                organization_id=org.id,
                name=f"Requirement number {index + 1:02d} annual hours",
                requirement_type=RequirementType.HOURS,
                required_hours=1.0,
                frequency=RequirementFrequency.ANNUAL,
                due_date_type=DueDateType.CALENDAR_PERIOD,
                applies_to_all=True,
                active=True,
            )
        )
    for user in users:
        for _ in range(3):
            db.add(
                TrainingRecord(
                    id=_uid(),
                    organization_id=org.id,
                    user_id=user.id,
                    course_name=LONG_COURSE,
                    training_type=TrainingType.CONTINUING_EDUCATION,
                    status=TrainingStatus.COMPLETED,
                    completion_date=date(2026, 3, 1),
                    hours_completed=2.0,
                    certification_number="NFPA-1072-OPS-000123456",
                )
            )
    await db.flush()
    return org, users


def _reader(buf) -> PdfReader:
    return PdfReader(BytesIO(buf.getvalue()))


def _pages(reader: PdfReader) -> list[str]:
    return [" ".join((p.extract_text() or "").split()) for p in reader.pages]


async def test_compliance_report_prints_every_requirement(db_session: AsyncSession):
    org, _ = await _department(db_session, members=2, requirements=9)
    buf = await ReportExportService(db_session).generate_compliance_pdf(
        org.id, start_date=START, end_date=END, generated_by="Chief Ames"
    )
    text = " ".join(_pages(_reader(buf)))
    for index in range(9):
        assert f"Requirement number {index + 1:02d} annual hours" in text
    assert "Requirements 1–" in text
    assert "of 9" in text
    assert "Member00 O'Neill" in text
    assert "Generated:" in text
    assert "by Chief Ames" in text


async def test_compliance_report_header_repeats_and_pages_are_numbered(
    db_session: AsyncSession,
):
    org, _ = await _department(db_session, members=45, requirements=2)
    pages = _pages(
        _reader(
            await ReportExportService(db_session).generate_compliance_pdf(
                org.id, start_date=START, end_date=END
            )
        )
    )
    assert len(pages) >= 2
    for number, text in enumerate(pages, start=1):
        assert "Member Hours Records" in text
        assert f"Page {number} of {len(pages)}" in text


async def test_individual_report_prints_course_and_certificate_in_full(
    db_session: AsyncSession,
):
    org, users = await _department(db_session, members=1, requirements=0)
    reader = _reader(
        await ReportExportService(db_session).generate_individual_pdf(
            users[0].id, org.id, start_date=START, end_date=END
        )
    )
    text = " ".join(_pages(reader))
    assert LONG_COURSE in text
    assert "NFPA-1072-OPS-000123456" in text
    assert "Member: Member00 O'Neill" in text
    assert reader.metadata is not None
    assert reader.metadata.title == "Individual Training Report"


async def test_individual_report_can_leave_out_certificates(db_session: AsyncSession):
    org, users = await _department(db_session, members=1, requirements=0)
    text = " ".join(
        _pages(
            _reader(
                await ReportExportService(db_session).generate_individual_pdf(
                    users[0].id, org.id, include_certifications=False
                )
            )
        )
    )
    assert "NFPA-1072-OPS-000123456" not in text
    assert "Cert #" not in text


async def test_bulk_records_are_one_numbered_document_with_an_outline(
    db_session: AsyncSession,
):
    org, users = await _department(db_session, members=3, requirements=0)
    reader = _reader(
        await ReportExportService(db_session).generate_bulk_pdf(
            org.id, start_date=START, end_date=END
        )
    )
    pages = _pages(reader)
    assert len(pages) == 3
    for number, text in enumerate(pages, start=1):
        assert f"Page {number} of 3" in text
    assert [entry.title for entry in reader.outline] == [
        f"Member{i:02d} O'Neill" for i in range(3)
    ]


async def test_bulk_records_with_nothing_in_the_window_is_still_a_pdf(
    db_session: AsyncSession,
):
    org, _ = await _department(db_session, members=1, requirements=0)
    pages = _pages(
        _reader(
            await ReportExportService(db_session).generate_bulk_pdf(
                org.id, start_date=date(2020, 1, 1), end_date=date(2020, 12, 31)
            )
        )
    )
    assert "No training records found for this period." in pages[0]
