"""A rolled-back election's filed result is superseded by a dated correction.

Owner decision 2026-11-01 (ELEC-49, ``docs/KNOWN_LIMITATIONS.md``): circulated
or adopted minutes are a record, so a rollback never edits or removes the
result filed there. It files a dated correction against it, and the re-run's
result, when the election closes again, is filed beside it as the result that
replaces it. Every copy shows both: the screen, the PDF, the library copy and
the public copy. A draft's own result is still content, and simply goes.
"""

from datetime import datetime, timezone
from typing import Any

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document
from app.models.election import Election, ElectionStatus
from app.models.event import Event, EventType
from app.models.minute import MeetingMinutes, MinutesElectionResult, MinutesPublicCopy
from app.models.user import Organization
from app.services.election_service import ElectionService
from app.services.minute_service import MinuteService
from app.services.minutes_election_filing import supersede_filed_results
from app.services.minutes_print_data import build_print_data
from tests.minutes_support import (
    _approve,
    _client,
    _closed_election,
    _create,
    _World,
    build_world,
)

pytestmark = [pytest.mark.integration]

REASON = "Two ballots were counted twice"


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


async def _event(w: _World) -> str:
    now = datetime.now(timezone.utc)
    event = Event(
        organization_id=w.org_id,
        title="November business meeting",
        event_type=EventType.BUSINESS_MEETING,
        start_datetime=now,
        end_datetime=now,
    )
    w.db.add(event)
    await w.db.flush()
    return event.id


async def _close(w: _World, election_id: str) -> None:
    closed, error = await ElectionService(w.db).close_election(
        election_id, w.org_id, closed_by=w.approver.id
    )
    assert error is None, error
    assert closed is not None


async def _roll_back(w: _World, election_id: str, reason: str = REASON) -> None:
    election, _sent, error = await ElectionService(w.db).rollback_election(
        election_id, w.org_id, w.approver.id, reason
    )
    assert error is None, error
    assert election is not None
    assert election.status == ElectionStatus.OPEN


async def _filed(w: _World, minutes_id: str) -> list[dict[str, Any]]:
    async with _client(w.db, w.secretary) as c:
        resp = await c.get(f"/minutes/{minutes_id}/election-results")
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _age(w: _World, minutes_id: str) -> None:
    """Move what is filed an hour into the past.

    The columns hold whole seconds, and a test rolls back and re-closes within
    one; real filings are minutes or days apart.
    """
    await w.db.execute(
        text(
            "UPDATE minutes_election_results SET "
            "created_at = created_at - INTERVAL 1 HOUR, "
            "superseded_at = superseded_at - INTERVAL 1 HOUR "
            "WHERE minutes_id = :id"
        ),
        {"id": minutes_id},
    )


async def _adopted_with_result(w: _World) -> tuple[str, str]:
    """Adopted minutes for a meeting, and an election there that closed after."""
    event_id = await _event(w)
    minutes = await _create(w, event_id=event_id)
    await _approve(w, minutes["id"])
    election = await _closed_election(w.db, w.org_id, closed=False, event_id=event_id)
    await _close(w, election.id)
    (row,) = await _filed(w, minutes["id"])
    assert row["is_addendum"] is True
    return minutes["id"], election.id


