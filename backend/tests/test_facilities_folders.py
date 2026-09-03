"""Guard tests for GET /facilities/{facility_id}/folders (Codex review, PR #1836).

FAC-6: `ensure_facility_folder` is a get-or-create with no uniqueness
constraint behind it — two concurrent first-accesses for the same facility
could both insert a facility folder (and its sub-folders), after which every
later read raises `MultipleResultsFound`. Locking the organization row for
the duration serializes concurrent creates.

FAC-9: the folder list's `document_count` crosses into the generic Documents
module's own permission boundary — a `facilities.view` holder without
`documents.view` should see the folders (a fixed part of the facility
record) but not how many documents are inside them. This class below mocks
`get_facility_sub_folders` entirely, so it tests only the count-redaction
logic in `get_facility_folders` -- not whether the folders themselves reach
that caller. As of FAC-13 (docs/security-review/FAC-12-facilities.md) they
usually do not: every facility folder is now stamped with the sensitive
permission set, so a plain `facilities.view` holder gets an empty folder
list from the real `get_facility_sub_folders`, not the populated one this
mock hands it.

FAC-17: the classes above call the plain Python handler directly and assert
on the returned dict, which bypasses FastAPI's response-model validation
entirely. `TestFolderRouteResponseValidation` below instead drives the route
through a real ASGI request, because the returned dict was missing the
`skip`/`limit` keys `FoldersListResponse` requires -- invisible to a
direct-call test, and a 500 on every real HTTP call.
"""

import inspect
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_current_user
from app.core.database import get_db
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


class TestFolderRouteResponseValidation:
    """Codex review (PR #2191): the handler once returned a dict with only
    ``folders``/``total``, omitting the ``skip``/``limit`` fields
    ``FoldersListResponse`` requires. ``TestFacilityFolderDocumentCountRedaction``
    above calls ``get_facility_folders`` as a plain Python function and reads
    the returned dict directly -- that bypasses FastAPI's response-model
    validation entirely, so it could not have caught a shape that only fails
    once real request/response serialization runs. These issue a real ASGI
    request through the actual router instead, which is what turned the
    missing fields into a 500 in production.
    """

    def _app(self, user):
        from app.api.v1.endpoints.facilities import router

        app = FastAPI()
        app.include_router(router, prefix="/facilities")
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: AsyncMock()
        return app

    async def _get(self, user, sub_folders):
        app = self._app(user)
        facility = SimpleNamespace(id="fac-1", display_name="Station 1")

        with (
            patch("app.api.v1.endpoints.facilities.FacilitiesService") as mock_fac_svc,
            patch("app.api.v1.endpoints.facilities.DocumentsService") as mock_doc_svc,
        ):
            mock_fac_svc.return_value.get_facility = AsyncMock(return_value=facility)
            mock_doc_svc.return_value.ensure_facility_folder = AsyncMock()
            mock_doc_svc.return_value.get_facility_sub_folders = AsyncMock(
                return_value=sub_folders
            )
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                return await client.get("/facilities/fac-1/folders")

    async def test_empty_folder_list_passes_response_validation(self):
        """The facilities.view-only caller FAC-13 describes: every sub-folder
        is sensitive-gated, so get_facility_sub_folders legitimately returns
        nothing. This must come back as a real 200 with an empty list -- not
        a 500 from FastAPI's own response-model validation, which is exactly
        what happened before this fix (skip/limit were missing on every
        return path, not just this one).
        """
        response = await self._get(
            _user(permissions=["facilities.view"]), sub_folders=[]
        )

        assert response.status_code == 200
        body = response.json()
        assert body["folders"] == []
        assert body["total"] == 0
        assert body["skip"] == 0
        assert body["limit"] == 0

    async def test_populated_folder_list_passes_response_validation(self):
        now = datetime.now(timezone.utc)
        sub_folder = DocumentFolder(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            name="Photos",
            slug="facility-fac-1-photos",
            parent_id=str(uuid4()),
            color="#3B82F6",
            icon="folder",
            is_system=False,
            sort_order=0,
            visibility="organization",
            created_at=now,
            updated_at=now,
        )
        sub_folder.document_count = 2

        response = await self._get(
            _user(permissions=["facilities.manage", "documents.manage"]),
            sub_folders=[sub_folder],
        )

        assert response.status_code == 200
        body = response.json()
        assert len(body["folders"]) == 1
        assert body["folders"][0]["document_count"] == 2
        assert body["total"] == 1
        assert body["skip"] == 0
        assert body["limit"] == 1
