"""Unit tests for _scrub_prospect's step-progress handling (no DB).

The integration coverage lives in test_member_anonymization.py; these
verify the PR #1412 review fixes — mapped_data redaction, duplicate
submission collection, single-count screening scrubs, and preserving a
coordinator's submitted_by attribution — against a recorded fake session.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.member_anonymization_service import MemberAnonymizationService


def _scalars(items):
    return MagicMock(
        scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=items)))
    )


def _rowcount(n):
    return MagicMock(rowcount=n)


class RecordingSession:
    def __init__(self, results):
        self._results = list(results)
        self.statements = []

    async def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        return self._results.pop(0) if self._results else MagicMock()


def _make_prospect(**overrides):
    fields = dict(
        id="prospect-1",
        form_submission_id="submission-original",
        first_name="Pat",
        last_name="Firefighter",
        email="pat@example.org",
        phone=None,
        mobile=None,
        date_of_birth=None,
        address_street=None,
        address_city=None,
        address_state=None,
        address_zip=None,
        interest_reason=None,
        referral_source=None,
        metadata_=None,
        notes=None,
        status_token="old-token",
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _statement_for(db, table_name):
    return next(
        stmt
        for stmt in db.statements
        if getattr(getattr(stmt, "table", None), "name", "") == table_name
    )


async def test_scrub_prospect_redacts_mapped_data_and_collects_duplicates():
    prospect = _make_prospect()
    progress_with_pii = SimpleNamespace(
        action_result={
            "form_submission_id": "submission-duplicate",
            "form_id": "form-1",
            "mapped_data": {"first_name": "Pat", "email": "pat@example.org"},
        }
    )
    progress_without_payload = SimpleNamespace(action_result=None)

    db = RecordingSession(
        [
            _scalars([prospect]),  # prospect lookup
            _rowcount(0),  # screening scrub
            _scalars([progress_with_pii, progress_without_payload]),
            _rowcount(2),  # form-submission scrub (original + duplicate)
            _rowcount(0),  # interview scrub
            _scalars([]),  # documents
            _rowcount(0),  # document delete
        ]
    )
    service = MemberAnonymizationService(db)
    user = SimpleNamespace(id="user-1", organization_id="org-1")

    summary = await service._scrub_prospect(user, "token123456")

    assert summary["form_submissions"] == 2
    assert summary["step_progress"] == 1
    assert progress_with_pii.action_result["mapped_data"] is None
    # Structural keys survive so the pipeline history stays legible.
    assert (
        progress_with_pii.action_result["form_submission_id"] == "submission-duplicate"
    )
    assert progress_without_payload.action_result is None
    assert prospect.form_submission_id is None

    # The one FormSubmission update targets both the prospect-linked and the
    # progress-linked submission ids.
    submission_update = _statement_for(db, "form_submissions")
    params = submission_update.compile().params
    bound_ids = set()
    for value in params.values():
        # The IN clause binds as one expanding parameter holding the id list.
        values = value if isinstance(value, (list, tuple, set)) else [value]
        bound_ids.update(v for v in values if str(v).startswith("submission-"))
    assert bound_ids == {"submission-original", "submission-duplicate"}


async def test_prospect_screening_scrub_excludes_user_linked_rows():
    """Screening rows linked to BOTH user_id and prospect_id are scrubbed
    and counted by the user-scoped update in anonymize_member; the
    prospect-scoped update must exclude them so the summary counts each
    record exactly once (PR #1412 review)."""
    prospect = _make_prospect(form_submission_id=None)
    db = RecordingSession(
        [
            _scalars([prospect]),  # prospect lookup
            _rowcount(1),  # screening scrub (prospect-only rows)
            _scalars([]),  # step progress
            _rowcount(0),  # interview scrub
            _scalars([]),  # documents
            _rowcount(0),  # document delete
        ]
    )
    service = MemberAnonymizationService(db)
    user = SimpleNamespace(id="user-1", organization_id="org-1")

    summary = await service._scrub_prospect(user, "token123456")

    assert summary["screenings"] == 1
    screening_update = _statement_for(db, "screening_records")
    assert "user_id IS NULL" in str(screening_update)
    assert "prospect-1" in screening_update.compile().params.values()


async def test_submitted_by_cleared_only_for_the_anonymized_member():
    """A coordinator may have filed the application on the member's behalf;
    their submitted_by attribution must survive. Only a submitted_by that
    names the anonymized user is cleared (PR #1412 review)."""
    prospect = _make_prospect()
    db = RecordingSession(
        [
            _scalars([prospect]),  # prospect lookup
            _rowcount(0),  # screening scrub
            _scalars([]),  # step progress
            _rowcount(1),  # form-submission scrub
            _rowcount(0),  # interview scrub
            _scalars([]),  # documents
            _rowcount(0),  # document delete
        ]
    )
    service = MemberAnonymizationService(db)
    user = SimpleNamespace(id="user-1", organization_id="org-1")

    summary = await service._scrub_prospect(user, "token123456")

    assert summary["form_submissions"] == 1
    submission_update = _statement_for(db, "form_submissions")
    compiled = str(submission_update)
    # submitted_by is set through a CASE keyed to the anonymized user's id,
    # not an unconditional NULL.
    assert "CASE WHEN" in compiled
    params = submission_update.compile().params
    assert "user-1" in params.values()
    # The member-identity fields are still cleared unconditionally.
    assert params["submitter_name"] is None
    assert params["submitter_email"] is None
    assert "submitted_by" not in params
