"""A member may hold at most ten open legal-document drafts per type (DOC-8).

Owner decision 2026-10-12: paging made *reading* the proposals cheap, but a
``legal.propose`` holder could still create drafts without bound. An open draft
is one still in ``DRAFT``; publishing it or withdrawing (deleting) it frees the
slot. The cap is per member and per document type.
"""

import asyncio
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import legal_documents as ep
from app.core.database import database_manager
from app.models.legal import LegalDocumentType
from app.models.user import Organization, User
from app.schemas.legal import LegalRevisionCreate
from app.services.legal_service import MAX_OPEN_DRAFTS_PER_MEMBER, LegalDocumentService

pytestmark = [pytest.mark.integration]

PRIVACY = LegalDocumentType.PRIVACY_POLICY
TERMS = LegalDocumentType.TERMS_OF_SERVICE
REFUSAL = "You already have 10 open proposals for the privacy policy"


async def _org(db) -> Organization:
    org = Organization(name="Cap VFD", slug=f"legal-cap-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _member(db, org) -> User:
    tag = uuid.uuid4().hex[:8]
    user = User(
        organization_id=str(org.id),
        username=f"proposer-{tag}",
        email=f"proposer-{tag}@example.com",
    )
    db.add(user)
    await db.flush()
    return user


async def _propose(db, org, member, document_type=PRIVACY, n=0):
    return await LegalDocumentService(db).create_draft(
        organization_id=str(org.id),
        created_by=str(member.id),
        document_type=document_type,
        body=f"Wording {n}.",
        change_note=f"Note {n}.",
    )


async def _fill(db, org, member, document_type=PRIVACY):
    return [
        await _propose(db, org, member, document_type, n)
        for n in range(MAX_OPEN_DRAFTS_PER_MEMBER)
    ]


async def test_the_cap_is_ten():
    assert MAX_OPEN_DRAFTS_PER_MEMBER == 10


async def test_ten_are_allowed_and_the_eleventh_is_refused(db_session):
    org = await _org(db_session)
    member = await _member(db_session, org)
    drafts = await _fill(db_session, org, member)
    assert len(drafts) == 10

    with pytest.raises(ValueError, match=REFUSAL):
        await _propose(db_session, org, member, n=11)


async def test_another_member_is_unaffected(db_session):
    org = await _org(db_session)
    first = await _member(db_session, org)
    second = await _member(db_session, org)
    await _fill(db_session, org, first)

    revision = await _propose(db_session, org, second)
    assert revision.created_by == str(second.id)


async def test_the_other_document_type_is_unaffected(db_session):
    org = await _org(db_session)
    member = await _member(db_session, org)
    await _fill(db_session, org, member, PRIVACY)

    revision = await _propose(db_session, org, member, TERMS)
    assert revision.document_type == TERMS


async def test_publishing_one_frees_a_slot(db_session):
    org = await _org(db_session)
    member = await _member(db_session, org)
    drafts = await _fill(db_session, org, member)

    await LegalDocumentService(db_session).publish(
        str(drafts[0].id), str(org.id), published_by=str(member.id)
    )

    assert (await _propose(db_session, org, member, n=11)) is not None
    with pytest.raises(ValueError, match=REFUSAL):
        await _propose(db_session, org, member, n=12)


async def test_withdrawing_one_frees_a_slot(db_session):
    org = await _org(db_session)
    member = await _member(db_session, org)
    drafts = await _fill(db_session, org, member)

    await LegalDocumentService(db_session).delete_draft(str(drafts[0].id), str(org.id))

    assert (await _propose(db_session, org, member, n=11)) is not None


async def test_a_member_of_another_organization_is_not_found(db_session):
    """The lock lookup is org-scoped: an id from another department is not a
    member here, and nothing is written for it."""
    home = await _org(db_session)
    elsewhere = await _org(db_session)
    outsider = await _member(db_session, elsewhere)

    with pytest.raises(ValueError, match="Member not found"):
        await _propose(db_session, home, outsider)


async def test_the_endpoint_refuses_with_a_400_and_the_reason(db_session):
    org = await _org(db_session)
    member = await _member(db_session, org)
    await _fill(db_session, org, member)

    with pytest.raises(HTTPException) as exc:
        await ep.create_revision(
            LegalRevisionCreate(
                document_type=PRIVACY,
                body="One too many.",
                change_note="Over the cap.",
            ),
            db=db_session,
            current_user=member,
        )
    assert exc.value.status_code == 400
    assert exc.value.detail == (
        "You already have 10 open proposals for the privacy policy. "
        "Publish or withdraw one first."
    )


# ── The race: two proposals at nine, on real connections ─────────────────

_HOLD_SECONDS = 0.3


async def _seed_at_nine() -> tuple[str, str]:
    org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text(
                    "INSERT INTO organizations "
                    "(id, name, organization_type, slug, timezone, active) "
                    "VALUES (:id, 'Draft Cap Race Dept', 'fire_department', "
                    ":slug, 'UTC', 1)"
                ),
                {"id": org_id, "slug": f"draft-cap-race-{org_id[:8]}"},
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id, organization_id, username, first_name, "
                    "last_name, email, password_hash, status) VALUES (:id, :org, "
                    ":un, 'Draft', 'Racer', :em, 'hashed', 'active')"
                ),
                {
                    "id": user_id,
                    "org": org_id,
                    "un": f"draft-race-{user_id[:8]}",
                    "em": f"draft-race-{user_id[:8]}@test.com",
                },
            )
            for n in range(MAX_OPEN_DRAFTS_PER_MEMBER - 1):
                await conn.execute(
                    text(
                        "INSERT INTO legal_document_revisions (id, organization_id, "
                        "document_type, status, body, change_note, created_by) "
                        "VALUES (:id, :org, 'privacy_policy', 'draft', :body, "
                        "'Seeded.', :user)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "org": org_id,
                        "body": f"Seeded {n}.",
                        "user": user_id,
                    },
                )
    return org_id, user_id


