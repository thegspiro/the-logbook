"""History import against the database.

A roster file becomes a draft, rows are decided, and a commit writes records:
created, mapped to an account, or filled into an existing record without
overwriting it. Pinned beside that: a second commit is refused, unfamiliar
titles are answered once and remembered, "Remove this import's records" takes
back only what nobody has touched, abandoned drafts expire, and nothing reaches
across departments.
"""

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, text

from app.models.history import (
    DatePrecision,
    HistoricalMember,
    HistoryImport,
    HistoryImportRow,
    HistoryImportStatus,
    HistoryImportTitleMapping,
    HistoryTitle,
    PublicationLevel,
    RelationType,
)
from app.services.history_import_service import (
    HistoryImportService,
    ImportNotDraft,
    ImportNotFound,
    ImportNotReady,
)
from app.services.history_service import HistoryService
from tests.test_history_module import _org, _position, _user

pytestmark = pytest.mark.integration

HEADER = "Last Name,First Name,Badge Number,Joined,Left,Titles,Birth Date,Notes\n"


@pytest.fixture
async def dept(db_session):
    org_id = await _org(db_session)
    historian_pos = await _position(
        db_session,
        org_id,
        "Historian",
        ["history.view", "history.manage", "history.publish"],
        slug="historian",
    )
    historian = await _user(db_session, org_id, "Hannah", historian_pos)
    return org_id, str(historian.id)


async def _draft(db, dept, body: str) -> HistoryImport:
    org_id, actor = dept
    return await HistoryImportService(db).create_draft(
        org_id, actor, "roster.csv", HEADER + body
    )


async def _rows(db, draft) -> dict[int, HistoryImportRow]:
    return {r.line_number: r for r in await HistoryImportService(db).rows(draft)}


async def _decide(db, dept, draft, row, **values):
    org_id, _ = dept
    await HistoryImportService(db).update_row(org_id, draft.id, row.id, values)


async def _answer_titles(db, dept, draft, *choices):
    org_id, actor = dept
    await HistoryImportService(db).set_titles(org_id, draft.id, list(choices), actor)


async def _people(db, org_id) -> list[HistoricalMember]:
    result = await db.execute(
        select(HistoricalMember)
        .options(*HistoryService(db)._person_options())
        .where(HistoricalMember.organization_id == org_id)
        .order_by(HistoricalMember.last_name)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().unique().all())


class TestDraft:
    async def test_the_cells_are_stored_encrypted(self, db_session, dept):
        draft = await _draft(db_session, dept, "Smith,John,14,1951,,,1929-03-02,\n")
        raw = await db_session.execute(
            select(func.count())
            .select_from(HistoryImportRow)
            .where(HistoryImportRow.import_id == draft.id)
        )
        assert raw.scalar_one() == 1
        # Plain SQL, not the model: the model's column type would decrypt.
        stored = await db_session.scalar(
            text("SELECT cells FROM history_import_rows WHERE import_id = :id"),
            {"id": draft.id},
        )
        assert "1929-03-02" not in stored
        assert "Smith" not in stored

    async def test_an_existing_record_is_suggested(self, db_session, dept):
        org_id, actor = dept
        existing = await HistoryService(db_session).create_person(
            org_id,
            {"last_name": "Smith", "first_name": "John", "badge_number": "14"},
            actor,
        )
        draft = await _draft(db_session, dept, "Smith,J.,14,,,,,\n")
        detail = await HistoryImportService(db_session).detail(draft)
        (row,) = detail["rows"]
        assert row["suggestions"][0]["id"] == existing.id
        assert row["suggestions"][0]["strength"] == "strong"
        assert row["decision"] is None

    async def test_another_departments_draft_is_not_found(self, db_session, dept):
        draft = await _draft(db_session, dept, "Smith,John,,,,,,\n")
        other_org = await _org(db_session)
        with pytest.raises(ImportNotFound):
            await HistoryImportService(db_session).get_import(other_org, draft.id)

    async def test_a_decision_cannot_name_another_departments_record(
        self, db_session, dept
    ):
        other_org = await _org(db_session)
        other_pos = await _position(
            db_session, other_org, "Historian", ["history.manage"]
        )
        other_user = await _user(db_session, other_org, "Olga", other_pos)
        foreign = await HistoryService(db_session).create_person(
            other_org, {"last_name": "Smith"}, str(other_user.id)
        )
        draft = await _draft(db_session, dept, "Smith,John,,,,,,\n")
        rows = await _rows(db_session, draft)
        with pytest.raises(ValueError, match="history record to match"):
            await _decide(
                db_session,
                dept,
                draft,
                rows[2],
                decision="match",
                target_member_id=foreign.id,
            )
        with pytest.raises(ValueError, match="Member not found"):
            await _decide(
                db_session,
                dept,
                draft,
                rows[2],
                decision="map",
                target_user_id=str(other_user.id),
            )


