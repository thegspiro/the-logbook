"""Review, suggestions, adoption, addenda, closed sessions, ballots and outlines.

The second half of minutes record keeping, driven over HTTP against the real
schema for the same reason as the first: the rules are about who may see and
change what at which status, and a mocked session evaluates none of them.
"""

import uuid
from datetime import date, datetime, timezone
from typing import Any, Optional
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting import Meeting, MeetingStatus, MeetingType
from tests.minutes_support import (
    _approve,
    _client,
    _closed_election,
    _create,
    _fill_required_sections,
    _user,
    _World,
    build_world,
)

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


async def _circulate(w: _World, minutes_id: str) -> None:
    await _fill_required_sections(w, minutes_id)
    async with _client(w.db, w.secretary) as c:
        resp = await c.post(f"/minutes/{minutes_id}/submit")
    assert resp.status_code == 200, resp.text


async def _adopt(
    w: _World, minutes_id: str, body: Optional[dict[str, Any]] = None
) -> dict[str, Any]:
    async with _client(w.db, w.approver) as c:
        resp = (
            await c.post(f"/minutes/{minutes_id}/approve", json=body)
            if body is not None
            else await c.post(f"/minutes/{minutes_id}/approve")
        )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── Circulation email ────────────────────────────────────────────────


class TestCirculationEmail:
    @pytest.fixture
    def mailer(self, monkeypatch):
        sender = MagicMock()
        sender.send_email = AsyncMock(return_value=(1, 0))
        monkeypatch.setattr(
            "app.services.minutes_notifications.EmailService", lambda: sender
        )
        return sender

    @staticmethod
    def circulation_mails(mailer):
        return [
            c
            for c in mailer.send_email.await_args_list
            if c.kwargs["template_type"] == "minutes_circulated"
        ]

    async def test_members_are_told_but_the_circulating_officer_is_not(
        self, world: _World, mailer
    ):
        minutes = await _create(world)
        await _circulate(world, minutes["id"])

        recipients = {c.kwargs["to_emails"][0] for c in self.circulation_mails(mailer)}
        assert world.member.email in recipients
        assert world.approver.email in recipients
        assert world.secretary.email not in recipients
        assert world.outsider.email not in recipients
        body = self.circulation_mails(mailer)[0].kwargs["html_body"]
        assert f"/minutes/{minutes['id']}" in body

    async def test_a_draft_sends_nothing(self, world: _World, mailer):
        await _create(world)
        assert self.circulation_mails(mailer) == []

    async def test_a_member_who_opted_out_is_not_emailed_and_can_still_read_them(
        self, world: _World, mailer
    ):
        quiet = await _user(
            world.db,
            world.org_id,
            "Quiet",
            ["minutes.view"],
            preferences='{"email_kinds": {"minutes_circulated": false}}',
        )
        minutes = await _create(world)
        await _circulate(world, minutes["id"])

        recipients = {c.kwargs["to_emails"][0] for c in self.circulation_mails(mailer)}
        assert quiet.email not in recipients
        async with _client(world.db, quiet) as c:
            assert (await c.get(f"/minutes/{minutes['id']}")).status_code == 200

    async def test_executive_session_minutes_are_never_announced(
        self, world: _World, mailer
    ):
        minutes = await _create(world, meeting_type="executive")
        await _circulate(world, minutes["id"])
        assert self.circulation_mails(mailer) == []

    async def test_a_mail_failure_does_not_fail_circulation(
        self, world: _World, mailer
    ):
        mailer.send_email.side_effect = RuntimeError("smtp down")
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        async with _client(world.db, world.secretary) as c:
            assert (await c.get(f"/minutes/{minutes['id']}")).json()[
                "status"
            ] == "submitted"

    async def test_the_title_is_escaped_in_the_email(self, world: _World, mailer):
        minutes = await _create(world, title="<script>x</script>")
        await _circulate(world, minutes["id"])
        body = self.circulation_mails(mailer)[0].kwargs["html_body"]
        assert "<script>x</script>" not in body
        assert "&lt;script&gt;" in body


# ── Review: what members see, and suggestions ────────────────────────


class TestCirculation:
    async def test_a_draft_is_hidden_from_members_until_it_is_circulated(
        self, world: _World
    ):
        minutes = await _create(world)
        async with _client(world.db, world.member) as c:
            assert (await c.get(f"/minutes/{minutes['id']}")).status_code == 404
            assert (await c.get("/minutes")).json() == []
        await _circulate(world, minutes["id"])
        async with _client(world.db, world.member) as c:
            seen = await c.get(f"/minutes/{minutes['id']}")
            listed = (await c.get("/minutes")).json()
        assert seen.status_code == 200
        assert seen.json()["status"] == "submitted"
        assert [m["id"] for m in listed] == [minutes["id"]]

    async def test_executive_minutes_are_never_circulated_to_members(
        self, world: _World
    ):
        minutes = await _create(world, meeting_type="executive")
        await _circulate(world, minutes["id"])
        async with _client(world.db, world.member) as c:
            assert (await c.get(f"/minutes/{minutes['id']}")).status_code == 404
            assert (await c.get("/minutes")).json() == []

    async def test_another_department_sees_nothing_of_it(self, world: _World):
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        async with _client(world.db, world.outsider) as c:
            assert (await c.get(f"/minutes/{minutes['id']}")).status_code == 404

    async def test_items_in_circulated_minutes_are_not_yet_commitments(
        self, world: _World
    ):
        minutes = await _create(
            world,
            items=[{"description": "Mine", "assignee_id": str(world.assignee.id)}],
        )
        await _circulate(world, minutes["id"])
        async with _client(world.db, world.assignee) as c:
            assert (await c.get("/minutes/action-items/mine")).json() == []
            stats = (await c.get("/minutes/stats")).json()
        assert stats["open_action_items"] == 0


