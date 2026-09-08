"""
Tests for the document service (app/services/document_service.py).

Covers the published-minutes HTML rendering (_generate_minutes_html) with a
focus on HTML escaping of member-supplied text (XSS) and present/absent
attendee partitioning, plus the timezone helper (DB mocked; no MySQL), and
``initialize_system_folders``'s locking/reconciliation shape (source
inspection plus real-database integration tests).
"""

import inspect
from datetime import datetime
from datetime import timezone as tz
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.models.document import DocumentFolder, FolderVisibility
from app.models.minute import MinutesMeetingType, MinutesStatus
from app.models.user import Organization, User
from app.services.document_service import DocumentService


def _svc(db=None):
    return DocumentService(db or MagicMock())


def _minutes(**kw):
    header = kw.get("header", {"org_name": "Falls Church FD", "subtitle": "Minutes"})
    return SimpleNamespace(
        get_effective_header=lambda: header,
        get_effective_footer=lambda: {},
        get_sections=lambda: kw.get("sections", []),
        meeting_type=kw.get("meeting_type", "business_meeting"),
        meeting_date=kw.get(
            "meeting_date", datetime(2026, 1, 15, 19, 0, tzinfo=tz.utc)
        ),
        title=kw.get("title", "Monthly Business Meeting"),
        location=kw.get("location"),
        called_by=kw.get("called_by"),
        called_to_order_at=None,
        adjourned_at=None,
        attendees=kw.get("attendees", []),
        quorum_met=kw.get("quorum_met"),
        quorum_count=kw.get("quorum_count"),
        motions=kw.get("motions", []),
        action_items=kw.get("action_items", []),
        approved_at=kw.get("approved_at"),
        status=kw.get("status", "published"),
        id="min-1",
        published_document_id=None,
    )


class TestGenerateMinutesHtml:
    def test_renders_org_title_and_type(self):
        html = _svc()._generate_minutes_html(_minutes())
        assert "Falls Church FD" in html
        assert "Monthly Business Meeting" in html
        assert "Business Meeting" in html  # meeting_type humanized

    def test_escapes_xss_in_title(self):
        html = _svc()._generate_minutes_html(
            _minutes(title="<script>alert(1)</script>")
        )
        assert "<script>alert(1)</script>" not in html
        assert "&lt;script&gt;" in html

    def test_partitions_present_and_absent(self):
        attendees = [
            {"name": "Jane Smith", "present": True, "role": "Chair"},
            {"name": "Bob Jones", "present": True},
            {"name": "Sam Lee", "present": False},
        ]
        html = _svc()._generate_minutes_html(_minutes(attendees=attendees))
        assert "Present (2):" in html
        assert "Absent (1):" in html
        assert "Jane Smith" in html
        assert "(Chair)" in html

    def test_escapes_attendee_names(self):
        attendees = [{"name": "<b>Hax</b>", "present": True}]
        html = _svc()._generate_minutes_html(_minutes(attendees=attendees))
        assert "<b>Hax</b>" not in html
        assert "&lt;b&gt;Hax&lt;/b&gt;" in html

    def test_quorum_line_when_set(self):
        attendees = [{"name": "A", "present": True}]
        html = _svc()._generate_minutes_html(
            _minutes(attendees=attendees, quorum_met=True, quorum_count=12)
        )
        assert "Quorum met" in html
        assert "12 members" in html


class TestToLocal:
    def test_naive_treated_as_utc(self):
        out = _svc()._to_local(datetime(2026, 6, 1, 12, 0), "America/New_York")
        assert out.hour == 8  # noon UTC -> 8am EDT

    def test_none_timezone_returns_utc(self):
        dt = datetime(2026, 6, 1, 12, 0, tzinfo=tz.utc)
        out = _svc()._to_local(dt, None)
        # No tz name -> stays UTC.
        assert out.hour == 12


class TestPublishMinutesExecutiveGuard:
    """MM2-1: executive-session minutes must not be publishable to the broadly
    readable meeting-minutes document folder (documents.view), which would
    bypass the executive restriction enforced on every minutes read path."""

    async def test_executive_minutes_cannot_be_published(self):
        minutes = SimpleNamespace(
            status=MinutesStatus.APPROVED.value,
            meeting_type=MinutesMeetingType.EXECUTIVE.value,
        )
        with pytest.raises(ValueError, match="Executive-session"):
            await _svc().publish_minutes(minutes, "org-1", "user-1")

    async def test_executive_enum_value_also_rejected(self):
        # meeting_type may arrive as the enum rather than its .value string.
        minutes = SimpleNamespace(
            status=MinutesStatus.APPROVED.value,
            meeting_type=MinutesMeetingType.EXECUTIVE,
        )
        with pytest.raises(ValueError, match="Executive-session"):
            await _svc().publish_minutes(minutes, "org-1", "user-1")

    async def test_unapproved_rejected_before_executive_check(self):
        # The approved gate runs first: a draft executive minutes reports the
        # approval error, not the executive one.
        minutes = SimpleNamespace(
            status=MinutesStatus.DRAFT.value,
            meeting_type=MinutesMeetingType.EXECUTIVE.value,
        )
        with pytest.raises(ValueError, match="approved"):
            await _svc().publish_minutes(minutes, "org-1", "user-1")


