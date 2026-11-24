"""What Outreach Impact reports about a department's CRR work.

Run against real rows. The owner's rules (2026-11-23): the CRR breakdowns
follow the page's period and its comparison; an activity with several tags
counts under each, so the tag rows need not sum to the total; ZIP codes carry
their GeoNames place and centre for the map. Nothing here may carry a
resident's details.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.v1.endpoints import crr as crr_endpoints
from app.api.v1.endpoints.crr import (
    create_activity,
    get_catalogue,
    update_activity_type,
)
from app.api.v1.endpoints.dashboard import get_community_engagement
from app.models.user import Organization, User, UserStatus
from app.schemas.crr import CrrActivityCreate, CrrActivityTypeUpdate
from app.services.crr_impact_service import CrrImpactService
from tests.clock_support import reread_each_test

pytestmark = pytest.mark.integration


def _clock() -> dict:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    return {
        "NOW": now,
        "WINDOW_START": now - timedelta(days=30),
        "PRIOR": (now - timedelta(days=60), now - timedelta(days=30)),
    }


NOW, WINDOW_START, PRIOR = _clock().values()
_reread_clock = reread_each_test(__name__, _clock)


async def _org(db_session, label):
    org = Organization(
        name=f"{label} FD",
        slug=f"{label.lower()}-{uuid.uuid4().hex[:10]}",
        timezone="America/New_York",
        settings={},
        mailing_city="Falls Church",
        mailing_state="VA",
        mailing_zip="22046",
        mailing_country="USA",
    )
    db_session.add(org)
    await db_session.flush()
    user = User(
        organization_id=org.id,
        username=f"{label.lower()}-{org.id[:8]}",
        email=f"{label.lower()}-{org.id[:8]}@example.test",
        first_name="Member",
        last_name=label,
        status=UserStatus.ACTIVE,
    )
    db_session.add(user)
    await db_session.flush()
    return org, user


@pytest.fixture(autouse=True)
def _no_permission_lookups(monkeypatch):
    # The endpoints ask user_has_permission for crr.view_contact; these users
    # hold nothing, and the answer does not change what is recorded.
    monkeypatch.setattr(crr_endpoints, "user_has_permission", lambda user, p: False)


@pytest.fixture
async def dept(db_session):
    return await _org(db_session, "Impact")


async def _types(db_session, user):
    catalogue = await get_catalogue(db=db_session, current_user=user)
    return {t.code: t for t in catalogue.activity_types}


async def _record(db_session, user, activity_type, when, **fields):
    counts = fields.pop("counts", {})
    body = CrrActivityCreate(
        activity_type_id=activity_type.id,
        occurred_at=when,
        counts={activity_type.measures[i].id: q for i, q in counts.items()},
        **fields,
    )
    return await create_activity(body=body, db=db_session, current_user=user)


_THE_PRIOR_SPAN = object()


async def _breakdown(db_session, org, previous=_THE_PRIOR_SPAN):
    # PRIOR is read here, not as the default: a default is fixed at import
    # (CLAUDE.md pitfall #40). None means "no comparison", so it cannot stand
    # in for "the usual one".
    span = PRIOR if previous is _THE_PRIOR_SPAN else previous
    return await CrrImpactService(db_session).breakdown(
        str(org.id), WINDOW_START, NOW, span
    )


class TestByType:
    async def test_counts_are_totalled_against_the_previous_span(
        self, db_session, dept
    ):
        org, user = dept
        types = await _types(db_session, user)
        smoke = types["smoke_alarm_install"]
        when = NOW - timedelta(days=2)
        await _record(db_session, user, smoke, when, counts={0: 3, 1: 1})
        await _record(db_session, user, smoke, when, counts={0: 2, 1: 1})
        await _record(
            db_session, user, smoke, PRIOR[0] + timedelta(days=1), counts={0: 4}
        )

        report = await _breakdown(db_session, org)

        assert (report["activities"], report["previous_activities"]) == (2, 1)
        [row] = report["by_type"]
        assert (row["name"], row["activities"], row["previous_activities"]) == (
            "Smoke alarm install",
            2,
            1,
        )
        assert [
            (c["label"], c["quantity"], c["previous_quantity"]) for c in row["counts"]
        ] == [("Alarms installed", 5, 4), ("Homes", 2, 0)]

    async def test_a_type_done_only_before_still_shows_its_drop(self, db_session, dept):
        org, user = dept
        types = await _types(db_session, user)
        await _record(
            db_session,
            user,
            types["hands_only_cpr"],
            PRIOR[0] + timedelta(days=1),
            counts={0: 12},
        )

        [row] = (await _breakdown(db_session, org))["by_type"]

        assert (row["activities"], row["previous_activities"]) == (0, 1)
        assert [(c["quantity"], c["previous_quantity"]) for c in row["counts"]] == [
            (0, 12)
        ]

    async def test_without_a_comparison_nothing_claims_one(self, db_session, dept):
        org, user = dept
        types = await _types(db_session, user)
        await _record(
            db_session, user, types["hands_only_cpr"], NOW - timedelta(days=1)
        )

        report = await _breakdown(db_session, org, previous=None)

        assert report["previous_activities"] is None
        assert report["by_type"][0]["previous_activities"] is None

    async def test_a_retired_type_keeps_its_history(self, db_session, dept):
        org, user = dept
        types = await _types(db_session, user)
        cpr = types["hands_only_cpr"]
        await _record(db_session, user, cpr, NOW - timedelta(days=1), counts={0: 8})
        await update_activity_type(
            type_id=cpr.id,
            body=CrrActivityTypeUpdate(is_active=False),
            db=db_session,
            current_user=user,
        )

        [row] = (await _breakdown(db_session, org))["by_type"]

        assert (row["name"], row["counts"][0]["quantity"]) == ("Hands-only CPR", 8)

    async def test_the_window_end_is_exclusive_and_its_start_inclusive(
        self, db_session, dept
    ):
        org, user = dept
        types = await _types(db_session, user)
        cpr = types["hands_only_cpr"]
        await _record(db_session, user, cpr, WINDOW_START)
        await _record(db_session, user, cpr, NOW)

        report = await _breakdown(db_session, org, previous=None)

        assert report["activities"] == 1


class TestByTag:
    async def test_an_activity_counts_under_every_tag_it_carries(
        self, db_session, dept
    ):
        org, user = dept
        types = await _types(db_session, user)
        when = NOW - timedelta(days=1)
        # Home safety survey: Fire and Falls. Smoke alarm install: Fire.
        await _record(
            db_session, user, types["home_safety_survey"], when, counts={0: 1}
        )
        await _record(
            db_session, user, types["smoke_alarm_install"], when, counts={0: 2}
        )

        report = await _breakdown(db_session, org)

        tags = {t["label"]: t for t in report["by_tag"]}
        assert {label: t["activities"] for label, t in tags.items()} == {
            "Fire": 2,
            "Falls": 1,
        }
        assert sum(t["activities"] for t in report["by_tag"]) > report["activities"]
        assert [
            (c["activity_type_name"], c["label"], c["quantity"])
            for c in tags["Fire"]["counts"]
        ] == [
            ("Smoke alarm install", "Alarms installed", 2),
            ("Home safety survey", "Homes surveyed", 1),
        ]

    async def test_risks_come_before_populations(self, db_session, dept):
        org, user = dept
        types = await _types(db_session, user)
        await _record(
            db_session, user, types["fall_prevention"], NOW - timedelta(days=1)
        )

        report = await _breakdown(db_session, org)

        assert [(t["kind"], t["label"]) for t in report["by_tag"]] == [
            ("risk", "Falls"),
            ("population", "Older adults"),
        ]


class TestByZip:
    async def test_a_zip_carries_its_place_and_centre(self, db_session, dept):
        org, user = dept
        types = await _types(db_session, user)
        smoke = types["smoke_alarm_install"]
        when = NOW - timedelta(days=1)
        await _record(db_session, user, smoke, when, counts={0: 2}, zip_code="22046")
        await _record(
            db_session, user, smoke, when, counts={0: 1}, zip_code="22046-1234"
        )
        await _record(db_session, user, smoke, when, counts={0: 4}, zip_code="90210")
        await _record(db_session, user, smoke, when)

        report = await _breakdown(db_session, org)

        assert report["unplaced_activities"] == 1
        first, second = report["by_zip"]
        assert (
            first["zip_code"],
            first["city"],
            first["state"],
            first["activities"],
            first["latitude"],
            first["longitude"],
        ) == ("22046", "Falls Church", "VA", 2, 38.8856, -77.1802)
        assert [c["quantity"] for c in first["counts"]] == [3]
        assert (second["zip_code"], second["city"]) == ("90210", "Beverly Hills")

    async def test_an_unknown_zip_keeps_what_was_recorded_and_has_no_centre(
        self, db_session, dept
    ):
        org, user = dept
        types = await _types(db_session, user)
        await _record(
            db_session,
            user,
            types["hands_only_cpr"],
            NOW - timedelta(days=1),
            zip_code="00000",
            city="Nowhere",
            state="VA",
        )

        [row] = (await _breakdown(db_session, org))["by_zip"]

        assert (row["city"], row["state"], row["latitude"], row["longitude"]) == (
            "Nowhere",
            "VA",
            None,
            None,
        )


class TestScopeAndPrivacy:
    async def test_another_departments_work_is_not_counted(self, db_session, dept):
        org, user = dept
        other_org, other_user = await _org(db_session, "Other")
        theirs = await _types(db_session, other_user)
        await _record(
            db_session,
            other_user,
            theirs["hands_only_cpr"],
            NOW - timedelta(days=1),
            zip_code="22046",
        )
        await _types(db_session, user)

        report = await _breakdown(db_session, org)

        assert report == {
            "activities": 0,
            "previous_activities": 0,
            "by_type": [],
            "by_tag": [],
            "by_zip": [],
            "unplaced_activities": 0,
        }

    async def test_resident_details_never_reach_the_report(self, db_session, dept):
        org, user = dept
        types = await _types(db_session, user)
        await _record(
            db_session,
            user,
            types["home_safety_survey"],
            NOW - timedelta(days=1),
            zip_code="22046",
            has_resident_details=True,
            street_address="12 Oak St",
            resident_name="Pat Resident",
            resident_phone="703-555-0100",
            resident_email="pat@example.test",
            notes="Ask for Pat",
        )

        text = json.dumps(await _breakdown(db_session, org))

        for secret in (
            "12 Oak St",
            "Pat Resident",
            "703-555-0100",
            "pat@example.test",
            "Ask for Pat",
        ):
            assert secret not in text


class TestOnOutreachImpact:
    async def test_the_report_carries_it_for_the_pages_period(self, db_session, dept):
        org, user = dept
        types = await _types(db_session, user)
        await _record(
            db_session,
            user,
            types["hands_only_cpr"],
            NOW - timedelta(days=1),
            counts={0: 9},
        )

        report = await get_community_engagement(
            period="all", db=db_session, current_user=user
        )

        assert report.crr.activities == 1
        assert report.crr.previous_activities is None
        assert report.crr.by_type[0].counts[0].quantity == 9