class TestSuggestions:
    async def _circulated(self, world: _World, **extra: Any) -> dict[str, Any]:
        minutes = await _create(world, **extra)
        await _circulate(world, minutes["id"])
        return minutes

    async def test_a_member_suggests_a_change_to_a_section(self, world: _World):
        minutes = await self._circulated(world)
        async with _client(world.db, world.member) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/suggestions",
                json={
                    "section_key": "new_business",
                    "comment": "The hose vote was 5-1, not 6-0",
                    "proposed_text": "Motion carried 5-1.",
                },
            )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == "open"
        assert body["section_key"] == "new_business"
        assert "Member" in body["created_by_name"]

    async def test_a_suggestion_about_a_missing_section_is_refused(self, world: _World):
        minutes = await self._circulated(world)
        async with _client(world.db, world.member) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/suggestions",
                json={"section_key": "nope", "comment": "Something wrong here"},
            )
        assert resp.status_code == 400

    @pytest.mark.parametrize("comment", ["", "  ", "ab"])
    async def test_a_blank_comment_is_refused(self, world: _World, comment: str):
        minutes = await self._circulated(world)
        async with _client(world.db, world.member) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/suggestions", json={"comment": comment}
            )
        assert resp.status_code == 422

    async def test_suggestions_close_when_the_minutes_are_not_circulating(
        self, world: _World
    ):
        draft = await _create(world)
        async with _client(world.db, world.secretary) as c:
            on_draft = await c.post(
                f"/minutes/{draft['id']}/suggestions", json={"comment": "Fix this"}
            )
        assert on_draft.status_code == 400

        adopted = await self._circulated(world, title="Adopted")
        await _adopt(world, adopted["id"])
        async with _client(world.db, world.member) as c:
            on_adopted = await c.post(
                f"/minutes/{adopted['id']}/suggestions", json={"comment": "Too late"}
            )
        assert on_adopted.status_code == 400

    async def test_a_member_cannot_suggest_on_minutes_they_cannot_see(
        self, world: _World
    ):
        executive = await self._circulated(world, meeting_type="executive")
        async with _client(world.db, world.member) as c:
            resp = await c.post(
                f"/minutes/{executive['id']}/suggestions", json={"comment": "Peeking"}
            )
        assert resp.status_code == 404

    async def test_a_member_sees_only_their_own_a_manager_sees_all(self, world: _World):
        minutes = await self._circulated(world)
        url = f"/minutes/{minutes['id']}/suggestions"
        async with _client(world.db, world.member) as c:
            await c.post(url, json={"comment": "From the member"})
        async with _client(world.db, world.assignee) as c:
            await c.post(url, json={"comment": "From the assignee"})
            mine = (await c.get(url)).json()
        async with _client(world.db, world.secretary) as c:
            everything = (await c.get(url)).json()
        assert [s["comment"] for s in mine] == ["From the assignee"]
        assert sorted(s["comment"] for s in everything) == [
            "From the assignee",
            "From the member",
        ]

    async def test_only_a_manager_answers_and_the_answer_is_recorded(
        self, world: _World
    ):
        minutes = await self._circulated(world)
        url = f"/minutes/{minutes['id']}/suggestions"
        async with _client(world.db, world.member) as c:
            suggestion = (await c.post(url, json={"comment": "Please fix"})).json()
            forbidden = await c.put(
                f"{url}/{suggestion['id']}", json={"status": "accepted"}
            )
        assert forbidden.status_code == 403
        async with _client(world.db, world.secretary) as c:
            answered = await c.put(
                f"{url}/{suggestion['id']}",
                json={"status": "accepted", "note": "Will correct"},
            )
        body = answered.json()
        assert body["status"] == "accepted"
        assert body["resolution_note"] == "Will correct"
        assert "Secretary" in body["resolved_by_name"]
        assert body["resolved_at"] is not None

    async def test_an_answer_must_be_accepted_or_declined(self, world: _World):
        minutes = await self._circulated(world)
        url = f"/minutes/{minutes['id']}/suggestions"
        async with _client(world.db, world.member) as c:
            suggestion = (await c.post(url, json={"comment": "Please fix"})).json()
        async with _client(world.db, world.secretary) as c:
            resp = await c.put(f"{url}/{suggestion['id']}", json={"status": "open"})
        assert resp.status_code == 422

    async def test_a_suggestion_cannot_be_answered_after_adoption(self, world: _World):
        minutes = await self._circulated(world)
        url = f"/minutes/{minutes['id']}/suggestions"
        async with _client(world.db, world.member) as c:
            suggestion = (await c.post(url, json={"comment": "Please fix"})).json()
        await _adopt(world, minutes["id"])
        async with _client(world.db, world.secretary) as c:
            resp = await c.put(f"{url}/{suggestion['id']}", json={"status": "declined"})
        assert resp.status_code == 400

    async def test_another_departments_manager_cannot_answer(self, world: _World):
        minutes = await self._circulated(world)
        url = f"/minutes/{minutes['id']}/suggestions"
        async with _client(world.db, world.member) as c:
            suggestion = (await c.post(url, json={"comment": "Please fix"})).json()
        async with _client(world.db, world.outsider) as c:
            resp = await c.put(f"{url}/{suggestion['id']}", json={"status": "declined"})
        assert resp.status_code == 404


