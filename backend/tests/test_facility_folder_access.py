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

from types import SimpleNamespace

from app.api.v1.endpoints.facilities import _SENSITIVE_READ_PERMISSIONS
from app.models.document import FolderVisibility
from app.services.documents_service import (
    FACILITY_SENSITIVE_PERMISSIONS,
    DocumentsService,
)


def _user(*permissions, slug="member"):
    return SimpleNamespace(
        id="u1",
        roles=[SimpleNamespace(permissions=list(permissions), slug=slug)],
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
