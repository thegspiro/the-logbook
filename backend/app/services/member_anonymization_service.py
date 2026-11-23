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
  meeting-attendance waivers (frequently medical/family detail); the reason
  on the member's attendance waiver requests and the decision notes on them.
  The requests and their decision log are kept, as the waivers are.
- The certificate files the member uploaded with self-reported training,
  and the entries naming them on their submissions and on the training
  records approval copied them to (the rows stay). A file another row still
  names is kept and only the member's entry goes; a file that cannot be
  deleted keeps its entry, its filename replaced, and is counted.
- The files uploaded to the member's own training records (the
  training-records storage area), by an officer or by the member, and their
  entries (owner decision 2026-11-20). Same rules as the certificates: a
  shared file is kept, a failed delete keeps its entry renamed and is
  counted. The records stay.
- event_rsvps: dietary restrictions, accessibility needs, notes.
- external_user_mappings: duplicated name/email/username copies.
- candidates.photo_url (second copy of the member photo). Candidate names
  are official election records and are retained.
- The member's original prospective-member record (linked via
  transferred_user_id): full PII block, notes, interview assessments,
  prospect-linked medical results, every linked source form submission
  (including later duplicate applications referenced only from step
  progress), and the mapped_data applicant copies that form-driven
  pipeline steps store in prospect_step_progress.action_result, the
  follow-up forms they were sent, and the applicant copy each election
  package took (its ballot item, an official election record, is retained).

What is deliberately NOT touched:
- audit_logs — append-only and hash-chained; rewriting them is tampering.
- votes/ballots — election integrity signatures must not change.
- Operational history rows (training, attendance, hours, custody, dues,
  exposure records) — they now point at the anonymized shell.
- membership_number and previous_membership_number — department-assigned
  keys, not personal data: they are what rosters and paper records cite, and
  the anonymized shell is identified by them.

