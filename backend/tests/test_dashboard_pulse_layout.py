"""
Department pulse layout — a department default in
``Organization.settings["dashboard_pulse"]`` and a member override in
``User.dashboard_pulse``, resolved by ``resolve_pulse_layout``.

The layout is preference only; which cards a caller may see stays with
``GET /dashboard/widgets`` (``test_dashboard_module_gating.py``).
"""

import uuid

import pydantic
import pytest
from sqlalchemy import select

from app.api.dependencies import PermissionChecker
from app.api.v1.endpoints.dashboard import (
    get_pulse_layout,
    reset_department_pulse_layout,
    reset_my_pulse_layout,
    router,
    set_department_pulse_layout,
    set_my_pulse_layout,
)
from app.models.user import Organization, User
from app.schemas.dashboard_pulse import (
    PULSE_CARD_IDS,
    DashboardPulseLayout,
    PulseCardPreference,
    normalize_pulse_layout,
    resolve_pulse_layout,
)


def _ids(response) -> list[str]:
    return [card.id for card in response.layout.cards]


@pytest.mark.unit
class TestSchema:
    def test_accepts_a_layout_and_trims_titles(self):
        layout = DashboardPulseLayout(
            period="year",
            cards=[
                PulseCardPreference(id="dues", title="  Dues owed  "),
                PulseCardPreference(id="cash_flow", visible=False, title="   "),
            ],
        )
        assert layout.cards[0].title == "Dues owed"
        assert layout.cards[1].title is None
        assert layout.cards[1].visible is False

    @pytest.mark.parametrize(
        "card",
        [
            {"id": "not_a_card"},
            {"id": "dues", "title": "x" * 41},
            {"id": "dues", "title": "two\nlines"},
            {"id": "dues", "visible": "yes please", "title": None},
            {"id": "dues", "unknown": 1},
        ],
    )
    def test_refuses_a_malformed_card(self, card):
        with pytest.raises(pydantic.ValidationError):
            DashboardPulseLayout(cards=[card])

    def test_refuses_a_duplicate_card(self):
        with pytest.raises(pydantic.ValidationError):
            DashboardPulseLayout(cards=[{"id": "dues"}, {"id": "dues"}])

    def test_refuses_an_unknown_period_and_unknown_keys(self):
        with pytest.raises(pydantic.ValidationError):
            DashboardPulseLayout(period="decade")
        with pytest.raises(pydantic.ValidationError):
            DashboardPulseLayout(cards=[], user_id="someone-else")


@pytest.mark.unit
class TestNormalize:
    @pytest.mark.parametrize("stored", [None, "x", 3, [], {}, {"cards": "dues"}])
    def test_unusable_values_read_as_not_set(self, stored):
        assert normalize_pulse_layout(stored) is None

    def test_bad_entries_are_dropped_not_fatal(self):
        stored = {
            "period": "quarter",
            "cards": [
                "dues",
                {"id": "nope"},
                {"id": "cash_flow", "visible": 0, "title": 5},
                {"id": "cash_flow"},
                {"id": "dues", "title": "x" * 99},
            ],
        }
        layout = normalize_pulse_layout(stored)
        assert layout is not None
        assert layout.period == "quarter"
        assert [(c.id, c.visible, c.title) for c in layout.cards] == [
            ("cash_flow", True, None),
            ("dues", True, None),
        ]

    def test_bad_period_alone_is_ignored(self):
        layout = normalize_pulse_layout(
            {"period": "decade", "cards": [{"id": "dues", "visible": False}]}
        )
        assert layout is not None
        assert layout.period is None
        assert layout.cards[0].visible is False


@pytest.mark.unit
class TestResolve:
    def test_nothing_stored_is_the_built_in_layout(self):
        response = resolve_pulse_layout(None, None)
        assert _ids(response) == list(PULSE_CARD_IDS)
        assert all(
            card.visible and card.title is None for card in response.layout.cards
        )
        assert response.layout.period is None
        assert (response.personal, response.organization_default) == (False, False)
        assert response.personal_layout is None

    def test_department_default_applies_without_a_personal_choice(self):
        org = {"cards": [{"id": "public_requests", "title": "Requests"}]}
        response = resolve_pulse_layout(org, None)
        assert _ids(response)[0] == "public_requests"
        assert response.layout.cards[0].title == "Requests"
        assert response.organization_default is True
        assert response.personal is False

    def test_personal_choice_replaces_the_default_wholesale(self):
        org = {"cards": [{"id": "dues", "visible": False}]}
        personal = {"cards": [{"id": "campaign_progress"}]}
        response = resolve_pulse_layout(org, personal)
        assert _ids(response)[0] == "campaign_progress"
        dues = next(c for c in response.layout.cards if c.id == "dues")
        assert dues.visible is True
        assert response.personal is True
        assert [c.id for c in response.personal_layout.cards] == ["campaign_progress"]

    def test_period_falls_back_separately_from_the_cards(self):
        org = {"period": "year", "cards": []}
        personal = {"cards": [{"id": "dues"}]}
        assert resolve_pulse_layout(org, personal).layout.period == "year"
        personal_period = {"period": "quarter", "cards": [{"id": "dues"}]}
        assert resolve_pulse_layout(org, personal_period).layout.period == "quarter"

    def test_a_card_missing_from_a_saved_layout_is_appended_visible(self):
        response = resolve_pulse_layout({"cards": [{"id": "dues"}]}, None)
        assert sorted(_ids(response)) == sorted(PULSE_CARD_IDS)
        assert len(_ids(response)) == len(PULSE_CARD_IDS)
        assert all(card.visible for card in response.layout.cards if card.id != "dues")


