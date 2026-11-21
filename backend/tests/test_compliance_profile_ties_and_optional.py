"""Compliance profiles: equal priorities and optional requirements, end to end.

Owner decisions of 2026-11-21:

* **Ties: the older profile wins**, then the smaller id, on every screen. The
  newer profile in each tie test is inserted first and given the smaller id,
  so whichever order the database returns rows in -- insertion or primary
  key -- the unfixed code reads the newer one first.
* **Optional requirements: shown, never graded.** A profile's
  ``optional_requirement_ids`` are listed on My Training and the officer's
  view of the member, under ``optional_requirements_detail``, and never reach
  a count, a percentage, the matrix, the card or a notice.
"""

import json
import uuid
from datetime import timedelta
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.training import get_compliance_summary
from app.api.v1.endpoints.training_module_config import get_member_requirements
from app.models.user import User
from app.services.training_compliance import (
    compute_org_compliance_tally,
    grade_org_members,
)
from tests.test_my_training_compliance_profiles import (
    _insert_compliance_config,
    _insert_hours_req,
    _insert_member,
    _insert_org,
    _insert_record,
    _load_member,
    _matrix_row,
    _my_training,
    _today,
)

pytestmark = [pytest.mark.integration]

_NEWER_PREFIX = "00000000-0000-4000-8000-"
_OLDER_PREFIX = "ffffffff-ffff-4fff-bfff-"


async def _profile(
    db: AsyncSession,
    config_id: str,
    *,
    name: str,
    required: list[str] | None,
    optional: list[str] | None = None,
    priority: int = 0,
    id_prefix: str | None = None,
    age_days: int = 0,
) -> str:
    profile_id = id_prefix + uuid.uuid4().hex[:12] if id_prefix else str(uuid.uuid4())
    created = (
        await db.execute(text("SELECT UTC_TIMESTAMP()"))
    ).scalar_one() - timedelta(days=age_days)
    await db.execute(
        text(
            "INSERT INTO compliance_profiles "
            "(id, config_id, name, membership_types, required_requirement_ids, "
            "optional_requirement_ids, priority, is_active, created_at, "
            "updated_at) "
            "VALUES (:id, :cfg, :name, :mt, :rr, :oo, :prio, 1, :ts, :ts)"
        ),
        {
            "id": profile_id,
            "cfg": config_id,
            "name": name,
            "mt": json.dumps(["active"]),
            "rr": json.dumps(required) if required is not None else None,
            "oo": json.dumps(optional) if optional is not None else None,
            "prio": priority,
            "ts": created,
        },
    )
    await db.flush()
    return profile_id


async def _officer_view(db: AsyncSession, org_id: str, user_id: str) -> dict:
    officer = User(id=str(uuid.uuid4()), organization_id=org_id)
    return await get_member_requirements(user_id=user_id, db=db, current_user=officer)


async def _card(db: AsyncSession, user_id: str):
    member = await _load_member(db, user_id)
    return await get_compliance_summary(
        user_id=UUID(user_id), db=db, current_user=member
    )


def _ids(details: list[dict]) -> set[str]:
    return {d["id"] for d in details}


def _met_total(summary: dict) -> tuple[int, int]:
    rs = summary["requirements_summary"]
    return rs["met_requirements"], rs["total_requirements"]


class TestEqualPriorityWinner:
    async def _tied_org(self, db: AsyncSession) -> tuple[str, str, str, str]:
        org_id = await _insert_org(db)
        user_id = await _insert_member(db, org_id)
        req1 = await _insert_hours_req(db, org_id, name="Req One")
        req2 = await _insert_hours_req(db, org_id, name="Req Two", required_hours=100)
        config_id = await _insert_compliance_config(db, org_id)
        await _profile(
            db, config_id, name="Newer", required=[req2], id_prefix=_NEWER_PREFIX
        )
        await _profile(
            db,
            config_id,
            name="Older",
            required=[req1],
            id_prefix=_OLDER_PREFIX,
            age_days=1,
        )
        await _insert_record(db, org_id, user_id, hours=30.0)
        return org_id, user_id, req1, req2

    async def test_every_screen_grades_by_the_older_profile(self, db_session):
        org_id, user_id, req1, _ = await self._tied_org(db_session)

        row = await _matrix_row(db_session, org_id, user_id)
        card = await _card(db_session, user_id)
        own = await _my_training(db_session, user_id)
        view = await _officer_view(db_session, org_id, user_id)
        tally = await compute_org_compliance_tally(db_session, org_id, _today())

        assert {c["requirement_id"] for c in row["requirements"]} == {req1}
        assert (row["requirements_met"], row["requirements_total"]) == (1, 1)
        assert (card.requirements_met, card.requirements_total) == (1, 1)
        assert _ids(own["requirements_detail"]) == {req1}
        assert _met_total(own) == (1, 1)
        assert _ids(view["requirements_detail"]) == {req1}
        assert (tally.compliant, tally.graded) == (1, 1)