class TestInitializeSystemFoldersIsLocked:
    """DOC-29: ``initialize_system_folders`` is the *other* get-or-create for
    an organization's ``members`` system folder --
    ``DocumentsService.ensure_member_folder`` (documents_service.py) is the
    one this feature's own DOC-28 fix locked. This method had no lock at
    all: a brand-new organization's first ``POST /minutes/{id}/publish``
    (which creates the whole ``SYSTEM_FOLDERS`` set, including ``members``,
    if none exist yet) could race a member's first ``GET
    /documents/my-folder`` and, since there is no uniqueness constraint
    behind ``(organization_id, slug)``, both create a ``members`` row --
    reopening DOC-28's exact failure mode through a second, unlocked
    creator DOC-28's own lock never reached.
    """

    def test_locks_the_organization_row_before_the_existence_check(self):
        source = inspect.getsource(DocumentService.initialize_system_folders)
        before_check, sep, _ = source.partition(
            "existing_result = await self.db.execute("
        )
        assert sep, (
            "expected to find the system-folder existence check to anchor "
            "the search for a lock taken before it"
        )
        assert "with_for_update()" in before_check, (
            "initialize_system_folders must lock the organization row "
            "before its existence check, or it can race "
            "DocumentsService.ensure_member_folder's own organization-row "
            "lock and still create a duplicate `members` root"
        )

    def test_existence_check_is_itself_a_locking_read(self):
        """Codex review, PR #2411, Pitfall #27's second half: locking the
        organization row is not sufficient on its own. ``publish_minutes``
        already reads a folder via ``get_folder_by_slug`` before calling
        this method, which under this app's default REPEATABLE READ
        establishes the transaction's snapshot before the organization
        lock above is acquired -- a plain read would still answer from
        that earlier snapshot and could report zero system folders even
        though a concurrent transaction already created and committed one
        while this one waited for the lock.
        """
        source = inspect.getsource(DocumentService.initialize_system_folders)
        _, sep, rest = source.partition("existing_result = await self.db.execute(")
        assert sep, (
            "expected to find the system-folder existence check to anchor "
            "the search for a locking read"
        )
        existence_check, _, _ = rest.partition("if missing_defs:")
        assert "with_for_update()" in existence_check, (
            "the existence check itself must be a locking read "
            "(with_for_update()), not just guarded by the organization "
            "row's lock -- a plain SELECT can still answer from a stale "
            "REPEATABLE READ snapshot taken before that lock was acquired"
        )

    @pytest.mark.integration
    async def test_reconciles_missing_system_folders_around_an_existing_one(
        self, db_session
    ):
        """Codex review, PR #2411, round 3: the previous fix's existence
        check short-circuited on ANY existing system folder, not ALL of
        them. ``ensure_member_folder`` (DocumentsService) only ever
        inserts the single "members" definition on its own get-or-create
        -- a member visiting their Documents folder before anyone had
        published minutes left exactly that one system folder in place.
        The next ``publish_minutes`` call then found a nonzero count,
        returned without creating "meeting-minutes", and failed with a
        ``RuntimeError``. Reconciling against the missing slugs instead
        of an all-or-nothing create must fill in what's missing rather
        than treating "something exists" as "everything exists".
        """
        org = Organization(name="Reconcile VFD", slug="reconcile-vfd")
        db_session.add(org)
        await db_session.flush()
        user = User(
            organization_id=org.id,
            username="chief1",
            email="chief1@example.com",
            first_name="Pat",
            last_name="Lee",
        )
        db_session.add(user)
        await db_session.flush()

        # The one folder ensure_member_folder's own get-or-create would
        # have created, simulating it winning the race first.
        db_session.add(
            DocumentFolder(
                organization_id=org.id,
                slug="members",
                name="Member Files",
                is_system=True,
                visibility=FolderVisibility.ORGANIZATION,
            )
        )
        await db_session.flush()

        service = DocumentService(db_session)
        folders = await service.initialize_system_folders(org.id, user.id)

        slugs = [f.slug for f in folders]
        assert "meeting-minutes" in slugs, (
            "initialize_system_folders must create the missing system "
            "folders even when one ('members') already exists -- not "
            "short-circuit on any nonzero count"
        )
        assert slugs.count("members") == 1, (
            "the pre-existing 'members' folder must not be duplicated by "
            "reconciliation"
        )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
