"""Every path that changes a self-report's attachments or decides it holds the row.

The behaviour is proven against real connections in
``test_training_submission_attachment_races.py``. This is the cheap guard that
fails when a later edit drops a lock from a path no race test covers, in the
manner of ``test_capacity_locking.py`` (CLAUDE.md pitfall #27).

Lock order, everywhere: the member's ``users`` row, then the submission, then
training records. A path that will insert a training record takes the users
row first (FOR SHARE), because the record's foreign key needs it and
anonymisation and the permanent delete take it before the submission.
"""

import inspect
import re
import textwrap

import pytest

from app.api.v1.endpoints import training_enhancements, training_submissions
from app.services import self_report_attachment_retention
from app.services.training_submission_service import TrainingSubmissionService

pytestmark = pytest.mark.unit


def _source(func) -> str:
    return textwrap.dedent(inspect.getsource(func))


def _first(pattern: str, source: str) -> int:
    match = re.search(pattern, source)
    assert match, f"{pattern!r} not found"
    return match.start()


def test_a_locked_read_refreshes_the_instance():
    source = _source(TrainingSubmissionService.get_submission)
    assert "with_for_update()" in source
    assert "populate_existing=True" in source


@pytest.mark.parametrize(
    "method",
    ["update_submission", "delete_submission", "reverse_approval"],
)
def test_member_and_reversal_paths_lock_the_submission(method):
    source = _source(getattr(TrainingSubmissionService, method))
    assert re.search(r"get_submission\([^)]*for_update=True", source, re.S), method


@pytest.mark.parametrize("method", ["review_submission", "submit_draft"])
def test_paths_that_create_a_record_lock_the_member_first(method):
    source = _source(getattr(TrainingSubmissionService, method))
    member = _first(r"_lock_submitter\(", source)
    submission = _first(r"get_submission\([^)]*for_update=True", source)
    assert member < submission, method


def test_the_member_lock_is_a_shared_lock_on_the_users_row():
    source = _source(TrainingSubmissionService._lock_submitter)
    assert "with_for_update(read=True)" in source
    assert "User.organization_id" in source


def test_an_approval_commits_once_with_its_record():
    """The status change and the record it spawns are one transaction: no
    commit between deciding and creating the record."""
    source = _source(TrainingSubmissionService.review_submission)
    approve = source[_first(r'if action == "approve":\n\s+# Apply overrides', source) :]
    approve = approve[: _first(r"elif action == \"reject\"", approve)]
    assert "_create_record_from_submission" in approve
    assert "commit()" not in approve


def test_the_attachment_endpoints_lock_the_submission():
    for func in (
        training_submissions.delete_submission_attachment,
        training_submissions.delete_submission,
    ):
        source = _source(func)
        assert "for_update=True" in source, func.__name__


@pytest.mark.parametrize(
    "func, store",
    [
        (training_submissions.upload_submission_attachment, "_store_attachment_file("),
        (training_enhancements.upload_record_attachment, "store_upload("),
    ],
)
def test_an_upload_rereads_the_row_locked_after_storing(func, store):
    """The file is stored and scanned outside the lock, so a slow upload does
    not hold up an approval; the row is re-read locked afterwards and checked
    again before the list is written."""
    source = _source(func)
    stored_at = source.index(store)
    assert "for_update=True" in source[stored_at:], func.__name__


def test_retention_locks_the_records_it_rewrites():
    source = _source(
        self_report_attachment_retention.SelfReportAttachmentRetention._strip_records
    )
    assert "with_for_update()" in source
    assert "populate_existing=True" in source
