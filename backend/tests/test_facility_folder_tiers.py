"""Who can open which facility folder (FAC-13).

Baseline ``facilities.view`` holders — secretary, quartermaster, safety and
training officers — saw no facility folder at all, because every folder in the
tree required the sensitive set and access ANDs every ancestor. The owner chose
an "any facilities access" tier for the root, each facility's folder, Photos,
Maintenance Records and Inspection Reports; Blueprints & Permits, Insurance &
Leases, Capital Projects and Facility Documents stay sensitive. Writing still
needs facilities.edit or .manage on either tier.
"""

import uuid
from types import SimpleNamespace

import pytest

from app.core.constants import FOLDER_FACILITIES
from app.models.document import (
    FACILITY_ACCESS_PERMISSIONS,
    FACILITY_SUB_FOLDERS,
    DocumentFolder,
    FolderVisibility,
    system_folder_fields,
)
from app.models.user import Organization
from app.services.documents_service import (
    FACILITY_SENSITIVE_PERMISSIONS,
    DocumentsService,
)

OPEN = {"photos", "maintenance", "inspections"}
SHUT = {"blueprints-permits", "insurance-leases", "capital-projects", "documents"}


def _user(*permissions):
    return SimpleNamespace(
        id="u1",
        roles=[SimpleNamespace(permissions=list(permissions), slug="officer")],
        rank=None,
    )


def _tree():
    """The tree ensure_facility_folder builds, as plain objects."""
    root = SimpleNamespace(
        id="root",
        parent_id=None,
        organization_id="org-1",
        visibility=FolderVisibility.ORGANIZATION,
        allowed_roles=None,
        owner_user_id=None,
        required_permissions=system_folder_fields(FOLDER_FACILITIES)[
            "required_permissions"
        ],
    )
    facility = SimpleNamespace(
        id="f1",
        parent_id="root",
        slug="facility-1",
        organization_id="org-1",
        visibility=FolderVisibility.ORGANIZATION,
        allowed_roles=None,
        owner_user_id=None,
        required_permissions=list(FACILITY_ACCESS_PERMISSIONS),
    )
    subs = {}
    for definition in FACILITY_SUB_FOLDERS:
        sub = DocumentsService._new_facility_sub_folder(
            "org-1", facility, definition["slug"]
        )
        sub.id = f"sub-{definition['slug']}"
        subs[definition["slug"]] = sub
    by_id = {f.id: f for f in (root, facility, *subs.values())}
    return by_id, subs


@pytest.mark.unit
class TestTheTiers:
    def test_the_split_is_the_owners(self):
        assert {d["slug"] for d in FACILITY_SUB_FOLDERS if not d["sensitive"]} == OPEN
        assert {d["slug"] for d in FACILITY_SUB_FOLDERS if d["sensitive"]} == SHUT

    def test_the_sensitive_tier_is_still_the_record_gate(self):
        assert set(FACILITY_SENSITIVE_PERMISSIONS) < set(FACILITY_ACCESS_PERMISSIONS)

    @pytest.mark.parametrize(
        "grant",
        ["facilities.view", "facilities.view_sensitive", "facilities.manage"],
    )
    async def test_any_facilities_access_opens_the_operational_folders(self, grant):
        by_id, subs = _tree()
        svc = DocumentsService(db=None)
        for slug in OPEN:
            assert await svc.can_access_folder(
                subs[slug], "org-1", _user(grant), by_id
            ), (grant, slug)

    async def test_baseline_view_does_not_open_the_sensitive_folders(self):
        by_id, subs = _tree()
        svc = DocumentsService(db=None)
        for slug in SHUT:
            assert not await svc.can_access_folder(
                subs[slug], "org-1", _user("facilities.view"), by_id
            ), slug

    async def test_the_sensitive_grant_opens_every_folder(self):
        by_id, subs = _tree()
        svc = DocumentsService(db=None)
        for slug in OPEN | SHUT:
            assert await svc.can_access_folder(
                subs[slug], "org-1", _user("facilities.view_sensitive"), by_id
            ), slug

    async def test_documents_view_alone_opens_nothing(self):
        """The reason the tier is not simply "no restriction": every member
        holds documents.view."""
        by_id, subs = _tree()
        svc = DocumentsService(db=None)
        for slug in OPEN | SHUT:
            assert not await svc.can_access_folder(
                subs[slug], "org-1", _user("documents.view"), by_id
            ), slug

    async def test_writing_still_needs_edit_or_manage(self):
        by_id, subs = _tree()
        svc = DocumentsService(db=None)
        photos = subs["photos"]
        for grant in ("facilities.view", "facilities.view_sensitive"):
            assert not await svc.can_access_folder(
                photos, "org-1", _user(grant), by_id, require_write=True
            ), grant
        assert await svc.can_access_folder(
            photos, "org-1", _user("facilities.edit"), by_id, require_write=True
        )


async def _org(db) -> Organization:
    org = Organization(name="Tier Dept", slug=f"fac13-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


@pytest.mark.integration
class TestOnTheDatabase:
    async def test_a_baseline_viewer_now_sees_the_operational_folders(self, db_session):
        org = await _org(db_session)
        svc = DocumentsService(db_session)
        facility_id = str(uuid.uuid4())
        await svc.ensure_facility_folder(org.id, facility_id, "Station 1")

        baseline = await svc.get_facility_sub_folders(
            org.id, facility_id, _user("facilities.view")
        )
        sensitive = await svc.get_facility_sub_folders(
            org.id, facility_id, _user("facilities.view_sensitive")
        )

        prefix = f"facility-{facility_id}-"
        assert {f.slug.removeprefix(prefix) for f in baseline} == OPEN
        assert {f.slug.removeprefix(prefix) for f in sensitive} == OPEN | SHUT

    async def test_an_older_facility_gets_its_documents_folder_on_first_use(
        self, db_session
    ):
        org = await _org(db_session)
        svc = DocumentsService(db_session)
        facility_id = str(uuid.uuid4())
        facility_folder = await svc.ensure_facility_folder(
            org.id, facility_id, "Station 2"
        )
        # A facility created before FAC-13 has no Facility Documents folder.
        existing = await svc.ensure_facility_sub_folder(
            org.id, facility_folder, "documents"
        )
        await db_session.delete(existing)
        await db_session.flush()

        created = await svc.ensure_facility_sub_folder(
            org.id, facility_folder, "documents"
        )
        again = await svc.ensure_facility_sub_folder(
            org.id, facility_folder, "documents"
        )

        assert created.id == again.id
        assert created.parent_id == facility_folder.id
        assert created.required_permissions == list(FACILITY_SENSITIVE_PERMISSIONS)
        assert isinstance(created, DocumentFolder)
