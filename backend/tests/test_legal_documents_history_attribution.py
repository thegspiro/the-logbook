"""Legal Documents: reverts in the history, and edits to someone else's proposal.

Owner decisions of 2026-11-01 (``docs/KNOWN_LIMITATIONS.md``, "Legal Documents
— History, Attribution and Formatting Gaps", W54-3 and W54-4):

- Restoring the built-in text is an entry in the published history, naming who
  restored it and when. Before, the history read "Replaced — published by …"
  and stopped, and only the audit log knew.
- A publisher editing another member's proposal is named on it, with the time;
  the proposer stays the proposer.
"""

import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from app.api.v1.endpoints import legal_documents as ep
from app.models.legal import (
    LegalDocumentRevision,
    LegalDocumentType,
    LegalRevisionStatus,
)
from app.models.user import Organization, User
from app.schemas.legal import LegalRevisionUpdate
from app.services.legal_service import REVERT_NOTE, LegalDocumentService

pytestmark = [pytest.mark.integration]

PRIVACY = LegalDocumentType.PRIVACY_POLICY


async def _org(db) -> Organization:
    org = Organization(
        name="Attribution VFD", slug=f"legal-attr-{uuid.uuid4().hex[:8]}"
    )
    db.add(org)
    await db.flush()
    return org


async def _member(db, org, name) -> User:
    tag = uuid.uuid4().hex[:8]
    user = User(
        organization_id=str(org.id),
        username=f"{name.lower()}-{tag}",
        email=f"{name.lower()}-{tag}@example.com",
        first_name=name,
        last_name="Tester",
    )
    db.add(user)
    await db.flush()
    # _assert_may_modify reads user.positions; load it explicitly so no lazy
    # load fires outside a greenlet (MissingGreenlet).
    await db.refresh(user, attribute_names=["positions"])
    return user


async def _draft(
    db, org, created_by, body="Proposed wording."
) -> LegalDocumentRevision:
    return await LegalDocumentService(db).create_draft(
        organization_id=str(org.id),
        created_by=str(created_by) if created_by else None,
        document_type=PRIVACY,
        body=body,
        change_note="Matches Article IV of the bylaws.",
    )


async def _overview(db, org, caller):
    with patch.object(ep, "_can_publish", return_value=True):
        result = await ep.get_legal_documents(db=db, current_user=caller)
    return {doc.document_type: doc for doc in result.documents}[PRIVACY]


class TestRevertIsRecorded:
    async def test_reverting_published_text_writes_a_history_row(self, db_session):
        org = await _org(db_session)
        publisher = await _member(db_session, org, "Pat")
        service = LegalDocumentService(db_session)
        revision = await _draft(db_session, org, publisher.id, "Our notice.")
        await service.publish(str(revision.id), str(org.id), str(publisher.id))

        revert = await service.revert_to_default(
            str(org.id), PRIVACY, reverted_by=str(publisher.id)
        )

        assert revert is not None
        assert revert.reverts_to_default is True
        assert revert.status == LegalRevisionStatus.ARCHIVED
        assert revert.published_by == str(publisher.id)
        assert revert.published_at is not None
        assert revert.change_note == REVERT_NOTE
        # The replaced text is archived exactly as before — untouched.
        await db_session.refresh(revision)
        assert revision.status == LegalRevisionStatus.ARCHIVED
        assert revision.body == "Our notice."
        assert "privacy_policy" not in org.settings["legal"]

    async def test_the_history_names_who_restored_the_built_in_text(self, db_session):
        org = await _org(db_session)
        publisher = await _member(db_session, org, "Pat")
        service = LegalDocumentService(db_session)
        revision = await _draft(db_session, org, publisher.id, "Our notice.")
        await service.publish(str(revision.id), str(org.id), str(publisher.id))
        # Whole-second columns: move the publish into the past so the revert,
        # a moment later, cannot share its timestamp and tie.
        revision.published_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        await db_session.flush()
        with patch.object(ep, "_can_publish", return_value=True):
            await ep.revert_to_default(PRIVACY, db=db_session, current_user=publisher)

        doc = await _overview(db_session, org, publisher)

        assert doc.using_platform_default is True
        assert doc.history_total == 2
        newest = doc.history[0]
        assert newest.reverts_to_default is True
        assert newest.published_by_name == publisher.full_name
        assert newest.published_at is not None
        assert doc.history[1].id == str(revision.id)
        assert doc.history[1].reverts_to_default is False

    async def test_reverting_text_with_no_revision_row_is_still_recorded(
        self, db_session
    ):
        # Text configured in settings before this screen existed has no row;
        # restoring the default still changed what members saw.
        org = await _org(db_session)
        org.settings = {"legal": {"privacy_policy": "Hand-configured notice."}}
        await db_session.flush()
        publisher = await _member(db_session, org, "Pat")

        revert = await LegalDocumentService(db_session).revert_to_default(
            str(org.id), PRIVACY, reverted_by=str(publisher.id)
        )

        assert revert is not None
        assert revert.reverts_to_default is True

    async def test_reverting_when_the_default_is_already_live_records_nothing(
        self, db_session
    ):
        org = await _org(db_session)
        revert = await LegalDocumentService(db_session).revert_to_default(
            str(org.id), PRIVACY, reverted_by=None
        )
        assert revert is None
        _, total = await LegalDocumentService(db_session).list_revisions_page(
            str(org.id), PRIVACY, False, 0, 10
        )
        assert total == 0

    async def test_a_revert_row_cannot_be_edited_published_or_discarded(
        self, db_session
    ):
        org = await _org(db_session)
        service = LegalDocumentService(db_session)
        revision = await _draft(db_session, org, None)
        await service.publish(str(revision.id), str(org.id), published_by=None)
        revert = await service.revert_to_default(str(org.id), PRIVACY)
        assert revert is not None

        with pytest.raises(ValueError, match="Only drafts can be edited"):
            await service.update_draft(str(revert.id), str(org.id), {"body": "x"})
        with pytest.raises(ValueError, match="Only drafts can be published"):
            await service.publish(str(revert.id), str(org.id), published_by=None)
        with pytest.raises(ValueError, match="Only drafts can be deleted"):
            await service.delete_draft(str(revert.id), str(org.id))

    async def test_history_is_ordered_by_when_each_entry_went_live(self, db_session):
        # Drafted before the revert, published after it: the history must put
        # it above the revert, because that is the order members saw them in.
        org = await _org(db_session)
        service = LegalDocumentService(db_session)
        first = await _draft(db_session, org, None, "First.")
        drafted_early = await _draft(db_session, org, None, "Drafted early.")
        await service.publish(str(first.id), str(org.id), published_by=None)
        revert = await service.revert_to_default(str(org.id), PRIVACY)
        assert revert is not None
        await service.publish(str(drafted_early.id), str(org.id), published_by=None)
        # The columns store whole seconds, so three steps in one test share a
        # timestamp. Pin them: both drafts proposed on day 1, then first live
        # on day 2, the revert on day 3 and the early draft live on day 4. The
        # revert row is newest by created_at; only published_at orders it
        # correctly.
        day = [datetime(2026, 11, d, 12, tzinfo=timezone.utc) for d in (1, 2, 3, 4)]
        first.created_at = drafted_early.created_at = day[0]
        first.published_at = day[1]
        revert.created_at = revert.published_at = day[2]
        drafted_early.published_at = day[3]
        await db_session.flush()

        items, _ = await service.list_revisions_page(str(org.id), PRIVACY, False, 0, 10)

        assert [r.id for r in items] == [drafted_early.id, revert.id, first.id]


