"""Guard tests for GET /facilities/{facility_id}/folders (Codex review, PR #1836).

FAC-6: `ensure_facility_folder` is a get-or-create with no uniqueness
constraint behind it — two concurrent first-accesses for the same facility
could both insert a facility folder (and its sub-folders), after which every
later read raises `MultipleResultsFound`. Locking the organization row for
the duration serializes concurrent creates.

FAC-9: the folder list's `document_count` crosses into the generic Documents
module's own permission boundary — a `facilities.view` holder without
`documents.view` should see the folders (a fixed part of the facility
record) but not how many documents are inside them.
"""

import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.models.document import DocumentFolder
from app.services.documents_service import DocumentsService

ORG = "org-1"


def _user(user_id="user-1", permissions=()):
    return SimpleNamespace(
        id=user_id,
        organization_id=ORG,
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
    )


class TestFolderCreationIsLocked:
    def test_ensure_facility_folder_locks_the_organization_row(self):
        source = inspect.getsource(DocumentsService.ensure_facility_folder)
        assert "with_for_update()" in source, (
            "ensure_facility_folder is a check-then-insert with no uniqueness "
            "constraint behind it; two concurrent first-accesses for the same "
            "facility must be serialized on the organization row or they can "
            "both insert a duplicate facility folder."
        )

    def test_ensure_facility_folder_also_locks_both_existence_checks(self):
        """DOC-10 pass 2 (2026-08-27): the organization-row lock above is
        necessary but not sufficient -- Pitfall #27's second half. The
        caller, GET /facilities/{id}/folders, reads the Facility row via
        FacilitiesService.get_facility (a plain SELECT) before this method
        ever runs, which under this app's default REPEATABLE READ
        establishes the transaction's snapshot before the organization lock
        is even acquired. A plain SELECT for facilities_root/facility_folder
        after that lock would still answer from that earlier snapshot and
        could report "no folder yet" even though a concurrent transaction
        already created and committed one while this one waited for the
        lock -- the exact shape demonstrated in CLAUDE.md Pitfall #27's own
        two-transaction trace. Both existence checks must be locking reads
        too, not just the organization row."""
        source = inspect.getsource(DocumentsService.ensure_facility_folder)
        assert source.count("with_for_update()") >= 3, (
            "ensure_facility_folder locks fewer than 3 reads (organization + "
            "facilities_root + facility_folder) -- the organization lock "
            "alone does not make the facility-folder existence checks see "
            "latest-committed data, so two concurrent first-accesses can "
            "still both decide no folder exists and both create one"
        )


class TestFacilityFolderDocumentCountRedaction:
    async def _call(self, current_user):
        from app.api.v1.endpoints.facilities import get_facility_folders

        facility = SimpleNamespace(id="fac-1", display_name="Station 1")
        sub_folder = DocumentFolder(
            id="folder-1",
            organization_id=ORG,
            name="Insurance & Leases",
            slug="facility-fac-1-insurance",
            parent_id="parent-1",
        )
        sub_folder.document_count = 3
        db = AsyncMock()
        db.commit = AsyncMock()

        with (
            patch("app.api.v1.endpoints.facilities.FacilitiesService") as mock_fac_svc,
            patch("app.api.v1.endpoints.facilities.DocumentsService") as mock_doc_svc,
        ):
            mock_fac_svc.return_value.get_facility = AsyncMock(return_value=facility)
            mock_doc_svc.return_value.ensure_facility_folder = AsyncMock()
            mock_doc_svc.return_value.get_facility_sub_folders = AsyncMock(
                return_value=[sub_folder]
            )
            return await get_facility_folders("fac-1", db=db, current_user=current_user)

    async def test_view_only_caller_does_not_see_document_count(self):
        result = await self._call(_user(permissions=["facilities.view"]))
        assert result["folders"][0]["document_count"] is None

    async def test_documents_view_caller_sees_document_count(self):
        result = await self._call(
            _user(permissions=["facilities.view", "documents.view"])
        )
        assert result["folders"][0]["document_count"] == 3

    async def test_documents_manage_caller_sees_document_count(self):
        result = await self._call(
            _user(permissions=["facilities.manage", "documents.manage"])
        )
        assert result["folders"][0]["document_count"] == 3
