"""Tests for Governance -> Legal Documents (propose / publish workflow)."""

import inspect
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints.legal_documents import (
    _assert_may_modify,
    delete_revision,
    update_revision,
)
from app.models.audit import AuditLog
from app.models.legal import (
    LegalDocumentRevision,
    LegalDocumentType,
    LegalRevisionStatus,
)
from app.models.user import Organization, User
from app.schemas.legal import LegalRevisionUpdate
from app.services.legal_service import (
    EFFECTIVE_DATE_KEY,
    SETTINGS_KEY,
    LegalDocumentService,
    effective_date_for,
)
from app.utils.model_updates import apply_updates


class TestWriteSettings:
    """The publish write into Organization.settings, without a database.

    This is the piece that silently does nothing when it is wrong: a shallow
    copy of a JSON column compares equal to SQLAlchemy's committed state and
    the UPDATE is skipped, so publishing reports success and members keep
    reading the old notice (pitfall #12).
    """

    pytestmark = pytest.mark.unit

    def _service(self) -> LegalDocumentService:
        return LegalDocumentService(db=None)  # type: ignore[arg-type]

    def test_publishes_body_and_date(self):
        org = Organization(name="Falls Church VFD", slug="fcvfd")
        self._service()._write_settings(
            org,
            LegalDocumentType.PRIVACY_POLICY,
            body="Our own notice.",
            effective_date="March 3, 2026",
        )
        assert org.settings["legal"]["privacy_policy"] == "Our own notice."
        assert org.settings["legal"]["privacy_policy_effective_date"] == "March 3, 2026"

    def test_publishing_one_document_leaves_the_other_alone(self):
        org = Organization(name="Falls Church VFD", slug="fcvfd")
        org.settings = {"legal": {"terms_of_service": "Existing terms."}}
        self._service()._write_settings(
            org,
            LegalDocumentType.PRIVACY_POLICY,
            body="New notice.",
            effective_date=None,
        )
        assert org.settings["legal"]["terms_of_service"] == "Existing terms."
        assert org.settings["legal"]["privacy_policy"] == "New notice."

    def test_publishing_one_document_does_not_misdate_the_other(self):
        # Regression for DOC-10 finding #3: a single shared "last_updated"
        # key let publishing privacy alone attribute its date to terms too,
        # or (published without a date) inherit terms' existing date.
        org = Organization(name="Falls Church VFD", slug="fcvfd")
        org.settings = {
            "legal": {
                "terms_of_service": "Existing terms.",
                "terms_of_service_effective_date": "Jan 1, 2026",
            }
        }
        self._service()._write_settings(
            org,
            LegalDocumentType.PRIVACY_POLICY,
            body="New privacy notice.",
            effective_date="March 3, 2026",
        )
        legal = org.settings["legal"]
        assert legal["privacy_policy_effective_date"] == "March 3, 2026"
        assert legal["terms_of_service_effective_date"] == "Jan 1, 2026"

    def test_publishing_without_a_date_clears_a_stale_one(self):
        # The date belongs to the revision, not the document type: publishing
        # a new revision with no effective_date must not leave a previous
        # revision's date attributed to the new text.
        org = Organization(name="Falls Church VFD", slug="fcvfd")
        org.settings = {
            "legal": {
                "privacy_policy": "Old notice.",
                "privacy_policy_effective_date": "Jan 1, 2026",
            }
        }
        self._service()._write_settings(
            org,
            LegalDocumentType.PRIVACY_POLICY,
            body="New notice.",
            effective_date=None,
        )
        # The key stays present, set to None, rather than being popped
        # (Codex round-2 on #1826 / DOC-19): a popped key is indistinguishable
        # from "never published under the per-type scheme" and would let
        # effective_date_for's legacy fallback resurrect a stale date.
        assert org.settings["legal"]["privacy_policy_effective_date"] is None

    def test_publishing_without_a_date_does_not_resurrect_the_legacy_date(self):
        # DOC-19 (Codex round-2 on #1826): an org still carrying the
        # pre-migration shared "last_updated" key must not have it resurface
        # on a *new* publish that explicitly leaves the date blank.
        org = Organization(name="Falls Church VFD", slug="fcvfd")
        org.settings = {
            "legal": {
                "privacy_policy": "Old notice.",
                "last_updated": "Jan 1, 2026",
            }
        }
        self._service()._write_settings(
            org,
            LegalDocumentType.PRIVACY_POLICY,
            body="New notice.",
            effective_date=None,
        )
        legal = org.settings["legal"]
        assert legal["privacy_policy_effective_date"] is None
        assert effective_date_for(legal, LegalDocumentType.PRIVACY_POLICY) is None
        # The legacy key itself is untouched -- an unrelated document type
        # that has never been republished still needs to read it.
        assert legal["last_updated"] == "Jan 1, 2026"

    def test_preserves_unrelated_settings_keys(self):
        org = Organization(name="Falls Church VFD", slug="fcvfd")
        org.settings = {"enabled_modules": ["events"], "events": {"visible": True}}
        self._service()._write_settings(
            org,
            LegalDocumentType.TERMS_OF_SERVICE,
            body="Terms.",
            effective_date=None,
        )
        assert org.settings["enabled_modules"] == ["events"]
        assert org.settings["events"] == {"visible": True}

    def test_reverting_clears_only_that_document(self):
        org = Organization(name="Falls Church VFD", slug="fcvfd")
        org.settings = {
            "legal": {
                "privacy_policy": "Custom notice.",
                "privacy_policy_effective_date": "March 3, 2026",
                "terms_of_service": "Custom terms.",
                "terms_of_service_effective_date": "Jan 1, 2026",
            }
        }
        self._service()._write_settings(
            org, LegalDocumentType.PRIVACY_POLICY, body=None, effective_date=None
        )
        legal = org.settings["legal"]
        assert "privacy_policy" not in legal
        assert "privacy_policy_effective_date" not in legal
        # Each document's date is its own key, so reverting privacy cannot
        # touch the still-published terms notice or its date.
        assert legal["terms_of_service"] == "Custom terms."
        assert legal["terms_of_service_effective_date"] == "Jan 1, 2026"

    def test_survives_a_hand_edited_settings_column(self):
        # settings["legal"] is free-form JSON an admin may have typed.
        org = Organization(name="Falls Church VFD", slug="fcvfd")
        org.settings = {"legal": "not a dict"}
        self._service()._write_settings(
            org, LegalDocumentType.PRIVACY_POLICY, body="Notice.", effective_date=None
        )
        assert org.settings["legal"]["privacy_policy"] == "Notice."

    def test_does_not_mutate_the_previous_settings_object(self):
        # The reassigned value must be a genuinely new object, or SQLAlchemy
        # compares new == old and skips the UPDATE.
        org = Organization(name="Falls Church VFD", slug="fcvfd")
        org.settings = {"legal": {"privacy_policy": "Old."}}
        before = org.settings
        snapshot = dict(before["legal"])
        self._service()._write_settings(
            org, LegalDocumentType.PRIVACY_POLICY, body="New.", effective_date=None
        )
        assert snapshot == {"privacy_policy": "Old."}
        assert org.settings["legal"]["privacy_policy"] == "New."

    def test_settings_key_matches_the_public_endpoint(self):
        # A rename here that is not mirrored in app/api/public/legal.py
        # publishes into a key nothing serves — the page would keep showing
        # the platform default with no error anywhere.
        assert SETTINGS_KEY[LegalDocumentType.PRIVACY_POLICY] == "privacy_policy"
        assert SETTINGS_KEY[LegalDocumentType.TERMS_OF_SERVICE] == "terms_of_service"

    def test_effective_date_keys_are_distinct_per_document(self):
        # The whole point of DOC-10 finding #3's fix: one shared key can't
        # come back by accident.
        assert (
            EFFECTIVE_DATE_KEY[LegalDocumentType.PRIVACY_POLICY]
            != EFFECTIVE_DATE_KEY[LegalDocumentType.TERMS_OF_SERVICE]
        )