class TestRecall:
    async def test_recall_returns_circulated_minutes_to_draft_and_hides_them(
        self, world: _World
    ):
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        url = f"/minutes/{minutes['id']}"
        async with _client(world.db, world.member) as c:
            await c.post(f"{url}/suggestions", json={"comment": "Please fix"})
        async with _client(world.db, world.secretary) as c:
            recalled = await c.post(f"{url}/recall")
            edit = await c.put(url, json={"location": "Hall"})
            kept = (await c.get(f"{url}/suggestions")).json()
        assert recalled.status_code == 200, recalled.text
        assert recalled.json()["status"] == "draft"
        assert recalled.json()["submitted_by"] is None
        assert edit.status_code == 200
        assert len(kept) == 1
        async with _client(world.db, world.member) as c:
            assert (await c.get(url)).status_code == 404

    async def test_only_circulated_minutes_can_be_recalled(self, world: _World):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            assert (await c.post(f"/minutes/{minutes['id']}/recall")).status_code == 400
        await _approve(world, minutes["id"])
        async with _client(world.db, world.secretary) as c:
            assert (await c.post(f"/minutes/{minutes['id']}/recall")).status_code == 400

    async def test_a_member_cannot_recall(self, world: _World):
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        async with _client(world.db, world.member) as c:
            assert (await c.post(f"/minutes/{minutes['id']}/recall")).status_code == 403


class TestRequiredSections:
    async def test_minutes_cannot_circulate_with_a_required_section_empty(
        self, world: _World
    ):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(f"/minutes/{minutes['id']}/submit")
        assert resp.status_code == 400
        assert "Call to Order" in resp.json()["detail"]
        assert "Adjournment" in resp.json()["detail"]

    async def test_a_recorded_roll_satisfies_the_roll_call_section(self, world: _World):
        minutes = await _create(world)
        assert minutes["attendees"]
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(f"/minutes/{minutes['id']}/submit")
        assert "Roll Call" not in resp.json()["detail"]

    async def test_filling_them_in_lets_the_minutes_circulate(self, world: _World):
        minutes = await _create(world)
        await _circulate(world, minutes["id"])

    async def test_sections_without_the_flag_never_block(self, world: _World):
        minutes = await _create(
            world,
            sections=[{"order": 0, "key": "notes", "title": "Notes", "content": ""}],
        )
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(f"/minutes/{minutes['id']}/submit")
        assert resp.status_code == 200


# ── Adoption ─────────────────────────────────────────────────────────


class TestAdoption:
    async def test_adopting_with_no_body_dates_the_vote_now_as_presented(
        self, world: _World
    ):
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        adopted = await _adopt(world, minutes["id"])
        assert adopted["status"] == "approved"
        assert adopted["adopted_on"] is not None
        assert adopted["adopted_as_amended"] is False
        assert adopted["adopting_minutes_id"] is None

    async def test_an_accepted_suggestion_makes_the_adoption_as_amended(
        self, world: _World
    ):
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        url = f"/minutes/{minutes['id']}/suggestions"
        async with _client(world.db, world.member) as c:
            suggestion = (await c.post(url, json={"comment": "Please fix"})).json()
        async with _client(world.db, world.secretary) as c:
            await c.put(f"{url}/{suggestion['id']}", json={"status": "accepted"})
        assert (await _adopt(world, minutes["id"]))["adopted_as_amended"] is True

    async def test_a_declined_suggestion_leaves_it_as_presented(self, world: _World):
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        url = f"/minutes/{minutes['id']}/suggestions"
        async with _client(world.db, world.member) as c:
            suggestion = (await c.post(url, json={"comment": "Please fix"})).json()
        async with _client(world.db, world.secretary) as c:
            await c.put(f"{url}/{suggestion['id']}", json={"status": "declined"})
        assert (await _adopt(world, minutes["id"]))["adopted_as_amended"] is False

    async def test_the_adopter_can_override_and_name_the_meeting(self, world: _World):
        adopting = await _create(world, title="November business meeting")
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        adopted = await _adopt(
            world,
            minutes["id"],
            {
                "adopted_on": "2026-11-05T01:30:00Z",
                "adopting_minutes_id": adopting["id"],
                "as_amended": True,
            },
        )
        assert adopted["adopted_on"].startswith("2026-11-05T01:30")
        assert adopted["adopted_as_amended"] is True
        assert adopted["adopting_minutes_id"] == adopting["id"]
        assert adopted["adopting_minutes_title"] == "November business meeting"

    async def test_minutes_cannot_be_adopted_at_their_own_meeting(self, world: _World):
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        async with _client(world.db, world.approver) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/approve",
                json={"adopting_minutes_id": minutes["id"]},
            )
        assert resp.status_code == 400

    async def test_the_adopting_meeting_must_be_this_departments(self, world: _World):
        other = await _create(world, title="Ours")
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        async with _client(world.db, world.outsider) as c:
            foreign = (
                await c.post(
                    "/minutes",
                    json={
                        "title": "Theirs",
                        "meeting_type": "business",
                        "meeting_date": "2026-10-01T19:00:00Z",
                    },
                )
            ).json()
        async with _client(world.db, world.approver) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/approve",
                json={"adopting_minutes_id": foreign["id"]},
            )
        assert resp.status_code == 400
        assert other["id"] != foreign["id"]

    async def test_an_executive_meetings_title_is_not_shown_to_members(
        self, world: _World
    ):
        executive = await _create(
            world, meeting_type="executive", title="Chief's discipline hearing"
        )
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        await _adopt(world, minutes["id"], {"adopting_minutes_id": executive["id"]})
        async with _client(world.db, world.member) as c:
            seen = (await c.get(f"/minutes/{minutes['id']}")).json()
        assert seen["adopting_minutes_id"] == executive["id"]
        assert seen["adopting_minutes_title"] is None

    async def test_adoption_is_part_of_what_the_hash_covers(self, world: _World):
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        await _adopt(world, minutes["id"])
        await world.db.execute(
            text("UPDATE meeting_minutes SET adopted_as_amended = 1 WHERE id = :i"),
            {"i": minutes["id"]},
        )
        async with _client(world.db, world.member) as c:
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
        assert verify["verified"] is False
        assert verify["changed"] == ["adoption"]

    async def test_reopening_clears_the_adoption_and_a_re_adoption_records_anew(
        self, world: _World
    ):
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        await _adopt(world, minutes["id"], {"as_amended": True})
        async with _client(world.db, world.secretary) as c:
            reopened = (
                await c.post(
                    f"/minutes/{minutes['id']}/reopen",
                    json={"reason": "A figure was recorded wrongly"},
                )
            ).json()
        assert reopened["adopted_on"] is None
        assert reopened["adopted_as_amended"] is None
        await _circulate(world, minutes["id"])
        assert (await _adopt(world, minutes["id"]))["adopted_as_amended"] is False

    async def test_the_adopter_cannot_be_the_circulator(self, world: _World):
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(f"/minutes/{minutes['id']}/approve")
        assert resp.status_code == 400


