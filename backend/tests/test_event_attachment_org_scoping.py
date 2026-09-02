"""Cross-tenant event attachment injection (EV-17).

``EventCreate``/``EventUpdate``/``RecurringEventCreate`` all declare
``attachments: List[Dict[str, str]]``, and the service persisted whatever
dictionary arrived. ``download_event_attachment`` then checked only that the
stored ``file_path`` resolved somewhere under the *shared*
``/app/uploads/event-attachments`` root — every organization's uploads live
under it — so an ``events.manage`` caller who learned another tenant's stored
path could attach it to an event in their own organization and read that
tenant's file through their own event.

Two halves, and both are asserted here: the write refuses a foreign path, and
the read refuses to serve one that is already stored.
"""

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.events import ATTACHMENT_UPLOAD_DIR, download_event_attachment
from app.utils.event_attachments import (
    is_path_in_org,
    validate_attachments_for_org,
)

VICTIM_ORG = str(uuid4())
ATTACKER_ORG = str(uuid4())

VICTIM_FILE = os.path.join(
    ATTACHMENT_UPLOAD_DIR, VICTIM_ORG, str(uuid4()), "abcdef0123456789.pdf"
)
ATTACKER_FILE = os.path.join(
    ATTACHMENT_UPLOAD_DIR, ATTACKER_ORG, str(uuid4()), "fedcba9876543210.pdf"
)


class TestWriteSideRejectsForeignPaths:
    def test_another_orgs_upload_path_is_refused(self):
        with pytest.raises(ValueError, match="uploaded to this organization") as exc:
            validate_attachments_for_org(
                [{"id": "a1", "file_name": "stolen.pdf", "file_path": VICTIM_FILE}],
                ATTACKER_ORG,
            )

        # The rejection must not echo the probed path back — that would confirm
        # a guess was well-formed.
        assert VICTIM_FILE not in str(exc.value)

    def test_the_callers_own_upload_path_is_accepted(self):
        """Copying an attachment between events of the same org is legitimate:
        recurring-occurrence generation and event duplication both do it."""
        validate_attachments_for_org(
            [{"id": "a1", "file_name": "ok.pdf", "file_path": ATTACKER_FILE}],
            ATTACKER_ORG,
        )

    def test_traversal_out_of_the_org_subtree_is_refused(self):
        escaped = os.path.join(
            ATTACHMENT_UPLOAD_DIR, ATTACKER_ORG, "..", VICTIM_ORG, "x.pdf"
        )
        with pytest.raises(ValueError, match="uploaded to this organization"):
            validate_attachments_for_org([{"file_path": escaped}], ATTACKER_ORG)

    def test_a_path_outside_the_upload_root_is_refused(self):
        with pytest.raises(ValueError, match="uploaded to this organization"):
            validate_attachments_for_org([{"file_path": "/etc/passwd"}], ATTACKER_ORG)

    def test_a_missing_file_path_is_refused(self):
        with pytest.raises(ValueError, match="uploaded to this organization"):
            validate_attachments_for_org([{"file_name": "no-path.pdf"}], ATTACKER_ORG)

    def test_a_non_object_entry_is_refused(self):
        with pytest.raises(ValueError, match="must be an object"):
            validate_attachments_for_org(["/etc/passwd"], ATTACKER_ORG)

    def test_unset_and_cleared_are_both_fine(self):
        validate_attachments_for_org(None, ATTACKER_ORG)
        validate_attachments_for_org([], ATTACKER_ORG)

    def test_it_fails_closed_without_an_organization(self):
        assert is_path_in_org(ATTACKER_FILE, None) is False
        assert is_path_in_org(None, ATTACKER_ORG) is False

    @pytest.mark.parametrize("bad", [1, 1.5, True, ["/tmp/x"], {"p": "/tmp/x"}])
    def test_a_non_string_file_path_is_a_400_not_a_500(self, bad):
        """`attachments` is typed List[Dict[str, Any]] — it has to be, because
        the upload handler writes file_size as an int and description as None —
        so a create request can legitimately arrive carrying a non-string
        file_path. os.path.realpath then raised TypeError, which the event
        endpoints do not catch: a malformed request 500'd."""
        assert is_path_in_org(bad, ATTACKER_ORG) is False
        with pytest.raises(ValueError, match="uploaded to this organization"):
            validate_attachments_for_org([{"file_path": bad}], ATTACKER_ORG)


