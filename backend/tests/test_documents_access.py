"""
Tests for documents service folder access control
(app/services/documents_service.py).

can_access_folder is a security boundary deciding which document folders a
member may see. Covers the leadership override, leadership/owner/organization
visibility, and the allowed-roles restriction, plus the permission/role
collection helpers. Pure logic; no DB.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints.documents import (
    _parse_uuid_or_400,
    _resolve_document_name,
    download_document,
)
from app.models.document import Document, DocumentFolder, FolderVisibility
from app.models.user import Organization
from app.schemas.documents import DocumentFolderUpdate
from app.services.documents_service import (
    DocumentsService,
    _get_user_permissions,
    _get_user_role_slugs,
    _is_leadership,
)


def _user(uid="u1", roles=None):
    # roles: list of (permissions_list, slug)
    role_objs = [
        SimpleNamespace(permissions=perms, slug=slug) for perms, slug in (roles or [])
    ]
    return SimpleNamespace(id=uid, roles=role_objs)


def _folder(visibility, owner_user_id=None, allowed_roles=None, fid="f1"):
    return SimpleNamespace(
        id=fid,
        visibility=visibility,
        owner_user_id=owner_user_id,
        allowed_roles=allowed_roles,
    )


def _svc():
    return DocumentsService(MagicMock())


class TestHelpers:
    def test_collect_permissions_across_roles(self):
        user = _user(roles=[(["a", "b"], "r1"), (["b", "c"], "r2")])
        assert _get_user_permissions(user) == {"a", "b", "c"}

    def test_collect_role_slugs(self):
        user = _user(roles=[([], "chief"), ([], "secretary")])
        assert _get_user_role_slugs(user) == {"chief", "secretary"}

    def test_is_leadership(self):
        assert _is_leadership({"documents.manage"}) is True
        assert _is_leadership({"members.manage"}) is True
        assert _is_leadership({"*"}) is True
        assert _is_leadership({"events.view"}) is False


class TestCanAccessFolder:
    def test_leadership_sees_everything(self):
        user = _user(roles=[(["documents.manage"], "chief")])
        # Even a leadership-only folder is visible to leadership.
        folder = _folder(FolderVisibility.LEADERSHIP)
        assert _svc().can_access_folder(folder, user) is True

    def test_leadership_visibility_blocks_non_leadership(self):
        user = _user(roles=[(["events.view"], "ff")])
        folder = _folder(FolderVisibility.LEADERSHIP)
        assert _svc().can_access_folder(folder, user) is False

    def test_owner_visibility_owner_allowed(self):
        user = _user(uid="u1", roles=[([], "ff")])
        folder = _folder(FolderVisibility.OWNER, owner_user_id="u1")
        assert _svc().can_access_folder(folder, user) is True

    def test_owner_visibility_non_owner_blocked(self):
        user = _user(uid="u2", roles=[([], "ff")])
        folder = _folder(FolderVisibility.OWNER, owner_user_id="u1")
        assert _svc().can_access_folder(folder, user) is False

    def test_owner_visibility_no_owner_blocked(self):
        user = _user(uid="u1", roles=[([], "ff")])
        folder = _folder(FolderVisibility.OWNER, owner_user_id=None)
        assert _svc().can_access_folder(folder, user) is False

    def test_organization_visibility_open_to_all(self):
        user = _user(roles=[([], "ff")])
        folder = _folder(FolderVisibility.ORGANIZATION)
        assert _svc().can_access_folder(folder, user) is True

    def test_organization_with_allowed_roles_match(self):
        user = _user(roles=[([], "officer")])
        folder = _folder(
            FolderVisibility.ORGANIZATION, allowed_roles=["officer", "chief"]
        )
        assert _svc().can_access_folder(folder, user) is True

    def test_organization_with_allowed_roles_no_match(self):
        user = _user(roles=[([], "ff")])
        folder = _folder(FolderVisibility.ORGANIZATION, allowed_roles=["officer"])
        assert _svc().can_access_folder(folder, user) is False

    def test_none_visibility_defaults_to_organization(self):
        user = _user(roles=[([], "ff")])
        folder = _folder(None)
        assert _svc().can_access_folder(folder, user) is True


class TestCanAccessDocument:
    """A by-id document fetch must honour the containing folder's access rules,
    otherwise a member can pull a leadership-only or another member's personal
    (owner-only) document by guessing its id — bypassing the list view."""

    async def test_no_folder_is_org_level_accessible(self):
        doc = SimpleNamespace(folder_id=None)
        user = _user(roles=[([], "ff")])
        assert await _svc().can_access_document(doc, "org-1", user) is True

    async def test_owner_only_folder_blocks_other_member(self):
        svc = _svc()
        svc.get_folder_by_id = AsyncMock(
            return_value=_folder(FolderVisibility.OWNER, owner_user_id="u1")
        )
        doc = SimpleNamespace(folder_id="f1")
        other = _user(uid="u2", roles=[([], "ff")])
        assert await svc.can_access_document(doc, "org-1", other) is False

    async def test_leadership_folder_blocks_non_leadership(self):
        svc = _svc()
        svc.get_folder_by_id = AsyncMock(
            return_value=_folder(FolderVisibility.LEADERSHIP)
        )
        doc = SimpleNamespace(folder_id="f1")
        user = _user(roles=[(["events.view"], "ff")])
        assert await svc.can_access_document(doc, "org-1", user) is False

    async def test_leadership_folder_allows_leadership(self):
        svc = _svc()
        svc.get_folder_by_id = AsyncMock(
            return_value=_folder(FolderVisibility.LEADERSHIP)
        )
        doc = SimpleNamespace(folder_id="f1")
        chief = _user(roles=[(["documents.manage"], "chief")])
        assert await svc.can_access_document(doc, "org-1", chief) is True

    async def test_missing_folder_fails_closed(self):
        """An unresolvable folder reference must deny, not fall through the
        ACL — see can_access_document's fail-closed contract."""
        svc = _svc()
        svc.get_folder_by_id = AsyncMock(return_value=None)
        doc = SimpleNamespace(folder_id="gone")
        user = _user(roles=[([], "ff")])
        assert await svc.can_access_document(doc, "org-1", user) is False


