"""
Personal Data Export Service (data portability)

Builds a complete, machine-readable export of everything the system stores
about one member — the "download my data" right under privacy frameworks
(ISO/IEC 27701, HIPAA right of access for the medical-screening section,
GDPR-style portability). The export is self-service and self-scoped: a
member can only ever export their own records.

Section list is driven by _EXPORT_SECTIONS below; when a new model storing
member personal data is added, add a row there (and to the anonymization
service) — docs/COMPLIANCE.md tracks this obligation.
"""

import enum
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin_hours import AdminHoursEntry
from app.models.audit import AuditLog
from app.models.event import EventRSVP
from app.models.finance import MemberDues
from app.models.inventory import (
    CheckOutRecord,
    DepartureClearance,
    ItemAssignment,
    ItemIssuance,
    MemberSizePreferences,
)
from app.models.medical_screening import ScreeningRecord
from app.models.meeting import MeetingAttendee
from app.models.skills_testing import SkillTest
from app.models.training import (
    InstructorQualification,
    MemberCompetency,
    ProgramEnrollment,
    ShiftAssignment,
    ShiftAttendance,
    ShiftCompletionReport,
    ShiftTimeOff,
    TrainingRecord,
    TrainingSubmission,
    TrainingWaiver,
)
from app.models.user import MemberLeaveOfAbsence, User

# Never exported, regardless of model: credentials, second factors, and
# unguessable tokens are security material, not personal data the subject
# needs back.
_EXCLUDED_COLUMNS = frozenset(
    {
        "password_hash",
        "mfa_secret",
        "mfa_backup_codes",
        "mfa_last_timestep",
        "password_reset_token",
        "password_reset_expires_at",
        "calendar_feed_token",
        "oauth_subject",
    }
)

# (section name, model, FK attribute pointing at the member)
_EXPORT_SECTIONS: list[tuple[str, type, str]] = [
    ("training_records", TrainingRecord, "user_id"),
    ("program_enrollments", ProgramEnrollment, "user_id"),
    ("training_submissions", TrainingSubmission, "submitted_by"),
    ("training_waivers", TrainingWaiver, "user_id"),
    ("competencies", MemberCompetency, "user_id"),
    ("instructor_qualifications", InstructorQualification, "user_id"),
    ("shift_attendance", ShiftAttendance, "user_id"),
    ("shift_assignments", ShiftAssignment, "user_id"),
    ("shift_time_off", ShiftTimeOff, "user_id"),
    ("event_rsvps", EventRSVP, "user_id"),
    ("meeting_attendance", MeetingAttendee, "user_id"),
    ("admin_hours", AdminHoursEntry, "user_id"),
    ("leaves_of_absence", MemberLeaveOfAbsence, "user_id"),
    ("medical_screening_records", ScreeningRecord, "user_id"),
    ("skill_tests", SkillTest, "candidate_id"),
    ("dues", MemberDues, "user_id"),
    ("size_preferences", MemberSizePreferences, "user_id"),
    ("equipment_assignments", ItemAssignment, "user_id"),
    ("equipment_checkouts", CheckOutRecord, "user_id"),
    ("equipment_issuances", ItemIssuance, "user_id"),
    ("departure_clearances", DepartureClearance, "user_id"),
]

# Shift completion reports are evaluations ABOUT the trainee — subject-access
# material — but reviewer-internal notes concern the review process, not the
# subject, and stay out of the export.
_SHIFT_REPORT_EXCLUDED = frozenset({"reviewer_notes", "review_history"})


def _serialize_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, Decimal):
        return str(value)
    return value


def _row_to_dict(obj: Any, extra_excluded: frozenset = frozenset()) -> dict:
    """Serialize a model row column-by-column, skipping security material."""
    data: dict[str, Any] = {}
    for column in obj.__table__.columns:
        name = column.name
        if name in _EXCLUDED_COLUMNS or name in extra_excluded:
            continue
        data[name] = _serialize_value(getattr(obj, name, None))
    return data


class DataExportService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def export_user_data(self, user: User) -> dict:
        """Assemble the full personal-data export for one member."""
        # Load any expired/deferred attributes (e.g. server_default
        # timestamps right after an INSERT) up front — column access during
        # serialization must not trigger implicit lazy IO in async SQLAlchemy.
        await self.db.refresh(user)
        export: dict[str, Any] = {
            "export_format": "the-logbook/personal-data-export/v1",
            "generated_at": datetime.now(UTC).isoformat(),
            "profile": _row_to_dict(user),
        }

        for section, model, fk_attr in _EXPORT_SECTIONS:
            result = await self.db.execute(
                select(model).where(getattr(model, fk_attr) == user.id)
            )
            export[section] = [_row_to_dict(row) for row in result.scalars().all()]

        report_result = await self.db.execute(
            select(ShiftCompletionReport).where(
                ShiftCompletionReport.trainee_id == user.id
            )
        )
        export["shift_completion_reports"] = [
            _row_to_dict(row, _SHIFT_REPORT_EXCLUDED)
            for row in report_result.scalars().all()
        ]

        # Audit rows are append-only security records, not subject data;
        # export a summary instead of the (potentially enormous) rows.
        audit_result = await self.db.execute(
            select(
                func.count(),
                func.min(AuditLog.timestamp),
                func.max(AuditLog.timestamp),
            ).where(AuditLog.user_id == str(user.id))
        )
        count, first_ts, last_ts = audit_result.one()
        export["audit_log_summary"] = {
            "entries": count,
            "first_entry_at": first_ts.isoformat() if first_ts else None,
            "last_entry_at": last_ts.isoformat() if last_ts else None,
        }

        return export
