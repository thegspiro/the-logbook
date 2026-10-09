"""Apparatus photos and documents as real documents (FILE_STORAGE_HARDENING
decision 12): uploaded to the vehicle's folder, served through the apparatus
module behind the folder's rights, and never a typed ``javascript:`` link.
"""

import io
import os
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.apparatus import (
    create_apparatus_photo,
    delete_apparatus_photo,
    download_apparatus_document,
    download_apparatus_photo,
    upload_apparatus_document,
    upload_apparatus_photo,
)
from app.models.apparatus import (
    Apparatus,
    ApparatusPhoto,
    ApparatusStatus,
    ApparatusType,
)
from app.models.document import Document, DocumentFolder, FolderVisibility
from app.models.user import Organization, Position, User, user_positions
from app.schemas.apparatus import ApparatusPhotoCreate, ApparatusPhotoResponse
from app.services import file_storage_service
from app.services.documents_service import DocumentsService

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f"
    b"\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)
PDF = b"%PDF-1.4 registration"


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()), name="Fleet VFD", slug=f"fleet-{uuid.uuid4().hex[:8]}"
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _apparatus(db_session, org) -> Apparatus:
    kind = ApparatusType(
        id=str(uuid.uuid4()), organization_id=org.id, name="Engine", code="ENG"
    )
    state = ApparatusStatus(
        id=str(uuid.uuid4()), organization_id=org.id, name="In Service", code="IS"
    )
    db_session.add_all([kind, state])
    await db_session.flush()
    apparatus = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        unit_number="Engine 1",
        apparatus_type_id=kind.id,
        status_id=state.id,
    )
    db_session.add(apparatus)
    await db_session.flush()
    return apparatus