class TestCommit:
    async def test_create_map_and_fill_an_existing_record(self, db_session, dept):
        org_id, actor = dept
        service = HistoryService(db_session)
        existing = await service.create_person(
            org_id,
            {"last_name": "Brown", "first_name": "Ann", "research_notes": "Mine"},
            actor,
        )
        account = await _user(db_session, org_id, "Carl")
        draft = await _draft(
            db_session,
            dept,
            "Adams,Abe,,c. 1923,1940,,,From the 1940 roster\n"
            "Brown,Ann,7,1950,1960,,1930-05,Overwritten?\n"
            "Tester,Carl,,1998,present,,,\n"
            "Doe,Dan,,,,,,\n",
        )
        rows = await _rows(db_session, draft)
        await _decide(db_session, dept, draft, rows[2], decision="create")
        await _decide(
            db_session,
            dept,
            draft,
            rows[3],
            decision="match",
            target_member_id=existing.id,
        )
        await _decide(
            db_session,
            dept,
            draft,
            rows[4],
            decision="map",
            target_user_id=str(account.id),
        )
        await _decide(db_session, dept, draft, rows[5], decision="skip")

        committed = await HistoryImportService(db_session).commit(
            org_id, draft.id, actor
        )
        assert committed.status == HistoryImportStatus.COMMITTED
        assert committed.summary == {
            "created": 1,
            "mapped": 1,
            "matched": 1,
            "repeats": 0,
            "skipped": 1,
        }
        people = {p.last_name: p for p in await _people(db_session, org_id)}
        assert set(people) == {"Adams", "Brown", "Tester"}

        adams = people["Adams"]
        assert adams.import_id == draft.id
        assert adams.publication_level == PublicationLevel.DRAFT
        assert adams.research_notes == "From the 1940 roster"
        (period,) = adams.service_periods
        assert period.start_date == date(1923, 1, 1)
        assert period.start_circa

        brown = people["Brown"]
        assert brown.research_notes == "Mine"  # filled only where empty
        assert brown.badge_number == "7"
        assert brown.birth_date == date(1930, 5, 1)
        assert brown.birth_date_precision == DatePrecision.MONTH
        assert brown.import_id is None
        assert brown.revision_number == 2

        tester = people["Tester"]
        assert tester.user_id == str(account.id)
        assert tester.service_periods[0].is_ongoing

        remaining = await db_session.scalar(
            select(func.count())
            .select_from(HistoryImportRow)
            .where(HistoryImportRow.import_id == draft.id)
        )
        assert remaining == 0

    async def test_a_second_commit_is_refused(self, db_session, dept):
        org_id, actor = dept
        draft = await _draft(db_session, dept, "Adams,Abe,,,,,,\n")
        await HistoryImportService(db_session).accept_suggestions(org_id, draft.id)
        service = HistoryImportService(db_session)
        await service.commit(org_id, draft.id, actor)
        with pytest.raises(ImportNotDraft):
            await service.commit(org_id, draft.id, actor)
        assert len(await _people(db_session, org_id)) == 1

    async def test_an_undecided_row_or_a_row_with_a_problem_blocks_the_commit(
        self, db_session, dept
    ):
        org_id, actor = dept
        draft = await _draft(db_session, dept, "Adams,Abe,,1960,1950,,,\n")
        service = HistoryImportService(db_session)
        with pytest.raises(ImportNotReady, match="still need a decision"):
            await service.commit(org_id, draft.id, actor)
        rows = await _rows(db_session, draft)
        await _decide(db_session, dept, draft, rows[2], decision="create")
        with pytest.raises(ImportNotReady, match="have a problem"):
            await service.commit(org_id, draft.id, actor)
        await _decide(db_session, dept, draft, rows[2], edits={"left": "1970"})
        await service.commit(org_id, draft.id, actor)

    async def test_a_repeat_adds_a_second_period_to_the_same_person(
        self, db_session, dept
    ):
        org_id, actor = dept
        draft = await _draft(
            db_session,
            dept,
            "Adams,Abe,,1950,1955,,,\nAdams,Abe,,1960,1970,,,\n",
        )
        service = HistoryImportService(db_session)
        assert await service.accept_suggestions(org_id, draft.id) == 2
        rows = await _rows(db_session, draft)
        assert rows[3].decision.value == "same_as"
        draft = await service.commit(org_id, draft.id, actor)
        assert draft.summary["repeats"] == 1
        (adams,) = await _people(db_session, org_id)
        assert sorted(p.start_date.year for p in adams.service_periods) == [1950, 1960]

    async def test_importing_the_same_period_twice_does_not_double_it(
        self, db_session, dept
    ):
        org_id, actor = dept
        first = await _draft(db_session, dept, "Adams,Abe,,1950,1955,,,\n")
        service = HistoryImportService(db_session)
        await service.accept_suggestions(org_id, first.id)
        await service.commit(org_id, first.id, actor)
        second = await _draft(db_session, dept, "Adams,Abe,,1950,1955,,,\n")
        await service.accept_suggestions(org_id, second.id)
        rows = await _rows(db_session, second)
        assert rows[2].decision.value == "match"
        await service.commit(org_id, second.id, actor)
        (adams,) = await _people(db_session, org_id)
        assert len(adams.service_periods) == 1

    async def test_an_account_that_gained_a_record_is_not_mapped_twice(
        self, db_session, dept
    ):
        org_id, actor = dept
        account = await _user(db_session, org_id, "Carl")
        draft = await _draft(db_session, dept, "Tester,Carl,,,,,,\n")
        rows = await _rows(db_session, draft)
        await _decide(
            db_session,
            dept,
            draft,
            rows[2],
            decision="map",
            target_user_id=str(account.id),
        )
        await HistoryService(db_session).create_from_member(
            org_id, str(account.id), actor
        )
        with pytest.raises(ImportNotReady, match="have a problem"):
            await HistoryImportService(db_session).commit(org_id, draft.id, actor)
        detail = await HistoryImportService(db_session).detail(draft)
        assert "now has a history record" in detail["rows"][0]["problems"][0]