@pytest.mark.unit
class TestRoutes:
    def _permissions(self, path: str, method: str) -> list[str] | None:
        route = next(
            r
            for r in router.routes
            if r.path == path and method in getattr(r, "methods", set())
        )
        for dep in route.dependant.dependencies:
            if isinstance(dep.call, PermissionChecker):
                return dep.call.required_permissions
        return None

    @pytest.mark.parametrize("method", ["PUT", "DELETE"])
    def test_department_default_requires_settings_manage(self, method):
        assert "settings.manage" in (
            self._permissions("/pulse-layout/default", method) or []
        )

    @pytest.mark.parametrize("method", ["GET", "PUT", "DELETE"])
    def test_personal_layout_needs_no_permission_and_names_no_user(self, method):
        assert self._permissions("/pulse-layout", method) is None
        paths = {r.path for r in router.routes if "pulse-layout" in r.path}
        assert paths == {"/pulse-layout", "/pulse-layout/default"}


async def _org_and_user(db, org_settings=None, personal=None):
    org = Organization(
        name="Pulse FD",
        slug=f"pulse-{uuid.uuid4().hex[:8]}",
        settings=org_settings or {},
    )
    db.add(org)
    await db.flush()
    user = User(
        organization_id=org.id,
        username=f"member-{uuid.uuid4().hex[:8]}",
        email=f"member-{uuid.uuid4().hex[:8]}@example.org",
        first_name="Member",
        last_name="One",
        dashboard_pulse=personal,
    )
    db.add(user)
    await db.flush()
    return org, user


@pytest.mark.integration
class TestPersistence:
    async def test_personal_layout_round_trips_and_resets(self, db_session):
        _, user = await _org_and_user(db_session)
        user_id = user.id
        body = DashboardPulseLayout(
            period="quarter",
            cards=[
                PulseCardPreference(id="public_requests", title="Outreach"),
                PulseCardPreference(id="dues", visible=False),
            ],
        )

        saved = await set_my_pulse_layout(body=body, current_user=user, db=db_session)
        assert saved.personal is True
        assert _ids(saved)[:2] == ["public_requests", "dues"]

        db_session.expire_all()
        stored = (
            await db_session.execute(select(User).where(User.id == user_id))
        ).scalar_one()
        assert stored.dashboard_pulse["period"] == "quarter"
        reread = await get_pulse_layout(db=db_session, current_user=stored)
        assert reread.layout.cards[0].title == "Outreach"
        assert reread.layout.cards[1].visible is False

        cleared = await reset_my_pulse_layout(db=db_session, current_user=stored)
        assert cleared.personal is False
        assert _ids(cleared) == list(PULSE_CARD_IDS)

    async def test_department_default_reaches_members_without_their_own(
        self, db_session
    ):
        org, admin = await _org_and_user(db_session)
        member = User(
            organization_id=org.id,
            username=f"member-{uuid.uuid4().hex[:8]}",
            email=f"member-{uuid.uuid4().hex[:8]}@example.org",
            first_name="Other",
            last_name="Member",
        )
        db_session.add(member)
        await db_session.flush()

        await set_department_pulse_layout(
            body=DashboardPulseLayout(
                period="year", cards=[PulseCardPreference(id="community_engagement")]
            ),
            current_user=admin,
            db=db_session,
        )
        seen = await get_pulse_layout(db=db_session, current_user=member)
        assert _ids(seen)[0] == "community_engagement"
        assert seen.layout.period == "year"
        assert seen.organization_default is True
        assert seen.personal is False

        reset = await reset_department_pulse_layout(current_user=admin, db=db_session)
        assert reset.organization_default is False
        assert _ids(reset) == list(PULSE_CARD_IDS)

    async def test_another_organizations_default_and_layout_never_apply(
        self, db_session
    ):
        _, owner = await _org_and_user(
            db_session,
            org_settings={"dashboard_pulse": {"cards": [{"id": "public_requests"}]}},
            personal={"cards": [{"id": "campaign_progress"}]},
        )
        _, outsider = await _org_and_user(db_session)

        seen = await get_pulse_layout(db=db_session, current_user=outsider)
        assert _ids(seen) == list(PULSE_CARD_IDS)
        assert (seen.personal, seen.organization_default) == (False, False)
        mine = await get_pulse_layout(db=db_session, current_user=owner)
        assert _ids(mine)[0] == "campaign_progress"

    async def test_a_corrupt_stored_value_degrades_to_the_built_in_layout(
        self, db_session
    ):
        _, user = await _org_and_user(
            db_session,
            org_settings={"dashboard_pulse": "garbage"},
            personal={"cards": [{"id": "ghost"}], "period": 7},
        )
        seen = await get_pulse_layout(db=db_session, current_user=user)
        assert _ids(seen) == list(PULSE_CARD_IDS)
        assert (seen.personal, seen.organization_default) == (False, False)