# ── Election results after the meeting ───────────────────────────────


class TestAddenda:
    async def test_a_result_that_closes_after_adoption_is_filed_as_an_addendum(
        self, world: _World
    ):
        minutes = await _create(world)
        await _approve(world, minutes["id"])
        late = await _closed_election(world.db, world.org_id, "Runs past midnight")
        async with _client(world.db, world.secretary) as c:
            filed = await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": late.id},
            )
            body = filed.json()
            again = await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": late.id},
            )
            remove = await c.delete(
                f"/minutes/{minutes['id']}/election-results/{body['id']}"
            )
        assert filed.status_code == 201, filed.text
        assert body["is_addendum"] is True
        assert again.status_code == 400
        assert "Remove it first" not in again.json()["detail"]
        assert remove.status_code == 400
        assert "permanent" in remove.json()["detail"]

    async def test_an_addendum_does_not_disturb_the_adopted_version(
        self, world: _World
    ):
        minutes = await _create(world)
        await _approve(world, minutes["id"])
        late = await _closed_election(world.db, world.org_id)
        async with _client(world.db, world.secretary) as c:
            await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": late.id},
            )
        async with _client(world.db, world.member) as c:
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
            listed = (await c.get(f"/minutes/{minutes['id']}/election-results")).json()
        assert verify["verified"] is True
        assert [r["is_addendum"] for r in listed] == [True]

    async def test_a_result_filed_while_circulating_is_also_an_addendum(
        self, world: _World
    ):
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        late = await _closed_election(world.db, world.org_id)
        async with _client(world.db, world.secretary) as c:
            filed = (
                await c.post(
                    f"/minutes/{minutes['id']}/election-results",
                    json={"election_id": late.id},
                )
            ).json()
        assert filed["is_addendum"] is True
        await _adopt(world, minutes["id"])
        async with _client(world.db, world.member) as c:
            assert (await c.get(f"/minutes/{minutes['id']}/verify")).json()[
                "verified"
            ] is True

    async def test_an_addendum_survives_a_reopen_and_stays_an_addendum(
        self, world: _World
    ):
        minutes = await _create(world)
        await _approve(world, minutes["id"])
        late = await _closed_election(world.db, world.org_id)
        async with _client(world.db, world.secretary) as c:
            await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": late.id},
            )
            await c.post(
                f"/minutes/{minutes['id']}/reopen",
                json={"reason": "Correcting a typo in a motion"},
            )
            listed = (await c.get(f"/minutes/{minutes['id']}/election-results")).json()
            removal = await c.delete(
                f"/minutes/{minutes['id']}/election-results/{listed[0]['id']}"
            )
        assert listed[0]["is_addendum"] is True
        assert removal.status_code == 400

    async def test_the_elections_held_at_this_meeting_are_offered_first(
        self, world: _World
    ):
        from app.models.event import Event, EventType

        now = datetime.now(timezone.utc)
        event = Event(
            id=str(uuid.uuid4()),
            organization_id=world.org_id,
            title="October business meeting",
            event_type=EventType.BUSINESS_MEETING,
            start_datetime=now,
            end_datetime=now,
        )
        world.db.add(event)
        await world.db.flush()
        elsewhere = await _closed_election(world.db, world.org_id, "Elsewhere")
        here = await _closed_election(
            world.db, world.org_id, "Held here", event_id=event.id
        )
        minutes = await _create(world, event_id=event.id)
        async with _client(world.db, world.secretary) as c:
            offered = (
                await c.get(f"/minutes/{minutes['id']}/importable-elections")
            ).json()
        assert [e["id"] for e in offered] == [here.id, elsewhere.id]
        assert [e["linked_to_meeting"] for e in offered] == [True, False]

    async def test_importable_elections_list_their_ballot_items(self, world: _World):
        await _closed_election(
            world.db,
            world.org_id,
            ballot_items=[{"id": "item-1", "title": "Amend bylaw 4"}, {"id": "item-2"}],
        )
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            (offered,) = (
                await c.get(f"/minutes/{minutes['id']}/importable-elections")
            ).json()
        assert offered["ballot_items"] == [
            {"id": "item-1", "title": "Amend bylaw 4"},
            {"id": "item-2", "title": "item-2"},
        ]

    async def test_the_published_copy_marks_the_addendum(self, world: _World):
        minutes = await _create(world)
        await _approve(world, minutes["id"])
        late = await _closed_election(world.db, world.org_id, "Late result")
        async with _client(world.db, world.secretary) as c:
            await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": late.id},
            )
            published = (await c.post(f"/minutes/{minutes['id']}/publish")).json()
            pdf = await c.get(f"/minutes/{minutes['id']}/pdf")
        assert "Election result — Late result" in published["content_html"]
        assert "Addendum" in published["content_html"]
        assert pdf.status_code == 200


