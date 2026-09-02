"""
MP-08 pass 3 (2026-09-02) Codex review — regression tests.

Six findings against ``membership_pipeline_service.py`` /
``membership_pipeline.py``, independently re-verified and fixed:

1. Unvalidated cross-tenant form ids in step config (add_step / update_step /
   create_pipeline's inline steps loop).
2. N+1 query shape in ``list_event_links``.
3. Election-package PII over-collection ignoring the stage's configured
   ``package_fields`` (a config switch with no reader — CLAUDE.md #19).
4. Election-package assignment race — a read-then-write with no row lock
   (CLAUDE.md #27).
5. Document deletion committing the metadata delete before the file removal
   is attempted, orphaning the file on a failed ``os.remove``.
6. No server-side state machine on ``ElectionPackageUpdate.status``.

A seventh, lower-priority finding (unbounded prospect reads on
``/widget-summary`` and ``/pipelines``) is tracked in
``docs/security-review/MP-08-membership-pipeline.md`` / KNOWN_LIMITATIONS —
the ``/pipelines`` half is covered here since it was fixed; ``/widget-summary``
was flagged, not fixed, and has no guard test.
"""

import ast
import inspect
import shutil
import textwrap
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Election, ElectionStatus
from app.models.forms import Form
from app.models.membership_pipeline import ProspectElectionPackage
from app.services.membership_pipeline_service import (
    ELECTION_PACKAGE_CALLER_STATUSES,
    ELECTION_PACKAGE_SYSTEM_STATUSES,
    MembershipPipelineService,
)

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_and_admin(db_session: AsyncSession):
    org_id = _uid()
    admin_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Admin', 'User', :em, 'hashed', 'active')"
        ),
        {
            "id": admin_id,
            "org": org_id,
            "un": f"admin-{org_id[:8]}",
            "em": f"admin-{org_id[:8]}@test.example",
        },
    )
    await db_session.flush()
    return org_id, admin_id


@pytest.fixture
async def other_org(db_session: AsyncSession):
    """A second organization, for cross-tenant validation."""
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Other Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"o-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


async def _pipeline_with_steps(svc, org_id, count=1):
    pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
    steps = [
        await svc.add_step(pipeline.id, org_id, {"name": f"Stage {i + 1}"})
        for i in range(count)
    ]
    return pipeline, steps


@pytest.fixture
def uploads_dir():
    """add_prospect_document requires file_path to resolve under
    /app/uploads (path-traversal guard) -- pytest's tmp_path lives
    elsewhere, so tests that go through that service method need a real
    subdirectory under the app's own uploads volume."""
    base = f"/app/uploads/test-{_uid()}"
    import os

    os.makedirs(base, exist_ok=True)
    try:
        yield base
    finally:
        shutil.rmtree(base, ignore_errors=True)


async def _prospect(svc, org_id, pipeline_id, **overrides):
    data = {
        "first_name": "App",
        "last_name": f"Licant{_uid()[:4]}",
        "email": f"a-{_uid()[:8]}@example.com",
        "pipeline_id": pipeline_id,
    }
    data.update(overrides)
    return await svc.create_prospect(organization_id=org_id, data=data)


# =========================================================================
# 1. Cross-tenant form_id in step config
# =========================================================================


