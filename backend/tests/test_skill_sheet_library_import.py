"""Copying a starter sheet into a department's own library.

A new department opens Skills Testing on an empty table and a New Template
button, and building an NREMT-style sheet from scratch is twenty minutes of
typing before the first candidate can be tested.

The sheets are served from a static definition and copied on demand rather than
seeded as system-level rows: ``skill_templates.organization_id`` is NOT NULL,
and making a tenancy column nullable to hold shared records is a bigger change
than the feature needs. Copying also gets the ownership right — an imported
sheet is the department's, not a shared row that shifts under them on upgrade.

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import skills_testing as endpoint
from app.data.skill_sheet_library import SHEET_SLUGS, SKILL_SHEETS, sheet_by_slug
from app.models.skills_testing import SkillTemplateStatus
from app.schemas.skills_testing import CRITERION_TYPES, SkillTemplateCreate

ORG = uuid4()


def _officer():
    return SimpleNamespace(id=uuid4(), organization_id=ORG, username="chief")


class RecordingSession:
    """Captures what would be persisted, without a database."""

    def __init__(self, existing_names=()):
        self._names = list(existing_names)
        self.added = []

    async def execute(self, *_args, **_kwargs):
        result = MagicMock()
        result.scalars.return_value.all.return_value = self._names
        return result

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        return None

    async def refresh(self, _obj):
        return None


class TestLibraryListing:
    async def test_lists_every_sheet_with_its_shape(self, monkeypatch):
        monkeypatch.setattr(endpoint, "log_audit_event", AsyncMock())
        items = await endpoint.list_library_sheets(
            db=RecordingSession(), current_user=_officer()
        )

        assert len(items) == len(SKILL_SHEETS)
        by_slug = {i.slug: i for i in items}
        scba = by_slug["scba-donning-timed"]
        assert scba.name == "SCBA Donning — Timed Evolution"
        assert scba.category == "Fire Suppression"
        assert scba.section_count == 2
        assert scba.criteria_count == 8
        # Statements are excluded: they are read aloud, not judged, and cannot
        # fail anyone — counting them would overstate the sheet's teeth.
        assert scba.critical_count == 5

    async def test_flags_the_ones_the_department_already_holds(self):
        """Otherwise the picker quietly makes a second copy of a sheet the
        officer imported last month and has since edited."""
        items = await endpoint.list_library_sheets(
            db=RecordingSession(existing_names=["SCBA Donning — Timed Evolution"]),
            current_user=_officer(),
        )
        by_slug = {i.slug: i for i in items}

        assert by_slug["scba-donning-timed"].already_imported is True
        assert by_slug["patient-assessment-medical"].already_imported is False

    async def test_slugs_are_stable_and_unique(self):
        """They are the import id. Deriving them from the names would break the
        link the moment anyone tidied a title — these carry em dashes,
        fractions and slashes."""
        assert len(set(SHEET_SLUGS.values())) == len(SHEET_SLUGS)
        assert set(SHEET_SLUGS) == {s["name"] for s in SKILL_SHEETS}


class TestImport:
    async def test_an_unknown_slug_is_a_404(self, monkeypatch):
        monkeypatch.setattr(endpoint, "log_audit_event", AsyncMock())
        with pytest.raises(HTTPException) as exc:
            await endpoint.import_library_sheet(
                slug="no-such-sheet", db=RecordingSession(), current_user=_officer()
            )
        assert exc.value.status_code == 404

    @pytest.mark.parametrize("slug", sorted(SHEET_SLUGS.values()))
    async def test_every_sheet_imports_into_the_callers_org(self, slug, monkeypatch):
        monkeypatch.setattr(endpoint, "log_audit_event", AsyncMock())
        session = RecordingSession()
        user = _officer()

        await endpoint.import_library_sheet(slug=slug, db=session, current_user=user)

        created = session.added[0]
        assert created.organization_id == ORG
        assert created.created_by == user.id
        assert created.name == sheet_by_slug(slug)["name"]

    async def test_lands_as_a_draft(self, monkeypatch):
        """A published template can be selected for a live evaluation, and a
        sheet nobody in the department has read yet should not be."""
        monkeypatch.setattr(endpoint, "log_audit_event", AsyncMock())
        session = RecordingSession()

        await endpoint.import_library_sheet(
            slug="scba-donning-timed", db=session, current_user=_officer()
        )

        assert session.added[0].status == SkillTemplateStatus.DRAFT.value

    async def test_the_copy_carries_the_whole_sheet(self, monkeypatch):
        monkeypatch.setattr(endpoint, "log_audit_event", AsyncMock())
        session = RecordingSession()

        await endpoint.import_library_sheet(
            slug="pump-ops-draft-relay", db=session, current_user=_officer()
        )

        created = session.added[0]
        assert created.passing_percentage == 75
        assert created.require_all_critical is True
        assert len(created.sections) == 2
        labels = [c["label"] for s in created.sections for c in s["criteria"]]
        assert "Priming technique and time to water" in labels

    async def test_imported_content_goes_through_the_same_validation(self, monkeypatch):
        """An import path that bypassed the schema is how unscorable templates
        got into a database once already."""
        monkeypatch.setattr(endpoint, "log_audit_event", AsyncMock())
        session = RecordingSession()

        await endpoint.import_library_sheet(
            slug="hazmat-level-a-suit", db=session, current_user=_officer()
        )

        # Re-validating the persisted shape must succeed — and every criterion
        # type must be one the examiner screen can render.
        created = session.added[0]
        SkillTemplateCreate(
            name=created.name,
            sections=created.sections,
            require_all_critical=created.require_all_critical,
        )
        for section in created.sections:
            for criterion in section["criteria"]:
                assert criterion["type"] in CRITERION_TYPES

    async def test_records_which_sheet_was_imported(self, monkeypatch):
        audit = AsyncMock()
        monkeypatch.setattr(endpoint, "log_audit_event", audit)

        await endpoint.import_library_sheet(
            slug="evoc-driving-course",
            db=RecordingSession(),
            current_user=_officer(),
        )

        data = audit.await_args.kwargs["event_data"]
        assert audit.await_args.kwargs["event_type"] == "skill_template_imported"
        assert data["library_slug"] == "evoc-driving-course"

    async def test_importing_twice_is_the_officers_call_not_a_refusal(
        self, monkeypatch
    ):
        """The listing flags what they already hold; the endpoint does not
        block. A department that edited its copy into something else may
        legitimately want the original back."""
        monkeypatch.setattr(endpoint, "log_audit_event", AsyncMock())
        session = RecordingSession(existing_names=["SCBA Donning — Timed Evolution"])

        await endpoint.import_library_sheet(
            slug="scba-donning-timed", db=session, current_user=_officer()
        )

        assert len(session.added) == 1
