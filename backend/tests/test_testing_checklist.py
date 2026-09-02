"""Tests for the shared page-testing run behind /testing.

Two things matter here and are easy to get wrong: a tester may only ever write
their own row (otherwise one account's observation silently replaces
another's), and reading every tester's marks is what the IT manager's grant
buys — nobody else.
"""

import uuid

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.testing_checklist import (
    _serialize,
    clear_checklist,
    list_checklist,
    upsert_entry,
)
from app.models.testing_checklist import TestingCheckStatus as CheckStatus
from app.models.user import Organization, User

# Aliased on import: pytest tries to collect any class named Test* and warns
# that it cannot, which is noise on every run of this file.
from app.schemas.testing_checklist import TestingCheckUpsert as CheckUpsert
from app.services.testing_checklist_service import (
    MAX_ENTRIES_PER_USER,
)
from app.services.testing_checklist_service import (
    TestingChecklistService as ChecklistService,
)

pytestmark = pytest.mark.integration


async def _make_org(db, label="Testing FD"):
    org = Organization(name=label, slug=f"testing-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_user(db, org, first="Fire", last="Fighter"):
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"tester-{suffix}",
        email=f"tester-{suffix}@example.org",
        first_name=first,
        last_name=last,
    )
    db.add(user)
    await db.flush()
    return user


def _upsert(path="/events", status=CheckStatus.PASS, note=None, params=None):
    return CheckUpsert(route_path=path, status=status, note=note, params=params)


