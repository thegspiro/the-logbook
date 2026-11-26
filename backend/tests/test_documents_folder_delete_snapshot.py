"""A folder moved into a subtree while it is being deleted goes with it.

DOC2-11: ``_delete_folder_subtree`` walked the subtree with plain SELECTs,
which answer from the snapshot this transaction took at its first read
(``get_folder_by_id``), and then locked only the ids that walk had found. A
folder moved under the target after that snapshot was missed: the database's
``parent_id ON DELETE CASCADE`` removed it anyway, its documents' ``folder_id``
went NULL, and ``can_access_document`` treats a folder-less document as open to
every member — so a document that sat under a restricted folder became
readable by everyone, with its file left on disk (CLAUDE.md pitfall #27).

Two sessions committing independently, against the real database.
"""

import uuid

import pytest
from sqlalchemy import select

from app.core.database import database_manager
from app.models.document import Document, DocumentFolder
from app.models.user import Organization
from app.services.documents_service import DocumentsService

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def two_sessions(_initialize_database):
    factory = database_manager.session_factory
    sessions = [factory(), factory()]
    try:
        yield sessions
    finally:
        for session in sessions:
            await session.rollback()
            await session.close()


async def _cleanup(ids):
    session = database_manager.session_factory()
    try:
        await session.execute(
            Document.__table__.delete().where(Document.organization_id == ids["org"])
        )
        for key in ("child", "target", "elsewhere"):
            await session.execute(
                DocumentFolder.__table__.delete().where(DocumentFolder.id == ids[key])
            )
        await session.execute(
            Organization.__table__.delete().where(Organization.id == ids["org"])
        )
        await session.commit()
    finally:
        await session.close()


async def test_a_folder_moved_in_mid_delete_is_deleted_with_its_documents(
    two_sessions,
):
    deleter, mover = two_sessions
    org = Organization(name="Snapshot VFD", slug=f"snap-{uuid.uuid4().hex[:12]}")
    deleter.add(org)
    await deleter.flush()
    target = DocumentFolder(organization_id=org.id, name="Target", is_system=False)
    elsewhere = DocumentFolder(
        organization_id=org.id, name="Elsewhere", is_system=False
    )
    deleter.add_all([target, elsewhere])
    await deleter.flush()
    child = DocumentFolder(
        organization_id=org.id, name="Child", is_system=False, parent_id=elsewhere.id
    )
    deleter.add(child)
    await deleter.flush()
    doc = Document(
        organization_id=org.id, name="Restricted", file_name="r.pdf", folder_id=child.id
    )
    deleter.add(doc)
    await deleter.commit()
    ids = dict(
        org=org.id,
        target=target.id,
        elsewhere=elsewhere.id,
        child=child.id,
        doc=doc.id,
    )
    try:
        service = DocumentsService(deleter)
        # The deleting request's first read fixes its snapshot.
        assert await service.get_folder_by_id(ids["target"], ids["org"])
        moved = (
            await mover.execute(
                select(DocumentFolder).where(DocumentFolder.id == ids["child"])
            )
        ).scalar_one()
        moved.parent_id = ids["target"]
        await mover.commit()

        assert await service.delete_folder(ids["target"], ids["org"], current_user=None)

        check = database_manager.session_factory()
        try:
            assert await check.get(DocumentFolder, ids["child"]) is None
            assert await check.get(Document, ids["doc"]) is None
        finally:
            await check.close()
    finally:
        await _cleanup(ids)