class TestStepFormIdOrgValidation:
    """A step's config.form_id is a client-supplied FK to an org-scoped Form
    (CLAUDE.md pitfall #14c / XC-1). ``_ensure_membership_form_integration``
    only logs and returns on a failed lookup — it never rejects the write —
    so it must not be the only thing standing between a cross-tenant form id
    and the database."""

    async def test_add_step_rejects_a_foreign_org_form_id(
        self, db_session: AsyncSession, org_and_admin, other_org
    ):
        org_id, _ = org_and_admin
        foreign_form_id = _uid()
        db_session.add(
            Form(id=foreign_form_id, organization_id=other_org, name="Other org form")
        )
        await db_session.flush()

        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")

        with pytest.raises(ValueError, match="[Ff]orm"):
            await svc.add_step(
                pipeline.id,
                org_id,
                {"name": "Apply", "config": {"form_id": foreign_form_id}},
            )

        # The step must not have been persisted at all.
        await db_session.refresh(pipeline)
        reloaded = await svc.get_pipeline(pipeline.id, org_id)
        assert reloaded.steps == []

    async def test_update_step_rejects_a_foreign_org_form_id(
        self, db_session: AsyncSession, org_and_admin, other_org
    ):
        org_id, _ = org_and_admin
        foreign_form_id = _uid()
        db_session.add(
            Form(id=foreign_form_id, organization_id=other_org, name="Other org form")
        )
        await db_session.flush()

        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id)
        step = steps[0]

        with pytest.raises(ValueError, match="[Ff]orm"):
            await svc.update_step(
                step.id,
                pipeline.id,
                org_id,
                {"config": {"form_id": foreign_form_id}},
            )

        reloaded = await svc.get_pipeline(pipeline.id, org_id)
        reloaded_step = next(s for s in reloaded.steps if s.id == step.id)
        assert (reloaded_step.config or {}).get("form_id") is None

    async def test_create_pipeline_inline_steps_rejects_a_foreign_org_form_id(
        self, db_session: AsyncSession, org_and_admin, other_org
    ):
        org_id, _ = org_and_admin
        foreign_form_id = _uid()
        db_session.add(
            Form(id=foreign_form_id, organization_id=other_org, name="Other org form")
        )
        await db_session.flush()

        svc = MembershipPipelineService(db_session)

        with pytest.raises(ValueError, match="[Ff]orm"):
            await svc.create_pipeline(
                organization_id=org_id,
                name="Inline steps pipeline",
                steps=[
                    {"name": "Apply", "config": {"form_id": foreign_form_id}},
                ],
            )

    async def test_add_step_still_accepts_an_in_org_form_id(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Regression guard: the fix must not block a legitimate same-org
        form_id."""
        org_id, _ = org_and_admin
        own_form_id = _uid()
        db_session.add(Form(id=own_form_id, organization_id=org_id, name="Our form"))
        await db_session.flush()

        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")

        step = await svc.add_step(
            pipeline.id,
            org_id,
            {"name": "Apply", "config": {"form_id": own_form_id}},
        )
        assert step is not None
        assert step.config.get("form_id") == own_form_id

    async def test_add_step_still_accepts_no_form_id(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Regression guard: steps with no form config (the common case)
        must be unaffected."""
        org_id, _ = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")

        step = await svc.add_step(pipeline.id, org_id, {"name": "Checklist item"})
        assert step is not None


# =========================================================================
# 2. list_event_links N+1
# =========================================================================


class TestEventLinkListBatching:

    def test_list_event_links_does_not_query_per_row(self):
        """MP-08 pass 3 (Codex): list_event_links issued a separate Event
        query and (when linked_by was set) a separate User query per link —
        a 2N+1 shape on GET /prospects/{id}/event-links. Source-inspected:
        no db.execute call may sit inside a `for` loop in this function."""
        source = textwrap.dedent(
            inspect.getsource(MembershipPipelineService.list_event_links)
        )
        tree = ast.parse(source)
        func_node = tree.body[0]
        for node in ast.walk(func_node):
            if isinstance(node, ast.For):
                for inner in ast.walk(node):
                    if isinstance(inner, ast.Attribute) and inner.attr == "execute":
                        pytest.fail(
                            "list_event_links still issues a db.execute() "
                            "call inside a for loop -- the N+1 shape is back"
                        )

    async def test_list_event_links_still_enriches_correctly(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Behavioral regression guard for the batch-fetch rewrite."""
        from app.models.event import Event, EventType

        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)

        now = datetime.now(timezone.utc)
        event1 = Event(
            id=_uid(),
            organization_id=org_id,
            title="Open House",
            event_type=EventType.OTHER,
            start_datetime=now,
            end_datetime=now + timedelta(hours=2),
        )
        event2 = Event(
            id=_uid(),
            organization_id=org_id,
            title="Ride Along",
            event_type=EventType.OTHER,
            start_datetime=now,
            end_datetime=now + timedelta(hours=2),
        )
        db_session.add_all([event1, event2])
        await db_session.flush()

        await svc.link_event(prospect.id, event1.id, org_id, linked_by=admin_id)
        await svc.link_event(prospect.id, event2.id, org_id, linked_by=None)

        links = await svc.list_event_links(prospect.id, org_id)
        assert len(links) == 2
        by_event_id = {link["event_id"]: link for link in links}
        assert by_event_id[event1.id]["event_title"] == "Open House"
        assert by_event_id[event1.id]["linked_by_name"] == "Admin User"
        assert by_event_id[event2.id]["event_title"] == "Ride Along"
        assert by_event_id[event2.id]["linked_by_name"] is None


# =========================================================================
# 3. Election-package PII over-collection ignoring package_fields
# =========================================================================


class TestElectionPackagePIIFields:

    async def _prospect_with_pii(self, svc, org_id, pipeline_id):
        return await _prospect(
            svc,
            org_id,
            pipeline_id,
            phone="555-0100",
            mobile="555-0101",
            date_of_birth=date(1990, 1, 1),
            address_street="1 Main St",
            address_city="Anytown",
            address_state="VA",
            address_zip="22042",
        )

    async def test_package_honors_configured_exclusions(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        step = await svc.add_step(
            pipeline.id,
            org_id,
            {
                "name": "Vote",
                "config": {
                    "package_fields": {
                        "include_email": True,
                        "include_phone": False,
                        "include_address": False,
                        "include_date_of_birth": False,
                        "include_documents": True,
                        "include_stage_history": True,
                    }
                },
            },
        )
        prospect = await self._prospect_with_pii(svc, org_id, pipeline.id)

        pkg = await svc.create_election_package(
            prospect.id, org_id, step_id=step.id, created_by=admin_id
        )

        snapshot = pkg.applicant_snapshot
        assert "email" in snapshot
        assert "phone" not in snapshot
        assert "mobile" not in snapshot
        assert "address_street" not in snapshot
        assert "address_city" not in snapshot
        assert "address_state" not in snapshot
        assert "address_zip" not in snapshot
        assert "date_of_birth" not in snapshot

    async def test_package_still_captures_everything_when_unconfigured(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Regression guard: a step whose config was never touched (the
        default for every pre-existing pipeline) must keep the prior
        capture-everything behavior."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id)
        prospect = await self._prospect_with_pii(svc, org_id, pipeline.id)

        pkg = await svc.create_election_package(
            prospect.id, org_id, step_id=steps[0].id, created_by=admin_id
        )

        snapshot = pkg.applicant_snapshot
        assert snapshot["phone"] == "555-0100"
        assert snapshot["mobile"] == "555-0101"
        assert snapshot["address_street"] == "1 Main St"
        assert snapshot["date_of_birth"] == "1990-01-01"
        assert snapshot["email"] == prospect.email

    async def test_package_without_step_id_still_captures_everything(
        self, db_session: AsyncSession, org_and_admin
    ):
        """No step_id at all (the field is optional) must not error and
        must keep the legacy full capture -- there is no stage config to
        consult."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        prospect = await self._prospect_with_pii(svc, org_id, pipeline.id)

        pkg = await svc.create_election_package(
            prospect.id, org_id, created_by=admin_id
        )
        assert pkg.applicant_snapshot["phone"] == "555-0100"


# =========================================================================
# 4. Election-package assignment race
# =========================================================================


class TestElectionPackageAssignmentLocking:

    def test_assign_locks_the_package_before_checking_status(self):
        """MP-08 pass 3 (Codex): assign_package_to_election read the package
        with a plain (unlocked) get_election_package call, checked
        pkg.status == "ready", then wrote election.ballot_items and
        pkg.election_id -- a check-before-write. Two concurrent calls (same
        package, different elections) could both pass the check and land
        the applicant on two ballots (CLAUDE.md pitfall #27's shape).
        Source-inspected, matching this rotation's existing lock-wiring
        guards (test_transfer_locks_the_prospect_before_checking_status)."""
        source = inspect.getsource(MembershipPipelineService.assign_package_to_election)
        assert "lock_for_update=True" in source, (
            "assign_package_to_election no longer locks the election "
            "package row before checking its status"
        )
        lock_at = source.index("lock_for_update=True")
        status_check_at = source.index('pkg.status != "ready"')
        assert lock_at < status_check_at, (
            "assign_package_to_election checks the package's status before "
            "acquiring the row lock -- the check-before-write race is "
            "still open even though a lock call exists somewhere in the "
            "function"
        )

    def test_get_election_package_lock_for_update_uses_with_for_update(self):
        source = inspect.getsource(MembershipPipelineService.get_election_package)
        assert "lock_for_update" in source
        assert "with_for_update" in source

    async def test_assign_still_works_and_double_assign_is_refused(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Behavioral regression guard: the lock must not break the
        ordinary, non-concurrent path, and re-assigning an already-assigned
        package must still be refused (belt-and-suspenders with finding 6's
        state-machine fix)."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)
        await svc.create_election_package(
            prospect.id, org_id, step_id=steps[0].id, created_by=admin_id
        )
        await svc.update_election_package(
            prospect.id, org_id, {"status": "ready"}, admin_id
        )

        now = datetime.now(timezone.utc)
        election = Election(
            id=_uid(),
            organization_id=org_id,
            title="Fall Vote",
            election_type="general",
            start_date=now,
            end_date=now + timedelta(days=14),
            status=ElectionStatus.DRAFT,
        )
        db_session.add(election)
        await db_session.flush()

        pkg = await svc.assign_package_to_election(
            prospect.id, org_id, election.id, admin_id
        )
        assert pkg.status == "added_to_ballot"
        assert pkg.election_id == election.id

        election2 = Election(
            id=_uid(),
            organization_id=org_id,
            title="Spring Vote",
            election_type="general",
            start_date=now,
            end_date=now + timedelta(days=14),
            status=ElectionStatus.DRAFT,
        )
        db_session.add(election2)
        await db_session.flush()

        with pytest.raises(ValueError, match="ready"):
            await svc.assign_package_to_election(
                prospect.id, org_id, election2.id, admin_id
            )


# =========================================================================
# 5. Document deletion orphans the file on OSError
# =========================================================================


class TestDocumentDeletionDoesNotOrphanTheFile:

    async def test_delete_removes_the_file_and_the_row(
        self, db_session: AsyncSession, org_and_admin, uploads_dir
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)

        stored = Path(uploads_dir) / "doc.pdf"
        stored.write_bytes(b"pdf bytes")

        doc = await svc.add_prospect_document(
            prospect_id=prospect.id,
            organization_id=org_id,
            document_type="application",
            file_name="doc.pdf",
            file_path=str(stored),
            uploaded_by=admin_id,
        )

        deleted = await svc.delete_prospect_document(doc.id, prospect.id, org_id)
        assert deleted is True
        assert not stored.exists()

    async def test_a_failed_removal_does_not_delete_the_metadata_row(
        self, db_session: AsyncSession, org_and_admin, uploads_dir, monkeypatch
    ):
        """MP-08 pass 3 (Codex): the DB row was deleted and committed before
        os.remove was attempted; a caught OSError still returned True, so
        the sensitive file survived on disk with no DB row left to retry
        cleanup against. Now: the row must survive a failed removal so a
        retry (or manual cleanup) has something to act on."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)

        stored = Path(uploads_dir) / "doc.pdf"
        stored.write_bytes(b"pdf bytes")

        doc = await svc.add_prospect_document(
            prospect_id=prospect.id,
            organization_id=org_id,
            document_type="application",
            file_name="doc.pdf",
            file_path=str(stored),
            uploaded_by=admin_id,
        )

        import os as os_module

        def _boom(path):
            raise OSError("Permission denied")

        monkeypatch.setattr(os_module, "remove", _boom)

        with pytest.raises(ValueError, match="delete the document file"):
            await svc.delete_prospect_document(doc.id, prospect.id, org_id)

        # The metadata row must still be there -- it is the only remaining
        # record that the file needs cleaning up.
        from app.models.membership_pipeline import ProspectDocument

        result = await db_session.execute(
            select(ProspectDocument).where(ProspectDocument.id == doc.id)
        )
        assert result.scalars().first() is not None
        assert stored.exists()

    async def test_delete_of_an_already_missing_file_still_succeeds(
        self, db_session: AsyncSession, org_and_admin, uploads_dir
    ):
        """A file already removed by some earlier partial failure is not an
        error -- there is nothing left to remove, and the metadata row
        should still be droppable."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)

        stored = Path(uploads_dir) / "gone.pdf"
        stored.write_bytes(b"x")

        doc = await svc.add_prospect_document(
            prospect_id=prospect.id,
            organization_id=org_id,
            document_type="application",
            file_name="gone.pdf",
            file_path=str(stored),
            uploaded_by=admin_id,
        )
        stored.unlink()  # simulate an already-missing file

        deleted = await svc.delete_prospect_document(doc.id, prospect.id, org_id)
        assert deleted is True


# =========================================================================
# 6. Election-package status state machine
# =========================================================================


class TestElectionPackageStatusStateMachine:

    def test_system_statuses_are_not_caller_settable(self):
        assert ELECTION_PACKAGE_CALLER_STATUSES == {"draft", "ready"}
        assert ELECTION_PACKAGE_SYSTEM_STATUSES == {
            "added_to_ballot",
            "elected",
            "not_elected",
        }
        assert ELECTION_PACKAGE_CALLER_STATUSES.isdisjoint(
            ELECTION_PACKAGE_SYSTEM_STATUSES
        )

    @pytest.mark.parametrize(
        "target_status", ["added_to_ballot", "elected", "not_elected", "bogus"]
    )
    async def test_update_refuses_to_set_a_system_or_unknown_status(
        self, db_session: AsyncSession, org_and_admin, target_status
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)
        await svc.create_election_package(prospect.id, org_id, created_by=admin_id)

        with pytest.raises(ValueError, match="status"):
            await svc.update_election_package(
                prospect.id, org_id, {"status": target_status}, admin_id
            )

    async def test_update_still_allows_draft_and_ready(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)
        await svc.create_election_package(prospect.id, org_id, created_by=admin_id)

        ready = await svc.update_election_package(
            prospect.id, org_id, {"status": "ready"}, admin_id
        )
        assert ready.status == "ready"

        back_to_draft = await svc.update_election_package(
            prospect.id, org_id, {"status": "draft"}, admin_id
        )
        assert back_to_draft.status == "draft"

    async def test_update_refuses_any_status_change_once_added_to_ballot(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The specific compounding scenario Codex described: reset an
        already-assigned package back to 'ready' and reassign it."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)
        await svc.create_election_package(
            prospect.id, org_id, step_id=steps[0].id, created_by=admin_id
        )
        await svc.update_election_package(
            prospect.id, org_id, {"status": "ready"}, admin_id
        )

        now = datetime.now(timezone.utc)
        election = Election(
            id=_uid(),
            organization_id=org_id,
            title="Vote",
            election_type="general",
            start_date=now,
            end_date=now + timedelta(days=14),
            status=ElectionStatus.DRAFT,
        )
        db_session.add(election)
        await db_session.flush()
        await svc.assign_package_to_election(prospect.id, org_id, election.id, admin_id)

        with pytest.raises(ValueError, match="status"):
            await svc.update_election_package(
                prospect.id, org_id, {"status": "ready"}, admin_id
            )

        # And the row genuinely never moved.
        result = await db_session.execute(
            select(ProspectElectionPackage).where(
                ProspectElectionPackage.prospect_id == prospect.id
            )
        )
        assert result.scalars().first().status == "added_to_ballot"

    async def test_update_of_unrelated_fields_is_unaffected(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Regression guard: the new guard must only look at `status`."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        prospect = await _prospect(svc, org_id, pipeline.id)
        await svc.create_election_package(prospect.id, org_id, created_by=admin_id)

        updated = await svc.update_election_package(
            prospect.id, org_id, {"coordinator_notes": "Looks great"}, admin_id
        )
        assert updated.coordinator_notes == "Looks great"
        assert updated.status == "draft"


# =========================================================================
# 7. /pipelines prospect_count no longer materializes every prospect row
# =========================================================================


class TestPipelineListProspectCount:

    async def test_prospect_count_is_correct_without_loading_the_collection(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        for _ in range(3):
            await _prospect(svc, org_id, pipeline.id)

        pipelines = await svc.list_pipelines(org_id)
        found = next(p for p in pipelines if p.id == pipeline.id)
        assert found.prospect_count == 3

        # The full `prospects` relationship must not have been materialized
        # -- that was the point of the fix (CLAUDE.md-style abuse-resistance,
        # same class as the already-flagged MP-10).
        state = sa_inspect(found)
        assert "prospects" in state.unloaded

    async def test_prospect_count_is_zero_for_an_empty_pipeline(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, _ = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="Empty")

        pipelines = await svc.list_pipelines(org_id)
        found = next(p for p in pipelines if p.id == pipeline.id)
        assert found.prospect_count == 0