class TestTestingChecklistService:
    async def test_records_a_finding(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        service = ChecklistService(db_session)

        entry = await service.upsert_entry(
            org.id, user, _upsert(note="roster column empty")
        )

        assert entry.status == CheckStatus.PASS
        assert entry.note == "roster column empty"
        assert entry.checked_at is not None

    async def test_re_marking_replaces_rather_than_duplicates(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        service = ChecklistService(db_session)

        await service.upsert_entry(org.id, user, _upsert(status=CheckStatus.FAIL))
        await service.upsert_entry(org.id, user, _upsert(status=CheckStatus.PASS))

        entries = await service.list_entries(org.id, str(user.id))
        assert len(entries) == 1
        assert entries[0].status == CheckStatus.PASS

    async def test_clearing_a_mark_drops_the_timestamp(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        service = ChecklistService(db_session)

        await service.upsert_entry(org.id, user, _upsert())
        entry = await service.upsert_entry(
            org.id, user, _upsert(status=CheckStatus.UNTESTED)
        )

        assert entry.checked_at is None

    async def test_an_emptied_note_persists_as_empty(self, db_session):
        # The update path sends every field every time, so a cleared note has
        # to reach the column — otherwise a correction can never be saved.
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        service = ChecklistService(db_session)

        await service.upsert_entry(org.id, user, _upsert(note="wrong first time"))
        entry = await service.upsert_entry(org.id, user, _upsert(note=None))

        assert entry.note is None

    async def test_two_testers_are_two_observations(self, db_session):
        org = await _make_org(db_session)
        firefighter = await _make_user(db_session, org, "Fire", "Fighter")
        chief = await _make_user(db_session, org, "The", "Chief")
        service = ChecklistService(db_session)

        await service.upsert_entry(
            org.id, firefighter, _upsert(status=CheckStatus.BLOCKED)
        )
        await service.upsert_entry(org.id, chief, _upsert(status=CheckStatus.PASS))

        mine = await service.list_entries(org.id, str(firefighter.id))
        assert [entry.status for entry in mine] == [CheckStatus.BLOCKED]

        everyone = await service.list_entries(
            org.id, str(firefighter.id), include_all_testers=True
        )
        assert len(everyone) == 2

    async def test_a_mark_survives_its_author_being_deleted(self, db_session):
        """testing_checklist_entries.user_id is ON DELETE SET NULL and the row
        is kept on purpose: an archived run is the record of what was found
        then, so hard-deleting a member must not rewrite it. The response
        schema declared user_id required, so one such row raised a Pydantic
        ValidationError and 500'd the shared run for the whole department."""
        org = await _make_org(db_session)
        author = await _make_user(db_session, org)
        viewer = await _make_user(db_session, org, first="Ivy", last="Ross")
        service = ChecklistService(db_session)
        entry = await service.upsert_entry(org.id, author, _upsert())

        # What ON DELETE SET NULL leaves behind.
        entry.user_id = None
        await db_session.flush()

        names = await service.resolve_tester_names(org.id, [entry])
        rendered = _serialize(entry, names, str(viewer.id))

        assert rendered.user_id is None
        assert rendered.user_name is None
        # Nobody's mark, not everybody's.
        assert rendered.is_mine is False

    async def test_a_duplicate_insert_recovers_instead_of_500ing(self, db_session):
        """Two taps in quick succession on an unmarked page both read no row
        and both INSERT; the unique index refuses the second. The recovery
        exists so the tester sees their mark recorded rather than a failed
        save — but it dereferenced run.id AFTER db.rollback() had expired
        every instance in the transaction, which issues a lazy refresh from a
        sync context and raises MissingGreenlet. A recoverable duplicate
        became an unhandled 500.
        """
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        service = ChecklistService(db_session)
        await service.upsert_entry(org.id, user, _upsert(note="first"))

        # Force the losing-race shape: the pre-insert lookup misses once, so
        # the code inserts a row that already exists. The IntegrityError and
        # the rollback that follows are both real, which is what expires the
        # instances the recovery then has to read.
        real_find = service._find_entry
        calls = {"n": 0}

        async def find_once_missing(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                return None
            return await real_find(*args, **kwargs)

        service._find_entry = find_once_missing

        entry = await service.upsert_entry(org.id, user, _upsert(note="second"))

        assert entry is not None
        assert entry.note == "second"
        assert calls["n"] >= 2, "the recovery path did not run"

    async def test_never_reads_another_department(self, db_session):
        org_a = await _make_org(db_session, "A FD")
        org_b = await _make_org(db_session, "B FD")
        tester_a = await _make_user(db_session, org_a)
        tester_b = await _make_user(db_session, org_b)
        service = ChecklistService(db_session)

        await service.upsert_entry(org_a.id, tester_a, _upsert())
        await service.upsert_entry(org_b.id, tester_b, _upsert())

        everyone_in_a = await service.list_entries(
            org_a.id, str(tester_a.id), include_all_testers=True
        )
        assert {entry.organization_id for entry in everyone_in_a} == {org_a.id}

    async def test_resolves_tester_names(self, db_session):
        org = await _make_org(db_session)
        chief = await _make_user(db_session, org, "The", "Chief")
        service = ChecklistService(db_session)
        entry = await service.upsert_entry(org.id, chief, _upsert())

        names = await service.resolve_tester_names(org.id, [entry])

        assert names[str(chief.id)] == "The Chief"

    async def test_clear_run_removes_only_that_tester(self, db_session):
        org = await _make_org(db_session)
        firefighter = await _make_user(db_session, org)
        chief = await _make_user(db_session, org)
        service = ChecklistService(db_session)
        await service.upsert_entry(org.id, firefighter, _upsert())
        await service.upsert_entry(org.id, chief, _upsert())

        deleted = await service.clear_run(org.id, str(firefighter.id))

        assert deleted == 1
        remaining = await service.list_entries(
            org.id, str(chief.id), include_all_testers=True
        )
        assert len(remaining) == 1

    async def test_clear_run_can_remove_the_whole_department(self, db_session):
        org = await _make_org(db_session)
        firefighter = await _make_user(db_session, org)
        chief = await _make_user(db_session, org)
        service = ChecklistService(db_session)
        await service.upsert_entry(org.id, firefighter, _upsert())
        await service.upsert_entry(org.id, chief, _upsert())

        deleted = await service.clear_run(org.id, None)

        assert deleted == 2

    async def test_caps_the_rows_one_tester_can_create(self, db_session, monkeypatch):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        service = ChecklistService(db_session)
        monkeypatch.setattr(
            "app.services.testing_checklist_service.MAX_ENTRIES_PER_USER", 2
        )

        await service.upsert_entry(org.id, user, _upsert(path="/a"))
        await service.upsert_entry(org.id, user, _upsert(path="/b"))

        with pytest.raises(ValueError, match="maximum number of pages"):
            await service.upsert_entry(org.id, user, _upsert(path="/c"))

        # A page already on the run is still re-markable at the cap.
        assert await service.upsert_entry(org.id, user, _upsert(path="/a"))

    def test_the_cap_clears_the_route_table(self):
        # The frontend registry lists every declared route; the cap is a bound
        # on junk, not something a real run should ever reach.
        assert MAX_ENTRIES_PER_USER >= 500


class TestRoutePathValidation:
    @pytest.mark.parametrize(
        "path",
        ["/events/:id/edit", "/", "/training/skills-testing/print/scorecard"],
    )
    def test_accepts_route_patterns(self, path):
        assert CheckUpsert(route_path=path).route_path == path

    @pytest.mark.parametrize(
        "path",
        ["events", "https://evil.example/x", "/events?<script>", "/events;drop"],
    )
    def test_rejects_anything_that_is_not_one(self, path):
        with pytest.raises(ValueError, match="route pattern"):
            CheckUpsert(route_path=path)

    def test_drops_blank_parameter_values(self):
        payload = CheckUpsert(route_path="/events/:id", params={"id": "  "})
        assert payload.params is None

    def test_rejects_an_unreasonable_number_of_parameters(self):
        with pytest.raises(ValueError, match="route parameters"):
            CheckUpsert(
                route_path="/events/:id", params={f"p{n}": "x" for n in range(20)}
            )


class TestTestingChecklistEndpoints:
    async def test_reading_everyone_needs_the_grant(self, db_session, monkeypatch):
        org = await _make_org(db_session)
        member = await _make_user(db_session, org)
        monkeypatch.setattr(
            "app.api.v1.endpoints.testing_checklist.user_has_permission",
            lambda user, permission: False,
        )

        with pytest.raises(HTTPException) as exc:
            await list_checklist(
                include_all_testers=True, current_user=member, db=db_session
            )

        assert exc.value.status_code == 403

    async def test_the_it_manager_sees_every_tester(self, db_session, monkeypatch):
        org = await _make_org(db_session)
        firefighter = await _make_user(db_session, org, "Fire", "Fighter")
        it_manager = await _make_user(db_session, org, "IT", "Manager")
        service = ChecklistService(db_session)
        await service.upsert_entry(
            org.id, firefighter, _upsert(status=CheckStatus.FAIL)
        )
        monkeypatch.setattr(
            "app.api.v1.endpoints.testing_checklist.user_has_permission",
            lambda user, permission: True,
        )

        response = await list_checklist(
            include_all_testers=True,
            run_id=None,
            current_user=it_manager,
            db=db_session,
        )

        assert response.includes_all_testers is True
        assert response.tester_count == 1
        entry = response.entries[0]
        assert entry.user_name == "Fire Fighter"
        assert entry.is_mine is False

    async def test_a_member_sees_only_their_own_run(self, db_session, monkeypatch):
        org = await _make_org(db_session)
        firefighter = await _make_user(db_session, org)
        chief = await _make_user(db_session, org)
        service = ChecklistService(db_session)
        await service.upsert_entry(org.id, chief, _upsert())
        await service.upsert_entry(
            org.id, firefighter, _upsert(path="/training", status=CheckStatus.FAIL)
        )
        monkeypatch.setattr(
            "app.api.v1.endpoints.testing_checklist.user_has_permission",
            lambda user, permission: False,
        )

        # Every query parameter is passed explicitly: called directly rather
        # than through FastAPI, a parameter's default is the Query object
        # itself — which is truthy, and is not None.
        response = await list_checklist(
            include_all_testers=False,
            run_id=None,
            current_user=firefighter,
            db=db_session,
        )

        assert [entry.route_path for entry in response.entries] == ["/training"]
        assert response.entries[0].is_mine is True
        assert response.includes_all_testers is False

    async def test_writing_is_open_to_any_member(self, db_session, monkeypatch):
        # Deliberate: a gate is proved by testing from the account it refuses,
        # so the account it refuses has to be able to record the result.
        org = await _make_org(db_session)
        member = await _make_user(db_session, org)
        monkeypatch.setattr(
            "app.api.v1.endpoints.testing_checklist.user_has_permission",
            lambda user, permission: False,
        )

        entry = await upsert_entry(
            payload=_upsert(status=CheckStatus.BLOCKED),
            current_user=member,
            db=db_session,
        )

        assert entry.status == CheckStatus.BLOCKED
        assert entry.is_mine is True

    async def test_clearing_everyone_needs_the_grant(self, db_session, monkeypatch):
        org = await _make_org(db_session)
        member = await _make_user(db_session, org)
        monkeypatch.setattr(
            "app.api.v1.endpoints.testing_checklist.user_has_permission",
            lambda user, permission: False,
        )

        with pytest.raises(HTTPException) as exc:
            await clear_checklist(scope="all", current_user=member, db=db_session)

        assert exc.value.status_code == 403
