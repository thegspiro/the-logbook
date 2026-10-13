"""MM-17 residual: a published document while its minutes are being corrected.

Owner decision (2026-10-12): reopening approved minutes leaves the document
already published from them readable, flagged as being corrected, until the
corrected minutes are republished -- which replaces that same document and
clears the flag.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.models.document import Document, DocumentType
from app.models.minute import MeetingMinutes, MinutesStatus
from app.models.user import Organization, User
from app.schemas.documents import DocumentResponse
from app.services.document_service import DocumentService
from app.services.minute_service import MinuteService

pytestmark = pytest.mark.integration


async def _org(db, name="Correction FD"):
    org = Organization(name=name, slug=f"corr-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _user(db, org, first):
    user = User(
        organization_id=org.id,
        username=f"{first.lower()}-{uuid.uuid4().hex[:8]}",
        email=f"{first.lower()}-{uuid.uuid4().hex[:8]}@example.org",
        first_name=first,
        last_name="Member",
    )
    db.add(user)
    await db.flush()
    return user


async def _approved_minutes(db, org, title="Business meeting"):
    minutes = MeetingMinutes(
        organization_id=org.id,
        title=title,
        meeting_date=datetime(2026, 10, 1, 19, 0, tzinfo=timezone.utc),
        status=MinutesStatus.APPROVED,
    )
    db.add(minutes)
    await db.flush()
    return await _loaded(db, minutes.id, org)


async def _loaded(db, minutes_id, org):
    # Publishing renders motions and action items, so it needs the minutes
    # as the endpoint hands them over: through get_minutes' eager loads.
    loaded = await MinuteService(db).get_minutes(minutes_id, org.id)
    assert loaded is not None
    return loaded


async def _document(db, document_id):
    return (
        await db.execute(select(Document).where(Document.id == document_id))
    ).scalar_one()


async def _reapprove(db, minutes, org, submitter, approver):
    service = MinuteService(db)
    await service.submit_for_approval(minutes.id, org.id, submitter.id)
    await service.approve_minutes(minutes.id, org.id, approver.id)


async def test_reopen_flags_the_published_document(db_session):
    org = await _org(db_session)
    secretary = await _user(db_session, org, "Sam")
    minutes = await _approved_minutes(db_session, org)
    doc = await DocumentService(db_session).publish_minutes(
        minutes, org.id, secretary.id
    )
    assert doc.under_correction_since is None

    before = datetime.now(timezone.utc)
    result = await MinuteService(db_session).reopen_minutes(minutes.id, org.id)
    assert result is not None

    flagged = await _document(db_session, doc.id)
    assert flagged.under_correction_since is not None
    since = flagged.under_correction_since
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    assert since >= before.replace(microsecond=0)
    # Still readable: the superseded text stays until it is replaced.
    assert flagged.content_html
    assert DocumentResponse.model_validate(flagged).under_correction_since


async def test_republish_after_reapproval_replaces_the_document_and_clears_the_flag(
    db_session,
):
    org = await _org(db_session)
    secretary = await _user(db_session, org, "Sam")
    chief = await _user(db_session, org, "Pat")
    minutes = await _approved_minutes(db_session, org, title="Original title")
    docs = DocumentService(db_session)
    doc = await docs.publish_minutes(minutes, org.id, secretary.id)

    await MinuteService(db_session).reopen_minutes(minutes.id, org.id)
    minutes.title = "Corrected title"
    await db_session.flush()

    minutes = await _loaded(db_session, minutes.id, org)
    # Draft minutes cannot be republished, so the notice holds meanwhile.
    with pytest.raises(ValueError, match="approved"):
        await docs.publish_minutes(minutes, org.id, secretary.id)
    await _reapprove(db_session, minutes, org, secretary, chief)
    minutes = await _loaded(db_session, minutes.id, org)
    # Re-approval alone does not replace the text, so the notice stays.
    assert (await _document(db_session, doc.id)).under_correction_since

    republished = await docs.publish_minutes(minutes, org.id, secretary.id)

    assert republished.id == doc.id
    assert republished.under_correction_since is None
    assert republished.name == "Corrected title"
    assert "Corrected title" in (republished.content_html or "")
    count = (
        await db_session.execute(
            select(func.count(Document.id)).where(
                Document.organization_id == org.id,
                Document.source_id == minutes.id,
            )
        )
    ).scalar()
    assert count == 1


async def test_reopen_without_a_published_document_touches_no_document(db_session):
    org = await _org(db_session)
    minutes = await _approved_minutes(db_session, org)
    other = Document(
        organization_id=org.id,
        name="Unrelated",
        document_type=DocumentType.GENERATED,
        content_html="<p>x</p>",
    )
    db_session.add(other)
    await db_session.flush()

    result = await MinuteService(db_session).reopen_minutes(minutes.id, org.id)

    assert result is not None
    assert result[0].status == MinutesStatus.DRAFT.value
    assert (await _document(db_session, other.id)).under_correction_since is None


async def test_reopen_never_flags_another_organizations_document(db_session):
    """published_document_id has no FK; a value naming another org's row
    (corrupted or tampered) must not let a reopen in this org mark it."""
    org = await _org(db_session)
    other_org = await _org(db_session, name="Other FD")
    foreign = Document(
        organization_id=other_org.id,
        name="Other org minutes",
        document_type=DocumentType.GENERATED,
        content_html="<p>theirs</p>",
    )
    db_session.add(foreign)
    await db_session.flush()
    minutes = await _approved_minutes(db_session, org)
    minutes.published_document_id = foreign.id
    await db_session.flush()

    result = await MinuteService(db_session).reopen_minutes(minutes.id, org.id)

    assert result is not None
    assert (await _document(db_session, foreign.id)).under_correction_since is None