class TestEffectiveDateFor:
    """The read side of the per-document-date fix, with a legacy fallback."""

    pytestmark = pytest.mark.unit

    def test_reads_the_per_type_key(self):
        legal = {"terms_of_service_effective_date": "Jan 1, 2026"}
        assert (
            effective_date_for(legal, LegalDocumentType.TERMS_OF_SERVICE)
            == "Jan 1, 2026"
        )

    def test_falls_back_to_the_legacy_shared_key(self):
        # An install that published under the pre-fix shared key keeps
        # showing its date until the document is republished.
        legal = {"last_updated": "Feb 2, 2026"}
        assert (
            effective_date_for(legal, LegalDocumentType.PRIVACY_POLICY) == "Feb 2, 2026"
        )

    def test_per_type_key_wins_over_the_legacy_fallback(self):
        legal = {
            "privacy_policy_effective_date": "March 3, 2026",
            "last_updated": "Feb 2, 2026",
        }
        assert (
            effective_date_for(legal, LegalDocumentType.PRIVACY_POLICY)
            == "March 3, 2026"
        )

    def test_no_date_anywhere_yields_none(self):
        assert effective_date_for({}, LegalDocumentType.PRIVACY_POLICY) is None

    def test_explicit_none_per_type_key_does_not_fall_back(self):
        # DOC-19 (Codex round-2 on #1826): an explicit None means "published
        # under the per-type scheme, date intentionally left blank" -- it
        # must win over the legacy key, not be treated as absent.
        legal = {
            "privacy_policy_effective_date": None,
            "last_updated": "Feb 2, 2026",
        }
        assert effective_date_for(legal, LegalDocumentType.PRIVACY_POLICY) is None


