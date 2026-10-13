"""Legal Documents loads a page of drafts and history, not all of them (DOC-8).

``GET /legal-documents`` returned every draft and every archived revision, each
with a body of up to 100,000 characters, on every load of the screen. The owner
chose to page it: the overview carries the first page of each list and its
total, and ``GET /legal-documents/{document_type}/revisions`` serves the rest.
"""

import inspect
import uuid
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.api.v1.endpoints import legal_documents as ep
from app.models.legal import LegalDocumentType, LegalRevisionStatus
from app.models.user import Organization
from app.services.legal_service import LegalDocumentService

pytestmark = [pytest.mark.integration]

PRIVACY = LegalDocumentType.PRIVACY_POLICY
TERMS = LegalDocumentType.TERMS_OF_SERVICE


async def _org(db) -> Organization:
    org = Organization(name="Paging VFD", slug=f"legal-paging-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _drafts(db, org, count, document_type=PRIVACY):
    service = LegalDocumentService(db)
    made = []
    for n in range(count):
        made.append(
            await service.create_draft(
                organization_id=str(org.id),
                created_by=None,
                document_type=document_type,
                body=f"Wording {n}.",
                change_note=f"Note {n}.",
            )
        )
    return made


def _caller(org):
    return SimpleNamespace(id=None, organization_id=str(org.id))


async def _overview(db, org):
    with patch.object(ep, "_can_publish", return_value=True):
        result = await ep.get_legal_documents(db=db, current_user=_caller(org))
    return {doc.document_type: doc for doc in result.documents}


async def test_the_overview_carries_one_page_and_the_totals(db_session):
    org = await _org(db_session)
    await _drafts(db_session, org, ep.REVISION_PAGE_SIZE + 3)
    await _drafts(db_session, org, 2, TERMS)

    docs = await _overview(db_session, org)

    assert len(docs[PRIVACY].drafts) == ep.REVISION_PAGE_SIZE
    assert docs[PRIVACY].drafts_total == ep.REVISION_PAGE_SIZE + 3
    assert len(docs[TERMS].drafts) == 2
    assert docs[TERMS].drafts_total == 2
    assert docs[PRIVACY].history == []
    assert docs[PRIVACY].history_total == 0


async def test_load_more_returns_the_rest_without_overlap(db_session):
    org = await _org(db_session)
    await _drafts(db_session, org, ep.REVISION_PAGE_SIZE + 3)

    first = (await _overview(db_session, org))[PRIVACY].drafts
    rest = await ep.list_legal_revisions(
        PRIVACY,
        kind="drafts",
        offset=len(first),
        limit=ep.REVISION_PAGE_SIZE,
        db=db_session,
        current_user=_caller(org),
    )

    assert rest.total == ep.REVISION_PAGE_SIZE + 3
    assert len(rest.items) == 3
    ids = [r.id for r in first] + [r.id for r in rest.items]
    assert len(ids) == len(set(ids)) == ep.REVISION_PAGE_SIZE + 3


async def test_history_holds_published_and_archived_and_the_live_one_is_named(
    db_session,
):
    org = await _org(db_session)
    service = LegalDocumentService(db_session)
    first, second = await _drafts(db_session, org, 2)
    await service.publish(str(first.id), str(org.id), published_by=None)
    await service.publish(str(second.id), str(org.id), published_by=None)
    await _drafts(db_session, org, 1)

    doc = (await _overview(db_session, org))[PRIVACY]

    assert doc.history_total == 2
    assert {r.status for r in doc.history} == {
        LegalRevisionStatus.PUBLISHED,
        LegalRevisionStatus.ARCHIVED,
    }
    assert doc.drafts_total == 1
    assert doc.published_at is not None
    history = await ep.list_legal_revisions(
        PRIVACY,
        kind="history",
        offset=0,
        limit=1,
        db=db_session,
        current_user=_caller(org),
    )
    assert history.total == 2
    assert len(history.items) == 1


async def test_pages_are_org_scoped(db_session):
    org, other = await _org(db_session), await _org(db_session)
    await _drafts(db_session, org, 3)

    page = await ep.list_legal_revisions(
        PRIVACY,
        kind="drafts",
        offset=0,
        limit=10,
        db=db_session,
        current_user=_caller(other),
    )
    assert page.total == 0
    assert page.items == []


def test_the_page_size_is_bounded():
    """A caller cannot ask for every revision in one page."""
    limit = inspect.signature(ep.list_legal_revisions).parameters["limit"].default
    bounds = {type(m).__name__: m for m in limit.metadata}
    assert bounds["Le"].le == ep.MAX_REVISION_PAGE_SIZE
    assert bounds["Ge"].ge == 1