class TestAccessibleFolderIds:
    """A folder-less document listing must be restricted to folders the caller
    can access, or it leaks documents from restricted/owner-only folders."""

    async def test_leadership_has_no_restriction(self):
        svc = _svc()
        chief = _user(roles=[(["documents.manage"], "chief")])
        assert await svc.accessible_folder_ids("org-1", chief) is None

    async def test_non_leadership_filtered_to_accessible(self):
        svc = _svc()
        folders = [
            _folder(FolderVisibility.ORGANIZATION, fid="f-org"),
            _folder(FolderVisibility.LEADERSHIP, fid="f-lead"),
            _folder(FolderVisibility.OWNER, owner_user_id="u1", fid="f-mine"),
            _folder(FolderVisibility.OWNER, owner_user_id="u2", fid="f-theirs"),
            _folder(
                FolderVisibility.ORGANIZATION, allowed_roles=["officer"], fid="f-off"
            ),
        ]
        result = MagicMock()
        result.scalars.return_value.all.return_value = folders
        svc.db.execute = AsyncMock(return_value=result)

        member = _user(uid="u1", roles=[([], "ff")])
        ids = await svc.accessible_folder_ids("org-1", member)
        # Open org folder + own owner folder only; not leadership, others', or
        # the officer-restricted folder.
        assert ids == {"f-org", "f-mine"}