class TestOptionalRequirements:
    async def _org(
        self, db: AsyncSession, *, required_null: bool = False
    ) -> tuple[str, str, str, str]:
        """``Req One`` required and met; ``Req Two`` optional and unmet."""
        org_id = await _insert_org(db)
        user_id = await _insert_member(db, org_id)
        req1 = await _insert_hours_req(db, org_id, name="Req One")
        req2 = await _insert_hours_req(db, org_id, name="Req Two", required_hours=100)
        config_id = await _insert_compliance_config(db, org_id)
        await _profile(
            db,
            config_id,
            name="Line",
            required=None if required_null else [req1],
            optional=[req2],
        )
        await _insert_record(db, org_id, user_id, hours=30.0)
        return org_id, user_id, req1, req2

    async def test_my_training_lists_optional_outside_the_counts(self, db_session):
        _, user_id, req1, req2 = await self._org(db_session)

        own = await _my_training(db_session, user_id)

        assert _ids(own["requirements_detail"]) == {req1}
        assert _ids(own["optional_requirements_detail"]) == {req2}
        assert _met_total(own) == (1, 1)
        assert own["requirements_summary"]["avg_compliance"] == 100.0

    async def test_officer_view_matches_my_training(self, db_session):
        org_id, user_id, req1, req2 = await self._org(db_session)

        view = await _officer_view(db_session, org_id, user_id)
        own = await _my_training(db_session, user_id)

        assert _ids(view["requirements_detail"]) == {req1}
        assert _ids(view["optional_requirements_detail"]) == {req2}
        assert view["requirements_summary"] == own["requirements_summary"]

    async def test_matrix_card_and_notices_do_not_grade_optional(self, db_session):
        # A guard: optional was never graded for a profile with a list.
        org_id, user_id, req1, _ = await self._org(db_session)

        row = await _matrix_row(db_session, org_id, user_id)
        card = await _card(db_session, user_id)
        graded = await grade_org_members(db_session, org_id, _today())

        assert {c["requirement_id"] for c in row["requirements"]} == {req1}
        assert (card.requirements_met, card.requirements_total) == (1, 1)
        member = next(g for g in graded if str(g.member.id) == user_id)
        assert {str(req.id) for req, _ in member.evaluations} == {req1}

    async def test_null_required_profile_does_not_grade_its_optional(self, db_session):
        org_id, user_id, req1, req2 = await self._org(db_session, required_null=True)

        row = await _matrix_row(db_session, org_id, user_id)
        card = await _card(db_session, user_id)
        own = await _my_training(db_session, user_id)
        tally = await compute_org_compliance_tally(db_session, org_id, _today())

        assert (row["requirements_met"], row["requirements_total"]) == (1, 1)
        assert (card.requirements_met, card.requirements_total) == (1, 1)
        assert _met_total(own) == (1, 1)
        assert _ids(own["optional_requirements_detail"]) == {req2}
        assert (tally.compliant, tally.graded) == (1, 1)

    async def test_an_id_in_both_lists_is_graded_not_optional(self, db_session):
        org_id = await _insert_org(db_session)
        user_id = await _insert_member(db_session, org_id)
        req1 = await _insert_hours_req(db_session, org_id, name="Req One")
        config_id = await _insert_compliance_config(db_session, org_id)
        await _profile(
            db_session, config_id, name="Line", required=[req1], optional=[req1]
        )

        own = await _my_training(db_session, user_id)

        assert _ids(own["requirements_detail"]) == {req1}
        assert own["optional_requirements_detail"] == []

    async def test_an_optional_requirement_that_does_not_apply_is_not_listed(
        self, db_session
    ):
        # Written beside the reader: before it, nothing optional was listed.
        org_id, user_id, _, _ = await self._org(db_session)
        other = await _insert_hours_req(db_session, org_id, name="Other Type")
        await db_session.execute(
            text(
                "UPDATE training_requirements SET applies_to_all = 0, "
                "required_membership_types = :mt WHERE id = :id"
            ),
            {"mt": json.dumps(["administrative"]), "id": other},
        )
        await db_session.execute(
            text(
                "UPDATE compliance_profiles SET optional_requirement_ids = :oo "
                "WHERE name = 'Line' AND config_id IN "
                "(SELECT id FROM compliance_configs WHERE organization_id = :org)"
            ),
            {"oo": json.dumps([other]), "org": org_id},
        )
        await db_session.flush()

        own = await _my_training(db_session, user_id)

        assert own["optional_requirements_detail"] == []

    async def test_hidden_certification_status_hides_it_on_optional_too(
        self, db_session
    ):
        # Written beside the reader: the strip loop must cover both lists.
        _, user_id, _, req2 = await self._org(db_session)
        member = await _load_member(db_session, user_id)
        await db_session.execute(
            text(
                "INSERT INTO training_module_configs "
                "(id, organization_id, show_certification_status) "
                "VALUES (:id, :org, 0)"
            ),
            {"id": str(uuid.uuid4()), "org": member.organization_id},
        )
        await db_session.flush()

        own = await _my_training(db_session, user_id)

        (optional,) = own["optional_requirements_detail"]
        assert optional["id"] == req2
        assert "cert_expired" not in optional
        assert "blocks_activity" not in optional