class TestEditedBy:
    async def test_a_publisher_editing_someone_elses_draft_is_named(self, db_session):
        org = await _org(db_session)
        proposer = await _member(db_session, org, "Sam")
        publisher = await _member(db_session, org, "Pat")
        revision = await _draft(db_session, org, proposer.id)

        with patch.object(ep, "_can_publish", return_value=True):
            response = await ep.update_revision(
                str(revision.id),
                LegalRevisionUpdate(body="Tidied wording."),
                db=db_session,
                current_user=publisher,
            )

        assert response.created_by == str(proposer.id)
        assert response.created_by_name == proposer.full_name
        assert response.edited_by == str(publisher.id)
        assert response.edited_by_name == publisher.full_name
        assert response.edited_at is not None

    async def test_the_proposer_editing_their_own_draft_names_no_editor(
        self, db_session
    ):
        org = await _org(db_session)
        proposer = await _member(db_session, org, "Sam")
        revision = await _draft(db_session, org, proposer.id)

        response = await ep.update_revision(
            str(revision.id),
            LegalRevisionUpdate(body="My own second thoughts."),
            db=db_session,
            current_user=proposer,
        )

        assert response.edited_by is None
        assert response.edited_by_name is None
        assert response.edited_at is None

    async def test_the_editor_stays_named_once_the_draft_is_published(self, db_session):
        org = await _org(db_session)
        proposer = await _member(db_session, org, "Sam")
        publisher = await _member(db_session, org, "Pat")
        revision = await _draft(db_session, org, proposer.id)
        service = LegalDocumentService(db_session)
        await service.update_draft(
            str(revision.id),
            str(org.id),
            {"body": "Tidied wording."},
            edited_by=str(publisher.id),
        )
        await service.publish(str(revision.id), str(org.id), str(publisher.id))

        doc = await _overview(db_session, org, publisher)

        live = doc.history[0]
        assert live.created_by_name == proposer.full_name
        assert live.edited_by_name == publisher.full_name
        assert live.published_by_name == publisher.full_name

    async def test_the_edit_columns_cannot_be_written_through_the_payload(
        self, db_session
    ):
        # The editor is whoever made the request, never a value in it.
        org = await _org(db_session)
        proposer = await _member(db_session, org, "Sam")
        someone = await _member(db_session, org, "Lee")
        revision = await _draft(db_session, org, proposer.id)

        updated = await LegalDocumentService(db_session).update_draft(
            str(revision.id),
            str(org.id),
            {"edited_by": str(someone.id), "edited_at": None, "body": "x"},
            edited_by=str(proposer.id),
        )

        assert updated.body == "x"
        assert updated.edited_by is None
        assert updated.edited_at is None