class TestTitles:
    async def test_an_unfamiliar_title_must_be_answered_and_is_remembered(
        self, db_session, dept
    ):
        org_id, actor = dept
        service = HistoryImportService(db_session)
        first = await _draft(db_session, dept, "Adams,Abe,,1950,,Hose Man; Chief,,\n")
        await service.accept_suggestions(org_id, first.id)
        detail = await service.detail(first)
        unresolved = {
            t["text"] for t in detail["titles"] if t["status"] == "unresolved"
        }
        assert unresolved == {"Hose Man", "Chief"}
        with pytest.raises(ImportNotReady, match="title"):
            await service.commit(org_id, first.id, actor)

        chief = await HistoryService(db_session).create_title(
            org_id, "Fire Chief", actor
        )
        await _answer_titles(
            db_session,
            dept,
            first,
            {"text": "Hose Man", "action": "create"},
            {"text": "Chief", "action": "map", "title_id": chief.id},
        )
        await service.commit(org_id, first.id, actor)
        (adams,) = await _people(db_session, org_id)
        held = sorted(t.title.name for t in adams.service_periods[0].titles)
        assert held == ["Fire Chief", "Hose Man"]
        created = await db_session.scalar(
            select(HistoryImportTitleMapping).where(
                HistoryImportTitleMapping.organization_id == org_id,
                HistoryImportTitleMapping.source_key == "hose man",
            )
        )
        assert created.action.value == "map"

        second = await _draft(db_session, dept, "Baker,Bea,,1960,,chief; HOSE MAN,,\n")
        detail = await service.detail(second)
        assert all(t["status"] != "unresolved" for t in detail["titles"])

    async def test_a_title_merge_carries_the_remembered_answer(self, db_session, dept):
        org_id, actor = dept
        history = HistoryService(db_session)
        old = await history.create_title(org_id, "Lt.", actor)
        new = await history.create_title(org_id, "Lieutenant", actor)
        draft = await _draft(db_session, dept, "Adams,Abe,,1950,,Lieut,,\n")
        await _answer_titles(
            db_session,
            dept,
            draft,
            {"text": "Lieut", "action": "map", "title_id": old.id},
        )
        await history.merge_title(old, new)
        mapping = await db_session.scalar(
            select(HistoryImportTitleMapping).where(
                HistoryImportTitleMapping.organization_id == org_id,
                HistoryImportTitleMapping.source_key == "lieut",
            )
        )
        assert mapping.title_id == new.id