async def _user(db_session, org, *permissions) -> User:
    name = f"u-{uuid.uuid4().hex[:8]}"
    user = User(organization_id=org.id, username=name, email=f"{name}@example.com")
    db_session.add(user)
    await db_session.flush()
    position = Position(
        organization_id=org.id, name=name, slug=name, permissions=list(permissions)
    )
    db_session.add(position)
    await db_session.flush()
    await db_session.execute(
        user_positions.insert().values(user_id=user.id, position_id=position.id)
    )
    await db_session.flush()
    return (
        await db_session.execute(
            select(User)
            .where(User.id == user.id)
            .options(selectinload(User.positions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


def _file(data: bytes, name: str) -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=name)


async def _upload_photo(db_session, apparatus, user, **fields):
    return await upload_apparatus_photo(
        apparatus_id=str(apparatus.id),
        file=_file(PNG, "IMG_2291.png"),
        title=fields.get("title", "Driver side"),
        description=None,
        photo_type="exterior",
        taken_at=None,
        is_primary=False,
        db=db_session,
        current_user=user,
    )


async def _folder_path(db_session, folder_id) -> list:
    names = []
    while folder_id:
        folder = await db_session.get(DocumentFolder, folder_id)
        names.append(folder.name)
        folder_id = folder.parent_id
    return list(reversed(names))


@pytest.mark.unit
class TestTheLinkShown:
    def _response(self, **fields):
        return ApparatusPhotoResponse(
            id="p1",
            organization_id="o1",
            apparatus_id="a1",
            file_name="x.png",
            uploaded_at=datetime.now(timezone.utc),
            **fields,
        )

    def test_a_stored_file_is_served_by_the_apparatus_endpoint(self):
        response = self._response(file_path="document:d1", document_id="d1")
        assert response.file_url == "/api/v1/apparatus/a1/photos/p1/file"

    @pytest.mark.parametrize(
        "value",
        ["javascript:alert(1)", "data:text/html,x", "/app/uploads/x.png", "ftp://h/x"],
    )
    def test_an_unsafe_legacy_link_is_withheld(self, value):
        assert self._response(file_path=value).file_url is None

    def test_a_legacy_https_link_is_passed_on(self):
        response = self._response(file_path="https://example.com/e1.jpg")
        assert response.file_url == "https://example.com/e1.jpg"


@pytest.mark.integration
class TestUpload:
    async def test_a_photo_is_filed_in_the_vehicles_photos_folder(
        self, db_session, uploads
    ):
        org = await _org(db_session)
        apparatus = await _apparatus(db_session, org)
        officer = await _user(db_session, org, "apparatus.view", "apparatus.edit")

        photo = await _upload_photo(db_session, apparatus, officer)

        document = await db_session.get(Document, photo.document_id)
        assert photo.file_path == f"document:{document.id}"
        assert await _folder_path(db_session, document.folder_id) == [
            "Apparatus Files",
            "Engine 1",
            "Photos",
        ]
        assert document.file_type == "image/png"
        assert document.file_path.startswith(str(uploads / org.id / "documents"))
        assert os.path.isfile(document.file_path)

    async def test_a_registration_is_filed_under_registration_and_insurance(
        self, db_session, uploads
    ):
        org = await _org(db_session)
        apparatus = await _apparatus(db_session, org)
        officer = await _user(db_session, org, "apparatus.view", "apparatus.edit")

        record = await upload_apparatus_document(
            apparatus_id=str(apparatus.id),
            file=_file(PDF, "scan0003.pdf"),
            title="2026 Registration",
            document_type="Registration",
            description=None,
            expiration_date=None,
            document_date=None,
            db=db_session,
            current_user=officer,
        )

        document = await db_session.get(Document, record.document_id)
        assert record.document_type == "registration"
        assert (await _folder_path(db_session, document.folder_id))[-1] == (
            "Registration & Insurance"
        )

    async def test_a_photo_must_be_an_image(self, db_session, uploads):
        org = await _org(db_session)
        apparatus = await _apparatus(db_session, org)
        officer = await _user(db_session, org, "apparatus.view", "apparatus.edit")

        with pytest.raises(HTTPException) as exc:
            await upload_apparatus_photo(
                apparatus_id=str(apparatus.id),
                file=_file(PDF, "not-a-photo.png"),
                title=None,
                description=None,
                photo_type=None,
                taken_at=None,
                is_primary=False,
                db=db_session,
                current_user=officer,
            )
        assert 400 <= exc.value.status_code < 500
        assert not list(uploads.rglob("*.pdf"))

    async def test_another_departments_apparatus_is_not_found(
        self, db_session, uploads
    ):
        org = await _org(db_session)
        other = await _apparatus(db_session, await _org(db_session))
        officer = await _user(db_session, org, "apparatus.view", "apparatus.edit")

        with pytest.raises(HTTPException) as exc:
            await _upload_photo(db_session, other, officer)
        assert exc.value.status_code == 404


@pytest.mark.integration
class TestTypedLinksAreRefused:
    async def test_a_url_is_no_longer_accepted(self, db_session, uploads):
        org = await _org(db_session)
        apparatus = await _apparatus(db_session, org)
        officer = await _user(db_session, org, "apparatus.view", "apparatus.edit")

        with pytest.raises(HTTPException) as exc:
            await create_apparatus_photo(
                apparatus_id=str(apparatus.id),
                photo_data=ApparatusPhotoCreate(
                    apparatus_id=str(apparatus.id),
                    file_path="javascript:alert(document.cookie)",
                    file_name="x.png",
                ),
                db=db_session,
                current_user=officer,
            )
        assert exc.value.status_code == 400

    async def test_an_unfiled_document_is_filed_into_the_vehicle(
        self, db_session, uploads
    ):
        org = await _org(db_session)
        apparatus = await _apparatus(db_session, org)
        officer = await _user(
            db_session, org, "apparatus.view", "apparatus.edit", "documents.view"
        )
        loose = Document(organization_id=org.id, name="Loose", uploaded_by=officer.id)
        db_session.add(loose)
        await db_session.flush()

        photo = await create_apparatus_photo(
            apparatus_id=str(apparatus.id),
            photo_data=ApparatusPhotoCreate(
                apparatus_id=str(apparatus.id),
                file_path=f"document:{loose.id}",
                file_name="loose.png",
            ),
            db=db_session,
            current_user=officer,
        )

        await db_session.refresh(loose)
        assert photo.document_id == loose.id
        assert (await _folder_path(db_session, loose.folder_id))[-1] == "Photos"


@pytest.mark.integration
class TestDownload:
    async def test_apparatus_view_opens_the_photo_inline(self, db_session, uploads):
        org = await _org(db_session)
        apparatus = await _apparatus(db_session, org)
        officer = await _user(db_session, org, "apparatus.view", "apparatus.edit")
        quartermaster = await _user(db_session, org, "apparatus.view")
        photo = await _upload_photo(db_session, apparatus, officer)

        response = await download_apparatus_photo(
            apparatus_id=str(apparatus.id),
            photo_id=str(photo.id),
            db=db_session,
            current_user=quartermaster,
        )

        disposition = response.headers["content-disposition"]
        assert disposition.startswith("inline")
        assert "Engine-1_Driver-side.png" in disposition
        assert response.media_type == "image/png"

    async def test_documents_are_sent_as_attachments(self, db_session, uploads):
        org = await _org(db_session)
        apparatus = await _apparatus(db_session, org)
        officer = await _user(db_session, org, "apparatus.view", "apparatus.edit")
        record = await upload_apparatus_document(
            apparatus_id=str(apparatus.id),
            file=_file(PDF, "scan.pdf"),
            title="Pump manual",
            document_type="manual",
            description=None,
            expiration_date=None,
            document_date=None,
            db=db_session,
            current_user=officer,
        )

        response = await download_apparatus_document(
            apparatus_id=str(apparatus.id),
            document_id=str(record.id),
            db=db_session,
            current_user=officer,
        )
        assert response.headers["content-disposition"].startswith("attachment")

    async def test_a_document_moved_out_of_reach_is_not_served(
        self, db_session, uploads
    ):
        """The module's door does not bypass the folder the file now sits in."""
        org = await _org(db_session)
        apparatus = await _apparatus(db_session, org)
        officer = await _user(db_session, org, "apparatus.view", "apparatus.edit")
        photo = await _upload_photo(db_session, apparatus, officer)
        board = DocumentFolder(
            organization_id=org.id,
            name="Board only",
            visibility=FolderVisibility.LEADERSHIP,
        )
        db_session.add(board)
        await db_session.flush()
        document = await db_session.get(Document, photo.document_id)
        document.folder_id = board.id
        await db_session.flush()

        with pytest.raises(HTTPException) as exc:
            await download_apparatus_photo(
                apparatus_id=str(apparatus.id),
                photo_id=str(photo.id),
                db=db_session,
                current_user=officer,
            )
        assert exc.value.status_code == 404

    async def test_a_library_manager_without_apparatus_rights_cannot_open_it(
        self, db_session, uploads
    ):
        org = await _org(db_session)
        apparatus = await _apparatus(db_session, org)
        officer = await _user(db_session, org, "apparatus.view", "apparatus.edit")
        secretary = await _user(db_session, org, "documents.view", "documents.manage")
        photo = await _upload_photo(db_session, apparatus, officer)
        document = await db_session.get(Document, photo.document_id)

        assert not await DocumentsService(db_session).can_access_document(
            document, org.id, secretary
        )


@pytest.mark.integration
class TestDelete:
    async def test_deleting_the_photo_removes_the_document_and_file(
        self, db_session, uploads
    ):
        org = await _org(db_session)
        apparatus = await _apparatus(db_session, org)
        manager = await _user(db_session, org, "apparatus.view", "apparatus.manage")
        photo = await _upload_photo(db_session, apparatus, manager)
        photo_id, document_id = str(photo.id), str(photo.document_id)
        stored = (await db_session.get(Document, document_id)).file_path

        await delete_apparatus_photo(
            apparatus_id=str(apparatus.id),
            photo_id=photo_id,
            db=db_session,
            current_user=manager,
        )

        db_session.expire_all()
        assert (
            await db_session.execute(
                select(ApparatusPhoto).where(ApparatusPhoto.id == photo_id)
            )
        ).scalar_one_or_none() is None
        assert (
            await db_session.execute(select(Document).where(Document.id == document_id))
        ).scalar_one_or_none() is None
        assert not os.path.exists(stored)