async def _cleanup(org_id: str) -> None:
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            for statement in (
                "DELETE FROM legal_document_revisions WHERE organization_id = :o",
                "DELETE FROM users WHERE organization_id = :o",
                "DELETE FROM organizations WHERE id = :o",
            ):
                await conn.execute(text(statement), {"o": org_id})


@pytest.mark.usefixtures("_initialize_database")
async def test_two_proposals_at_nine_leave_ten_not_eleven():
    org_id, user_id = await _seed_at_nine()
    inserted = asyncio.Event()

    async def propose(after=None):
        if after is not None:
            await after.wait()
        async with database_manager.engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            try:
                await LegalDocumentService(session).create_draft(
                    organization_id=org_id,
                    created_by=user_id,
                    document_type=PRIVACY,
                    body="Racing wording.",
                    change_note="Racing.",
                )
                if after is None:
                    # Hold the first transaction open past the second one's
                    # check: without the lock and the locking count, the
                    # second counts nine and inserts an eleventh.
                    inserted.set()
                    await asyncio.sleep(_HOLD_SECONDS)
                await session.commit()
                return "created"
            except ValueError as e:
                await session.rollback()
                return str(e)
            finally:
                await session.close()

    try:
        results = await asyncio.gather(propose(), propose(after=inserted))
        async with database_manager.engine.connect() as conn:
            open_drafts = (
                await conn.execute(
                    text(
                        "SELECT COUNT(*) FROM legal_document_revisions WHERE "
                        "organization_id = :o AND created_by = :u AND "
                        "status = 'draft'"
                    ),
                    {"o": org_id, "u": user_id},
                )
            ).scalar()
    finally:
        await _cleanup(org_id)

    assert results[0] == "created"
    assert results[1].startswith(REFUSAL), results
    assert open_drafts == MAX_OPEN_DRAFTS_PER_MEMBER
