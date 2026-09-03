"""
Tests for documents service folder access control
(app/services/documents_service.py).

can_access_folder is a security boundary deciding which document folders a
member may see. Covers the leadership override, leadership/owner/organization
visibility, and the allowed-roles restriction, plus the permission/role
collection helpers. Pure logic; no DB.
"""

import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.documents import (
    _parse_uuid_or_400,
    _resolve_document_name,
    create_folder,
    delete_document,
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


class TestFolderListing:
    """Folder pagination is applied after ACL filtering and stays constant-query."""

    async def test_total_counts_the_level_and_the_page_is_one_query(self):
        svc = _svc()
        member = _user(uid="u1", roles=[([], "ff")])
        # Four folders exist; the leadership-only one is not admitted, so the
        # level holds three and the caller asks for the second of them.
        acl_result = MagicMock()
        acl_result.scalars.return_value.all.return_value = [
            _folder(FolderVisibility.ORGANIZATION, fid="f1"),
            _folder(FolderVisibility.LEADERSHIP, fid="hidden"),
            _folder(FolderVisibility.ORGANIZATION, fid="f2"),
            _folder(FolderVisibility.ORGANIZATION, fid="f3"),
        ]
        count_result = MagicMock()
        count_result.scalar_one.return_value = 3
        folder = SimpleNamespace(id="f2")
        page_result = MagicMock()
        page_result.all.return_value = [(folder, 0)]
        svc.db.execute = AsyncMock(side_effect=[acl_result, count_result, page_result])

        folders, total = await svc.get_folders(
            "org-1", current_user=member, skip=1, limit=1
        )

        assert total == 3
        assert [item.id for item in folders] == ["f2"]
        assert folders[0].document_count == 0
        # One ACL pass, one COUNT, one grouped-count page. Never a count query
        # per folder, whatever the level holds or the page returns.
        assert svc.db.execute.await_count == 3

    async def test_ordering_breaks_ties_on_id(self):
        """Two folders sharing sort_order and name must still order stably, or
        a row can appear on two pages or on neither as the caller walks them."""
        svc = _svc()
        acl_result = MagicMock()
        acl_result.scalars.return_value.all.return_value = [
            _folder(FolderVisibility.ORGANIZATION, fid="f1")
        ]
        count_result = MagicMock()
        count_result.scalar_one.return_value = 1
        page_result = MagicMock()
        page_result.all.return_value = [(SimpleNamespace(id="f1"), 0)]
        svc.db.execute = AsyncMock(side_effect=[acl_result, count_result, page_result])

        await svc.get_folders("org-1", current_user=_user(), skip=0, limit=10)

        page_statement = str(svc.db.execute.await_args_list[2].args[0])
        assert "document_folders.id" in page_statement.split("ORDER BY", 1)[1]

    async def test_page_past_total_skips_the_page_query(self):
        svc = _svc()
        acl_result = MagicMock()
        acl_result.scalars.return_value.all.return_value = [
            _folder(FolderVisibility.ORGANIZATION, fid="f1")
        ]
        count_result = MagicMock()
        count_result.scalar_one.return_value = 1
        svc.db.execute = AsyncMock(side_effect=[acl_result, count_result])

        folders, total = await svc.get_folders(
            "org-1", current_user=_user(), skip=1, limit=10
        )

        assert folders == []
        assert total == 1
        assert svc.db.execute.await_count == 2

    async def test_no_accessible_folder_skips_count_and_page(self):
        svc = _svc()
        acl_result = MagicMock()
        acl_result.scalars.return_value.all.return_value = [
            _folder(FolderVisibility.LEADERSHIP, fid="hidden")
        ]
        svc.db.execute = AsyncMock(side_effect=[acl_result])

        folders, total = await svc.get_folders(
            "org-1", current_user=_user(uid="u1", roles=[([], "ff")])
        )

        assert (folders, total) == ([], 0)
        assert svc.db.execute.await_count == 1

    async def test_level_is_filtered_to_the_ancestor_aware_set(self):
        """The restriction that hides a folder can live on its parent, and a
        query filtered to one parent level cannot see it. So the level query
        must carry the accessible-id filter, not just a per-row check."""
        svc = _svc()
        acl_result = MagicMock()
        acl_result.scalars.return_value.all.return_value = [
            _folder(FolderVisibility.ORGANIZATION, fid="root"),
            _folder(
                FolderVisibility.ORGANIZATION,
                fid="child",
                parent_id="locked",
            ),
            _folder(FolderVisibility.LEADERSHIP, fid="locked"),
        ]
        count_result = MagicMock()
        count_result.scalar_one.return_value = 0
        svc.db.execute = AsyncMock(side_effect=[acl_result, count_result])

        folders, total = await svc.get_folders(
            "org-1",
            parent_id="locked",
            current_user=_user(uid="u1", roles=[([], "ff")]),
        )

        assert (folders, total) == ([], 0)
        level_statement = str(svc.db.execute.await_args_list[1].args[0])
        assert "document_folders.id IN" in level_statement


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


@pytest.mark.integration
class TestUpdateAndDeleteDocumentRespectFolderAcl:
    """FAC-13 Codex follow-up (P1): ``documents.manage`` is an org-wide
    mutation grant, but a folder's ``required_permissions`` is the one rule
    leadership/documents.manage does not override (see
    ``_folder_admits_user``). ``get_document``/``download_document`` already
    enforce that boundary via ``can_access_document`` on read --
    ``update_document`` and ``delete_document`` did not, so a documents.manage
    holder with no facilities grant at all could move a facility's
    sensitive-folder document (e.g. Insurance & Leases, gated on
    ``facilities.view_sensitive``) to org-level storage -- after which any
    ``documents.view`` holder could read it -- or delete it outright,
    defeating the folder ACL from the write side instead of merely lacking
    documents.manage's own scope.
    """

    async def _org_and_sensitive_document(self, db_session, slug):
        org = Organization(name="Falls Church VFD", slug=slug)
        db_session.add(org)
        await db_session.flush()
        folder = DocumentFolder(
            organization_id=org.id,
            name="Insurance & Leases",
            required_permissions=["facilities.view_sensitive"],
        )
        db_session.add(folder)
        await db_session.flush()
        document = Document(
            organization_id=org.id,
            folder_id=folder.id,
            name="Policy",
            file_name="policy.pdf",
        )
        db_session.add(document)
        await db_session.flush()
        return org, folder, document

    def _caller(self, org_id, *, facilities_permission=False):
        perms = ["documents.manage"]
        if facilities_permission:
            perms.append("facilities.view_sensitive")
        user = _user(uid="caller-1", roles=[(perms, "admin")])
        user.organization_id = org_id
        user.username = "caller"
        return user

    async def test_documents_manage_alone_cannot_unfile_a_sensitive_document(
        self, db_session
    ):
        org, folder, document = await self._org_and_sensitive_document(
            db_session, "fcvfd-acl-1"
        )
        caller = self._caller(org.id)

        with pytest.raises(HTTPException) as exc:
            await update_document(
                document.id,
                DocumentUpdate(folder_id=None),
                db=db_session,
                current_user=caller,
            )
        assert exc.value.status_code == 404

        # The document must be left untouched, not partially applied before
        # the ACL check runs.
        await db_session.refresh(document)
        assert document.folder_id == folder.id

    async def test_documents_manage_alone_cannot_delete_a_sensitive_document(
        self, db_session
    ):
        org, folder, document = await self._org_and_sensitive_document(
            db_session, "fcvfd-acl-2"
        )
        caller = self._caller(org.id)

        with pytest.raises(HTTPException) as exc:
            await delete_document(document.id, db=db_session, current_user=caller)
        assert exc.value.status_code == 404

        result = await db_session.execute(
            select(Document).where(Document.id == document.id)
        )
        assert result.scalar_one_or_none() is not None

    async def test_caller_with_the_folders_own_permission_can_still_unfile_it(
        self, db_session
    ):
        # Positive control: the fix must not block a caller who genuinely
        # holds the folder's required permission.
        org, folder, document = await self._org_and_sensitive_document(
            db_session, "fcvfd-acl-3"
        )
        caller = self._caller(org.id, facilities_permission=True)

        result = await update_document(
            document.id,
            DocumentUpdate(folder_id=None),
            db=db_session,
            current_user=caller,
        )
        assert result.folder_id is None

    async def test_caller_with_the_folders_own_permission_can_still_delete_it(
        self, db_session
    ):
        org, folder, document = await self._org_and_sensitive_document(
            db_session, "fcvfd-acl-4"
        )
        caller = self._caller(org.id, facilities_permission=True)

        await delete_document(document.id, db=db_session, current_user=caller)

        result = await db_session.execute(
            select(Document).where(Document.id == document.id)
        )
        assert result.scalar_one_or_none() is None


@pytest.mark.integration
class TestUpdateDocumentRespectsDestinationFolderAcl:
    """FAC-15 (Codex follow-up on FAC-14, round 3): the FAC-14 fix above
    authorizes only the document's *current* folder via ``can_access_document``.
    ``DocumentsService.update_document`` only checks that a reassigned
    ``folder_id`` belongs to the caller's own organization (DOC-6/XC-1) --
    not that the caller can actually access that destination folder. A
    ``documents.manage`` holder with no facilities grant at all could
    therefore move a document they already have access to *into* a
    sensitive-gated facility folder (e.g. Insurance & Leases), injecting
    content into a folder they have no read/write access to -- the opposite
    direction from FAC-14 (write-into rather than read-out-of).
    """

    async def _org_with_source_and_sensitive_destination(self, db_session, slug):
        org = Organization(name="Falls Church VFD", slug=slug)
        db_session.add(org)
        await db_session.flush()
        source = DocumentFolder(organization_id=org.id, name="General")
        db_session.add(source)
        destination = DocumentFolder(
            organization_id=org.id,
            name="Insurance & Leases",
            required_permissions=["facilities.view_sensitive"],
        )
        db_session.add(destination)
        await db_session.flush()
        document = Document(
            organization_id=org.id,
            folder_id=source.id,
            name="Memo",
            file_name="memo.pdf",
        )
        db_session.add(document)
        await db_session.flush()
        return org, source, destination, document

    def _caller(self, org_id, *, facilities_permission=False):
        perms = ["documents.manage"]
        if facilities_permission:
            perms.append("facilities.view_sensitive")
        user = _user(uid="caller-1", roles=[(perms, "admin")])
        user.organization_id = org_id
        user.username = "caller"
        return user

    async def test_documents_manage_alone_cannot_move_into_a_sensitive_folder(
        self, db_session
    ):
        org, source, destination, document = (
            await self._org_with_source_and_sensitive_destination(
                db_session, "fcvfd-dest-1"
            )
        )
        caller = self._caller(org.id)

        with pytest.raises(HTTPException) as exc:
            await update_document(
                document.id,
                DocumentUpdate(folder_id=destination.id),
                db=db_session,
                current_user=caller,
            )
        assert exc.value.status_code == 403

        # The document must be left in its original folder, not partially
        # moved before the destination ACL check runs.
        await db_session.refresh(document)
        assert document.folder_id == source.id

    async def test_caller_with_the_destination_folders_permission_can_move_it(
        self, db_session
    ):
        # Positive control: the fix must not block a caller who genuinely
        # holds the destination folder's required permission.
        org, source, destination, document = (
            await self._org_with_source_and_sensitive_destination(
                db_session, "fcvfd-dest-2"
            )
        )
        caller = self._caller(org.id, facilities_permission=True)

        result = await update_document(
            document.id,
            DocumentUpdate(folder_id=destination.id),
            db=db_session,
            current_user=caller,
        )
        assert result.folder_id == destination.id

    async def test_moving_to_the_same_folder_needs_no_destination_check(
        self, db_session
    ):
        # folder_id unchanged (e.g. a caller re-sending the current value
        # alongside an unrelated field edit) must not be treated as a move.
        org, source, _destination, document = (
            await self._org_with_source_and_sensitive_destination(
                db_session, "fcvfd-dest-3"
            )
        )
        caller = self._caller(org.id)

        result = await update_document(
            document.id,
            DocumentUpdate(name="Renamed memo", folder_id=source.id),
            db=db_session,
            current_user=caller,
        )
        assert result.name == "Renamed memo"
        assert result.folder_id == source.id


@pytest.mark.integration
class TestFolderMutationRespectsOwnFolderAcl:
    """FAC-16 (Codex follow-up on FAC-14, round 3): ``update_folder`` and
    ``delete_folder`` require only ``documents.manage`` and never checked
    ``can_access_folder`` on the *target folder itself* -- unlike
    ``update_document``/``delete_document`` (FAC-14) and the read-side
    ``get_facility_sub_folders``. A documents.manage holder with no
    facilities grant at all could rename, reparent, or delete the sensitive
    facility folder tree outright, even though the folder's own
    ``required_permissions`` explicitly excludes them -- a full destructive
    cascade (every descendant folder, document, and backing file) rather
    than a single document.
    """

    async def _org_with_sensitive_folder(self, db_session, slug):
        org = Organization(name="Falls Church VFD", slug=slug)
        db_session.add(org)
        await db_session.flush()
        other_folder = DocumentFolder(organization_id=org.id, name="Other")
        db_session.add(other_folder)
        folder = DocumentFolder(
            organization_id=org.id,
            name="Insurance & Leases",
            required_permissions=["facilities.view_sensitive"],
        )
        db_session.add(folder)
        await db_session.flush()
        child = DocumentFolder(
            organization_id=org.id, name="Renewals", parent_id=folder.id
        )
        db_session.add(child)
        await db_session.flush()
        document = Document(
            organization_id=org.id,
            folder_id=folder.id,
            name="Policy",
            file_name="policy.pdf",
        )
        child_document = Document(
            organization_id=org.id,
            folder_id=child.id,
            name="Renewal notice",
            file_name="renewal.pdf",
        )
        db_session.add_all([document, child_document])
        await db_session.flush()
        return org, other_folder, folder, child, document, child_document

    def _caller(self, org_id, *, facilities_permission=False):
        perms = ["documents.manage"]
        if facilities_permission:
            perms.append("facilities.view_sensitive")
        user = _user(uid="caller-1", roles=[(perms, "admin")])
        user.organization_id = org_id
        user.username = "caller"
        return user

    async def test_documents_manage_alone_cannot_rename_a_sensitive_folder(
        self, db_session
    ):
        org, _other, folder, _child, _doc, _child_doc = (
            await self._org_with_sensitive_folder(db_session, "fcvfd-folder-1")
        )
        caller = self._caller(org.id)

        with pytest.raises(HTTPException) as exc:
            await update_folder(
                folder.id,
                DocumentFolderUpdate(name="Renamed"),
                db=db_session,
                current_user=caller,
            )
        assert exc.value.status_code == 404

        await db_session.refresh(folder)
        assert folder.name == "Insurance & Leases"

    async def test_documents_manage_alone_cannot_reparent_a_sensitive_folder(
        self, db_session
    ):
        org, other_folder, folder, _child, _doc, _child_doc = (
            await self._org_with_sensitive_folder(db_session, "fcvfd-folder-2")
        )
        caller = self._caller(org.id)

        with pytest.raises(HTTPException) as exc:
            await update_folder(
                folder.id,
                DocumentFolderUpdate(parent_id=other_folder.id),
                db=db_session,
                current_user=caller,
            )
        assert exc.value.status_code == 404

        await db_session.refresh(folder)
        assert folder.parent_id is None

    async def test_documents_manage_alone_cannot_delete_a_sensitive_folder(
        self, db_session
    ):
        org, _other, folder, child, document, child_document = (
            await self._org_with_sensitive_folder(db_session, "fcvfd-folder-3")
        )
        caller = self._caller(org.id)

        with pytest.raises(HTTPException) as exc:
            await delete_folder(folder.id, db=db_session, current_user=caller)
        assert exc.value.status_code == 404

        # Nothing in the subtree was touched -- the cascade never started.
        for model, row_id in (
            (DocumentFolder, folder.id),
            (DocumentFolder, child.id),
            (Document, document.id),
            (Document, child_document.id),
        ):
            result = await db_session.execute(select(model).where(model.id == row_id))
            assert result.scalar_one_or_none() is not None

    async def test_caller_with_the_folders_own_permission_can_still_rename_it(
        self, db_session
    ):
        org, _other, folder, _child, _doc, _child_doc = (
            await self._org_with_sensitive_folder(db_session, "fcvfd-folder-4")
        )
        caller = self._caller(org.id, facilities_permission=True)

        result = await update_folder(
            folder.id,
            DocumentFolderUpdate(name="Renamed"),
            db=db_session,
            current_user=caller,
        )
        assert result.name == "Renamed"

    async def test_caller_with_the_folders_own_permission_can_still_delete_it(
        self, db_session
    ):
        # Positive control, and proof the cascade still works as intended for
        # an authorized caller: the folder, its child folder, and both
        # documents are all gone afterward.
        org, _other, folder, child, document, child_document = (
            await self._org_with_sensitive_folder(db_session, "fcvfd-folder-5")
        )
        caller = self._caller(org.id, facilities_permission=True)

        await delete_folder(folder.id, db=db_session, current_user=caller)

        for model, row_id in (
            (DocumentFolder, folder.id),
            (DocumentFolder, child.id),
            (Document, document.id),
            (Document, child_document.id),
        ):
            result = await db_session.execute(select(model).where(model.id == row_id))
            assert result.scalar_one_or_none() is None


@pytest.mark.integration
class TestFolderCreationRespectsParentAcl:
    """FAC-19 (Codex round 4 on FAC-14/15/16, finding B): ``create_folder``'s
    DOC-6 FK validation on a supplied ``parent_id`` only confirms the parent
    belongs to the caller's organization -- not that the caller can access
    it. A ``documents.manage`` holder with no facilities grant could
    therefore inject a new child folder into a sensitive-gated facility tree
    they cannot even read, the same "destination not checked" shape as
    FAC-15/FAC-16 but for folder creation.
    """

    async def _org_with_sensitive_parent(self, db_session, slug):
        org = Organization(name="Falls Church VFD", slug=slug)
        db_session.add(org)
        await db_session.flush()
        parent = DocumentFolder(
            organization_id=org.id,
            name="Insurance & Leases",
            required_permissions=["facilities.view_sensitive"],
        )
        db_session.add(parent)
        await db_session.flush()
        return org, parent

    async def _caller(self, db_session, org_id, *, facilities_permission=False):
        # A real row, not a SimpleNamespace stand-in: a successful
        # create_folder inserts `created_by` as an FK to `users.id`, which a
        # synthetic id would violate. The position/user_positions rows are
        # inserted via raw SQL rather than `user.positions.append(...)`,
        # which touches the (unloaded) collection attribute directly and
        # trips AsyncSession's synchronous-lazy-load guard (MissingGreenlet)
        # -- the same reason test_training_member_visibility.py's
        # `_grant_officer_position` helper does the same.
        perms = ["documents.manage"]
        if facilities_permission:
            perms.append("facilities.view_sensitive")
        user = User(organization_id=org_id, username="caller", email="caller@x.test")
        db_session.add(user)
        await db_session.flush()
        position_id = str(uuid4())
        await db_session.execute(
            text(
                "INSERT INTO positions (id, organization_id, name, slug, "
                "permissions) VALUES (:i, :o, :n, :s, :p)"
            ),
            {
                "i": position_id,
                "o": org_id,
                "n": "Admin",
                "s": "admin",
                "p": json.dumps(perms),
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO user_positions (user_id, position_id) " "VALUES (:u, :p)"
            ),
            {"u": user.id, "p": position_id},
        )
        await db_session.flush()
        # FAC-16/17: can_access_folder reads user.roles (a synonym for the
        # async `positions` relationship) -- production's get_current_user
        # always hands over a user with it eager-loaded via selectinload
        # (auth_service.get_user_from_token); mirror that here.
        result = await db_session.execute(
            select(User).options(selectinload(User.positions)).where(User.id == user.id)
        )
        return result.scalar_one()

    async def test_documents_manage_alone_cannot_create_inside_a_sensitive_folder(
        self, db_session
    ):
        org, parent = await self._org_with_sensitive_parent(
            db_session, "fcvfd-create-1"
        )
        caller = await self._caller(db_session, org.id)

        with pytest.raises(HTTPException) as exc:
            await create_folder(
                DocumentFolderCreate(name="Injected", parent_id=parent.id),
                db=db_session,
                current_user=caller,
            )
        assert exc.value.status_code == 403

        result = await db_session.execute(
            select(DocumentFolder).where(DocumentFolder.name == "Injected")
        )
        assert result.scalar_one_or_none() is None

    async def test_caller_with_the_parents_own_permission_can_still_create_inside_it(
        self, db_session
    ):
        org, parent = await self._org_with_sensitive_parent(
            db_session, "fcvfd-create-2"
        )
        caller = await self._caller(db_session, org.id, facilities_permission=True)

        result = await create_folder(
            DocumentFolderCreate(name="Renewal", parent_id=parent.id),
            db=db_session,
            current_user=caller,
        )
        assert result.parent_id == parent.id

    async def test_a_root_level_create_needs_no_parent_check(self, db_session):
        org = Organization(name="Falls Church VFD", slug="fcvfd-create-3")
        db_session.add(org)
        await db_session.flush()
        caller = await self._caller(db_session, org.id)

        result = await create_folder(
            DocumentFolderCreate(name="General"),
            db=db_session,
            current_user=caller,
        )
        assert result.parent_id is None


@pytest.mark.integration
class TestFolderReparentRespectsNewParentAcl:
    """FAC-18 (Codex round 4 on FAC-14/15/16, finding A): the can_access_folder
    check ``update_folder`` runs (FAC-16) authorizes only the folder's
    *current* ancestry. ``DocumentsService.update_folder``'s DOC-6 FK
    validation on a reassigned ``parent_id`` only confirms the new parent is
    in the caller's organization -- not that the caller can access it. A
    ``documents.manage`` holder with no facilities grant could therefore
    reparent an accessible folder -- and everything inside it -- into a
    sensitive-gated facility tree they cannot access. Mirrors FAC-15's
    destination check on ``update_document``.
    """

    async def _org_with_movable_and_sensitive_parent(self, db_session, slug):
        org = Organization(name="Falls Church VFD", slug=slug)
        db_session.add(org)
        await db_session.flush()
        movable = DocumentFolder(organization_id=org.id, name="Renewals")
        sensitive_parent = DocumentFolder(
            organization_id=org.id,
            name="Insurance & Leases",
            required_permissions=["facilities.view_sensitive"],
        )
        db_session.add_all([movable, sensitive_parent])
        await db_session.flush()
        return org, movable, sensitive_parent

    def _caller(self, org_id, *, facilities_permission=False):
        perms = ["documents.manage"]
        if facilities_permission:
            perms.append("facilities.view_sensitive")
        user = _user(uid="caller-1", roles=[(perms, "admin")])
        user.organization_id = org_id
        user.username = "caller"
        return user

    async def test_documents_manage_alone_cannot_move_a_folder_into_a_sensitive_parent(
        self, db_session
    ):
        org, movable, sensitive_parent = (
            await self._org_with_movable_and_sensitive_parent(
                db_session, "fcvfd-reparent-1"
            )
        )
        caller = self._caller(org.id)

        with pytest.raises(HTTPException) as exc:
            await update_folder(
                movable.id,
                DocumentFolderUpdate(parent_id=sensitive_parent.id),
                db=db_session,
                current_user=caller,
            )
        assert exc.value.status_code == 403

        # Left exactly where it was -- not partially reparented before the
        # destination ACL check runs.
        await db_session.refresh(movable)
        assert movable.parent_id is None

    async def test_caller_with_the_new_parents_permission_can_still_move_it(
        self, db_session
    ):
        org, movable, sensitive_parent = (
            await self._org_with_movable_and_sensitive_parent(
                db_session, "fcvfd-reparent-2"
            )
        )
        caller = self._caller(org.id, facilities_permission=True)

        result = await update_folder(
            movable.id,
            DocumentFolderUpdate(parent_id=sensitive_parent.id),
            db=db_session,
            current_user=caller,
        )
        assert result.parent_id == sensitive_parent.id

    async def test_moving_to_the_same_parent_needs_no_destination_check(
        self, db_session
    ):
        org, movable, sensitive_parent = (
            await self._org_with_movable_and_sensitive_parent(
                db_session, "fcvfd-reparent-3"
            )
        )
        movable.parent_id = sensitive_parent.id
        await db_session.flush()
        # Holds the sensitive parent's own permission so the FAC-16 check on
        # movable's *current* ancestry (which now includes sensitive_parent)
        # admits the caller; only the destination re-check under test here.
        caller = self._caller(org.id, facilities_permission=True)

        result = await update_folder(
            movable.id,
            DocumentFolderUpdate(name="Renamed", parent_id=sensitive_parent.id),
            db=db_session,
            current_user=caller,
        )
        assert result.name == "Renamed"
        assert result.parent_id == sensitive_parent.id


@pytest.mark.integration
class TestDeleteFolderRefusesCrossOrgCascade:
    """FAC-20 (Codex round 4 on FAC-16, finding C): the FAC-16 fix made the
    ``children`` cascade (``cascade="all, delete-orphan"``) actually work --
    but it walks ``parent_id`` with no organization_id filter, exactly like
    the ORM would when ``self.db.delete(folder)`` loads descendants to
    cascade through them. ``parent_id`` carries no same-org DB constraint;
    assert_in_org (DOC-6) is an application-level guard on the two
    client-facing writers of this column, not a schema constraint. A row
    that somehow carries a cross-organization ``parent_id`` -- written before
    that guard existed, or by any future writer that forgets it -- would
    have its cascade reach into another tenant's rows. This constructs that
    row directly (bypassing the service layer, the only way to get such a
    row into the database at all) and asserts delete_folder refuses rather
    than cascading into it.
    """

    async def test_a_cross_org_child_aborts_the_delete_instead_of_cascading(
        self, db_session
    ):
        org_a = Organization(name="Org A", slug="fcvfd-cascade-a")
        org_b = Organization(name="Org B", slug="fcvfd-cascade-b")
        db_session.add_all([org_a, org_b])
        await db_session.flush()

        parent = DocumentFolder(organization_id=org_a.id, name="Parent")
        db_session.add(parent)
        await db_session.flush()
        # A row the application itself can never create (assert_in_org/DOC-6
        # blocks this on both create_folder and update_folder) -- standing in
        # for stale data or a future writer that skips the guard.
        cross_org_child = DocumentFolder(
            organization_id=org_b.id, name="Should stay put", parent_id=parent.id
        )
        db_session.add(cross_org_child)
        await db_session.flush()
        cross_org_child_id = cross_org_child.id

        service = DocumentsService(db_session)
        with pytest.raises(ValueError, match="cross-organization"):
            await service.delete_folder(parent.id, org_a.id)

        # Neither row was touched -- the cascade never started.
        for row_id in (parent.id, cross_org_child_id):
            result = await db_session.execute(
                select(DocumentFolder).where(DocumentFolder.id == row_id)
            )
            assert result.scalar_one_or_none() is not None

    async def test_a_same_org_subtree_still_deletes_normally(self, db_session):
        # Positive control: the new check must not block the overwhelmingly
        # common case of a subtree that is entirely within one organization.
        org = Organization(name="Falls Church VFD", slug="fcvfd-cascade-c")
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
        child_id = child.id

        service = DocumentsService(db_session)
        assert await service.delete_folder(parent.id, org.id) is True

        for row_id in (parent.id, child_id):
            result = await db_session.execute(
                select(DocumentFolder).where(DocumentFolder.id == row_id)
            )
            assert result.scalar_one_or_none() is None


@pytest.mark.integration
class TestDeleteFolderRefusesInaccessibleDescendant:
    """FAC-21 (Codex, round 6 on FAC-16/20): the endpoint's own
    ``can_access_folder`` check authorizes only the folder being deleted --
    via that call's own ancestor walk, everything *above* it too -- but never
    anything *below* it. ``required_permissions`` is set per-folder with no
    rule that a descendant must be at least as permissive as its parent, so a
    caller admitted at the root of a subtree is not necessarily admitted at
    every node inside it. A ``documents.manage`` holder with no facilities
    grant could delete an accessible parent folder and cascade-destroy a
    more-restricted descendant nested beneath it that they could never have
    accessed (or deleted) directly.
    """

    async def _org_with_accessible_root_and_sensitive_child(self, db_session, slug):
        org = Organization(name="Falls Church VFD", slug=slug)
        db_session.add(org)
        await db_session.flush()
        root = DocumentFolder(organization_id=org.id, name="General")
        db_session.add(root)
        await db_session.flush()
        sensitive_child = DocumentFolder(
            organization_id=org.id,
            name="Insurance & Leases",
            parent_id=root.id,
            required_permissions=["facilities.view_sensitive"],
        )
        db_session.add(sensitive_child)
        await db_session.flush()
        document = Document(
            organization_id=org.id,
            folder_id=sensitive_child.id,
            name="Policy",
            file_name="policy.pdf",
        )
        db_session.add(document)
        await db_session.flush()
        return org, root, sensitive_child, document

    def _caller(self, org_id, *, facilities_permission=False):
        perms = ["documents.manage"]
        if facilities_permission:
            perms.append("facilities.view_sensitive")
        user = _user(uid="caller-1", roles=[(perms, "admin")])
        user.organization_id = org_id
        user.username = "caller"
        return user

    async def test_deleting_an_accessible_root_cannot_cascade_into_a_sensitive_child(
        self, db_session
    ):
        org, root, sensitive_child, document = (
            await self._org_with_accessible_root_and_sensitive_child(
                db_session, "fcvfd-descendant-1"
            )
        )
        caller = self._caller(org.id)

        with pytest.raises(HTTPException) as exc:
            await delete_folder(root.id, db=db_session, current_user=caller)
        assert exc.value.status_code == 400

        # Nothing in the subtree was touched -- the cascade never started.
        for model, row_id in (
            (DocumentFolder, root.id),
            (DocumentFolder, sensitive_child.id),
            (Document, document.id),
        ):
            result = await db_session.execute(select(model).where(model.id == row_id))
            assert result.scalar_one_or_none() is not None

    async def test_a_caller_with_every_descendants_permission_can_still_delete_it(
        self, db_session
    ):
        # Positive control, and proof the cascade still works end to end for
        # an authorized caller.
        org, root, sensitive_child, document = (
            await self._org_with_accessible_root_and_sensitive_child(
                db_session, "fcvfd-descendant-2"
            )
        )
        caller = self._caller(org.id, facilities_permission=True)

        await delete_folder(root.id, db=db_session, current_user=caller)

        for model, row_id in (
            (DocumentFolder, root.id),
            (DocumentFolder, sensitive_child.id),
            (Document, document.id),
        ):
            result = await db_session.execute(select(model).where(model.id == row_id))
            assert result.scalar_one_or_none() is None

    async def test_a_uniformly_accessible_subtree_still_deletes_normally(
        self, db_session
    ):
        # A second positive control at the service layer: no current_user
        # passed at all (the pre-FAC-21 call shape) must not regress -- the
        # descendant-ACL check is skip-if-absent, not fail-if-absent, since
        # no client-facing caller today can reach delete_folder without one.
        org = Organization(name="Falls Church VFD", slug="fcvfd-descendant-3")
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

        service = DocumentsService(db_session)
        assert await service.delete_folder(parent.id, org.id) is True


@pytest.mark.integration
class TestDeleteFolderRefusesSystemFolder:
    """FAC-22 (Codex, on top of FAC-16/20/21): FAC-16 corrected
    ``DocumentFolder.children``'s self-referential relationship so
    ``cascade="all, delete-orphan"`` genuinely deletes a folder's subtree
    instead of merely orphaning it (nulling descendants' ``parent_id``).
    Before that fix, ``delete_folder`` never checking ``is_system`` was
    latent -- the pre-fix cascade didn't destroy anything, it just detached
    the descendants. After FAC-16, the same missing check lets any
    ``documents.manage`` holder (an org-wide, broadly-held grant) delete a
    system root such as 'Member Files' outright and cascade-destroy every
    member's subfolder and document beneath it in one request --
    unrecoverable, organization-wide data loss, and a direct contradiction
    of the documented invariant that system folders cannot be deleted
    (``docs/changelog/2026-02.md``, ``docs/TROUBLESHOOTING.md``: "System
    folders (the 7 default folders) cannot be deleted").
    """

    def _caller(self, org_id):
        user = _user(uid="caller-1", roles=[(["documents.manage"], "admin")])
        user.organization_id = org_id
        user.username = "caller"
        return user

    async def _org_with_system_folder_and_contents(self, db_session, slug):
        org = Organization(name="Falls Church VFD", slug=slug)
        db_session.add(org)
        await db_session.flush()
        system_root = DocumentFolder(
            organization_id=org.id, name="Member Files", is_system=True
        )
        db_session.add(system_root)
        await db_session.flush()
        member_folder = DocumentFolder(
            organization_id=org.id,
            name="Doe, John",
            parent_id=system_root.id,
            is_system=False,
        )
        db_session.add(member_folder)
        await db_session.flush()
        document = Document(
            organization_id=org.id,
            folder_id=member_folder.id,
            name="Certification",
            file_name="cert.pdf",
        )
        db_session.add(document)
        await db_session.flush()
        return org, system_root, member_folder, document

    async def test_deleting_a_system_folder_is_refused_and_nothing_is_deleted(
        self, db_session
    ):
        org, system_root, member_folder, document = (
            await self._org_with_system_folder_and_contents(
                db_session, "fcvfd-system-folder-1"
            )
        )
        caller = self._caller(org.id)

        with pytest.raises(HTTPException) as exc:
            await delete_folder(system_root.id, db=db_session, current_user=caller)
        assert exc.value.status_code == 403

        # The system root, its descendant, and the document beneath it must
        # all survive -- the cascade must never start.
        for model, row_id in (
            (DocumentFolder, system_root.id),
            (DocumentFolder, member_folder.id),
            (Document, document.id),
        ):
            result = await db_session.execute(select(model).where(model.id == row_id))
            assert result.scalar_one_or_none() is not None

    async def test_a_non_system_folder_still_deletes_normally(self, db_session):
        # Positive control: the new check must not block the overwhelmingly
        # common case of deleting an ordinary, non-system folder.
        org, _system_root, member_folder, document = (
            await self._org_with_system_folder_and_contents(
                db_session, "fcvfd-system-folder-2"
            )
        )
        caller = self._caller(org.id)

        await delete_folder(member_folder.id, db=db_session, current_user=caller)

        for model, row_id in (
            (DocumentFolder, member_folder.id),
            (Document, document.id),
        ):
            result = await db_session.execute(select(model).where(model.id == row_id))
            assert result.scalar_one_or_none() is None


@pytest.mark.integration
class TestUpdateFolderRefusesReparentingSystemFolder:
    """FAC-23 (Codex, on top of FAC-22): FAC-22 made ``delete_folder`` refuse
    a direct delete of a system folder, but ``update_folder`` never checked
    ``is_system`` before applying a reparent. A ``documents.manage`` holder
    could move a system root (e.g. "Member Files") underneath an ordinary,
    freely deletable folder via ``PATCH``, then delete that ordinary folder --
    the root-level ``is_system`` check in ``delete_folder`` only looks at the
    folder passed in, the subtree walk finds the system folder as a
    descendant, and neither the cross-org nor ACL check there stops it. Same
    unrecoverable, organization-wide data loss FAC-22 was meant to close,
    reached in one extra step.
    """

    def _caller(self, org_id):
        user = _user(uid="caller-1", roles=[(["documents.manage"], "admin")])
        user.organization_id = org_id
        user.username = "caller"
        return user

    async def _org_with_system_folder_and_ordinary_folder(self, db_session, slug):
        org = Organization(name="Falls Church VFD", slug=slug)
        db_session.add(org)
        await db_session.flush()
        system_root = DocumentFolder(
            organization_id=org.id, name="Member Files", is_system=True
        )
        ordinary = DocumentFolder(organization_id=org.id, name="Scratch")
        db_session.add_all([system_root, ordinary])
        await db_session.flush()
        return org, system_root, ordinary

    async def test_reparenting_a_system_folder_is_refused(self, db_session):
        org, system_root, ordinary = (
            await self._org_with_system_folder_and_ordinary_folder(
                db_session, "fcvfd-reparent-system-1"
            )
        )
        caller = self._caller(org.id)

        with pytest.raises(HTTPException) as exc:
            await update_folder(
                system_root.id,
                DocumentFolderUpdate(parent_id=ordinary.id),
                db=db_session,
                current_user=caller,
            )
        assert exc.value.status_code == 400

        # Left exactly where it was -- not partially reparented before the
        # rejection.
        await db_session.refresh(system_root)
        assert system_root.parent_id is None

    async def test_renaming_a_system_folder_without_touching_parent_id_still_works(
        self, db_session
    ):
        # Positive control: the new check keys off `"parent_id" in
        # update_data`, not `is_system` alone -- a rename or other field
        # update on a system folder that doesn't touch parent_id must not be
        # blocked.
        org, system_root, _ordinary = (
            await self._org_with_system_folder_and_ordinary_folder(
                db_session, "fcvfd-reparent-system-2"
            )
        )
        caller = self._caller(org.id)

        result = await update_folder(
            system_root.id,
            DocumentFolderUpdate(name="Member Files (Renamed)"),
            db=db_session,
            current_user=caller,
        )
        assert result.name == "Member Files (Renamed)"

    async def test_a_non_system_folder_can_still_be_reparented_normally(
        self, db_session
    ):
        # Positive control: the new check must not block the overwhelmingly
        # common case of reparenting an ordinary folder.
        org, system_root, ordinary = (
            await self._org_with_system_folder_and_ordinary_folder(
                db_session, "fcvfd-reparent-system-3"
            )
        )
        caller = self._caller(org.id)

        result = await update_folder(
            ordinary.id,
            DocumentFolderUpdate(parent_id=system_root.id),
            db=db_session,
            current_user=caller,
        )
        assert result.parent_id == system_root.id


@pytest.mark.integration
class TestDeleteFolderRefusesReparentedSystemFolderInSubtree:
    """FAC-23 (Codex, on top of FAC-22): reproduces the full two-step bypass
    end to end -- reparent a system folder underneath an ordinary folder
    (bypassing the update_folder-layer fix above, exactly as a pre-existing
    row or a future writer that misses that guard could), then delete the
    ordinary folder. Before this fix, the subtree walk in ``delete_folder``
    checked cross-org (FAC-20) and ACL (FAC-21) on every descendant but never
    ``is_system``, so the cascade reached the system folder and everything
    beneath it.
    """

    def _caller(self, org_id):
        user = _user(uid="caller-1", roles=[(["documents.manage"], "admin")])
        user.organization_id = org_id
        user.username = "caller"
        return user

    async def test_deleting_an_ordinary_folder_cannot_cascade_into_a_reparented_system_folder(
        self, db_session
    ):
        org = Organization(name="Falls Church VFD", slug="fcvfd-bypass-1")
        db_session.add(org)
        await db_session.flush()
        system_root = DocumentFolder(
            organization_id=org.id, name="Member Files", is_system=True
        )
        db_session.add(system_root)
        await db_session.flush()
        member_folder = DocumentFolder(
            organization_id=org.id,
            name="Doe, John",
            parent_id=system_root.id,
            is_system=False,
        )
        db_session.add(member_folder)
        await db_session.flush()
        document = Document(
            organization_id=org.id,
            folder_id=member_folder.id,
            name="Certification",
            file_name="cert.pdf",
        )
        db_session.add(document)
        # An ordinary folder the caller can freely delete.
        ordinary = DocumentFolder(organization_id=org.id, name="Scratch")
        db_session.add(ordinary)
        await db_session.flush()

        # Reparent the system folder underneath the ordinary folder --
        # bypassing the service-layer at the DB directly, standing in for a
        # row that predates the update_folder fix (or a future writer that
        # misses it), so this test isolates the delete_folder-side guard.
        system_root.parent_id = ordinary.id
        await db_session.flush()

        caller = self._caller(org.id)

        with pytest.raises(HTTPException) as exc:
            await delete_folder(ordinary.id, db=db_session, current_user=caller)
        assert exc.value.status_code == 400

        # Nothing in the subtree was touched -- the cascade never started.
        for model, row_id in (
            (DocumentFolder, ordinary.id),
            (DocumentFolder, system_root.id),
            (DocumentFolder, member_folder.id),
            (Document, document.id),
        ):
            result = await db_session.execute(select(model).where(model.id == row_id))
            assert result.scalar_one_or_none() is not None


@pytest.mark.integration
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
        # FAC-16: update_folder/delete_folder now call can_access_folder,
        # which reads user.roles (a synonym for the async `positions`
        # relationship). Production's get_current_user always hands over a
        # user with that relationship eager-loaded via selectinload
        # (auth_service.get_user_from_token) -- outside that path, touching
        # it lazily raises MissingGreenlet, so mirror the eager load here.
        await db_session.refresh(user, attribute_names=["positions"])
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
        # Regression guard: str(FolderVisibility.ORGANIZATION) renders
        # "FolderVisibility.ORGANIZATION" (Enum.__str__), not the schema
        # value "organization" -- the audit event must use .value.
        assert entry.event_data["visibility"] == "organization"

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