class TestPublishLocking:
    """DOC-10 finding #8: two concurrent publishes of the same document type
    must not both read the current published revision, archive it, and mark
    their own row PUBLISHED — CLAUDE.md pitfall #27's read-then-write shape.

    Checked by source inspection rather than two real concurrent connections,
    the same approach `test_capacity_locking.py` uses for this exact class of
    bug: a two-connection race is expensive to set up reliably in a suite that
    runs against a shared MySQL instance, and a static check catches the same
    regression a live race would — a lock nobody calls, or a plain read of the
    very row the lock is meant to protect, is invisible in every test that
    does not race itself.
    """

    pytestmark = pytest.mark.unit

    def test_publish_locks_the_organization_row(self):
        source = inspect.getsource(LegalDocumentService.publish)
        assert "_get_organization_for_update" in source

    def test_revert_locks_the_organization_row(self):
        source = inspect.getsource(LegalDocumentService.revert_to_default)
        assert "_get_organization_for_update" in source

    def test_the_organization_lock_is_a_locking_read(self):
        source = inspect.getsource(LegalDocumentService._get_organization_for_update)
        assert "with_for_update" in source

    def test_archive_published_is_a_locking_read(self):
        # The lock above is not enough on its own: under REPEATABLE READ, a
        # plain SELECT here would still answer from the snapshot taken before
        # the lock was acquired.
        source = inspect.getsource(LegalDocumentService._archive_published)
        assert "with_for_update" in source