class TestCirculatedMinutes:
    async def test_a_rollback_files_a_dated_correction_and_keeps_the_result(
        self, world
    ):
        minutes_id, election_id = await _adopted_with_result(world)
        (before,) = await _filed(world, minutes_id)

        await _roll_back(world, election_id)

        (row,) = await _filed(world, minutes_id)
        assert row["id"] == before["id"]
        assert row["snapshot"] == before["snapshot"]
        assert row["superseded_at"] is not None
        assert row["superseded_reason"] == REASON
        assert row["superseded_by"] == str(world.approver.id)
        assert row["superseded_by_name"]

    async def test_the_re_run_files_its_result_beside_the_correction(self, world):
        minutes_id, election_id = await _adopted_with_result(world)
        await _roll_back(world, election_id)

        await _close(world, election_id)

        old, new = await _filed(world, minutes_id)
        assert old["superseded_at"] is not None
        assert new["superseded_at"] is None
        assert new["is_addendum"] is True
        assert new["replaces_superseded_at"] == old["superseded_at"]
        assert old["replaces_superseded_at"] is None

    async def test_each_rollback_corrects_only_the_result_standing_then(self, world):
        minutes_id, election_id = await _adopted_with_result(world)
        await _roll_back(world, election_id, "First rollback")
        await _age(world, minutes_id)
        await _close(world, election_id)

        await _roll_back(world, election_id, "Second rollback")
        await _age(world, minutes_id)
        await _close(world, election_id)

        one, two, three = await _filed(world, minutes_id)
        # The second rollback left the first correction as it was.
        assert one["superseded_at"] < two["superseded_at"]
        assert one["superseded_reason"] == "First rollback"
        assert two["superseded_reason"] == "Second rollback"
        assert two["replaces_superseded_at"] == one["superseded_at"]
        assert three["superseded_at"] is None
        assert three["replaces_superseded_at"] == two["superseded_at"]

    async def test_running_the_correction_twice_files_it_once(self, world):
        minutes_id, election_id = await _adopted_with_result(world)
        await _roll_back(world, election_id)
        (row,) = await _filed(world, minutes_id)
        election = await world.db.get(Election, election_id)
        assert election is not None

        corrected = await supersede_filed_results(
            world.db,
            election,
            str(world.secretary.id),
            "A retried rollback",
            datetime(2030, 1, 1, tzinfo=timezone.utc),
        )
        await world.db.commit()

        assert corrected == []
        (again,) = await _filed(world, minutes_id)
        assert again["superseded_at"] == row["superseded_at"]
        assert again["superseded_reason"] == REASON
        assert again["superseded_by"] == str(world.approver.id)

    async def test_the_adopted_version_still_verifies(self, world):
        minutes_id, election_id = await _adopted_with_result(world)

        await _roll_back(world, election_id)
        await _close(world, election_id)

        async with _client(world.db, world.secretary) as c:
            verify = await c.get(f"/minutes/{minutes_id}/verify")
        assert verify.status_code == 200, verify.text
        assert verify.json()["verified"] is True

    async def test_a_result_adopted_with_the_minutes_is_superseded_not_removed(
        self, world
    ):
        event_id = await _event(world)
        minutes = await _create(world, event_id=event_id)
        election = await _closed_election(
            world.db, world.org_id, closed=False, event_id=event_id
        )
        await _close(world, election.id)
        await _approve(world, minutes["id"])

        await _roll_back(world, election.id)

        (row,) = await _filed(world, minutes["id"])
        assert row["is_addendum"] is False
        assert row["superseded_at"] is not None

    async def test_a_superseded_result_can_be_followed_by_a_manual_import(self, world):
        await world.db.execute(
            update(Organization)
            .where(Organization.id == world.org_id)
            .values(settings={"minutes": {"auto_file_election_results": False}})
        )
        event_id = await _event(world)
        minutes = await _create(world, event_id=event_id)
        await _approve(world, minutes["id"])
        election = await _closed_election(
            world.db, world.org_id, closed=False, event_id=event_id
        )
        await _close(world, election.id)
        async with _client(world.db, world.secretary) as c:
            first = await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": election.id},
            )
        assert first.status_code == 201, first.text
        await _roll_back(world, election.id)
        await _close(world, election.id)

        async with _client(world.db, world.secretary) as c:
            offered = (
                await c.get(f"/minutes/{minutes['id']}/importable-elections")
            ).json()
            again = await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": election.id},
            )
            twice = await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": election.id},
            )

        (entry,) = [e for e in offered if e["id"] == election.id]
        assert entry["already_imported"] is False
        assert again.status_code == 201, again.text
        assert twice.status_code == 400
        assert len(await _filed(world, minutes["id"])) == 2


class TestDraftMinutes:
    async def test_a_drafts_result_is_removed_and_the_re_run_filed_in_its_place(
        self, world
    ):
        event_id = await _event(world)
        minutes = await _create(world, event_id=event_id)
        election = await _closed_election(
            world.db, world.org_id, closed=False, event_id=event_id
        )
        await _close(world, election.id)
        (old,) = await _filed(world, minutes["id"])

        await _roll_back(world, election.id)
        assert await _filed(world, minutes["id"]) == []

        await _close(world, election.id)
        (new,) = await _filed(world, minutes["id"])
        assert new["id"] != old["id"]
        assert new["is_addendum"] is False
        assert new["superseded_at"] is None
        assert new["replaces_superseded_at"] is None


