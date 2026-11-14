"""Holding an election, or one ballot item, outside the department's voter
rules: the reason that has to be given, where it is recorded, and the
ballot-item carve-out that lets one question follow another kind's rules.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from dateutil.relativedelta import relativedelta
from fastapi import HTTPException

from app.api.v1.endpoints.elections import (
    create_election,
    preview_electorate,
    update_election,
)
from app.models.election import Election, ElectionStatus
from app.models.meeting import Meeting, MeetingAttendee, MeetingType
from app.models.user import Organization, User, UserStatus
from app.schemas.election import (
    ElectionCreate,
    ElectionUpdate,
    ElectoratePreviewRequest,
)
from app.services.election_service import ElectionService, _voter_rule_exceptions
from app.utils.org_timezone import org_today

NO_RULE = {"may_vote": True, "wait": None, "attendance": []}
COUNT_2_OF_3 = {"mode": "count", "min_meetings": 2, "of_last_meetings": 3}


def _v2(**types):
    return {
        "version": 2,
        "types": {key: {**NO_RULE, **rule} for key, rule in types.items()},
    }


def _defaults(rules):
    return {
        "rules": rules,
        "default_require_attendance": False,
        "default_voter_types": ["all"],
        "position_voter_types": {},
    }


# The department: regular members need 2 of their last 3 meetings; a bylaws
# amendment is open to every regular member whatever their attendance.
REGULAR_RULES = _v2(regular={"attendance": [COUNT_2_OF_3]})
BYLAWS_RULES = _v2(regular={})
SETTINGS = {
    "election_eligibility": _defaults(REGULAR_RULES),
    "election_eligibility_bylaws": _defaults(BYLAWS_RULES),
}

BYLAWS_ITEM = {
    "id": "bylaws-iv",
    "type": "general_vote",
    "title": "Amend Article IV",
    "vote_type": "approval",
    "eligibility_kind": "bylaws",
}
CHIEF_ITEM = {
    "id": "chief",
    "type": "officer_election",
    "title": "Chief",
    "position": "Chief",
    "vote_type": "candidate_selection",
}


@pytest.fixture
def audit(monkeypatch):
    mock = AsyncMock()
    monkeypatch.setattr("app.api.v1.endpoints.elections.log_audit_event", mock)
    return mock


def _customized_events(audit):
    return [
        call.kwargs
        for call in audit.call_args_list
        if call.kwargs.get("event_type") == "election_voter_rules_customized"
    ]


async def _org(db, settings=None):
    org = Organization(
        name="Rule Exceptions FD",
        slug=f"rule-exc-{uuid.uuid4().hex[:8]}",
        settings=dict(SETTINGS if settings is None else settings),
    )
    db.add(org)
    await db.flush()
    return org


async def _member(db, org, tag, status="regular"):
    user = User(
        organization_id=org.id,
        username=f"{tag}-{uuid.uuid4().hex[:8]}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@example.org",
        first_name=tag.capitalize(),
        last_name="Member",
        hire_date=date(2010, 1, 1),
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    user.member_class = "operational"
    user.member_status = status
    await db.flush()
    return user


def _payload(**extra):
    now = datetime.now(timezone.utc)
    return {
        "title": "December meeting votes",
        "start_date": now + timedelta(days=1),
        "end_date": now + timedelta(days=2),
        **extra,
    }


@pytest.mark.integration
class TestElectionReason:
    async def test_custom_rules_without_a_reason_are_refused(self, db_session, audit):
        org = await _org(db_session)
        secretary = await _member(db_session, org, "secretary")
        with pytest.raises(HTTPException) as exc:
            await create_election(
                election=ElectionCreate.model_validate(
                    _payload(eligibility_rules=BYLAWS_RULES)
                ),
                db=db_session,
                current_user=secretary,
            )
        assert exc.value.status_code == 400
        assert "Give the reason they differ" in exc.value.detail

    async def test_a_reason_is_stored_and_audited(self, db_session, audit):
        org = await _org(db_session)
        secretary = await _member(db_session, org, "secretary")
        response = await create_election(
            election=ElectionCreate.model_validate(
                _payload(
                    eligibility_rules=BYLAWS_RULES,
                    eligibility_override_reason="  Bylaws Article XII s.2  ",
                )
            ),
            db=db_session,
            current_user=secretary,
        )
        assert response.eligibility_override_reason == "Bylaws Article XII s.2"
        [event] = _customized_events(audit)
        assert event["event_data"]["reason"] == "Bylaws Article XII s.2"
        assert event["user_id"] == str(secretary.id)

    async def test_a_reason_for_the_default_rules_is_dropped(self, db_session, audit):
        org = await _org(db_session)
        secretary = await _member(db_session, org, "secretary")
        response = await create_election(
            election=ElectionCreate.model_validate(
                _payload(
                    eligibility_rules=REGULAR_RULES,
                    eligibility_override_reason="Nothing differs",
                )
            ),
            db=db_session,
            current_user=secretary,
        )
        assert response.eligibility_override_reason is None
        assert _customized_events(audit) == []

    async def test_restoring_the_defaults_clears_the_reason(self, db_session, audit):
        org = await _org(db_session)
        secretary = await _member(db_session, org, "secretary")
        created = await create_election(
            election=ElectionCreate.model_validate(
                _payload(
                    eligibility_rules=BYLAWS_RULES,
                    eligibility_override_reason="Open vote",
                )
            ),
            db=db_session,
            current_user=secretary,
        )
        response = await update_election(
            election_id=created.id,
            election_update=ElectionUpdate.model_validate(
                {"eligibility_rules": REGULAR_RULES}
            ),
            db=db_session,
            current_user=secretary,
        )
        assert response.eligibility_override_reason is None

    async def test_an_unrelated_edit_does_not_demand_a_reason(self, db_session, audit):
        org = await _org(db_session)
        secretary = await _member(db_session, org, "secretary")
        created = await create_election(
            election=ElectionCreate.model_validate(_payload()),
            db=db_session,
            current_user=secretary,
        )
        # The department's defaults change after the election copied them.
        org.settings = {**SETTINGS, "election_eligibility": _defaults(BYLAWS_RULES)}
        await db_session.flush()
        response = await update_election(
            election_id=created.id,
            election_update=ElectionUpdate(title="Renamed"),
            db=db_session,
            current_user=secretary,
        )
        assert response.title == "Renamed"


@pytest.mark.integration
class TestBallotItemRules:
    async def test_an_item_naming_a_kind_takes_that_kinds_rules(
        self, db_session, audit
    ):
        org = await _org(db_session)
        secretary = await _member(db_session, org, "secretary")
        response = await create_election(
            election=ElectionCreate.model_validate(
                _payload(ballot_items=[BYLAWS_ITEM, CHIEF_ITEM])
            ),
            db=db_session,
            current_user=secretary,
        )
        bylaws, chief = response.ballot_items
        assert bylaws.eligibility_kind == "bylaws"
        assert bylaws.eligibility_rules["types"]["regular"]["attendance"] == []
        assert bylaws.eligibility_override_reason is None
        # An item without a carve-out is stored without the new keys.
        election = await db_session.get(Election, str(response.id))
        assert "eligibility_rules" not in election.ballot_items[1]
        assert chief.eligibility_rules is None

    async def test_custom_item_rules_need_a_reason(self, db_session, audit):
        org = await _org(db_session)
        secretary = await _member(db_session, org, "secretary")
        custom = {
            **BYLAWS_ITEM,
            "eligibility_rules": _v2(regular={"may_vote": False}),
        }
        with pytest.raises(HTTPException) as exc:
            await create_election(
                election=ElectionCreate.model_validate(_payload(ballot_items=[custom])),
                db=db_session,
                current_user=secretary,
            )
        assert "Ballot item 'Amend Article IV'" in exc.value.detail

        response = await create_election(
            election=ElectionCreate.model_validate(
                _payload(
                    ballot_items=[
                        {**custom, "eligibility_override_reason": "Board only"}
                    ]
                )
            ),
            db=db_session,
            current_user=secretary,
        )
        assert response.ballot_items[0].eligibility_override_reason == "Board only"
        [event] = _customized_events(audit)
        assert event["event_data"]["ballot_item_reasons"] == {"bylaws-iv": "Board only"}

    async def test_version_1_item_rules_are_refused(self):
        with pytest.raises(ValueError, match="set per member type"):
            ElectionCreate.model_validate(
                _payload(
                    ballot_items=[
                        {
                            **BYLAWS_ITEM,
                            "eligibility_rules": {
                                "attendance": {"mode": "none"},
                                "waiting_periods": {},
                            },
                        }
                    ]
                )
            )


async def _open_election(db, org, creator, ballot_items, **extra):
    now = datetime.now(timezone.utc)
    election = Election(
        organization_id=org.id,
        title="December meeting votes",
        positions=[],
        start_date=now - timedelta(days=1),
        end_date=now + timedelta(days=1),
        status=ElectionStatus.OPEN,
        created_by=creator.id,
        voter_anonymity_salt=uuid.uuid4().hex,
        eligibility_rules=REGULAR_RULES,
        ballot_items=ballot_items,
        **extra,
    )
    db.add(election)
    await db.flush()
    return election


async def _three_meetings(db, org, attended_by):
    today = org_today(org)
    meetings = [
        Meeting(
            organization_id=org.id,
            title=f"Meeting {k}",
            meeting_date=today - relativedelta(months=k),
            meeting_type=MeetingType.BUSINESS,
        )
        for k in (3, 2, 1)
    ]
    db.add_all(meetings)
    await db.flush()
    db.add_all(
        MeetingAttendee(
            organization_id=org.id, meeting_id=m.id, user_id=member.id, present=True
        )
        for member in attended_by
        for m in meetings
    )
    await db.flush()


CARVED_BYLAWS_ITEM = {**BYLAWS_ITEM, "eligibility_rules": BYLAWS_RULES}


@pytest.mark.integration
class TestCarveOutVoting:
    async def _setup(self, db_session, **extra):
        org = await _org(db_session)
        steady = await _member(db_session, org, "steady")
        absent = await _member(db_session, org, "absent")
        await _three_meetings(db_session, org, attended_by=[steady])
        election = await _open_election(
            db_session, org, steady, [CARVED_BYLAWS_ITEM, CHIEF_ITEM], **extra
        )
        return org, steady, absent, election

    async def test_the_carved_out_item_follows_its_own_rules(self, db_session):
        org, steady, absent, election = await self._setup(db_session)
        annotated = await ElectionService(db_session).annotate_ballot_items_for_user(
            absent, election, str(org.id)
        )
        by_id = {i["id"]: i["eligibility"] for i in annotated}
        assert by_id["bylaws-iv"] == {"eligible": True, "reason": None}
        assert by_id["chief"]["eligible"] is False
        assert by_id["chief"]["reason"] == (
            "Attended 0 of the last 3 meetings; 2 required to vote"
        )

    async def test_a_vote_is_judged_by_the_rules_of_its_item(self, db_session):
        org, steady, absent, election = await self._setup(db_session)
        service = ElectionService(db_session)
        bylaws = await service.check_voter_eligibility(
            absent.id, election.id, org.id, position="Amend Article IV"
        )
        chief = await service.check_voter_eligibility(
            absent.id, election.id, org.id, position="Chief"
        )
        assert bylaws.is_eligible is True
        assert chief.is_eligible is False

    async def test_the_frozen_roll_does_not_open_the_other_items(self, db_session):
        # The roll holds everyone eligible for at least one item, so being on
        # it proves nothing about the officer race.
        org, steady, absent, election = await self._setup(db_session)
        election.eligible_roster_snapshot = [str(steady.id), str(absent.id)]
        await db_session.flush()
        chief = await ElectionService(db_session).check_voter_eligibility(
            absent.id, election.id, org.id, position="Chief"
        )
        assert chief.is_eligible is False

    async def test_the_roster_gives_the_item_reason(self, db_session):
        org, steady, absent, election = await self._setup(db_session)
        roster = await ElectionService(db_session).get_eligibility_roster(
            election.id, org.id
        )
        row = next(m for m in roster["roster"] if m["user_id"] == str(absent.id))
        assert row["will_receive_ballot"] is True
        items = {i["ballot_item_id"]: i for i in row["item_eligibility"]}
        assert items["bylaws-iv"]["eligible"] is True
        assert items["chief"]["reason"] == (
            "Attended 0 of the last 3 meetings; 2 required to vote"
        )


@pytest.mark.unit
class TestResultsRecordTheExceptions:
    def test_the_election_and_each_carved_out_item_are_listed(self):
        election = SimpleNamespace(
            title="December meeting votes",
            meeting_kind="regular",
            eligibility_override_reason="Article XII",
            ballot_items=[
                {**CARVED_BYLAWS_ITEM, "eligibility_override_reason": None},
                CHIEF_ITEM,
            ],
        )
        assert [e.model_dump() for e in _voter_rule_exceptions(election)] == [
            {
                "scope": "election",
                "title": "December meeting votes",
                "meeting_kind": "regular",
                "reason": "Article XII",
            },
            {
                "scope": "ballot_item",
                "title": "Amend Article IV",
                "meeting_kind": "bylaws",
                "reason": None,
            },
        ]


@pytest.mark.integration
class TestElectoratePreview:
    async def test_counts_who_the_rules_admit_today(self, db_session):
        org = await _org(db_session)
        steady = await _member(db_session, org, "steady")
        await _member(db_session, org, "absent")
        await _member(db_session, org, "probie", status="probationary")
        await _three_meetings(db_session, org, attended_by=[steady])

        # The regular defaults: attendance keeps out the absent member.
        defaults = await preview_electorate(
            preview=ElectoratePreviewRequest(meeting_kind="regular"),
            db=db_session,
            current_user=steady,
        )
        assert (defaults.eligible, defaults.total) == (2, 3)

        custom = await preview_electorate(
            preview=ElectoratePreviewRequest.model_validate(
                {"eligibility_rules": _v2(probationary={"may_vote": False})}
            ),
            db=db_session,
            current_user=steady,
        )
        assert (custom.eligible, custom.total) == (2, 3)

        bylaws = await preview_electorate(
            preview=ElectoratePreviewRequest(meeting_kind="bylaws"),
            db=db_session,
            current_user=steady,
        )
        assert (bylaws.eligible, bylaws.total) == (3, 3)