# ── Closed sessions ──────────────────────────────────────────────────


def _session(w: _World, **over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "reason": "Personnel matter",
        "legal_basis": "Bylaws Art. IV §3",
        "started_at": "2026-10-01T20:10:00Z",
        "ended_at": "2026-10-01T20:40:00Z",
        "participants": [
            {
                "user_id": str(w.secretary.id),
                "name": "Secretary",
                "joined_at": "2026-10-01T20:10:00Z",
                "left_at": "2026-10-01T20:40:00Z",
            },
            {"name": "Counsel", "joined_at": "2026-10-01T20:15:00Z"},
        ],
        "summary": "No action was taken.",
    }
    body.update(over)
    return body


class TestClosedSessions:
    async def test_a_closed_session_is_recorded_with_who_stayed(self, world: _World):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            created = await c.post(
                f"/minutes/{minutes['id']}/closed-sessions", json=_session(world)
            )
            listed = (await c.get(f"/minutes/{minutes['id']}/closed-sessions")).json()
        assert created.status_code == 201, created.text
        assert [s["reason"] for s in listed] == ["Personnel matter"]
        assert [p["name"] for p in listed[0]["participants"]] == [
            "Secretary",
            "Counsel",
        ]
        assert listed[0]["summary"] == "No action was taken."

    async def test_the_session_can_cite_the_motion_that_opened_it(self, world: _World):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            motion = (
                await c.post(
                    f"/minutes/{minutes['id']}/motions",
                    json={
                        "motion_text": "Move into closed session",
                        "status": "passed",
                    },
                )
            ).json()
            created = await c.post(
                f"/minutes/{minutes['id']}/closed-sessions",
                json=_session(world, motion_id=motion["id"]),
            )
        assert created.status_code == 201
        assert created.json()["motion_id"] == motion["id"]

    async def test_a_motion_from_other_minutes_is_refused(self, world: _World):
        other = await _create(world, title="Other")
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            motion = (
                await c.post(
                    f"/minutes/{other['id']}/motions",
                    json={"motion_text": "Elsewhere", "status": "passed"},
                )
            ).json()
            resp = await c.post(
                f"/minutes/{minutes['id']}/closed-sessions",
                json=_session(world, motion_id=motion["id"]),
            )
        assert resp.status_code == 400

    async def test_a_participant_from_another_department_is_refused(
        self, world: _World
    ):
        minutes = await _create(world)
        body = _session(world)
        body["participants"].append(
            {"user_id": str(world.outsider.id), "name": "Outsider"}
        )
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(f"/minutes/{minutes['id']}/closed-sessions", json=body)
        assert resp.status_code == 400

    @pytest.mark.parametrize(
        "over",
        [
            {"ended_at": "2026-10-01T19:00:00Z"},
            {"reason": ""},
            {
                "participants": [
                    {"user_id": "u1", "name": "A"},
                    {"user_id": "u1", "name": "A again"},
                ]
            },
            {
                "participants": [
                    {
                        "name": "A",
                        "joined_at": "2026-10-01T20:30:00Z",
                        "left_at": "2026-10-01T20:20:00Z",
                    }
                ]
            },
        ],
    )
    async def test_an_impossible_session_is_refused(self, world: _World, over: dict):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/closed-sessions",
                json=_session(world, **over),
            )
        assert resp.status_code == 422

    async def test_moving_the_start_past_the_stored_end_is_refused(self, world: _World):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            session = (
                await c.post(
                    f"/minutes/{minutes['id']}/closed-sessions", json=_session(world)
                )
            ).json()
            resp = await c.put(
                f"/minutes/{minutes['id']}/closed-sessions/{session['id']}",
                json={"started_at": "2026-10-01T22:00:00Z"},
            )
        assert resp.status_code == 400

    async def test_a_session_can_be_edited_and_removed_on_a_draft(self, world: _World):
        minutes = await _create(world)
        base = f"/minutes/{minutes['id']}/closed-sessions"
        async with _client(world.db, world.secretary) as c:
            session = (await c.post(base, json=_session(world))).json()
            edited = await c.put(
                f"{base}/{session['id']}",
                json={"summary": None, "ended_at": "2026-10-01T20:55:00Z"},
            )
            gone = await c.delete(f"{base}/{session['id']}")
            missing = await c.delete(f"{base}/{session['id']}")
        assert edited.status_code == 200, edited.text
        assert edited.json()["summary"] is None
        assert edited.json()["ended_at"].startswith("2026-10-01T20:55")
        assert gone.status_code == 204
        assert missing.status_code == 404

    async def test_the_record_is_locked_once_circulated(self, world: _World):
        minutes = await _create(world)
        base = f"/minutes/{minutes['id']}/closed-sessions"
        async with _client(world.db, world.secretary) as c:
            session = (await c.post(base, json=_session(world))).json()
        await _circulate(world, minutes["id"])
        async with _client(world.db, world.secretary) as c:
            add = await c.post(base, json=_session(world))
            edit = await c.put(f"{base}/{session['id']}", json={"reason": "Changed"})
            remove = await c.delete(f"{base}/{session['id']}")
        assert {add.status_code, edit.status_code, remove.status_code} == {400}

    async def test_it_is_part_of_the_adopted_record(self, world: _World):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            await c.post(
                f"/minutes/{minutes['id']}/closed-sessions", json=_session(world)
            )
        await _approve(world, minutes["id"])
        await world.db.execute(
            text("UPDATE minutes_closed_sessions SET reason = 'Something else'")
        )
        async with _client(world.db, world.member) as c:
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
        assert verify["verified"] is False
        assert verify["changed"] == ["closed_sessions"]

    async def test_members_read_it_once_circulated_and_not_before(self, world: _World):
        minutes = await _create(world)
        base = f"/minutes/{minutes['id']}/closed-sessions"
        async with _client(world.db, world.secretary) as c:
            await c.post(base, json=_session(world))
        async with _client(world.db, world.member) as c:
            assert (await c.get(base)).status_code == 404
        await _circulate(world, minutes["id"])
        async with _client(world.db, world.member) as c:
            assert (await c.get(base)).status_code == 200
            assert (await c.post(base, json=_session(world))).status_code == 403

    async def test_another_department_reaches_none_of_it(self, world: _World):
        minutes = await _create(world)
        base = f"/minutes/{minutes['id']}/closed-sessions"
        async with _client(world.db, world.secretary) as c:
            session = (await c.post(base, json=_session(world))).json()
        async with _client(world.db, world.outsider) as c:
            assert (await c.get(base)).status_code == 404
            assert (await c.post(base, json=_session(world))).status_code == 404
            assert (
                await c.put(f"{base}/{session['id']}", json={"reason": "x"})
            ).status_code == 404
            assert (await c.delete(f"{base}/{session['id']}")).status_code == 404

    async def test_the_published_copy_and_the_pdf_carry_the_record_not_the_talk(
        self, world: _World
    ):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            await c.post(
                f"/minutes/{minutes['id']}/closed-sessions",
                json=_session(world, summary="<b>No action</b> was taken."),
            )
        await _approve(world, minutes["id"])
        async with _client(world.db, world.secretary) as c:
            html = (await c.post(f"/minutes/{minutes['id']}/publish")).json()[
                "content_html"
            ]
            pdf = await c.get(f"/minutes/{minutes['id']}/pdf")
        assert "Closed session 1" in html
        assert "Personnel matter" in html
        assert "Bylaws Art. IV §3" in html
        assert "In the room (2)" in html
        assert "<b>No action</b>" not in html
        assert pdf.status_code == 200
        assert pdf.content.startswith(b"%PDF")