class TestAttachDocumentNames:
    """DOC2-1: the response declares uploader_name/folder_name and the UI renders
    "Uploaded by {uploader_name}", but the ORM row has neither — so they must be
    populated org-scoped or the attribution never appears."""

    def _doc(self, uploaded_by=None, folder_id=None):
        return SimpleNamespace(
            uploaded_by=uploaded_by,
            folder_id=folder_id,
            uploader_name=None,
            folder_name=None,
        )

    def _rows(self, data):
        r = MagicMock()
        r.all.return_value = data
        return r

    async def test_populates_uploader_and_folder(self):
        db = AsyncMock()
        svc = DocumentsService(db)
        doc = self._doc(uploaded_by="u1", folder_id="f1")
        # One execute per non-empty id set: users, then folders.
        db.execute.side_effect = [
            self._rows([("u1", "Dana", "Reyes")]),
            self._rows([("f1", "Engine Bay")]),
        ]
        await svc.attach_document_names("org-1", [doc])
        assert doc.uploader_name == "Dana Reyes"
        assert doc.folder_name == "Engine Bay"

    async def test_empty_list_makes_no_query(self):
        db = AsyncMock()
        svc = DocumentsService(db)
        await svc.attach_document_names("org-1", [])
        db.execute.assert_not_awaited()

    async def test_unresolved_uploader_yields_none(self):
        db = AsyncMock()
        svc = DocumentsService(db)
        doc = self._doc(uploaded_by="u-foreign")  # no folder_id
        db.execute.side_effect = [self._rows([])]  # user not in org
        await svc.attach_document_names("org-1", [doc])
        assert doc.uploader_name is None
        assert doc.folder_name is None


class TestCreatesCycle:
    """DOC-10 finding #9: the existing FK-validation guard on ``parent_id``
    only checks the target folder exists in the org, never that it isn't the
    folder itself or one of its own descendants — a cycle can be committed,
    breaking root-based navigation and cascade delete."""

    def _row(self, value):
        row = MagicMock()
        row.scalar_one_or_none.return_value = value
        return row

    async def test_self_parenting_is_rejected_with_no_query(self):
        # The cheapest case: no db round trip needed to know f1 == f1.
        db = AsyncMock()
        svc = DocumentsService(db)
        assert await svc._creates_cycle("f1", "f1", "org-1") is True
        db.execute.assert_not_awaited()

    async def test_a_direct_child_as_new_parent_is_rejected(self):
        # f1 -> f2 (f2's parent is f1); moving f1 under f2 is a 2-node cycle.
        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[self._row("f1")])
        svc = DocumentsService(db)
        assert await svc._creates_cycle("f1", "f2", "org-1") is True

    async def test_a_deeper_descendant_as_new_parent_is_rejected(self):
        # f1 -> f2 -> f3; moving f1 under f3 walks f3 -> f2 -> f1.
        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[self._row("f2"), self._row("f1")])
        svc = DocumentsService(db)
        assert await svc._creates_cycle("f1", "f3", "org-1") is True

    async def test_an_unrelated_folder_is_not_a_cycle(self):
        # f5's chain (f5 -> f6 -> root) never reaches f1.
        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[self._row("f6"), self._row(None)])
        svc = DocumentsService(db)
        assert await svc._creates_cycle("f1", "f5", "org-1") is False

    async def test_a_preexisting_unrelated_cycle_terminates_instead_of_hanging(self):
        # A pre-existing loop elsewhere (f2 <-> f3) that never reaches the
        # target must not spin forever.
        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[self._row("f3"), self._row("f2")])
        svc = DocumentsService(db)
        assert await svc._creates_cycle("f1", "f2", "org-1") is False


