"""Unit tests for _scrub_prospect's step-progress handling (no DB).

The integration coverage lives in test_member_anonymization.py; these
verify the PR #1412 review fixes — mapped_data redaction and duplicate
submission collection — against a recorded fake session.
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


async def test_scrub_prospect_redacts_mapped_data_and_collects_duplicates():
    prospect = SimpleNamespace(
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
    submission_update = next(
        stmt
        for stmt in db.statements
        if getattr(getattr(stmt, "table", None), "name", "") == "form_submissions"
    )
    params = submission_update.compile().params
    bound_ids = set()
    for value in params.values():
        # The IN clause binds as one expanding parameter holding the id list.
        values = value if isinstance(value, (list, tuple, set)) else [value]
        bound_ids.update(v for v in values if str(v).startswith("submission-"))
    assert bound_ids == {"submission-original", "submission-duplicate"}
