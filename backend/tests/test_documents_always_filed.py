"""Every document lives in a folder, so a folder's rights decide who reads it.

An unfiled document (``folder_id`` NULL) was readable and downloadable by
every ``documents.view`` holder, outside every folder's rules — and a move to
``folder_id: null`` took a document out of a gated folder into that state.
Uploads and moves with no folder now land in General Documents; migration
``dcb8a46ac50c`` filed the rows already there (tested in
test_file_unfiled_documents_migration.py).
"""

import io
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.documents import update_document, upload_document
from app.api.v1.endpoints.facilities import _is_own_general_upload
from app.models.document import Document, DocumentFolder, FolderVisibility
from app.models.user import Organization, Position, User, user_positions
from app.schemas.documents import DocumentUpdate
from app.services.documents_service import DocumentsService

pytestmark = pytest.mark.integration


async def _org(db_session) -> Organization:
    org = Organization(name="Falls Church VFD", slug=f"fcvfd-af-{uuid4().hex[:8]}")
    db_session.add(org)
    await db_session.flush()
    return org


async def _user(db_session, org, *permissions) -> User:
    user = User(
        organization_id=org.id,
        username=f"u-{uuid4().hex[:8]}",
        email=f"{uuid4().hex[:8]}@example.com",
    )
    db_session.add(user)
    await db_session.flush()
    position = Position(
        organization_id=org.id,
        name="Clerk",
        slug=f"clerk-{user.id[:8]}",
        permissions=list(permissions),
    )
    db_session.add(position)
    await db_session.flush()
    await db_session.execute(
        user_positions.insert().values(user_id=user.id, position_id=position.id)
    )
    await db_session.flush()
    result = await db_session.execute(
        select(User)
        .where(User.id == user.id)
        .options(selectinload(User.positions))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _upload(db_session, user, folder_id=None):
    return await upload_document(
        file=UploadFile(file=io.BytesIO(b"%PDF-1.4 minutes"), filename="m.pdf"),
        name="Minutes",
        description=None,
        folder_id=folder_id,
        tags=None,
        db=db_session,
        current_user=user,
    )


class TestUploadWithNoFolder:
    async def test_lands_in_general_documents(self, db_session):
        org = await _org(db_session)
        clerk = await _user(db_session, org, "documents.view", "documents.manage")

        document = await _upload(db_session, clerk)

        general = await DocumentsService(db_session).general_root(org.id)
        assert general is not None
        assert str(document.folder_id) == str(general.id)

    async def test_general_is_created_when_the_org_has_none(self, db_session):
        org = await _org(db_session)
        clerk = await _user(db_session, org, "documents.view", "documents.manage")
        assert await DocumentsService(db_session).general_root(org.id) is None

        document = await _upload(db_session, clerk)

        assert document.folder_id is not None


class TestMoveToNoFolder:
    async def test_files_into_general_not_unfiled(self, db_session):
        """The leak this closes: a document taken out of a gated folder used
        to become readable by every documents.view holder."""
        org = await _org(db_session)
        clerk = await _user(db_session, org, "documents.view", "documents.manage")
        restricted = DocumentFolder(
            organization_id=org.id,
            name="Board only",
            visibility=FolderVisibility.LEADERSHIP,
        )
        db_session.add(restricted)
        await db_session.flush()
        document = Document(
            organization_id=org.id,
            folder_id=restricted.id,
            name="Personnel matter",
            uploaded_by=clerk.id,
        )
        db_session.add(document)
        await db_session.flush()

        moved = await update_document(
            document.id,
            DocumentUpdate(folder_id=None),
            db=db_session,
            current_user=clerk,
        )

        general = await DocumentsService(db_session).general_root(org.id)
        assert str(moved.folder_id) == str(general.id)

    async def test_without_write_on_general_the_move_is_refused(self, db_session):
        org = await _org(db_session)
        clerk = await _user(db_session, org, "documents.view", "documents.manage")
        service = DocumentsService(db_session)
        general = await service.general_folder(org.id, clerk.id)
        # A department that has locked General down to the library managers'
        # own visibility still gets a real check, not a free pass.
        general.required_permissions = ["documents.admin_only"]
        source = DocumentFolder(organization_id=org.id, name="Drafts")
        db_session.add(source)
        await db_session.flush()
        document = Document(
            organization_id=org.id,
            folder_id=source.id,
            name="Draft",
            uploaded_by=clerk.id,
        )
        db_session.add(document)
        await db_session.flush()

        with pytest.raises(HTTPException) as exc:
            await update_document(
                document.id,
                DocumentUpdate(folder_id=None),
                db=db_session,
                current_user=clerk,
            )
        assert exc.value.status_code == 403


class TestFacilityUploads:
    """The facility Files tab uploads with no folder and then files the
    reference, which moves the document behind the facility's rights."""

    async def test_the_callers_own_general_upload_is_filed_with_the_facility(
        self, db_session
    ):
        org = await _org(db_session)
        clerk = await _user(db_session, org, "documents.view", "documents.manage")
        document = await _upload(db_session, clerk)

        assert await _is_own_general_upload(
            DocumentsService(db_session), document, clerk, org.id
        )

    async def test_someone_elses_library_document_is_not_pulled_in(self, db_session):
        org = await _org(db_session)
        librarian = await _user(db_session, org, "documents.view", "documents.manage")
        facilities_clerk = await _user(
            db_session, org, "documents.view", "documents.manage"
        )
        document = await _upload(db_session, librarian)

        assert not await _is_own_general_upload(
            DocumentsService(db_session), document, facilities_clerk, org.id
        )

    async def test_a_document_in_another_folder_is_not_pulled_in(self, db_session):
        org = await _org(db_session)
        clerk = await _user(db_session, org, "documents.view", "documents.manage")
        policies = DocumentFolder(organization_id=org.id, name="Policies")
        db_session.add(policies)
        await db_session.flush()
        document = await _upload(db_session, clerk, folder_id=str(policies.id))

        assert not await _is_own_general_upload(
            DocumentsService(db_session), document, clerk, org.id
        )
