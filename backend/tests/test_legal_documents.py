"""Tests for Governance -> Legal Documents (propose / publish workflow)."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.legal_documents import _assert_may_modify
from app.models.legal import (
    LegalDocumentRevision,
    LegalDocumentType,
    LegalRevisionStatus,
)
from app.models.user import Organization
from app.services.legal_service import SETTINGS_KEY, LegalDocumentService
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
        assert org.settings["legal"]["last_updated"] == "March 3, 2026"

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
                "terms_of_service": "Custom terms.",
                "last_updated": "March 3, 2026",
            }
        }
        self._service()._write_settings(
            org, LegalDocumentType.PRIVACY_POLICY, body=None, effective_date=None
        )
        legal = org.settings["legal"]
        assert "privacy_policy" not in legal
        assert legal["terms_of_service"] == "Custom terms."
        # The date belongs to whatever is still published; blanking it here
        # would strip the revision date off a notice that never changed.
        assert legal["last_updated"] == "March 3, 2026"

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
        assert org.settings["legal"]["last_updated"] == "March 3, 2026"

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