class TestUpdateSemantics:
    """The three states an update payload can express, without a database.

    Kept DB-free because this is the pitfall that fails *quietly*: dropping an
    explicit null acknowledges the clear with a 200 and leaves the old value
    in place, so nothing surfaces until someone notices the public page still
    shows last year's date.
    """

    pytestmark = pytest.mark.unit

    def _revision(self) -> LegalDocumentRevision:
        return LegalDocumentRevision(
            organization_id="org-1",
            document_type=LegalDocumentType.PRIVACY_POLICY,
            body="Original.",
            change_note="Original note.",
            effective_date="March 3, 2026",
        )

    def test_absent_key_leaves_the_field_untouched(self):
        revision = self._revision()
        apply_updates(revision, {"body": "Revised."})
        assert revision.body == "Revised."
        assert revision.effective_date == "March 3, 2026"

    def test_explicit_null_clears_a_nullable_field(self):
        revision = self._revision()
        apply_updates(revision, {"effective_date": None})
        assert revision.effective_date is None

    def test_null_against_a_required_column_raises(self):
        revision = self._revision()
        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(revision, {"body": None})


class TestAssertMayModify:
    """The endpoint-layer guard on editing/deleting a draft.

    A proposer may only touch their own draft; a publisher may tidy up
    anyone's. Without this, any holder of ``legal.propose`` could rewrite or
    discard a colleague's proposal and leave their own name on it — the one
    thing a proposal record exists to prevent. Exercised directly (no DB):
    both branches turn on ``user_has_permission``, which reads only the
    transient ``positions``/``rank`` attributes.
    """

    pytestmark = pytest.mark.unit

    def _revision(self, created_by="u-author"):
        return LegalDocumentRevision(
            organization_id="org-1",
            document_type=LegalDocumentType.PRIVACY_POLICY,
            body="Body.",
            change_note="Note.",
            created_by=created_by,
        )

    def _user(self, user_id, *, permissions=()):
        return SimpleNamespace(
            id=user_id,
            positions=[SimpleNamespace(permissions=list(permissions))],
            rank=None,
        )

    def test_the_author_may_modify_their_own_draft(self):
        author = self._user("u-author")
        _assert_may_modify(self._revision(created_by="u-author"), author)

    def test_a_proposer_may_not_modify_someone_elses_draft(self):
        other = self._user("u-other", permissions=("legal.propose",))
        with pytest.raises(HTTPException) as exc:
            _assert_may_modify(self._revision(created_by="u-author"), other)
        assert exc.value.status_code == 403

    def test_a_publisher_may_modify_anyones_draft(self):
        publisher = self._user("u-publisher", permissions=("legal.publish",))
        _assert_may_modify(self._revision(created_by="u-author"), publisher)

    def test_settings_manage_may_modify_anyones_draft(self):
        admin = self._user("u-admin", permissions=("settings.manage",))
        _assert_may_modify(self._revision(created_by="u-author"), admin)