class TestDocumentFolderUpdateSchema:
    """Codex finding on PR #1827: ``color``/``icon`` are DB-nullable, but
    ``DocumentFolderResponse`` declares both as required strings — a PATCH
    that clears either would commit successfully and then 500 on every
    subsequent read of that row (including any listing containing it).
    Rejected at the request boundary instead, since neither field ever has a
    legitimate reason to be null: ``DocumentFolderCreate`` always gives both
    a real default.
    """

    pytestmark = pytest.mark.unit

    def test_explicit_null_color_is_rejected(self):
        with pytest.raises(ValidationError, match="color cannot be cleared"):
            DocumentFolderUpdate(color=None)

    def test_explicit_null_icon_is_rejected(self):
        with pytest.raises(ValidationError, match="icon cannot be cleared"):
            DocumentFolderUpdate(icon=None)

    def test_omitting_color_and_icon_is_fine(self):
        update = DocumentFolderUpdate(name="Renamed")
        assert "color" not in update.model_fields_set
        assert "icon" not in update.model_fields_set

    def test_a_real_value_is_accepted(self):
        update = DocumentFolderUpdate(color="#FF0000", icon="star")
        assert update.color == "#FF0000"
        assert update.icon == "star"


class TestParseUuidOr400:
    """DOC-10 finding #4: a malformed UUID at the request boundary must be a
    clean 4xx, not an unhandled 500."""

    def test_a_valid_uuid_string_parses(self):
        from uuid import UUID

        parsed = _parse_uuid_or_400("11111111-1111-1111-1111-111111111111", "folder_id")
        assert isinstance(parsed, UUID)

    def test_a_malformed_value_is_a_clean_400_not_a_500(self):
        # The upload form's own placeholder value, sent as folder_id when an
        # org has no folders yet — this used to reach UUID(...) unguarded and
        # escape as an unhandled 500.
        with pytest.raises(HTTPException) as exc:
            _parse_uuid_or_400("general", "folder_id")
        assert exc.value.status_code == 400

    def test_an_empty_string_is_also_a_clean_400(self):
        with pytest.raises(HTTPException) as exc:
            _parse_uuid_or_400("", "parent_id")
        assert exc.value.status_code == 400


class TestResolveDocumentName:
    """DOC-10 finding #6: the upload form advertises the name field as
    optional and omits it when blank, so the endpoint must derive one rather
    than 422 on that normal, advertised path."""

    def test_the_caller_supplied_name_wins(self):
        assert _resolve_document_name("SOP 4.2", "sop-4-2.pdf") == "SOP 4.2"

    def test_a_blank_name_falls_back_to_the_filename(self):
        assert _resolve_document_name("", "sop-4-2.pdf") == "sop-4-2.pdf"
        assert _resolve_document_name(None, "sop-4-2.pdf") == "sop-4-2.pdf"

    def test_whitespace_only_name_falls_back_to_the_filename(self):
        assert _resolve_document_name("   ", "sop-4-2.pdf") == "sop-4-2.pdf"

    def test_no_name_and_no_filename_gets_a_generic_default(self):
        assert _resolve_document_name(None, None) == "Untitled document"


@pytest.mark.integration
class TestUpdateFolderPreservesExplicitNulls:
    """DOC-10 finding #5: the PATCH endpoint used to dump the payload with
    ``exclude_none=True``, silently dropping an explicit null before the
    service ever saw it — clearing a folder's ``parent_id`` reported success
    and left the old parent in place. Exercised against the service (which
    now runs the payload through ``apply_updates``), not the endpoint, since
    the endpoint's only role in the fix is which ``model_dump`` flag it uses.
    """

    async def test_explicit_null_clears_parent_id(self, db_session):
        org = Organization(name="Falls Church VFD", slug="fcvfd-doc-1")
        db_session.add(org)
        await db_session.flush()

        parent = DocumentFolder(organization_id=org.id, name="Parent")
        db_session.add(parent)
        await db_session.flush()

        child = DocumentFolder(
            organization_id=org.id, name="Child", parent_id=parent.id
        )
        db_session.add(child)
        await db_session.flush()

        svc = DocumentsService(db_session)
        updated = await svc.update_folder(child.id, org.id, {"parent_id": None})
        assert updated.parent_id is None

    async def test_omitting_the_field_leaves_it_alone(self, db_session):
        org = Organization(name="Falls Church VFD", slug="fcvfd-doc-2")
        db_session.add(org)
        await db_session.flush()

        parent = DocumentFolder(organization_id=org.id, name="Parent")
        db_session.add(parent)
        await db_session.flush()

        child = DocumentFolder(
            organization_id=org.id, name="Child", parent_id=parent.id
        )
        db_session.add(child)
        await db_session.flush()
        # Captured before the update commits: the service's own commit()
        # expires every object in the session (expire_on_commit is the
        # default), so re-reading `parent.id` afterwards would trigger a
        # lazy refresh outside the greenlet context this test runs in.
        parent_id = parent.id

        svc = DocumentsService(db_session)
        updated = await svc.update_folder(child.id, org.id, {"name": "Renamed"})
        assert updated.name == "Renamed"
        assert updated.parent_id == parent_id

    async def test_moving_a_folder_under_its_own_descendant_is_rejected(
        self, db_session
    ):
        org = Organization(name="Falls Church VFD", slug="fcvfd-doc-3")
        db_session.add(org)
        await db_session.flush()

        root = DocumentFolder(organization_id=org.id, name="Root")
        db_session.add(root)
        await db_session.flush()

        child = DocumentFolder(organization_id=org.id, name="Child", parent_id=root.id)
        db_session.add(child)
        await db_session.flush()

        svc = DocumentsService(db_session)
        with pytest.raises(ValueError, match="own descendants"):
            await svc.update_folder(root.id, org.id, {"parent_id": child.id})


