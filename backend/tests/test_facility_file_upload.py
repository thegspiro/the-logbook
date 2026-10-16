"""Facility photos and documents upload in one step, behind facilities rights.

The Files section used to upload through ``POST /documents/upload`` and then
link the document, so a facilities manager holding ``facilities.edit`` but
not ``documents.manage`` was refused at the first step. The facility upload
endpoints store the file straight into the facility's sub-folder and create
the record in the same transaction.
"""

import io
import uuid

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.facilities import (
    upload_facility_document,
    upload_facility_photo,
)
from app.models.document import Document, DocumentFolder
from app.models.facilities import (
    Facility,
    FacilityDocument,
    FacilityPhoto,
    FacilityStatus,
    FacilityType,
)
from app.models.user import Organization, Position, User, user_positions
from app.services import facilities_service, file_storage_service

pytestmark = pytest.mark.integration

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f"
    b"\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)
PDF = b"%PDF-1.4 lease"


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


async def _org(db_session) -> Organization:
    org = Organization(name="Station VFD", slug=f"stn-{uuid.uuid4().hex[:8]}")
    db_session.add(org)
    await db_session.flush()
    return org


async def _facility(db_session, org) -> Facility:
    kind = FacilityType(organization_id=None, name="Station", is_system=True)
    state = FacilityStatus(organization_id=None, name="In service", is_system=True)
    db_session.add_all([kind, state])
    await db_session.flush()
    facility = Facility(
        organization_id=org.id,
        name="Station 1",
        facility_type_id=kind.id,
        status_id=state.id,
    )
    db_session.add(facility)
    await db_session.flush()
    return facility


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


async def _folder_slug(db_session, document_id) -> str:
    document = (
        await db_session.execute(select(Document).where(Document.id == document_id))
    ).scalar_one()
    folder = (
        await db_session.execute(
            select(DocumentFolder).where(DocumentFolder.id == document.folder_id)
        )
    ).scalar_one()
    return folder.slug or ""


def _document_id(file_path: str) -> str:
    assert file_path.startswith("document:")
    return file_path.removeprefix("document:")


class TestOneStepFacilityUploads:
    async def test_a_facilities_editor_uploads_a_photo_without_documents_rights(
        self, db_session, uploads
    ):
        org = await _org(db_session)
        facility = await _facility(db_session, org)
        editor = await _user(db_session, org, "facilities.view", "facilities.edit")

        photo = await upload_facility_photo(
            facility_id=str(facility.id),
            file=_file(PNG, "front.png"),
            caption="  Bay doors  ",
            db=db_session,
            current_user=editor,
        )

        assert photo.caption == "Bay doors"
        assert photo.file_name == "front.png"
        stored = (
            await db_session.execute(
                select(FacilityPhoto).where(FacilityPhoto.id == photo.id)
            )
        ).scalar_one()
        slug = await _folder_slug(db_session, _document_id(stored.file_path))
        assert slug.endswith("photos")

    async def test_a_document_lands_in_the_restricted_documents_folder(
        self, db_session, uploads
    ):
        org = await _org(db_session)
        facility = await _facility(db_session, org)
        editor = await _user(db_session, org, "facilities.view", "facilities.edit")

        record = await upload_facility_document(
            facility_id=str(facility.id),
            file=_file(PDF, "lease.pdf"),
            document_type=None,
            description="",
            db=db_session,
            current_user=editor,
        )

        assert record.document_type == "facility_record"
        assert record.description is None
        stored = (
            await db_session.execute(
                select(FacilityDocument).where(FacilityDocument.id == record.id)
            )
        ).scalar_one()
        slug = await _folder_slug(db_session, _document_id(stored.file_path))
        assert slug.endswith("documents")

    async def test_a_photo_must_be_an_image(self, db_session, uploads):
        org = await _org(db_session)
        facility = await _facility(db_session, org)
        editor = await _user(db_session, org, "facilities.edit")

        with pytest.raises(HTTPException) as refused:
            await upload_facility_photo(
                facility_id=str(facility.id),
                file=_file(PDF, "not-a-photo.pdf"),
                caption=None,
                db=db_session,
                current_user=editor,
            )
        assert 400 <= refused.value.status_code < 500
        assert (await db_session.execute(select(FacilityPhoto))).first() is None

    async def test_another_departments_facility_is_not_found(self, db_session, uploads):
        org = await _org(db_session)
        other = await _org(db_session)
        facility = await _facility(db_session, other)
        editor = await _user(db_session, org, "facilities.edit")

        with pytest.raises(HTTPException) as refused:
            await upload_facility_document(
                facility_id=str(facility.id),
                file=_file(PDF, "lease.pdf"),
                document_type=None,
                description=None,
                db=db_session,
                current_user=editor,
            )
        assert refused.value.status_code == 404
        assert (
            await db_session.execute(
                select(Document).where(Document.organization_id == org.id)
            )
        ).first() is None

    async def test_a_failed_record_removes_the_stored_file(
        self, db_session, uploads, monkeypatch
    ):
        org = await _org(db_session)
        facility = await _facility(db_session, org)
        editor = await _user(db_session, org, "facilities.edit")

        async def fail(*args, **kwargs):
            raise RuntimeError("database went away")

        monkeypatch.setattr(facilities_service.FacilitiesService, "create_photo", fail)
        with pytest.raises(RuntimeError):
            await upload_facility_photo(
                facility_id=str(facility.id),
                file=_file(PNG, "front.png"),
                caption=None,
                db=db_session,
                current_user=editor,
            )
        assert [p for p in uploads.rglob("*") if p.is_file()] == []