class TestRollingBackAnOpenElection:
    async def test_it_leaves_a_result_already_superseded_alone(self, world):
        minutes_id, election_id = await _adopted_with_result(world)
        await _roll_back(world, election_id)
        (row,) = await _filed(world, minutes_id)

        election, _sent, error = await ElectionService(world.db).rollback_election(
            election_id, world.org_id, world.secretary.id, "Back to draft"
        )

        assert error is None, error
        assert election is not None
        assert election.status == ElectionStatus.DRAFT
        assert await _filed(world, minutes_id) == [row]


class TestEveryCopyShowsTheCorrection:
    async def test_the_printed_copy_carries_the_correction(self, world):
        minutes_id, election_id = await _adopted_with_result(world)
        await _roll_back(world, election_id)
        await _close(world, election_id)

        async with _client(world.db, world.secretary) as c:
            resp = await c.get(f"/minutes/{minutes_id}/pdf")
        assert resp.status_code == 200, resp.text

        minutes = await MinuteService(world.db).get_minutes(minutes_id, world.org_id)
        assert minutes is not None
        printed = await build_print_data(
            world.db, minutes, world.org_id, restricted=False
        )
        old, new = printed.data["election_results"]
        assert old["superseded_display"]
        assert old["superseded_reason"] == REASON
        assert new["superseded_display"] is None
        assert new["replaces_display"] == old["superseded_display"]

    async def test_standing_published_copies_are_refreshed_in_place(self, world):
        await world.db.execute(
            update(Organization)
            .where(Organization.id == world.org_id)
            .values(settings={"minutes": {"public_posting": True}})
        )
        minutes_id, election_id = await _adopted_with_result(world)
        async with _client(world.db, world.secretary) as c:
            published = await c.post(f"/minutes/{minutes_id}/publish")
        assert published.status_code == 200, published.text
        minutes = await world.db.get(MeetingMinutes, minutes_id)
        assert minutes is not None
        document_id = minutes.published_document_id
        version, published_at = (
            minutes.published_revision_version,
            minutes.published_at,
        )

        await _roll_back(world, election_id)

        document = (
            await world.db.execute(
                select(Document)
                .where(Document.id == document_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert "Correction filed" in document.content_html
        assert REASON in document.content_html
        assert "minutes-replacement-note" not in document.content_html
        copy = (
            await world.db.execute(
                select(MinutesPublicCopy)
                .where(MinutesPublicCopy.minutes_id == minutes_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        (entry,) = copy.content["election_results"]
        assert entry["superseded_on"]
        assert REASON not in str(copy.content)
        await world.db.refresh(minutes)
        assert minutes.published_revision_version == version
        assert minutes.published_at == published_at

        await _close(world, election_id)

        await world.db.refresh(document)
        assert "Corrected result: replaces the result superseded on" in (
            document.content_html
        )

    async def test_a_withdrawn_public_copy_is_left_withdrawn(self, world):
        await world.db.execute(
            update(Organization)
            .where(Organization.id == world.org_id)
            .values(settings={"minutes": {"public_posting": True}})
        )
        minutes_id, election_id = await _adopted_with_result(world)
        async with _client(world.db, world.secretary) as c:
            assert (await c.post(f"/minutes/{minutes_id}/publish")).status_code == 200
            withdrawn = await c.delete(f"/minutes/{minutes_id}/public-posting")
        assert withdrawn.status_code in (200, 204), withdrawn.text
        copy = (
            await world.db.execute(
                select(MinutesPublicCopy).where(
                    MinutesPublicCopy.minutes_id == minutes_id
                )
            )
        ).scalar_one()
        content = copy.content

        await _roll_back(world, election_id)

        await world.db.refresh(copy)
        assert copy.withdrawn_at is not None
        assert copy.content == content


async def test_the_rollback_is_one_transaction_with_its_correction(world):
    """A rollback refused for its own reasons files no correction."""
    minutes_id, election_id = await _adopted_with_result(world)
    await world.db.execute(
        update(MinutesElectionResult)
        .where(MinutesElectionResult.minutes_id == minutes_id)
        .values(created_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    )
    await world.db.execute(
        update(Election)
        .where(Election.id == election_id)
        .values(status=ElectionStatus.CANCELLED)
    )

    _election, _sent, error = await ElectionService(world.db).rollback_election(
        election_id, world.org_id, world.approver.id, REASON
    )

    assert error is not None
    (row,) = await _filed(world, minutes_id)
    assert row["superseded_at"] is None