# ── Motions decided by ballot ────────────────────────────────────────


class TestMotionBallots:
    async def _ballot(self, world: _World):
        return await _closed_election(
            world.db,
            world.org_id,
            "Bylaw vote",
            ballot_items=[{"id": "item-1", "title": "Amend bylaw 4"}],
        )

    async def test_a_motion_names_the_ballot_that_decided_it(self, world: _World):
        election = await self._ballot(world)
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/motions",
                json={
                    "motion_text": "Amend bylaw 4",
                    "status": "passed",
                    "election_id": election.id,
                    "ballot_item_id": "item-1",
                },
            )
            detail = (await c.get(f"/minutes/{minutes['id']}")).json()
        assert resp.status_code == 201, resp.text
        assert resp.json()["election_title"] == "Bylaw vote"
        (motion,) = detail["motions"]
        assert (motion["election_id"], motion["ballot_item_id"]) == (
            election.id,
            "item-1",
        )
        assert motion["election_title"] == "Bylaw vote"

    async def test_a_motion_can_be_created_with_its_ballot_in_one_request(
        self, world: _World
    ):
        election = await self._ballot(world)
        minutes = await _create(
            world,
            motions=[
                {
                    "motion_text": "Amend bylaw 4",
                    "status": "passed",
                    "election_id": election.id,
                    "ballot_item_id": "item-1",
                }
            ],
        )
        assert minutes["motions"][0]["election_title"] == "Bylaw vote"

    async def test_another_departments_election_is_refused(self, world: _World):
        foreign = await _closed_election(world.db, world.other_org_id)
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/motions",
                json={
                    "motion_text": "x",
                    "status": "passed",
                    "election_id": foreign.id,
                },
            )
        assert resp.status_code == 400

    async def test_an_item_that_is_not_on_the_ballot_is_refused(self, world: _World):
        election = await self._ballot(world)
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/motions",
                json={
                    "motion_text": "x",
                    "status": "passed",
                    "election_id": election.id,
                    "ballot_item_id": "item-9",
                },
            )
        assert resp.status_code == 400

    async def test_an_item_without_an_election_is_refused(self, world: _World):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/motions",
                json={"motion_text": "x", "status": "passed", "ballot_item_id": "i"},
            )
        assert resp.status_code == 422

    async def test_unlinking_the_election_drops_its_item(self, world: _World):
        election = await self._ballot(world)
        minutes = await _create(world)
        base = f"/minutes/{minutes['id']}/motions"
        async with _client(world.db, world.secretary) as c:
            motion = (
                await c.post(
                    base,
                    json={
                        "motion_text": "x",
                        "status": "passed",
                        "election_id": election.id,
                        "ballot_item_id": "item-1",
                    },
                )
            ).json()
            cleared = await c.put(f"{base}/{motion['id']}", json={"election_id": None})
        body = cleared.json()
        assert cleared.status_code == 200, cleared.text
        assert body["election_id"] is None
        assert body["ballot_item_id"] is None
        assert body["election_title"] is None

    async def test_deleting_the_election_keeps_the_motion(self, world: _World):
        election = await self._ballot(world)
        minutes = await _create(
            world,
            motions=[
                {"motion_text": "x", "status": "passed", "election_id": election.id}
            ],
        )
        await world.db.execute(
            text("DELETE FROM elections WHERE id = :i"), {"i": election.id}
        )
        rows = (
            await world.db.execute(
                text("SELECT election_id FROM meeting_motions WHERE minutes_id = :i"),
                {"i": minutes["id"]},
            )
        ).all()
        assert [r[0] for r in rows] == [None]

    async def test_the_link_is_part_of_the_adopted_record_and_prints(
        self, world: _World
    ):
        election = await self._ballot(world)
        minutes = await _create(
            world,
            motions=[
                {
                    "motion_text": "Amend bylaw 4",
                    "status": "passed",
                    "election_id": election.id,
                }
            ],
        )
        await _approve(world, minutes["id"])
        async with _client(world.db, world.secretary) as c:
            html = (await c.post(f"/minutes/{minutes['id']}/publish")).json()[
                "content_html"
            ]
        assert "Decided by ballot: Bylaw vote" in html
        await world.db.execute(
            text("UPDATE meeting_motions SET election_id = NULL WHERE minutes_id = :i"),
            {"i": minutes["id"]},
        )
        async with _client(world.db, world.member) as c:
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
        assert verify["verified"] is False
        assert verify["changed"] == ["motions"]