@pytest.mark.integration
class TestLegalDocumentWorkflow:
    """Draft -> publish -> archive, against the database."""

    async def _org(self, db, name="Falls Church VFD", slug="fcvfd") -> Organization:
        org = Organization(name=name, slug=slug)
        db.add(org)
        await db.flush()
        return org

    async def _draft(self, db, org, **kwargs) -> LegalDocumentRevision:
        service = LegalDocumentService(db)
        return await service.create_draft(
            organization_id=str(org.id),
            created_by=None,
            document_type=kwargs.pop("document_type", LegalDocumentType.PRIVACY_POLICY),
            body=kwargs.pop("body", "Proposed wording."),
            change_note=kwargs.pop("change_note", "Matches Article IV of the bylaws."),
            **kwargs,
        )

    async def test_create_draft_is_not_public(self, db_session):
        org = await self._org(db_session)
        revision = await self._draft(db_session, org)
        assert revision.status == LegalRevisionStatus.DRAFT
        # Nothing reaches the public page until somebody publishes.
        assert (org.settings or {}).get("legal", {}).get("privacy_policy") is None

    async def test_publish_makes_it_live(self, db_session):
        org = await self._org(db_session)
        revision = await self._draft(
            db_session, org, body="Our notice.", effective_date="March 3, 2026"
        )
        service = LegalDocumentService(db_session)
        published = await service.publish(
            str(revision.id), str(org.id), published_by=None
        )
        assert published.status == LegalRevisionStatus.PUBLISHED
        assert published.published_at is not None
        assert org.settings["legal"]["privacy_policy"] == "Our notice."
        assert org.settings["legal"]["privacy_policy_effective_date"] == "March 3, 2026"

    async def test_publishing_archives_the_previous_version(self, db_session):
        org = await self._org(db_session)
        service = LegalDocumentService(db_session)
        first = await self._draft(db_session, org, body="First.")
        await service.publish(str(first.id), str(org.id), published_by=None)
        second = await self._draft(db_session, org, body="Second.")
        await service.publish(str(second.id), str(org.id), published_by=None)

        await db_session.refresh(first)
        assert first.status == LegalRevisionStatus.ARCHIVED
        assert second.status == LegalRevisionStatus.PUBLISHED
        assert org.settings["legal"]["privacy_policy"] == "Second."

    async def test_published_revisions_cannot_be_edited_or_deleted(self, db_session):
        org = await self._org(db_session)
        service = LegalDocumentService(db_session)
        revision = await self._draft(db_session, org)
        await service.publish(str(revision.id), str(org.id), published_by=None)

        with pytest.raises(ValueError, match="Only drafts can be edited"):
            await service.update_draft(str(revision.id), str(org.id), {"body": "Edit."})
        with pytest.raises(ValueError, match="Only drafts can be deleted"):
            await service.delete_draft(str(revision.id), str(org.id))

    async def test_publishing_twice_is_rejected(self, db_session):
        org = await self._org(db_session)
        service = LegalDocumentService(db_session)
        revision = await self._draft(db_session, org)
        await service.publish(str(revision.id), str(org.id), published_by=None)
        with pytest.raises(ValueError, match="already published"):
            await service.publish(str(revision.id), str(org.id), published_by=None)

    async def test_revert_restores_the_platform_default(self, db_session):
        org = await self._org(db_session)
        service = LegalDocumentService(db_session)
        revision = await self._draft(db_session, org, body="Our notice.")
        await service.publish(str(revision.id), str(org.id), published_by=None)

        await service.revert_to_default(str(org.id), LegalDocumentType.PRIVACY_POLICY)
        await db_session.refresh(revision)
        assert revision.status == LegalRevisionStatus.ARCHIVED
        assert "privacy_policy" not in org.settings["legal"]

    async def test_revisions_are_org_scoped(self, db_session):
        # A permission is held within an organization and says nothing about
        # which org a path id belongs to (pitfall #14b).
        org_a = await self._org(db_session, "Org A", "org-a")
        other = await self._org(db_session, "Org B", "org-b")
        revision = await self._draft(db_session, org_a)

        service = LegalDocumentService(db_session)
        with pytest.raises(ValueError, match="not found"):
            await service.get_revision(str(revision.id), str(other.id))
        with pytest.raises(ValueError, match="not found"):
            await service.publish(str(revision.id), str(other.id), published_by=None)

    async def test_clearing_the_effective_date_persists(self, db_session):
        # An explicit null is the drafter emptying the box. Dropping it would
        # acknowledge the clear with a 200 and leave the old date in place —
        # and the date is what members read as "Last updated" (pitfall #1).
        org = await self._org(db_session)
        revision = await self._draft(db_session, org, effective_date="March 3, 2026")
        service = LegalDocumentService(db_session)
        updated = await service.update_draft(
            str(revision.id), str(org.id), {"effective_date": None}
        )
        assert updated.effective_date is None

    async def test_omitting_a_field_leaves_it_alone(self, db_session):
        org = await self._org(db_session)
        revision = await self._draft(db_session, org, effective_date="March 3, 2026")
        service = LegalDocumentService(db_session)
        updated = await service.update_draft(
            str(revision.id), str(org.id), {"body": "Revised."}
        )
        assert updated.body == "Revised."
        assert updated.effective_date == "March 3, 2026"

    async def test_nulling_a_required_field_is_rejected_not_dropped(self, db_session):
        org = await self._org(db_session)
        revision = await self._draft(db_session, org)
        service = LegalDocumentService(db_session)
        with pytest.raises(ValueError, match="cannot be cleared"):
            await service.update_draft(str(revision.id), str(org.id), {"body": None})

    async def test_update_draft_changes_body_and_note(self, db_session):
        org = await self._org(db_session)
        revision = await self._draft(db_session, org)
        service = LegalDocumentService(db_session)
        updated = await service.update_draft(
            str(revision.id),
            str(org.id),
            {"body": "Revised.", "change_note": "Per counsel review."},
        )
        assert updated.body == "Revised."
        assert updated.change_note == "Per counsel review."