class TestRemoveRecords:
    async def test_only_untouched_drafts_are_removed(self, db_session, dept):
        org_id, actor = dept
        draft = await _draft(
            db_session,
            dept,
            "Adams,Abe,,,,,,\nBaker,Bea,,,,,,\nCole,Cy,,,,,,\nDunn,Di,,,,,,\n",
        )
        service = HistoryImportService(db_session)
        await service.accept_suggestions(org_id, draft.id)
        await service.commit(org_id, draft.id, actor)
        people = {p.last_name: p for p in await _people(db_session, org_id)}
        history = HistoryService(db_session)
        await history.update_person(
            people["Baker"],
            {"nickname": "B"},
            edit_kind="minor",
            edit_note=None,
            actor_id=actor,
        )
        await history.publish(people["Cole"], PublicationLevel.MEMBERS, actor)
        await history.add_relation(
            people["Dunn"], people["Adams"].id, RelationType.SIBLING, None, actor
        )
        result = await service.remove_records(org_id, draft.id)
        assert result["removed"] == 0
        assert {k["display_name"]: k["reason"] for k in result["kept"]} == {
            "Abe Adams": "Linked to family",
            'Bea "B" Baker': "Edited since the import",
            "Cy Cole": "Published",
            "Di Dunn": "Linked to family",
        }

    async def test_untouched_records_go_and_matched_ones_stay(self, db_session, dept):
        org_id, actor = dept
        existing = await HistoryService(db_session).create_person(
            org_id, {"last_name": "Brown", "first_name": "Ann"}, actor
        )
        draft = await _draft(db_session, dept, "Adams,Abe,,,,,,\nBrown,Ann,,1950,,,,\n")
        service = HistoryImportService(db_session)
        await service.accept_suggestions(org_id, draft.id)
        await service.commit(org_id, draft.id, actor)
        result = await service.remove_records(org_id, draft.id)
        assert result == {"removed": 1, "kept": []}
        remaining = await _people(db_session, org_id)
        assert [p.id for p in remaining] == [existing.id]
        assert len(remaining[0].service_periods) == 1
        draft = await service.get_import(org_id, draft.id)
        assert draft.summary["removed"] == 1


class TestExpiry:
    async def test_an_abandoned_draft_expires_and_a_second_run_finds_nothing(
        self, db_session, dept
    ):
        org_id, _ = dept
        draft = await _draft(db_session, dept, "Adams,Abe,,,,,,\n")
        fresh = await _draft(db_session, dept, "Baker,Bea,,,,,,\n")
        draft.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        await db_session.flush()
        service = HistoryImportService(db_session)
        assert await service.expire_drafts(org_id) == 1
        assert await service.expire_drafts(org_id) == 0
        expired = await service.get_import(org_id, draft.id)
        assert expired.status == HistoryImportStatus.EXPIRED
        assert await service.rows(expired) == []
        assert len(await service.rows(fresh)) == 1

    async def test_working_on_a_draft_pushes_its_expiry_back(self, db_session, dept):
        org_id, _ = dept
        draft = await _draft(db_session, dept, "Adams,Abe,,,,,,\n")
        draft.expires_at = datetime.now(timezone.utc) + timedelta(days=1)
        await db_session.flush()
        await HistoryImportService(db_session).accept_suggestions(org_id, draft.id)
        draft = await HistoryImportService(db_session).get_import(org_id, draft.id)
        assert draft.expires_at.replace(tzinfo=timezone.utc) > datetime.now(
            timezone.utc
        ) + timedelta(days=29)


class TestNothingIsSkippedQuietly:
    async def test_a_title_already_on_the_list_needs_no_answer(self, db_session, dept):
        org_id, actor = dept
        await HistoryService(db_session).create_title(org_id, "Engineer", actor)
        draft = await _draft(db_session, dept, "Adams,Abe,,1950,,engineer,,\n")
        detail = await HistoryImportService(db_session).detail(draft)
        assert [t["status"] for t in detail["titles"]] == ["known"]
        title = await db_session.scalar(
            select(HistoryTitle).where(
                HistoryTitle.organization_id == org_id, HistoryTitle.name == "Engineer"
            )
        )
        assert detail["titles"][0]["title_id"] == title.id