# ── Outlines ─────────────────────────────────────────────────────────


def _outline(**over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": "Our order of business",
        "meeting_type": "business",
        "sections": [
            {
                "order": 0,
                "key": "call_to_order",
                "title": "Call to Order",
                "required": True,
            },
            {"order": 1, "key": "roll_call", "title": "Roll Call", "required": True},
            {
                "order": 2,
                "key": "safety_minute",
                "title": "Safety Minute",
                "default_content": "Topic:",
            },
            {
                "order": 3,
                "key": "adjournment",
                "title": "Adjournment",
                "required": True,
            },
        ],
    }
    body.update(over)
    return body


async def _meeting(w: _World, kind: MeetingType = MeetingType.BUSINESS) -> Meeting:
    meeting = Meeting(
        id=str(uuid.uuid4()),
        organization_id=w.org_id,
        title="October meeting",
        meeting_type=kind,
        meeting_date=date(2026, 10, 1),
        status=MeetingStatus.DRAFT,
    )
    w.db.add(meeting)
    await w.db.flush()
    return meeting


class TestOutlines:
    async def test_a_new_department_gets_the_standard_outlines(self, world: _World):
        async with _client(world.db, world.secretary) as c:
            listed = (await c.get("/minutes/templates")).json()
        kinds = {t["meeting_type"] for t in listed}
        assert {
            "business",
            "special",
            "committee",
            "trustee",
            "executive",
            "annual",
        } <= kinds

    async def test_an_outline_is_created_with_its_order_kept_and_numbered(
        self, world: _World
    ):
        scrambled = _outline()
        scrambled["sections"] = [scrambled["sections"][3], scrambled["sections"][0]]
        scrambled["sections"][0]["order"] = 9
        async with _client(world.db, world.secretary) as c:
            resp = await c.post("/minutes/templates", json=scrambled)
        assert resp.status_code == 201, resp.text
        sections = resp.json()["sections"]
        assert [(s["order"], s["key"]) for s in sections] == [
            (0, "call_to_order"),
            (1, "adjournment"),
        ]

    @pytest.mark.parametrize(
        "sections",
        [
            [
                {"order": 0, "key": "a", "title": "A"},
                {"order": 1, "key": "a", "title": "A again"},
            ],
            [{"order": 0, "key": "Bad Key", "title": "A"}],
        ],
    )
    async def test_an_outline_must_have_unique_safe_section_keys(
        self, world: _World, sections: list
    ):
        async with _client(world.db, world.secretary) as c:
            resp = await c.post("/minutes/templates", json=_outline(sections=sections))
        assert resp.status_code == 422

    async def test_making_an_outline_the_default_replaces_the_old_default(
        self, world: _World
    ):
        async with _client(world.db, world.secretary) as c:
            await c.get("/minutes/templates")
            await c.post("/minutes/templates", json=_outline(is_default=True))
            listed = (
                await c.get("/minutes/templates", params={"meeting_type": "business"})
            ).json()
        assert [t["name"] for t in listed if t["is_default"]] == [
            "Our order of business"
        ]

    async def test_minutes_start_from_the_departments_default_outline(
        self, world: _World
    ):
        async with _client(world.db, world.secretary) as c:
            outline = (
                await c.post("/minutes/templates", json=_outline(is_default=True))
            ).json()
            meeting = await _meeting(world)
            created = await c.post(f"/minutes/from-meeting/{meeting.id}")
            detail = (await c.get(f"/minutes/{created.json()['id']}")).json()
        assert created.status_code == 201, created.text
        assert detail["template_id"] == outline["id"]
        assert [s["key"] for s in detail["sections"]] == [
            "call_to_order",
            "roll_call",
            "safety_minute",
            "adjournment",
        ]
        by_key = {s["key"]: s for s in detail["sections"]}
        assert by_key["safety_minute"]["content"] == "Topic:"
        assert by_key["call_to_order"]["required"] is True
        assert by_key["safety_minute"]["required"] is False

    async def test_an_outline_can_be_chosen_when_the_minutes_are_started(
        self, world: _World
    ):
        async with _client(world.db, world.secretary) as c:
            await c.post("/minutes/templates", json=_outline(is_default=True))
            special = (
                await c.post(
                    "/minutes/templates",
                    json=_outline(
                        name="Short form",
                        sections=[{"order": 0, "key": "notes", "title": "Notes"}],
                    ),
                )
            ).json()
            meeting = await _meeting(world)
            created = await c.post(
                f"/minutes/from-meeting/{meeting.id}",
                params={"template_id": special["id"]},
            )
            detail = (await c.get(f"/minutes/{created.json()['id']}")).json()
        assert [s["key"] for s in detail["sections"]] == ["notes"]

    async def test_a_new_department_gets_the_standard_order_with_no_setup(
        self, world: _World
    ):
        meeting = await _meeting(world)
        async with _client(world.db, world.secretary) as c:
            created = await c.post(f"/minutes/from-meeting/{meeting.id}")
            detail = (await c.get(f"/minutes/{created.json()['id']}")).json()
        keys = [s["key"] for s in detail["sections"]]
        assert keys[0] == "call_to_order"
        assert keys[-1] == "adjournment"
        assert detail["template_id"] is not None

    async def test_another_departments_outline_is_refused(self, world: _World):
        async with _client(world.db, world.outsider) as c:
            foreign = (await c.post("/minutes/templates", json=_outline())).json()
        meeting = await _meeting(world)
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/from-meeting/{meeting.id}",
                params={"template_id": foreign["id"]},
            )
        assert resp.status_code == 400

    async def test_applying_an_outline_keeps_what_is_written(self, world: _World):
        minutes = await _create(
            world,
            sections=[
                {
                    "order": 0,
                    "key": "call_to_order",
                    "title": "Call",
                    "content": "7:02 pm",
                },
                {
                    "order": 1,
                    "key": "old_note",
                    "title": "Old note",
                    "content": "Keep me",
                },
                {
                    "order": 2,
                    "key": "empty_extra",
                    "title": "Empty extra",
                    "content": "",
                },
            ],
        )
        async with _client(world.db, world.secretary) as c:
            outline = (await c.post("/minutes/templates", json=_outline())).json()
            resp = await c.post(
                f"/minutes/{minutes['id']}/apply-outline",
                json={"template_id": outline["id"]},
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [s["key"] for s in body["sections"]] == [
            "call_to_order",
            "roll_call",
            "safety_minute",
            "adjournment",
            "old_note",
        ]
        by_key = {s["key"]: s for s in body["sections"]}
        assert by_key["call_to_order"]["content"] == "7:02 pm"
        assert by_key["call_to_order"]["required"] is True
        assert by_key["old_note"]["content"] == "Keep me"
        assert body["template_id"] == outline["id"]
        assert [s["order"] for s in body["sections"]] == [0, 1, 2, 3, 4]

    async def test_an_outline_cannot_be_laid_over_circulated_minutes(
        self, world: _World
    ):
        minutes = await _create(world)
        await _circulate(world, minutes["id"])
        async with _client(world.db, world.secretary) as c:
            outline = (await c.post("/minutes/templates", json=_outline())).json()
            resp = await c.post(
                f"/minutes/{minutes['id']}/apply-outline",
                json={"template_id": outline["id"]},
            )
        assert resp.status_code == 400

    async def test_applying_a_foreign_outline_is_refused(self, world: _World):
        minutes = await _create(world)
        async with _client(world.db, world.outsider) as c:
            foreign = (await c.post("/minutes/templates", json=_outline())).json()
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/apply-outline",
                json={"template_id": foreign["id"]},
            )
        assert resp.status_code == 400

    async def test_only_a_manager_edits_outlines(self, world: _World):
        async with _client(world.db, world.member) as c:
            assert (
                await c.post("/minutes/templates", json=_outline())
            ).status_code == 403
            assert (await c.get("/minutes/templates")).status_code == 200