@pytest.mark.integration
class TestRevisionAuditLogging:
    """DOC-27: editing or discarding a draft revision had no audit trail --
    unlike propose/publish/revert, which all already log. A draft is not
    public, but the governance record around who proposed and who edited or
    discarded a proposal is the whole reason this workflow keeps a revision
    table instead of editing settings in place.
    """

    async def _org(self, db, slug="fcvfd-audit") -> Organization:
        org = Organization(name="Falls Church VFD", slug=slug)
        db.add(org)
        await db.flush()
        return org

    async def _author(self, db, org_id) -> User:
        # A real row, not a SimpleNamespace stand-in: create_draft inserts
        # `created_by` as an FK to `users.id`, which a synthetic id would
        # violate. Its own `positions`/`rank` are unset (no grants), which is
        # fine here -- `_assert_may_modify` admits the draft's own author
        # regardless of permissions; only a *different* caller needs one of
        # the propose/publish/settings.manage tiers.
        user = User(
            organization_id=org_id, username="author", email="author@example.com"
        )
        db.add(user)
        await db.flush()
        # _assert_may_modify -> _can_publish reads user.positions. A bare
        # attribute access on an unloaded relationship needs a lazy load,
        # which needs a greenlet context this plain `await` test setup
        # doesn't provide (MissingGreenlet) -- force it through an explicit
        # async refresh instead of leaving it to trigger implicitly.
        await db.refresh(user, attribute_names=["positions"])
        return user

    async def _draft(self, db, org, created_by) -> LegalDocumentRevision:
        service = LegalDocumentService(db)
        return await service.create_draft(
            organization_id=str(org.id),
            created_by=str(created_by),
            document_type=LegalDocumentType.PRIVACY_POLICY,
            body="Proposed wording.",
            change_note="Matches Article IV of the bylaws.",
        )

    async def _last_event(self, db, event_type):
        result = await db.execute(
            select(AuditLog)
            .where(AuditLog.event_type == event_type)
            .order_by(AuditLog.id.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def test_update_revision_is_audited(self, db_session):
        org = await self._org(db_session)
        author = await self._author(db_session, org.id)
        revision = await self._draft(db_session, org, author.id)

        await update_revision(
            str(revision.id),
            LegalRevisionUpdate(body="Revised wording."),
            db=db_session,
            current_user=author,
        )

        entry = await self._last_event(db_session, "legal.revision_updated")
        assert entry is not None
        assert entry.event_data["revision_id"] == str(revision.id)
        assert entry.event_data["document_type"] == "privacy_policy"

    async def test_delete_revision_is_audited(self, db_session):
        org = await self._org(db_session)
        author = await self._author(db_session, org.id)
        revision = await self._draft(db_session, org, author.id)
        revision_id = str(revision.id)

        await delete_revision(revision_id, db=db_session, current_user=author)

        entry = await self._last_event(db_session, "legal.revision_discarded")
        assert entry is not None
        assert entry.event_data["revision_id"] == revision_id
        assert entry.event_data["document_type"] == "privacy_policy"
