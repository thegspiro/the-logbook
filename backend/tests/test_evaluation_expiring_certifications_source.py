"""The ``certifications.expiring_soon`` data source: qualifications held at the
end of the review period that lapse within the training stats' "expiring
soon" window after it (owner decision, 2026-11-14)."""

import uuid
from datetime import date, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.models.qualification import MemberQualification
from app.services.evaluation_data_service import (
    EvaluationDataService,
    compute_coverage,
)
from app.services.evaluation_data_sources import DATA_SOURCES_BY_KEY
from app.services.training_service import CERTIFICATION_EXPIRING_SOON_DAYS
from tests.test_shift_evaluations import _member, _org

pytestmark = [pytest.mark.integration]

KEY = "certifications.expiring_soon"
PERIOD_END = date(2026, 12, 31)
HORIZON = PERIOD_END + timedelta(days=CERTIFICATION_EXPIRING_SOON_DAYS)


def _qualification(org_id, member, code, *, expires, granted=date(2020, 1, 1)):
    return MemberQualification(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        user_id=member.id,
        qualification_code=code,
        granted_on=granted,
        expires_on=expires,
    )


async def _figures(db, org_id, member):
    coverage = compute_coverage(
        date(2026, 1, 1), PERIOD_END, [(date(2020, 1, 1), None)], []
    )
    assert coverage is not None
    return await EvaluationDataService(db).compute(
        org_id, member, coverage, [KEY, "certifications.current"], ZoneInfo("UTC")
    )


async def test_lists_only_what_lapses_within_the_window_after_the_period(
    db_session,
):
    org_id = await _org(db_session)
    member = await _member(db_session, org_id, "Terry")
    db_session.add_all(
        [
            # In force on the last day and lapsing the next: expiring.
            _qualification(org_id, member, "emt", expires=PERIOD_END),
            # The last day of the window: expiring.
            _qualification(org_id, member, "firefighter_i", expires=HORIZON),
            # A day past the window: held, not expiring soon.
            _qualification(
                org_id,
                member,
                "firefighter_ii",
                expires=HORIZON + timedelta(days=1),
            ),
            # Never expires.
            _qualification(org_id, member, "driver_operator", expires=None),
            # Lapsed during the period: not held at its end, so not listed.
            _qualification(org_id, member, "aemt", expires=date(2026, 6, 30)),
        ]
    )
    await db_session.flush()

    figures = await _figures(db_session, org_id, member)

    assert figures[KEY] == {
        "available": True,
        "value": [
            {"label": "EMT", "expires_on": PERIOD_END.isoformat()},
            {"label": "Firefighter I", "expires_on": HORIZON.isoformat()},
        ],
    }
    # Everything expiring soon is among what the Certifications source lists.
    held = {line["label"] for line in figures["certifications.current"]["value"]}
    assert {line["label"] for line in figures[KEY]["value"]} <= held
    assert held == {"EMT", "Firefighter I", "Firefighter II", "Driver / Operator"}


def test_the_catalog_names_the_same_window_the_code_uses():
    assert f"within {CERTIFICATION_EXPIRING_SOON_DAYS} days" in (
        DATA_SOURCES_BY_KEY[KEY].description
    )