Preconditions: the member must already be departed (soft-deleted or in a
departed/archived status). Anonymization is irreversible by design.
"""

import copy
import os
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import case, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified

from app.models.attendance_waiver import (
    AttendanceWaiverRequest,
    AttendanceWaiverRequestAction,
)
from app.models.event import EventRSVP
from app.models.forms import FormSubmission
from app.models.inventory import MemberSizePreferences
from app.models.medical_screening import ScreeningRecord
from app.models.meeting import MeetingAttendee
from app.models.membership_pipeline import (
    ProspectActivityLog,
    ProspectDocument,
    ProspectElectionPackage,
    ProspectFormRequest,
    ProspectInterview,
    ProspectiveMember,
    ProspectStepProgress,
)
from app.models.pending_file_deletion import PendingDeletionReason
from app.models.training import (
    ExternalUserMapping,
    ShiftTimeOff,
    TrainingRecord,
    TrainingSubmission,
    TrainingWaiver,
)
from app.models.user import (
    MemberLeaveOfAbsence,
    PasswordHistory,
    Session,
    User,
    UserStatus,
)
from app.services import file_storage_service as file_storage
from app.services.attendance_waiver_attachments import remove_member_attachments
from app.services.attendance_waiver_service import MEETING_WAIVER_TEXT
from app.services.file_storage_service import StorageArea
from app.services.member_files import (
    collect_member_files,
    confined_attachment_path,
    referenced_elsewhere,
)
from app.services.membership_pipeline_service import prospect_document_path
from app.services.passkey_service import delete_all_passkeys
from app.services.pending_file_deletions import (
    enqueue as enqueue_pending_file_deletions,
)
from app.services.upload_relocation import areas_for
from app.utils.sql_results import rows_affected

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
        """Org-scoped fetch — never resolve a target across tenants.

        Positions are loaded because the endpoint checks the target's
        permissions against the caller's before erasing the account, and a
        lazy load would raise under async.
        """
        result = await self.db.execute(
            select(User)
            .where(
                User.id == user_id,
                User.organization_id == organization_id,
            )
            .options(selectinload(User.positions))
        )
        user: User | None = result.scalar_one_or_none()
        return user

    def _check_preconditions(self, user: User) -> None:
        if user.anonymized_at is not None:
            raise ValueError("Member is already anonymized")
        status = user.status
        departed = user.deleted_at is not None or status in _DEPARTED_STATUSES
        if not departed:
            raise ValueError(
                "Only departed members can be anonymized. Drop or archive "
                "the member first."
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
        # `format_display_name` prefers this over first_name, so leaving it set
        # would keep naming the member on every everyday screen — a shift board
        # reading "Terry Member-1a2b3c4d" beside an anonymized record.
        user.preferred_name = None
        # Org-scoped unique indexes (username, email) forbid constant
        # placeholders — derive per-user tokens instead.
        user.username = f"anon-{token}"
        user.email = f"anon-{token}@anonymized.invalid"
        user.personal_email = None
        user.phone = None
        user.mobile = None
        user.photo_url = None  # photos are stored in-row as data URIs
        # Any badge the member still holds must stop scanning as anyone.
        user.badge_code = None
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
        # Free text a secretary wrote about the member when overriding their
        # voting waiting period; the dates and the waiver flag beside it are
        # standing, not personal, and are kept.
        user.voting_wait_override_reason = None
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
        counts["sessions_deleted"] = rows_affected(result) or 0
        result = await self.db.execute(
            delete(PasswordHistory).where(PasswordHistory.user_id == user.id)
        )
        counts["password_history_deleted"] = rows_affected(result) or 0
        counts["passkeys_deleted"] = await delete_all_passkeys(self.db, str(user.id))

        # --- body measurements -----------------------------------------
        result = await self.db.execute(
            delete(MemberSizePreferences).where(
                MemberSizePreferences.user_id == user.id
            )
        )
        counts["size_preferences_deleted"] = rows_affected(result) or 0

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
        counts["screening_records_scrubbed"] = rows_affected(result) or 0

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
            counts[f"{label}_scrubbed"] = rows_affected(result) or 0

        # A waiver's reason may be the Secretary's free text about the member,
        # so it goes; the excusal does not. Every reader decides "excused"
        # from a non-blank waiver_reason, so clearing it would turn excused
        # meetings into absences and drop the member's attendance figure.
        # Neutral wording with no category keeps the session excused and
        # says nothing about why. Migration 1f3a6c2d9e40 repairs members
        # anonymised before this, whose reason is already gone, from the
        # grant timestamp and request link every waiver writes beside it.
        result = await self.db.execute(
            update(MeetingAttendee)
            .where(
                MeetingAttendee.user_id == user.id,
                MeetingAttendee.waiver_reason.is_not(None),
            )
            .values(waiver_reason=MEETING_WAIVER_TEXT)
        )
        counts["meeting_waiver_reasons_scrubbed"] = rows_affected(result) or 0

        # A waiver request's reason, and the deciders' notes answering it,
        # are about the member and may be medical. The rows stay: they are
        # the record that a session was excused, and grading reads them.
        result = await self.db.execute(
            update(AttendanceWaiverRequest)
            .where(
                AttendanceWaiverRequest.user_id == user.id,
                AttendanceWaiverRequest.organization_id == user.organization_id,
            )
            .values(reason=None)
        )
        counts["attendance_waiver_reasons_scrubbed"] = rows_affected(result) or 0
        result = await self.db.execute(
            update(AttendanceWaiverRequestAction)
            .where(
                AttendanceWaiverRequestAction.organization_id == user.organization_id,
                AttendanceWaiverRequestAction.request_id.in_(
                    select(AttendanceWaiverRequest.id).where(
                        AttendanceWaiverRequest.user_id == user.id
                    )
                ),
            )
            .values(note=None)
        )
        counts["attendance_waiver_notes_scrubbed"] = rows_affected(result) or 0
        # The documents filed with those requests (doctor's notes, mostly):
        # files and rows both go, the requests stay.
        waiver_queued: list[str] = []
        counts["attendance_waiver_attachments_deleted"] = (
            await remove_member_attachments(self.db, user, queued=waiver_queued)
        )
        counts["attendance_waiver_files_queued"] = len(waiver_queued)

        # --- RSVP quasi-health fields ----------------------------------
        result = await self.db.execute(
            update(EventRSVP)
            .where(EventRSVP.user_id == user.id)
            .values(dietary_restrictions=None, accessibility_needs=None, notes=None)
        )
        counts["rsvps_scrubbed"] = rows_affected(result) or 0

        # --- duplicated identity copies --------------------------------
        result = await self.db.execute(
            update(ExternalUserMapping)
            .where(ExternalUserMapping.internal_user_id == user.id)
            .values(external_username=None, external_email=None, external_name=None)
        )
        counts["external_mappings_scrubbed"] = rows_affected(result) or 0

        # Candidate photos duplicate the member photo; names on ballots are
        # official election records and are kept. Imported lazily — the
        # election module's mappers are heavyweight.
        from app.models.election import Candidate

        result = await self.db.execute(
            update(Candidate).where(Candidate.user_id == user.id).values(photo_url=None)
        )
        counts["candidate_photos_scrubbed"] = rows_affected(result) or 0

        # --- original applicant record ---------------------------------
        prospect_counts = await self._scrub_prospect(user, token)
        counts["prospect_records_scrubbed"] = prospect_counts["prospects"]
        counts["screening_records_scrubbed"] += prospect_counts["screenings"]
        counts["form_submissions_scrubbed"] = prospect_counts["form_submissions"]
        counts["step_progress_scrubbed"] = prospect_counts["step_progress"]
        counts["prospect_activity_scrubbed"] = prospect_counts["activity"]
        counts["applicant_files_queued"] = prospect_counts["files_queued"]

        # --- uploaded training files -----------------------------------
        # Last, so the files go as late as possible before the endpoint's
        # commit: a failure in any step above rolls back before a single
        # file has been deleted.
        counts.update(await self._remove_member_uploads(user))

        await self.db.flush()
        return {
            "user_id": user.id,
            "anonymized_at": now.isoformat(),
            **counts,
        }

    async def _remove_member_uploads(self, user: User) -> dict[str, int]:
        """Delete the files the member's training rows name, and the entries
        naming them. The rows stay.

        Two kinds, counted apart: the certificates uploaded with self-reported
        training (on the submissions, and on the records approval copied them
        to), and the files uploaded to the member's own training records.
        Erasing the second kind is the owner's decision of 2026-11-20.

        Files first, rows after, as the retention sweep does. If a later step
        or the endpoint's commit fails, the rows still name files that are
        gone and ``anonymized_at`` is unset, so anonymisation may be run
        again: :func:`file_storage.delete` reports a missing file as removed,
        and the rerun completes (pitfall #36).

        A file that cannot be deleted keeps its entry, with the uploader's
        filename replaced, and is counted. Unlike
        ``remove_member_attachments``, which drops the row whatever happens
        to the file, this keeps the reference: anonymisation refuses to run
        twice, so a dropped reference would leave an orphan nothing could
        ever find again, and the count tells the administrator the erasure
        is incomplete.
        """
        org_id = str(user.organization_id)
        # Locks the member's submissions and records until the commit: an
        # approval, a reversal or an officer's attachment append running now
        # would otherwise write back an entry naming a file deleted below.
        files = await collect_member_files(self.db, str(user.id), org_id, lock=True)
        # The records' half matters on its own: after an approval is reversed
        # and the member removes the attachment from the submission, only the
        # voided record still names the certificate.
        #
        # Each path's kind comes from the collector's sets, never from
        # confining it again: the legacy self-reports root sits inside the
        # legacy training-records root, and the collector's SELF_REPORTS-first
        # classification is the one answer.
        certificates = files.self_report_paths
        uploads = files.record_own_paths
        candidates = certificates | uploads
        # One check over both kinds: it reads the organization's references.
        shared = await referenced_elsewhere(
            self.db, org_id, candidates, exclude_rows=files.own_rows
        )

        removed: set[str] = set()
        failed: set[str] = set()
        for path in sorted(candidates - shared):
            if await file_storage.delete(path):
                removed.add(path)
            else:
                failed.add(path)

        # Visited even when the member has no stored file: a path-less entry's
        # name is relabelled too (see _strip_entries).
        if files.submission_ids or files.record_ids:
            if files.submission_ids:
                submissions = (
                    (
                        await self.db.execute(
                            select(TrainingSubmission).where(
                                TrainingSubmission.organization_id == org_id,
                                TrainingSubmission.id.in_(files.submission_ids),
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                for submission in submissions:
                    _strip_entries(
                        submission,
                        org_id,
                        removed | shared,
                        failed,
                        (StorageArea.SELF_REPORTS,),
                    )
            if files.record_ids:
                records = (
                    (
                        await self.db.execute(
                            select(TrainingRecord).where(
                                TrainingRecord.organization_id == org_id,
                                TrainingRecord.id.in_(files.record_ids),
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                for record in records:
                    _strip_entries(
                        record,
                        org_id,
                        removed | shared,
                        failed,
                        areas_for(StorageArea.TRAINING_RECORDS),
                    )

        return {
            "self_report_files_deleted": len(removed & certificates),
            "self_report_files_not_deleted": len(failed & certificates),
            "self_report_files_shared_kept": len(shared & certificates),
            "training_record_files_deleted": len(removed & uploads),
            "training_record_files_not_deleted": len(failed & uploads),
            "training_record_files_shared_kept": len(shared & uploads),
        }

    async def _scrub_prospect(self, user: User, token: str) -> dict[str, int]:
        """Scrub the applicant-era copy of the member's PII."""
        result = await self.db.execute(
            select(ProspectiveMember).where(
                ProspectiveMember.transferred_user_id == user.id,
                ProspectiveMember.organization_id == user.organization_id,
            )
        )
        prospects = result.scalars().all()
        screenings_scrubbed = 0
        form_submissions_scrubbed = 0
        step_progress_scrubbed = 0
        activity_scrubbed = 0
        # Applicant documents whose file would not delete. Their rows go
        # anyway, so the files are queued for the hourly sweep in this
        # transaction, rather than left named by nothing (owner decision
        # 2026-11-23).
        retry: dict[str, StorageArea] = {}
        for prospect in prospects:
            # Rows linked to BOTH user_id and prospect_id were already
            # scrubbed (and counted) by the user-scoped update in
            # anonymize_member — exclude them here so the summary counts
            # each record exactly once.
            result = await self.db.execute(
                update(ScreeningRecord)
                .where(
                    ScreeningRecord.prospect_id == prospect.id,
                    ScreeningRecord.user_id.is_(None),
                )
                .values(
                    result_summary=None,
                    result_data=None,
                    notes=None,
                    provider_name=None,
                )
            )
            screenings_scrubbed += rows_affected(result) or 0

            # Form-driven pipeline steps copy the full mapped applicant data
            # (name, email, address, date of birth, ...) into
            # ProspectStepProgress.action_result, and a later duplicate
            # application's submission id lives ONLY there —
            # prospect.form_submission_id keeps pointing at the original.
            # Collect every linked submission id and redact the mapped_data
            # copies, or the erasure leaves the applicant fully identifiable.
            submission_ids: set[str] = set()
            if prospect.form_submission_id:
                submission_ids.add(str(prospect.form_submission_id))
                prospect.form_submission_id = None

            progress_result = await self.db.execute(
                select(ProspectStepProgress).where(
                    ProspectStepProgress.prospect_id == prospect.id
                )
            )
            for progress in progress_result.scalars().all():
                # A coordinator's free-text note on a step is written about
                # the applicant, by name as often as not.
                progress.notes = None
                action_result = progress.action_result
                if not isinstance(action_result, dict):
                    continue
                linked_submission = action_result.get("form_submission_id")
                if linked_submission:
                    submission_ids.add(str(linked_submission))
                if action_result.get("mapped_data") is not None:
                    # New top-level dict — a nested in-place edit would be
                    # invisible to the plain JSON column (pitfall #12).
                    progress.action_result = {**action_result, "mapped_data": None}
                    step_progress_scrubbed += 1

            # Follow-up forms: each one's submission is the applicant's own
            # answers, its draft and change log hold their contact details,
            # and its link would keep opening the form.
            requests_result = await self.db.execute(
                select(ProspectFormRequest).where(
                    ProspectFormRequest.prospect_id == prospect.id,
                    ProspectFormRequest.organization_id == user.organization_id,
                )
            )
            for form_request in requests_result.scalars().all():
                if form_request.submission_id:
                    submission_ids.add(str(form_request.submission_id))
                form_request.token = None
                form_request.draft_data = None
                form_request.changes = None

            if submission_ids:
                result = await self.db.execute(
                    update(FormSubmission)
                    .where(
                        FormSubmission.id.in_(submission_ids),
                        FormSubmission.organization_id == user.organization_id,
                    )
                    .values(
                        data={},
                        sensitive_data=None,
                        submitter_name=None,
                        submitter_email=None,
                        # submitted_by may identify a coordinator who filed
                        # the application on the member's behalf — clear it
                        # only when it names the member being anonymized.
                        submitted_by=case(
                            (FormSubmission.submitted_by == user.id, None),
                            else_=FormSubmission.submitted_by,
                        ),
                        ip_address=None,
                        user_agent=None,
                        integration_result=None,
                    )
                )
                form_submissions_scrubbed += rows_affected(result) or 0

            # The activity log records every edit as from/to values, every
            # uploaded file's name and every coordinator's note. Keep the
            # history's shape — what happened, at which step, to which kind
            # of document — and drop the values.
            activity_result = await self.db.execute(
                select(ProspectActivityLog).where(
                    ProspectActivityLog.prospect_id == prospect.id
                )
            )
            for log in activity_result.scalars().all():
                redacted = _redact_activity_details(log.details)
                if redacted != log.details:
                    log.details = redacted
                    activity_scrubbed += 1

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
            # An election package keeps its own copy of the applicant's
            # details -- contact details, notes, follow-up answers -- taken
            # when it was assembled. Keep only what the package's ballot item
            # and stage list need, under the anonymized name.
            packages_result = await self.db.execute(
                select(ProspectElectionPackage).where(
                    ProspectElectionPackage.prospect_id == prospect.id
                )
            )
            for package in packages_result.scalars().all():
                old_snapshot = (
                    package.applicant_snapshot
                    if isinstance(package.applicant_snapshot, dict)
                    else {}
                )
                package.applicant_snapshot = {
                    "first_name": prospect.first_name,
                    "last_name": prospect.last_name,
                    "desired_membership_type": old_snapshot.get(
                        "desired_membership_type"
                    ),
                    "stage_history": copy.deepcopy(
                        old_snapshot.get("stage_history") or []
                    ),
                }
                package.coordinator_notes = None
                config = copy.deepcopy(
                    package.package_config
                    if isinstance(package.package_config, dict)
                    else {}
                )
                for key in ("supporting_statement", "custom_fields", "documents"):
                    config.pop(key, None)
                package.package_config = config
            # Uploaded applicant documents (ID photos, background checks)
            # are pure PII: remove the files best-effort, then the rows.
            docs_result = await self.db.execute(
                select(ProspectDocument).where(
                    ProspectDocument.prospect_id == prospect.id
                )
            )
            for doc in docs_result.scalars().all():
                # Only ever unlink inside this organization's own applicant
                # storage — a tampered stored path must not turn anonymization
                # into a delete of some other file on the volume.
                confined = prospect_document_path(
                    doc.file_path, prospect.organization_id
                )
                if confined and not await file_storage.delete(confined):
                    retry[confined] = StorageArea.APPLICANTS
            await self.db.execute(
                delete(ProspectDocument).where(
                    ProspectDocument.prospect_id == prospect.id
                )
            )
        return {
            "prospects": len(prospects),
            "screenings": screenings_scrubbed,
            "form_submissions": form_submissions_scrubbed,
            "step_progress": step_progress_scrubbed,
            "activity": activity_scrubbed,
            "files_queued": len(
                enqueue_pending_file_deletions(
                    self.db,
                    str(user.organization_id),
                    retry,
                    PendingDeletionReason.MEMBER_ANONYMIZATION,
                )
            ),
        }


# Activity-log detail keys whose values are department structure (ids, stage
# names, statuses, counts) and never text about the applicant. An allowlist
# rather than a list of known offenders: a key some later action adds is
# dropped by default instead of surviving the erasure until somebody notices.
_ACTIVITY_KEYS_KEPT = frozenset(
    {
        "source",
        "bulk",
        "by_applicant",
        # Top-level from/to belong to prospect_status_changed and hold status
        # values. prospect_updated nests its from/to under "changes", which
        # is handled on its own below.
        "from",
        "to",
        "step_name",
        "to_step_name",
        "deleted_step_name",
        "document_type",
        "missing_roles",
        "recommendation",
        "interviewer_role",
        "trigger",
        "updates",
        "election_title",
        "event_title",
        "event_type",
        "alert_level",
        "days_inactive",
        "timeout_days",
        "recipient_count",
        "in_app_count",
        "delivered",
        "department_bcc",
        "purge_on",
    }
)


def _is_plain_value(value: Any) -> bool:
    if value is None or isinstance(value, (bool, int, float, str)):
        return True
    if isinstance(value, list):
        return all(
            item is None or isinstance(item, (bool, int, float, str)) for item in value
        )
    return False


def _redact_activity_details(details: Any) -> Any:
    """Keep a prospect activity entry's structure and drop its values.

    Returns a new dict (pitfall #12) so the plain JSON column sees the change.
    """
    if not isinstance(details, dict):
        return details
    redacted: dict[str, Any] = {}
    for key, value in details.items():
        if key == "changes" and isinstance(value, dict):
            redacted[key] = {str(field): {"changed": True} for field in value}
        elif (
            key in _ACTIVITY_KEYS_KEPT or key.endswith("_id") or key.endswith("_ids")
        ) and _is_plain_value(value):
            redacted[key] = copy.deepcopy(value)
    return redacted


# The neutral name a kept entry gets, by the area its file confined to. The
# stored name is server-chosen, so its extension is the only part of the
# label that does not come from the uploader.
_NEUTRAL_LABELS = {
    StorageArea.SELF_REPORTS: "certificate",
    StorageArea.TRAINING_RECORDS: "attachment",
}


def _neutral_name(label: str, file_name: Any) -> str:
    """*label* with the original name's extension, when it has a plausible
    one (letters and digits, at most five), lower-cased; otherwise bare."""
    extension = os.path.splitext(file_name)[1] if isinstance(file_name, str) else ""
    if 1 < len(extension) <= 6 and extension[1:].isalnum():
        return label + extension.lower()
    return label


def _strip_entries(
    row: TrainingSubmission | TrainingRecord,
    org_id: str,
    drop: set[str],
    unnamed: set[str],
    areas: tuple[StorageArea, ...],
) -> None:
    """Remove the entries naming *drop* from *row*'s attachments, and replace
    the uploader's filename on the entries naming *unnamed*.

    *areas* are the row kind's areas in the collector's order: a submission's
    entries confine to SELF_REPORTS only, a record's to SELF_REPORTS then
    TRAINING_RECORDS (``upload_relocation.areas_for``). An entry is matched
    in the first area it confines to, as ``collect_member_files`` matches it.
    """
    attachments = row.attachments
    if not isinstance(attachments, list):
        return
    kept: list[Any] = []
    changed = False
    for attachment in attachments:
        path: str | None = None
        area: StorageArea | None = None
        for candidate in areas:
            path = confined_attachment_path(attachment, org_id, candidate)
            if path is not None:
                area = candidate
                break
        if path is not None and path in drop:
            changed = True
            continue
        if (
            path is not None
            and area is not None
            and path in unnamed
            and isinstance(attachment, dict)
        ):
            label = _NEUTRAL_LABELS[area] + os.path.splitext(path)[1]
            if attachment.get("file_name") != label:
                attachment = {**copy.deepcopy(attachment), "file_name": label}
                changed = True
        elif isinstance(attachment, dict) and not attachment.get("file_path"):
            # A path-less entry (an old text-only attachment, settled as
            # {"file_name": ...} by migration 0c22a95b94b8) names no file,
            # but its name is the uploader's text and often the member's.
            # Relabelled with the row kind's label: a submission's is a
            # certificate, a record's an attachment. The frozen copy of this
            # rule in migration 1f3a6c2d9e40 settles members anonymised
            # before it.
            label = _neutral_name(
                _NEUTRAL_LABELS[areas[-1]], attachment.get("file_name")
            )
            if attachment.get("file_name") != label:
                attachment = {**copy.deepcopy(attachment), "file_name": label}
                changed = True
        kept.append(attachment)
    if changed:
        # A new list and flag_modified: the JSON column does not track
        # in-place mutation (pitfall #12).
        row.attachments = kept
        flag_modified(row, "attachments")
