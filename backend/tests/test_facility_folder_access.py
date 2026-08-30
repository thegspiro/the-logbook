"""The bytes behind a facility record must be gated like the record itself.

The facility Files section stores each file as a row in ``documents`` and keeps
only a ``document:<id>`` reference on the facility photo/document record. The
record is gated on ``facilities.view_sensitive``/``edit``/``manage``; the
document was not. Uploads landed folderless, and a folderless document is
organization level — ``get_documents`` returns it to anyone holding
``documents.view`` — so the protected record pointed at an unprotected file and
the whole contract was defeated one layer down.

These tests cover both halves: the folder ACL that expresses the gate, and the
filing that puts facility uploads behind it.
"""

import inspect
from types import SimpleNamespace

from app.api.v1.endpoints.facilities import _SENSITIVE_READ_PERMISSIONS
from app.models.document import FolderVisibility
from app.services.documents_service import (
    FACILITY_SENSITIVE_PERMISSIONS,
    DocumentsService,
)


def _user(*permissions, slug="member", rank=None):
    # `rank` is part of a real User and carries its own default permissions,
    # so the stand-in declares it rather than leaving the attribute absent.
    return SimpleNamespace(
        id="u1",
        roles=[SimpleNamespace(permissions=list(permissions), slug=slug)],
        rank=rank,
    )


def _folder(**kwargs):
    kwargs.setdefault("visibility", FolderVisibility.ORGANIZATION)
    kwargs.setdefault("allowed_roles", None)
    kwargs.setdefault("required_permissions", None)
    kwargs.setdefault("owner_user_id", None)
    return SimpleNamespace(**kwargs)


class TestFacilityGateMatchesTheEndpoint:
    def test_the_two_permission_sets_are_the_same(self):
        """One contract, named in two modules. If the endpoint's set changes and
        the folder's does not, the record and its bytes drift apart silently —
        which is the exact failure these tests exist to prevent."""
        assert set(FACILITY_SENSITIVE_PERMISSIONS) == set(_SENSITIVE_READ_PERMISSIONS)


class TestRequiredPermissions:
    def test_holder_of_any_listed_grant_is_admitted(self):
        svc = DocumentsService(db=None)
        folder = _folder(required_permissions=list(FACILITY_SENSITIVE_PERMISSIONS))
        for grant in FACILITY_SENSITIVE_PERMISSIONS:
            assert svc.can_access_folder(folder, _user("documents.view", grant)), grant

    def test_documents_view_alone_is_refused(self):
        """The leak itself: a baseline member browsing the Documents module."""
        svc = DocumentsService(db=None)
        folder = _folder(required_permissions=list(FACILITY_SENSITIVE_PERMISSIONS))
        assert not svc.can_access_folder(folder, _user("documents.view"))

    def test_leadership_does_not_override_it(self):
        """Every other restriction here asks "is this person senior enough",
        which documents.manage settles. This one asks whether they hold the
        module grant the data is gated on, and a documents administrator with
        no facilities grant is precisely who the contract excludes."""
        svc = DocumentsService(db=None)
        folder = _folder(required_permissions=list(FACILITY_SENSITIVE_PERMISSIONS))
        assert not svc.can_access_folder(folder, _user("documents.manage"))
        assert not svc.can_access_folder(folder, _user("members.manage"))

    def test_wildcard_still_admits(self):
        """A tenant administrator holding '*' holds every facilities grant by
        definition; refusing them would be a different bug."""
        svc = DocumentsService(db=None)
        folder = _folder(required_permissions=list(FACILITY_SENSITIVE_PERMISSIONS))
        assert svc.can_access_folder(folder, _user("*"))

    def test_a_grant_held_through_operational_rank_admits(self):
        """The endpoint resolves positions AND rank defaults; the folder gate
        resolved positions only. fire_chief/deputy_chief/assistant_chief carry
        the facilities grants by rank, so a chief holding them that way passed
        the facilities endpoint and was then refused the folder — the record
        was readable and the file it pointed at was not."""
        svc = DocumentsService(db=None)
        folder = _folder(required_permissions=list(FACILITY_SENSITIVE_PERMISSIONS))
        chief = _user("documents.view", rank="fire_chief")
        assert svc.can_access_folder(folder, chief)

    def test_a_module_wildcard_admits(self):
        """`facilities.*` holds every facilities grant, but a raw set
        intersection matches none of them."""
        svc = DocumentsService(db=None)
        folder = _folder(required_permissions=list(FACILITY_SENSITIVE_PERMISSIONS))
        assert svc.can_access_folder(folder, _user("facilities.*"))

    def test_absent_field_changes_nothing(self):
        """Every folder that predates this field must behave exactly as before."""
        svc = DocumentsService(db=None)
        assert svc.can_access_folder(_folder(), _user("documents.view"))
        assert svc.can_access_folder(
            _folder(visibility=FolderVisibility.LEADERSHIP), _user("documents.manage")
        )
        assert not svc.can_access_folder(
            _folder(visibility=FolderVisibility.LEADERSHIP), _user("documents.view")
        )

    def test_it_composes_with_visibility_rather_than_replacing_it(self):
        """A permission holder still cannot reach someone else's owner folder."""
        svc = DocumentsService(db=None)
        folder = _folder(
            visibility=FolderVisibility.OWNER,
            owner_user_id="someone-else",
            required_permissions=list(FACILITY_SENSITIVE_PERMISSIONS),
        )
        assert not svc.can_access_folder(folder, _user("facilities.manage"))


class TestTheGateIsStampedOnTheFolderTreeItGuards:
    """Migration a9c4e7b2f631 stamped every folder whose slug is `facilities`
    or matches `facility-%`, which covers the per-facility sub-folders. The
    creation path has to agree with it, or every facility created after that
    deploy reopens the leak the migration closed — and only for new rows, so
    nothing about an existing install would reveal it.

    Source-level, in the manner of test_facilities_folders.py: the defect was
    a stamp applied to the wrong loop, which no call-level assertion on one
    of the two paths would catch.
    """

    @staticmethod
    def _sub_folder_loop_body(func, marker: str) -> str:
        """The text between `for sub_def in <MARKER>:` and the add() that ends
        the loop body — i.e. the DocumentFolder construction itself, not the
        log line after it that also names the constant."""
        source = inspect.getsource(func)
        after = source.split(f"for sub_def in {marker}:")[-1]
        return after.split("self.db.add(sub_folder)")[0]

    def test_facility_sub_folders_are_stamped(self):
        body = self._sub_folder_loop_body(
            DocumentsService.ensure_facility_folder, "FACILITY_SUB_FOLDERS"
        )
        assert "required_permissions" in body, (
            "ensure_facility_folder creates its sub-folders without "
            "required_permissions; migration a9c4e7b2f631 stamped the "
            "equivalent existing rows, so new facilities would be readable by "
            "anyone holding documents.view"
        )

    def test_apparatus_sub_folders_are_not_gated_on_facilities_grants(self):
        source = inspect.getsource(DocumentsService.ensure_apparatus_folder)
        assert "FACILITY_SENSITIVE_PERMISSIONS" not in source, (
            "apparatus folders gated on facilities permissions: no apparatus "
            "role holds them, and migration a9c4e7b2f631 never stamped "
            "apparatus-% rows, so new and existing apparatus trees disagree"
        )
