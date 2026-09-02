"""
Tests for documents service folder access control
(app/services/documents_service.py).

can_access_folder is a security boundary deciding which document folders a
member may see. Covers the leadership override, leadership/owner/organization
visibility, and the allowed-roles restriction, plus the permission/role
collection helpers. Pure logic; no DB.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints.documents import (
    _parse_uuid_or_400,
    _resolve_document_name,
    create_folder,
    delete_folder,
    download_document,
    update_document,
    update_folder,
)
from app.models.audit import AuditLog
from app.models.document import Document, DocumentFolder, FolderVisibility
from app.models.user import Organization, User
from app.schemas.documents import (
    DocumentFolderCreate,
    DocumentFolderUpdate,
    DocumentUpdate,
)
from app.services.documents_service import (
    DocumentsService,
    _get_user_permissions,
    _get_user_role_slugs,
    _is_leadership,
)


def _user(uid="u1", roles=None, rank=None):
    # roles: list of (permissions_list, slug)
    # `rank` is part of a real User and carries its own default permissions,
    # so the stand-in declares it rather than leaving the attribute absent.
    role_objs = [
        SimpleNamespace(permissions=perms, slug=slug) for perms, slug in (roles or [])
    ]
    return SimpleNamespace(id=uid, roles=role_objs, rank=rank)


def _folder(
    visibility,
    owner_user_id=None,
    allowed_roles=None,
    fid="f1",
    required_permissions=None,
    parent_id=None,
    organization_id="org-1",
):
    # required_permissions is spelled out rather than defaulted away: the ACL
    # reads it directly instead of via getattr, because a getattr default would
    # make an unloaded or half-built folder read as "unrestricted" — failing
    # open on the one rule that gates another module's sensitive data.
    return SimpleNamespace(
        id=fid,
        visibility=visibility,
        owner_user_id=owner_user_id,
        allowed_roles=allowed_roles,
        required_permissions=required_permissions,
        parent_id=parent_id,
        organization_id=organization_id,
    )


def _svc():
    return DocumentsService(MagicMock())


class TestHelpers:
    async def test_collect_permissions_across_roles(self):
        user = _user(roles=[(["a", "b"], "r1"), (["b", "c"], "r2")])
        assert _get_user_permissions(user) == {"a", "b", "c"}

    async def test_collect_role_slugs(self):
        user = _user(roles=[([], "chief"), ([], "secretary")])
        assert _get_user_role_slugs(user) == {"chief", "secretary"}

    async def test_is_leadership(self):
        assert _is_leadership({"documents.manage"}) is True
        assert _is_leadership({"members.manage"}) is True
        assert _is_leadership({"*"}) is True
        assert _is_leadership({"events.view"}) is False


class TestCanAccessFolder:
    async def test_leadership_sees_everything(self):
        user = _user(roles=[(["documents.manage"], "chief")])
        # Even a leadership-only folder is visible to leadership.
        folder = _folder(FolderVisibility.LEADERSHIP)
        assert await _svc().can_access_folder(folder, "org-1", user) is True

    async def test_leadership_visibility_blocks_non_leadership(self):
        user = _user(roles=[(["events.view"], "ff")])
        folder = _folder(FolderVisibility.LEADERSHIP)
        assert await _svc().can_access_folder(folder, "org-1", user) is False

    async def test_owner_visibility_owner_allowed(self):
        user = _user(uid="u1", roles=[([], "ff")])
        folder = _folder(FolderVisibility.OWNER, owner_user_id="u1")
        assert await _svc().can_access_folder(folder, "org-1", user) is True

    async def test_owner_visibility_non_owner_blocked(self):
        user = _user(uid="u2", roles=[([], "ff")])
        folder = _folder(FolderVisibility.OWNER, owner_user_id="u1")
        assert await _svc().can_access_folder(folder, "org-1", user) is False

    async def test_owner_visibility_no_owner_blocked(self):
        user = _user(uid="u1", roles=[([], "ff")])
        folder = _folder(FolderVisibility.OWNER, owner_user_id=None)
        assert await _svc().can_access_folder(folder, "org-1", user) is False

    async def test_organization_visibility_open_to_all(self):
        user = _user(roles=[([], "ff")])
        folder = _folder(FolderVisibility.ORGANIZATION)
        assert await _svc().can_access_folder(folder, "org-1", user) is True

    async def test_organization_with_allowed_roles_match(self):
        user = _user(roles=[([], "officer")])
        folder = _folder(
            FolderVisibility.ORGANIZATION, allowed_roles=["officer", "chief"]
        )
        assert await _svc().can_access_folder(folder, "org-1", user) is True

    async def test_organization_with_allowed_roles_no_match(self):
        user = _user(roles=[([], "ff")])
        folder = _folder(FolderVisibility.ORGANIZATION, allowed_roles=["officer"])
        assert await _svc().can_access_folder(folder, "org-1", user) is False

    async def test_none_visibility_defaults_to_organization(self):
        user = _user(roles=[([], "ff")])
        folder = _folder(None)
        assert await _svc().can_access_folder(folder, "org-1", user) is True


class TestFolderHierarchyAccess:
    """Every restriction in the path to the root is an authorization gate."""

    async def _access(self, child, user, *ancestors):
        folders = {str(folder.id): folder for folder in (child, *ancestors)}
        return await _svc().can_access_folder(
            child, "org-1", user, folders_by_id=folders
        )

    async def test_org_child_under_leadership_parent_is_denied(self):
        parent = _folder(FolderVisibility.LEADERSHIP, fid="parent")
        child = _folder(FolderVisibility.ORGANIZATION, fid="child", parent_id="parent")
        assert not await self._access(child, _user(roles=[([], "ff")]), parent)

    async def test_child_under_another_members_owner_parent_is_denied(self):
        parent = _folder(FolderVisibility.OWNER, fid="parent", owner_user_id="owner")
        child = _folder(FolderVisibility.ORGANIZATION, fid="child", parent_id="parent")
        assert not await self._access(child, _user(uid="other"), parent)

    async def test_role_and_required_permission_ancestors_both_apply(self):
        root = _folder(
            FolderVisibility.ORGANIZATION,
            fid="root",
            required_permissions=["facilities.view_sensitive"],
        )
        parent = _folder(
            FolderVisibility.ORGANIZATION,
            fid="parent",
            parent_id="root",
            allowed_roles=["officer"],
        )
        child = _folder(FolderVisibility.ORGANIZATION, fid="child", parent_id="parent")
        assert not await self._access(
            child, _user(roles=[([], "officer")]), parent, root
        )
        assert not await self._access(
            child,
            _user(roles=[(["facilities.view_sensitive"], "member")]),
            parent,
            root,
        )
        assert await self._access(
            child,
            _user(roles=[(["facilities.view_sensitive"], "officer")]),
            parent,
            root,
        )

    async def test_missing_and_cross_org_ancestors_fail_closed(self):
        child = _folder(FolderVisibility.ORGANIZATION, fid="child", parent_id="missing")
        assert not await self._access(child, _user())

        foreign = _folder(
            FolderVisibility.ORGANIZATION,
            fid="foreign",
            organization_id="org-2",
        )
        child.parent_id = "foreign"
        assert not await self._access(child, _user(), foreign)

    async def test_cycle_terminates_and_fails_closed(self):
        first = _folder(FolderVisibility.ORGANIZATION, fid="first", parent_id="second")
        second = _folder(FolderVisibility.ORGANIZATION, fid="second", parent_id="first")
        assert not await self._access(first, _user(), second)

    async def test_owner_is_admitted_through_member_root(self):
        root = _folder(FolderVisibility.ORGANIZATION, fid="members")
        child = _folder(
            FolderVisibility.OWNER,
            fid="personal",
            parent_id="members",
            owner_user_id="u1",
        )
        assert await self._access(child, _user(uid="u1"), root)

    async def test_facility_grant_is_admitted_through_facility_root(self):
        permissions = ["facilities.view_sensitive"]
        root = _folder(
            FolderVisibility.ORGANIZATION,
            fid="facilities",
            required_permissions=permissions,
        )
        child = _folder(
            FolderVisibility.ORGANIZATION,
            fid="facility",
            parent_id="facilities",
            required_permissions=permissions,
        )
        user = _user(roles=[(["facilities.view_sensitive"], "treasurer")])
        assert await self._access(child, user, root)


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

    async def test_leadership_receives_explicit_accessible_ids(self):
        svc = _svc()
        result = MagicMock()
        result.scalars.return_value.all.return_value = [
            _folder(FolderVisibility.ORGANIZATION, fid="f-org"),
            _folder(FolderVisibility.LEADERSHIP, fid="f-lead"),
        ]
        svc.db.execute = AsyncMock(return_value=result)

        chief = _user(roles=[(["documents.manage"], "chief")])
        assert await svc.accessible_folder_ids("org-1", chief) == {
            "f-org",
            "f-lead",
        }

    async def test_leadership_is_still_filtered_by_required_permissions(self):
        """ "No restriction" would hand a documents administrator the facility
        files that facilities.view_sensitive exists to withhold, which is the
        leak the field was added to close."""
        svc = _svc()
        result = MagicMock()
        result.scalars.return_value.all.return_value = [
            _folder(FolderVisibility.ORGANIZATION, fid="f-org"),
            _folder(
                FolderVisibility.ORGANIZATION,
                fid="f-facility",
                required_permissions=["facilities.view_sensitive"],
            ),
        ]
        svc.db.execute = AsyncMock(return_value=result)

        chief = _user(roles=[(["documents.manage"], "chief")])
        assert await svc.accessible_folder_ids("org-1", chief) == {"f-org"}

        holder = _user(
            roles=[(["documents.manage", "facilities.view_sensitive"], "facilities")]
        )
        assert await svc.accessible_folder_ids("org-1", holder) == {
            "f-org",
            "f-facility",
        }

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

    async def test_accessible_child_is_hidden_beneath_inaccessible_ancestor(self):
        svc = _svc()
        folders = [
            _folder(FolderVisibility.LEADERSHIP, fid="parent"),
            _folder(
                FolderVisibility.ORGANIZATION,
                fid="child",
                parent_id="parent",
            ),
        ]
        result = MagicMock()
        result.scalars.return_value.all.return_value = folders
        svc.db.execute = AsyncMock(return_value=result)

        member = _user(roles=[([], "member")])
        assert await svc.accessible_folder_ids("org-1", member) == set()


@pytest.mark.integration
class TestDocumentsSummaryAccess:
    """Summary cards must describe the same rows the caller can browse."""

    async def test_summary_matches_each_caller_access_scope(self, db_session):
        org = Organization(name="Summary VFD", slug="documents-summary-access")
        db_session.add(org)
        await db_session.flush()

        owner = User(
            organization_id=org.id,
            username="summary-owner",
            email="summary-owner@example.com",
        )
        db_session.add(owner)
        await db_session.flush()
        owner_id = owner.id
        folders = {
            "open": DocumentFolder(organization_id=org.id, name="Open"),
            "role": DocumentFolder(
                organization_id=org.id,
                name="Officers",
                allowed_roles=["officer"],
            ),
            "owner": DocumentFolder(
                organization_id=org.id,
                name="Personal",
                visibility=FolderVisibility.OWNER,
                owner_user_id=owner_id,
            ),
            "sensitive": DocumentFolder(
                organization_id=org.id,
                name="Sensitive",
                required_permissions=["facilities.view_sensitive"],
            ),
            "leadership": DocumentFolder(
                organization_id=org.id,
                name="Leadership",
                visibility=FolderVisibility.LEADERSHIP,
            ),
        }
        db_session.add_all(folders.values())
        await db_session.flush()
        folders["nested"] = DocumentFolder(
            organization_id=org.id,
            name="Nested open child",
            parent_id=folders["leadership"].id,
        )
        db_session.add(folders["nested"])
        await db_session.flush()

        current = datetime.now(timezone.utc)
        old = datetime(2020, 1, 1, tzinfo=timezone.utc)
        documents = [
            Document(
                organization_id=org.id,
                folder_id=folders[key].id,
                name=key,
                file_size=size,
                created_at=old if key == "owner" else current,
            )
            for key, size in [
                ("open", 10),
                ("role", 20),
                ("owner", 30),
                ("sensitive", 40),
                ("leadership", 50),
                ("nested", 60),
            ]
        ]
        documents.extend(
            [
                Document(
                    organization_id=org.id,
                    name="Organization level",
                    file_size=5,
                    created_at=current,
                ),
                Document(
                    organization_id=org.id,
                    folder_id=folders["open"].id,
                    name="Archived",
                    file_size=100,
                    status="archived",
                    created_at=current,
                ),
            ]
        )
        db_session.add_all(documents)
        await db_session.flush()

        callers = [
            (_user(roles=[([], "member")]), (2, 1, 15, 2)),
            (_user(uid=owner_id, roles=[([], "member")]), (3, 2, 45, 2)),
            (_user(roles=[([], "officer")]), (3, 2, 35, 3)),
            (
                _user(roles=[(["facilities.view_sensitive"], "facility-reader")]),
                (3, 2, 55, 3),
            ),
            (
                _user(roles=[(["documents.manage"], "leadership")]),
                (6, 5, 175, 5),
            ),
        ]

        service = DocumentsService(db_session)
        for caller, expected in callers:
            accessible_ids = await service.accessible_folder_ids(org.id, caller)
            browsable, browsable_total = await service.get_documents(
                org.id, accessible_folder_ids=accessible_ids, limit=100
            )
            summary = await service.get_summary(org.id, caller)

            assert len(browsable) == browsable_total == expected[0]
            assert summary == {
                "total_documents": expected[0],
                "total_folders": expected[1],
                "total_size_bytes": expected[2],
                "documents_this_month": expected[3],
            }


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


class TestParseUuidOr400:
    """DOC-10 finding #4: a malformed UUID at the request boundary must be a
    clean 4xx, not an unhandled 500."""

    async def test_a_valid_uuid_string_parses(self):
        from uuid import UUID

        parsed = _parse_uuid_or_400("11111111-1111-1111-1111-111111111111", "folder_id")
        assert isinstance(parsed, UUID)

    async def test_a_malformed_value_is_a_clean_400_not_a_500(self):
        # The upload form's own placeholder value, sent as folder_id when an
        # org has no folders yet — this used to reach UUID(...) unguarded and
        # escape as an unhandled 500.
        with pytest.raises(HTTPException) as exc:
            _parse_uuid_or_400("general", "folder_id")
        assert exc.value.status_code == 400

    async def test_an_empty_string_is_also_a_clean_400(self):
        with pytest.raises(HTTPException) as exc:
            _parse_uuid_or_400("", "parent_id")
        assert exc.value.status_code == 400


class TestResolveDocumentName:
    """DOC-10 finding #6: the upload form advertises the name field as
    optional and omits it when blank, so the endpoint must derive one rather
    than 422 on that normal, advertised path."""

    async def test_the_caller_supplied_name_wins(self):
        assert _resolve_document_name("SOP 4.2", "sop-4-2.pdf") == "SOP 4.2"

    async def test_a_blank_name_falls_back_to_the_filename(self):
        assert _resolve_document_name("", "sop-4-2.pdf") == "sop-4-2.pdf"
        assert _resolve_document_name(None, "sop-4-2.pdf") == "sop-4-2.pdf"

    async def test_whitespace_only_name_falls_back_to_the_filename(self):
        assert _resolve_document_name("   ", "sop-4-2.pdf") == "sop-4-2.pdf"

    async def test_no_name_and_no_filename_gets_a_generic_default(self):
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

    @pytest.mark.parametrize("field", ["color", "icon"])
    async def test_clearing_color_or_icon_is_rejected(self, db_session, field):
        # DOC-20 (Codex round-2 on #1826): color/icon are DB-nullable but
        # DocumentFolderResponse requires both as plain str -- persisting an
        # explicit null 500s the *next* serialization of this row (including
        # a plain folder listing), after the bad value is already committed.
        # Must be rejected with a ValueError (-> 400) before it ever reaches
        # apply_updates, not merely surface later as a serialization error.
        org = Organization(name="Falls Church VFD", slug="fcvfd-doc-4")
        db_session.add(org)
        await db_session.flush()

        folder = DocumentFolder(organization_id=org.id, name="Folder")
        db_session.add(folder)
        await db_session.flush()

        svc = DocumentsService(db_session)
        with pytest.raises(ValueError, match=f"'{field}' cannot be cleared"):
            await svc.update_folder(folder.id, org.id, {field: None})

    async def test_setting_color_and_icon_to_a_new_value_still_works(self, db_session):
        # The rejection above is specific to null -- a real replacement value
        # must still be written normally.
        org = Organization(name="Falls Church VFD", slug="fcvfd-doc-5")
        db_session.add(org)
        await db_session.flush()

        folder = DocumentFolder(organization_id=org.id, name="Folder")
        db_session.add(folder)
        await db_session.flush()

        svc = DocumentsService(db_session)
        updated = await svc.update_folder(
            folder.id, org.id, {"color": "#000000", "icon": "star"}
        )
        assert updated.color == "#000000"
        assert updated.icon == "star"


@pytest.mark.integration
class TestDownloadDocument:
    """DOC-18 (P1): there was no way to retrieve an uploaded document's bytes
    at all. ``download_document`` must apply the same folder ACL
    ``get_document`` does, must never serve a document with no (or a
    tampered) file on disk, and must confine a resolved path to the
    *caller's own org* subdirectory -- not the shared ``UPLOAD_DIR`` root
    (ported from #1827, DOC-24 finding).

    Files are written under ``UPLOAD_DIR/<organization_id>``, matching how
    ``upload_document`` actually lays them out on disk (see its own
    ``org_dir = os.path.join(UPLOAD_DIR, str(current_user.organization_id))``)
    -- the containment check is scoped to that per-org subdirectory, not the
    shared root, so a fixture that wrote straight into ``tmp_path`` would
    pass a check real uploads could never satisfy.
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

    def _caller(self, org_id):
        user = _user(uid="caller-1", roles=[(["documents.view"], "member")])
        user.organization_id = org_id
        user.username = "caller"
        return user

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

        response = await download_document(
            document.id, db=db_session, current_user=self._caller(org.id)
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

        with pytest.raises(HTTPException) as exc:
            await download_document(
                document.id, db=db_session, current_user=self._caller(org.id)
            )
        assert exc.value.status_code == 404

    async def test_generated_document_with_no_file_path_is_a_404(
        self, db_session, tmp_path, monkeypatch
    ):
        # A published-minutes/property-return style document carries
        # content_html and no file_path at all -- there is nothing to
        # download, ever, for this row (matches Document.has_file == False).
        monkeypatch.setattr("app.api.v1.endpoints.documents.UPLOAD_DIR", str(tmp_path))
        org, folder = await self._org_and_folder(db_session, "fcvfd-dl-3")
        document = Document(
            organization_id=org.id,
            folder_id=folder.id,
            name="Minutes",
            content_html="<p>Approved</p>",
            file_path=None,
        )
        db_session.add(document)
        await db_session.flush()
        assert document.has_file is False

        with pytest.raises(HTTPException) as exc:
            await download_document(
                document.id, db=db_session, current_user=self._caller(org.id)
            )
        assert exc.value.status_code == 404

    async def test_missing_file_on_disk_is_a_404(
        self, db_session, tmp_path, monkeypatch
    ):
        monkeypatch.setattr("app.api.v1.endpoints.documents.UPLOAD_DIR", str(tmp_path))
        org, folder = await self._org_and_folder(db_session, "fcvfd-dl-4")
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

        with pytest.raises(HTTPException) as exc:
            await download_document(
                document.id, db=db_session, current_user=self._caller(org.id)
            )
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
        org, folder = await self._org_and_folder(db_session, "fcvfd-dl-5")
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

        with pytest.raises(HTTPException) as exc:
            await download_document(
                document.id, db=db_session, current_user=self._caller(org.id)
            )
        assert exc.value.status_code == 403

    async def test_path_inside_another_orgs_upload_directory_is_rejected(
        self, db_session, tmp_path, monkeypatch
    ):
        # DOC-24 (Codex finding on #1827): every org's files live under the
        # same UPLOAD_DIR root, so a root-level containment check would
        # accept a tampered file_path pointing at a *different* org's own
        # subdirectory and leak that org's document. Containment must be
        # scoped to the caller's own org subdirectory.
        monkeypatch.setattr("app.api.v1.endpoints.documents.UPLOAD_DIR", str(tmp_path))
        org, folder = await self._org_and_folder(db_session, "fcvfd-dl-6")
        other_org, _ = await self._org_and_folder(db_session, "fcvfd-dl-7")
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

        with pytest.raises(HTTPException) as exc:
            await download_document(
                document.id, db=db_session, current_user=self._caller(org.id)
            )
        assert exc.value.status_code == 403


class TestFolderAndDocumentAuditLogging:
    """DOC-27: folder create/update/delete and a document metadata edit had
    no audit trail at all -- unlike document_uploaded/downloaded/deleted,
    which already log. A folder delete in particular cascades to every
    descendant folder and document (plus their backing files) with nothing
    recording who did it.
    """

    async def _manager(self, db_session, org_id):
        # A real row, not a SimpleNamespace stand-in: create_folder/create_draft
        # insert `created_by` as an FK to `users.id`, which a synthetic id
        # would violate.
        user = User(
            organization_id=org_id,
            username="manager",
            email="manager@example.com",
        )
        db_session.add(user)
        await db_session.flush()
        return user

    async def _last_event(self, db_session, event_type):
        result = await db_session.execute(
            select(AuditLog)
            .where(AuditLog.event_type == event_type)
            .order_by(AuditLog.id.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def test_create_folder_is_audited(self, db_session):
        org = Organization(name="Audit VFD", slug="audit-folder-create")
        db_session.add(org)
        await db_session.flush()

        await create_folder(
            DocumentFolderCreate(name="New Folder"),
            db=db_session,
            current_user=await self._manager(db_session, org.id),
        )

        entry = await self._last_event(db_session, "folder_created")
        assert entry is not None
        assert entry.event_data["name"] == "New Folder"

    async def test_update_folder_is_audited(self, db_session):
        org = Organization(name="Audit VFD", slug="audit-folder-update")
        db_session.add(org)
        await db_session.flush()
        folder = DocumentFolder(organization_id=org.id, name="Original")
        db_session.add(folder)
        await db_session.flush()

        await update_folder(
            folder.id,
            DocumentFolderUpdate(name="Renamed"),
            db=db_session,
            current_user=await self._manager(db_session, org.id),
        )

        entry = await self._last_event(db_session, "folder_updated")
        assert entry is not None
        assert entry.event_data["folder_id"] == str(folder.id)
        assert "name" in entry.event_data["fields"]

    async def test_delete_folder_is_audited(self, db_session):
        org = Organization(name="Audit VFD", slug="audit-folder-delete")
        db_session.add(org)
        await db_session.flush()
        folder = DocumentFolder(organization_id=org.id, name="Doomed")
        db_session.add(folder)
        await db_session.flush()
        folder_id = folder.id

        await delete_folder(
            folder_id,
            db=db_session,
            current_user=await self._manager(db_session, org.id),
        )

        entry = await self._last_event(db_session, "folder_deleted")
        assert entry is not None
        assert entry.event_data["folder_id"] == str(folder_id)
        assert entry.severity == "warning"

    async def test_update_document_is_audited(self, db_session):
        org = Organization(name="Audit VFD", slug="audit-document-update")
        db_session.add(org)
        await db_session.flush()
        document = Document(organization_id=org.id, name="Original name")
        db_session.add(document)
        await db_session.flush()

        await update_document(
            document.id,
            DocumentUpdate(name="Renamed"),
            db=db_session,
            current_user=await self._manager(db_session, org.id),
        )

        entry = await self._last_event(db_session, "document_updated")
        assert entry is not None
        assert entry.event_data["document_id"] == str(document.id)
        assert "name" in entry.event_data["fields"]


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
