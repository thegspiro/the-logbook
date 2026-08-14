"""Tests for the per-user personal-data export (data portability)."""

import json
import uuid
from datetime import date

import pytest

from app.core.audit import audit_logger
from app.models.inventory import MemberSizePreferences
from app.models.training import (
    ShiftCompletionReport,
    TrainingModuleConfig,
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User
from app.services.data_export_service import DataExportService

pytestmark = pytest.mark.integration


async def _make_member(db, org, **overrides):
    suffix = uuid.uuid4().hex[:8]
    defaults = dict(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{suffix}",
        email=f"member-{suffix}@example.org",
        first_name="Pat",
        last_name="Member",
        phone="555-0100",
        emergency_contacts=[
            {"name": "Casey Member", "relationship": "spouse", "phone": "555-0101"}
        ],
    )
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    await db.flush()
    return user


async def _make_training_record(db, user, course_name="CPR"):
    record = TrainingRecord(
        id=str(uuid.uuid4()),
        organization_id=user.organization_id,
        user_id=user.id,
        course_name=course_name,
        training_type=TrainingType.CERTIFICATION,
        status=TrainingStatus.COMPLETED,
        hours_completed=8.0,
        certification_number=f"CERT-{uuid.uuid4().hex[:6]}",
    )
    db.add(record)
    await db.flush()
    return record


class TestDataExportService:
    async def test_export_includes_profile_and_records(self, db_session):
        org = Organization(name="Export FD", slug=f"export-{uuid.uuid4().hex[:8]}")
        db_session.add(org)
        await db_session.flush()
        user = _member = await _make_member(db_session, org)
        record = await _make_training_record(db_session, user)
        db_session.add(
            MemberSizePreferences(
                id=str(uuid.uuid4()),
                user_id=user.id,
                organization_id=org.id,
                shirt_size="L",
                boot_size="11",
            )
        )
        await db_session.flush()
        assert _member is user

        export = await DataExportService(db_session).export_user_data(user)

        assert export["profile"]["email"] == user.email
        assert export["profile"]["emergency_contacts"][0]["name"] == "Casey Member"
        assert [r["id"] for r in export["training_records"]] == [record.id]
        assert export["training_records"][0]["certification_number"] == (
            record.certification_number
        )
        assert export["size_preferences"][0]["shirt_size"] == "L"
        # Every declared section exists even when empty (predictable shape).
        assert export["medical_screening_records"] == []
        assert export["shift_completion_reports"] == []

    async def test_security_material_is_never_exported(self, db_session):
        org = Organization(name="Export FD", slug=f"export-{uuid.uuid4().hex[:8]}")
        db_session.add(org)
        await db_session.flush()
        user = await _make_member(db_session, org, password_hash="bcrypt$fake")

        export = await DataExportService(db_session).export_user_data(user)

        for forbidden in (
            "password_hash",
            "mfa_secret",
            "mfa_backup_codes",
            "password_reset_token",
            "calendar_feed_token",
            "oauth_subject",
        ):
            assert forbidden not in export["profile"]

    async def test_export_is_scoped_to_the_requesting_user(self, db_session):
        org = Organization(name="Export FD", slug=f"export-{uuid.uuid4().hex[:8]}")
        db_session.add(org)
        await db_session.flush()
        user_a = await _make_member(db_session, org)
        user_b = await _make_member(db_session, org)
        await _make_training_record(db_session, user_a, course_name="A-Course")
        await _make_training_record(db_session, user_b, course_name="B-Course")

        export = await DataExportService(db_session).export_user_data(user_a)

        names = [r["course_name"] for r in export["training_records"]]
        assert names == ["A-Course"]

    async def test_shift_reports_respect_trainee_visibility(self, db_session):
        org = Organization(name="Export FD", slug=f"export-{uuid.uuid4().hex[:8]}")
        db_session.add(org)
        await db_session.flush()
        trainee = await _make_member(db_session, org)
        officer = await _make_member(db_session, org)
        db_session.add(
            TrainingModuleConfig(
                organization_id=org.id,
                show_officer_narrative=False,
                show_performance_rating=False,
            )
        )
        approved = ShiftCompletionReport(
            organization_id=org.id,
            trainee_id=trainee.id,
            officer_id=officer.id,
            shift_date=date(2026, 8, 1),
            hours_on_shift=8,
            review_status="approved",
            officer_narrative="Officer-only narrative",
            performance_rating=2,
            areas_of_strength="Teamwork",
            reviewer_notes="Reviewer-only note",
        )
        pending = ShiftCompletionReport(
            organization_id=org.id,
            trainee_id=trainee.id,
            officer_id=officer.id,
            shift_date=date(2026, 8, 2),
            hours_on_shift=8,
            review_status="pending_review",
            officer_narrative="Draft narrative",
        )
        db_session.add_all([approved, pending])
        await db_session.flush()

        export = await DataExportService(db_session).export_user_data(trainee)

        assert len(export["shift_completion_reports"]) == 1
        exported = export["shift_completion_reports"][0]
        assert exported["id"] == approved.id
        assert exported["areas_of_strength"] == "Teamwork"
        assert "officer_narrative" not in exported
        assert "performance_rating" not in exported
        assert "reviewer_notes" not in exported

    async def test_audit_summary_counts_only_own_entries(self, db_session):
        org = Organization(name="Export FD", slug=f"export-{uuid.uuid4().hex[:8]}")
        db_session.add(org)
        await db_session.flush()
        user = await _make_member(db_session, org)
        await audit_logger.create_log_entry(
            db_session,
            event_type="user_login",
            event_category="auth",
            severity="info",
            event_data={},
            user_id=user.id,
            organization_id=org.id,
        )

        export = await DataExportService(db_session).export_user_data(user)

        assert export["audit_log_summary"]["entries"] == 1
        assert export["audit_log_summary"]["first_entry_at"] is not None

    async def test_export_is_json_serializable(self, db_session):
        org = Organization(name="Export FD", slug=f"export-{uuid.uuid4().hex[:8]}")
        db_session.add(org)
        await db_session.flush()
        user = await _make_member(db_session, org)
        await _make_training_record(db_session, user)

        export = await DataExportService(db_session).export_user_data(user)

        json.dumps(export)  # raises on any non-serializable leftovers
