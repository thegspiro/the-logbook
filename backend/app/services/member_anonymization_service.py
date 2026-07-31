"""
Member Anonymization Service (right to erasure, fire-service style)

Departments must keep operational history — training completions,
attendance counts, property custody, exposure records — long after a member
departs, but nothing obliges them to keep the person's *identity* attached
to it forever. This service scrubs a departed member's PII while preserving
the operational rows, linked to an anonymized shell user.

What is scrubbed (see docs/module-audit and the PII survey behind
docs/COMPLIANCE.md):
- users: names → placeholders, email/username → per-id tokens (the org-scoped
  unique indexes forbid constant placeholders), contact details, addresses,
  date of birth, photo (stored in-row), emergency contacts, notification
  preferences, free-text reasons, credentials, MFA secrets, OAuth linkage,
  and unguessable tokens (calendar feed, password reset).
- sessions + password_history rows: deleted.
- member_size_preferences (body measurements): deleted.
- screening_records: medical content (results, notes, provider) scrubbed;
  status and dates retained as compliance-history proof.
- free-text reason fields on leaves, training waivers, shift time-off, and
  meeting-attendance waivers (frequently medical/family detail).
- event_rsvps: dietary restrictions, accessibility needs, notes.
- external_user_mappings: duplicated name/email/username copies.
- candidates.photo_url (second copy of the member photo). Candidate names
  are official election records and are retained.
- The member's original prospective-member record (linked via
  transferred_user_id): full PII block, notes, interview assessments.

What is deliberately NOT touched:
- audit_logs — append-only and hash-chained; rewriting them is tampering.
- votes/ballots — election integrity signatures must not change.
- Operational history rows (training, attendance, hours, custody, dues,
  exposure records) — they now point at the anonymized shell.

Preconditions: the member must already be departed (soft-deleted or in a
departed/archived status). Anonymization is irreversible by design.
"""

import os
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import EventRSVP
from app.models.inventory import MemberSizePreferences
from app.models.medical_screening import ScreeningRecord
from app.models.meeting import MeetingAttendee
from app.models.membership_pipeline import (
    ProspectDocument,
    ProspectInterview,
    ProspectiveMember,
)
from app.models.training import ExternalUserMapping, ShiftTimeOff, TrainingWaiver
from app.models.user import (
    MemberLeaveOfAbsence,
    PasswordHistory,
    Session,
    User,
    UserStatus,
)

_DEPARTED_STATUSES = {
    UserStatus.DROPPED_VOLUNTARY,
    UserStatus.DROPPED_INVOLUNTARY,
    UserStatus.ARCHIVED,
}


class MemberAnonymizationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_user_for_anonymization(
        self, user_id: str, organization_id: str
    ) -> User | None:
        """Org-scoped fetch — never resolve a target across tenants."""
        result = await self.db.execute(
            select(User).where(
                User.id == user_id,
                User.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    def _check_preconditions(self, user: User) -> None:
        if user.anonymized_at is not None:
            raise ValueError("Member is already anonymized")
        status = user.status
        departed = user.deleted_at is not None or status in _DEPARTED_STATUSES
        if not departed:
            raise ValueError(
                "Only departed members can be anonymized. Deactivate or "
                "archive the member first."
            )

    async def anonymize_member(self, user: User) -> dict[str, Any]:
        """Scrub the member's PII. Irreversible."""
        self._check_preconditions(user)

        counts: dict[str, int] = {}
        now = datetime.now(UTC)
        token = uuid.uuid4().hex[:12]

        # --- users row -------------------------------------------------
        user.first_name = "Former"
        user.middle_name = None
        user.last_name = f"Member-{token[:8]}"
        # Org-scoped unique indexes (username, email) forbid constant
        # placeholders — derive per-user tokens instead.
        user.username = f"anon-{token}"
        user.email = f"anon-{token}@anonymized.invalid"
        user.personal_email = None
        user.phone = None
        user.mobile = None
        user.photo_url = None  # photos are stored in-row as data URIs
        user.date_of_birth = None
        user.address_street = None
        user.address_city = None
        user.address_state = None
        user.address_zip = None
        user.address_country = None
        user.referral_source = None
        user.interest_reason = None
        user.emergency_contacts = None
        user.notification_preferences = None
        user.status_change_reason = None
        user.password_hash = None
        user.oauth_provider = None
        user.oauth_subject = None
        user._mfa_secret_encrypted = None
        user._mfa_backup_codes_encrypted = None
        user.mfa_enabled = False
        user.password_reset_token = None
        user.password_reset_expires_at = None
        user.calendar_feed_token = None
        if user.deleted_at is None:
            user.deleted_at = now
        user.anonymized_at = now

        # --- security material rows ------------------------------------
        result = await self.db.execute(
            delete(Session).where(Session.user_id == user.id)
        )
        counts["sessions_deleted"] = result.rowcount or 0
        result = await self.db.execute(
            delete(PasswordHistory).where(PasswordHistory.user_id == user.id)
        )
        counts["password_history_deleted"] = result.rowcount or 0

        # --- body measurements -----------------------------------------
        result = await self.db.execute(
            delete(MemberSizePreferences).where(
                MemberSizePreferences.user_id == user.id
            )
        )
        counts["size_preferences_deleted"] = result.rowcount or 0

        # --- medical content (keep status/dates as compliance proof) ---
        result = await self.db.execute(
            update(ScreeningRecord)
            .where(ScreeningRecord.user_id == user.id)
            .values(
                result_summary=None,
                result_data=None,
                notes=None,
                provider_name=None,
            )
        )
        counts["screening_records_scrubbed"] = result.rowcount or 0

        # --- free-text reasons (frequently medical/family detail) ------
        for label, model, values in (
            ("leave_reasons", MemberLeaveOfAbsence, {"reason": None}),
            ("training_waiver_reasons", TrainingWaiver, {"reason": None}),
            (
                "shift_time_off_reasons",
                ShiftTimeOff,
                {"reason": None, "reviewer_notes": None},
            ),
        ):
            result = await self.db.execute(
                update(model).where(model.user_id == user.id).values(**values)
            )
            counts[f"{label}_scrubbed"] = result.rowcount or 0

        result = await self.db.execute(
            update(MeetingAttendee)
            .where(MeetingAttendee.user_id == user.id)
            .values(waiver_reason=None)
        )
        counts["meeting_waiver_reasons_scrubbed"] = result.rowcount or 0

        # --- RSVP quasi-health fields ----------------------------------
        result = await self.db.execute(
            update(EventRSVP)
            .where(EventRSVP.user_id == user.id)
            .values(dietary_restrictions=None, accessibility_needs=None, notes=None)
        )
        counts["rsvps_scrubbed"] = result.rowcount or 0

        # --- duplicated identity copies --------------------------------
        result = await self.db.execute(
            update(ExternalUserMapping)
            .where(ExternalUserMapping.internal_user_id == user.id)
            .values(external_username=None, external_email=None, external_name=None)
        )
        counts["external_mappings_scrubbed"] = result.rowcount or 0

        # Candidate photos duplicate the member photo; names on ballots are
        # official election records and are kept. Imported lazily — the
        # election module's mappers are heavyweight.
        from app.models.election import Candidate

        result = await self.db.execute(
            update(Candidate).where(Candidate.user_id == user.id).values(photo_url=None)
        )
        counts["candidate_photos_scrubbed"] = result.rowcount or 0

        # --- original applicant record ---------------------------------
        counts["prospect_records_scrubbed"] = await self._scrub_prospect(user, token)

        await self.db.flush()
        return {
            "user_id": user.id,
            "anonymized_at": now.isoformat(),
            **counts,
        }

    async def _scrub_prospect(self, user: User, token: str) -> int:
        """Scrub the applicant-era copy of the member's PII."""
        result = await self.db.execute(
            select(ProspectiveMember).where(
                ProspectiveMember.transferred_user_id == user.id,
                ProspectiveMember.organization_id == user.organization_id,
            )
        )
        prospects = result.scalars().all()
        for prospect in prospects:
            prospect.first_name = "Former"
            prospect.last_name = f"Member-{token[:8]}"
            prospect.email = f"anon-{token}@anonymized.invalid"
            prospect.phone = None
            prospect.mobile = None
            prospect.date_of_birth = None
            prospect.address_street = None
            prospect.address_city = None
            prospect.address_state = None
            prospect.address_zip = None
            prospect.interest_reason = None
            prospect.referral_source = None
            prospect.metadata_ = None
            prospect.notes = None
            # Rotate the public status-check token so old links go dead.
            prospect.status_token = uuid.uuid4().hex

            await self.db.execute(
                update(ProspectInterview)
                .where(ProspectInterview.prospect_id == prospect.id)
                .values(notes=None, recommendation_notes=None)
            )
            # Uploaded applicant documents (ID photos, background checks)
            # are pure PII: remove the files best-effort, then the rows.
            docs_result = await self.db.execute(
                select(ProspectDocument).where(
                    ProspectDocument.prospect_id == prospect.id
                )
            )
            for doc in docs_result.scalars().all():
                if doc.file_path:
                    try:
                        os.remove(doc.file_path)
                    except OSError:
                        pass  # already gone or unreachable — the row still goes
            await self.db.execute(
                delete(ProspectDocument).where(
                    ProspectDocument.prospect_id == prospect.id
                )
            )
        return len(prospects)