class TestReadSideRefusesAnAlreadyStoredForeignPath:
    """Defence in depth: the download must not serve a row that predates — or
    slipped past — the write-side guard."""

    @staticmethod
    def _call(stored_path, caller_org, monkeypatch):
        event = SimpleNamespace(
            id=str(uuid4()),
            organization_id=caller_org,
            attachments=[
                {
                    "id": "att-1",
                    "file_name": "readme.pdf",
                    "file_path": stored_path,
                }
            ],
        )
        db = SimpleNamespace(
            execute=AsyncMock(
                return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=event))
            )
        )
        user = SimpleNamespace(id=str(uuid4()), organization_id=caller_org)
        # The files do not exist on disk in the test environment; the guard
        # under test runs before the existence check, so a 403 proves the
        # containment rejection and a 404 proves it got past it.
        monkeypatch.setattr(os.path, "exists", lambda _p: False)
        return download_event_attachment(uuid4(), "att-1", db, user)

    @pytest.mark.asyncio
    async def test_another_orgs_stored_path_is_denied(self, monkeypatch):
        with pytest.raises(HTTPException) as exc:
            await self._call(VICTIM_FILE, ATTACKER_ORG, monkeypatch)

        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_the_callers_own_path_passes_containment(self, monkeypatch):
        """404 (missing on disk), not 403 — the guard let it through."""
        with pytest.raises(HTTPException) as exc:
            await self._call(ATTACKER_FILE, ATTACKER_ORG, monkeypatch)

        assert exc.value.status_code == 404


class TestServiceWritePathsRefuseForeignPaths:
    """The guard has to sit on the service, not only in the helper — these are
    the three payloads that can write the column."""

    @staticmethod
    def _service(event):
        from app.services.event_service import EventService

        db = SimpleNamespace(
            execute=AsyncMock(
                return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=event))
            ),
            add=MagicMock(),
            commit=AsyncMock(),
            refresh=AsyncMock(),
            flush=AsyncMock(),
        )
        return EventService(db), db

    @pytest.mark.asyncio
    async def test_update_event_refuses_a_foreign_attachment(self):
        from datetime import datetime, timedelta, timezone

        from app.schemas.event import EventUpdate

        start = datetime.now(timezone.utc) + timedelta(days=30)
        event = SimpleNamespace(
            id=str(uuid4()),
            organization_id=ATTACKER_ORG,
            is_cancelled=False,
            custom_fields=None,
            start_datetime=start,
            end_datetime=start + timedelta(hours=2),
            location_id=None,
            attachments=[],
        )
        service, db = self._service(event)

        with pytest.raises(ValueError, match="uploaded to this organization"):
            await service.update_event(
                event_id=uuid4(),
                organization_id=ATTACKER_ORG,
                event_data=EventUpdate(
                    attachments=[{"id": "a1", "file_path": VICTIM_FILE}]
                ),
            )

        db.commit.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_create_recurring_event_reports_the_refusal(self):
        service, db = self._service(None)

        events, error = await service.create_recurring_event(
            event_data={
                "recurrence_pattern": "weekly",
                "attachments": [{"id": "a1", "file_path": VICTIM_FILE}],
            },
            organization_id=ATTACKER_ORG,
            created_by=uuid4(),
        )

        assert events == []
        assert "uploaded to this organization" in (error or "")
        db.add.assert_not_called()