@pytest.mark.integration
class TestDownloadDocument:
    """DOC-10 finding #10 (P1): there was no way to retrieve an uploaded
    document's bytes at all. ``download_document`` must apply the same
    folder ACL ``get_document`` does, and must not serve a document with no
    (or a tampered) file on disk.

    Files are written under ``UPLOAD_DIR/<organization_id>``, matching how
    ``upload_document`` actually lays them out on disk — the containment
    check is scoped to that per-org subdirectory, not the shared root, so a
    fixture that wrote straight into ``tmp_path`` would pass a check that
    real uploads could never satisfy (Codex finding).
    """

    async def _org_and_folder(self, db_session, slug, **folder_kwargs):
        org = Organization(name="Falls Church VFD", slug=slug)
        db_session.add(org)
        await db_session.flush()
        folder = DocumentFolder(organization_id=org.id, name="Folder", **folder_kwargs)
        db_session.add(folder)
        await db_session.flush()
        return org, folder

    def _stored_file(self, upload_dir, org, name="stored.pdf"):
        org_dir = upload_dir / str(org.id)
        org_dir.mkdir(parents=True, exist_ok=True)
        file_path = org_dir / name
        file_path.write_bytes(b"%PDF-1.4 test")
        return file_path

    async def test_accessible_document_downloads(
        self, db_session, tmp_path, monkeypatch
    ):
        monkeypatch.setattr("app.api.v1.endpoints.documents.UPLOAD_DIR", str(tmp_path))
        org, folder = await self._org_and_folder(db_session, "fcvfd-dl-1")
        file_path = self._stored_file(tmp_path, org)
        document = Document(
            organization_id=org.id,
            folder_id=folder.id,
            name="Doc",
            file_name="report.pdf",
            file_path=str(file_path),
            file_type="application/pdf",
        )
        db_session.add(document)
        await db_session.flush()

        user = _user(uid="caller-1", roles=[(["documents.view"], "member")])
        user.organization_id = org.id
        response = await download_document(
            document.id, db=db_session, current_user=user
        )
        assert response.path == str(file_path)

    async def test_leadership_only_folder_is_hidden_as_404_not_403(
        self, db_session, tmp_path, monkeypatch
    ):
        # Matches get_document: existence of a restricted document is never
        # confirmed to a caller who cannot see it.
        monkeypatch.setattr("app.api.v1.endpoints.documents.UPLOAD_DIR", str(tmp_path))
        org, folder = await self._org_and_folder(
            db_session, "fcvfd-dl-2", visibility=FolderVisibility.LEADERSHIP
        )
        file_path = self._stored_file(tmp_path, org)
        document = Document(
            organization_id=org.id,
            folder_id=folder.id,
            name="Doc",
            file_name="report.pdf",
            file_path=str(file_path),
            file_type="application/pdf",
        )
        db_session.add(document)
        await db_session.flush()

        user = _user(uid="caller-1", roles=[(["documents.view"], "member")])
        user.organization_id = org.id
        with pytest.raises(HTTPException) as exc:
            await download_document(document.id, db=db_session, current_user=user)
        assert exc.value.status_code == 404

    async def test_missing_file_on_disk_is_a_404(
        self, db_session, tmp_path, monkeypatch
    ):
        monkeypatch.setattr("app.api.v1.endpoints.documents.UPLOAD_DIR", str(tmp_path))
        org, folder = await self._org_and_folder(db_session, "fcvfd-dl-3")
        org_dir = tmp_path / str(org.id)
        org_dir.mkdir(parents=True, exist_ok=True)
        document = Document(
            organization_id=org.id,
            folder_id=folder.id,
            name="Doc",
            file_name="gone.pdf",
            file_path=str(org_dir / "never-written.pdf"),
            file_type="application/pdf",
        )
        db_session.add(document)
        await db_session.flush()

        user = _user(uid="caller-1", roles=[(["documents.view"], "member")])
        user.organization_id = org.id
        with pytest.raises(HTTPException) as exc:
            await download_document(document.id, db=db_session, current_user=user)
        assert exc.value.status_code == 404

    async def test_path_outside_upload_dir_is_rejected(
        self, db_session, tmp_path, monkeypatch
    ):
        # Defence-in-depth: a tampered file_path outside UPLOAD_DIR entirely
        # must not be served even if the row and the file both genuinely
        # exist.
        upload_dir = tmp_path / "uploads"
        upload_dir.mkdir()
        monkeypatch.setattr(
            "app.api.v1.endpoints.documents.UPLOAD_DIR", str(upload_dir)
        )
        outside_file = tmp_path / "outside.pdf"
        outside_file.write_bytes(b"%PDF-1.4 test")
        org, folder = await self._org_and_folder(db_session, "fcvfd-dl-4")
        document = Document(
            organization_id=org.id,
            folder_id=folder.id,
            name="Doc",
            file_name="outside.pdf",
            file_path=str(outside_file),
            file_type="application/pdf",
        )
        db_session.add(document)
        await db_session.flush()

        user = _user(uid="caller-1", roles=[(["documents.view"], "member")])
        user.organization_id = org.id
        with pytest.raises(HTTPException) as exc:
            await download_document(document.id, db=db_session, current_user=user)
        assert exc.value.status_code == 403

    async def test_path_inside_another_orgs_upload_directory_is_rejected(
        self, db_session, tmp_path, monkeypatch
    ):
        # Codex finding: every org's files live under the same UPLOAD_DIR
        # root, so a root-level containment check would accept a tampered
        # file_path pointing at a *different* org's own subdirectory and
        # leak that org's document. Containment must be scoped to the
        # caller's own org subdirectory.
        monkeypatch.setattr("app.api.v1.endpoints.documents.UPLOAD_DIR", str(tmp_path))
        org, folder = await self._org_and_folder(db_session, "fcvfd-dl-5")
        other_org, _ = await self._org_and_folder(db_session, "fcvfd-dl-6")
        other_orgs_file = self._stored_file(tmp_path, other_org, name="theirs.pdf")
        document = Document(
            organization_id=org.id,
            folder_id=folder.id,
            name="Doc",
            file_name="theirs.pdf",
            file_path=str(other_orgs_file),
            file_type="application/pdf",
        )
        db_session.add(document)
        await db_session.flush()

        user = _user(uid="caller-1", roles=[(["documents.view"], "member")])
        user.organization_id = org.id
        with pytest.raises(HTTPException) as exc:
            await download_document(document.id, db=db_session, current_user=user)
        assert exc.value.status_code == 403


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
