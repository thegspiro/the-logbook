"""The setup wizard's Positions step stores only what its editor can express.

ONB-7: ``save_session_roles`` took the client's ``priority`` verbatim, made any
non-custom slug an undeletable ``is_system`` row, let a custom position reuse a
built-in slug (and so rewrite the built-in row), and expanded any
``permissions`` key into ``{key}.view`` / ``{key}.*`` grants. The owner chose
"clamp and allowlist": priority is the registry's for a built-in position and
clamped below the System Owner's for anything else, ``is_system`` follows the
registry rather than the client flag, a custom position may not take a
built-in identifier, and permission keys must be modules the editor renders.
"""

import re
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.onboarding import (
    RolePermission,
    RoleSetupItem,
    RolesSetupRequest,
    _check_submitted_positions,
    _custom_priority_ceiling,
    _stored_priority,
    save_session_roles,
)
from app.core.constants import ROLE_IT_MANAGER
from app.core.permissions import DEFAULT_ROLES
from app.models.user import Position
from app.services.onboarding import (
    ONBOARDING_POSITION_EDITOR_MODULE_IDS,
    OnboardingService,
)

_ONBOARDING = Path(__file__).resolve().parents[2] / "frontend" / "src" / "modules"
_REGISTRY = _ONBOARDING / "onboarding" / "config" / "moduleRegistry.ts"
_TEMPLATES = _ONBOARDING / "onboarding" / "pages" / "positionTemplates.ts"


def _item(slug, *, priority=50, custom=False, permissions=None, name=None):
    return RoleSetupItem(
        id=slug,
        name=name or slug.replace("_", " ").title(),
        priority=priority,
        is_custom=custom,
        permissions=permissions or {},
    )


@pytest.mark.unit
class TestTheRules:
    def test_the_allowlist_is_exactly_the_editors_module_rows(self):
        """Every row RoleSetup renders, System entries included — no more."""
        ids = set(
            re.findall(
                r"id:\s*'([\w]+)'[^}]*?category:\s*'[\w /]+'",
                _REGISTRY.read_text(),
                re.S,
            )
        )
        assert ids, f"no module ids parsed from {_REGISTRY.name}"
        assert ONBOARDING_POSITION_EDITOR_MODULE_IDS == ids

    def test_the_templates_present_the_priority_that_will_be_stored(self):
        """A built-in position's stored priority is the registry's, so the
        editor's sort order must not promise a different one."""
        source = _TEMPLATES.read_text()
        pairs = re.findall(r"id: '([\w]+)',.*?priority: (\d+),", source, re.S)
        assert pairs, f"no templates parsed from {_TEMPLATES.name}"
        drift = {
            slug: (int(shown), DEFAULT_ROLES[slug]["priority"])
            for slug, shown in pairs
            if slug in DEFAULT_ROLES and int(shown) != DEFAULT_ROLES[slug]["priority"]
        }
        assert not drift, drift

    def test_the_ceiling_sits_below_the_system_owner(self):
        assert (
            _custom_priority_ceiling() == DEFAULT_ROLES[ROLE_IT_MANAGER]["priority"] - 1
        )

    def test_a_built_in_position_takes_the_registry_priority(self):
        assert _stored_priority(_item("fire_chief", priority=100), None) == 95
        assert _stored_priority(_item("member", priority=0), None) == 10

    def test_a_seeded_row_the_registry_no_longer_lists_keeps_its_own(self):
        row = SimpleNamespace(priority=33)
        assert _stored_priority(_item("retired_rank", priority=100), row) == 33

    def test_anything_client_defined_is_clamped(self):
        assert _stored_priority(_item("x", priority=100, custom=True), None) == 99
        assert _stored_priority(_item("x", priority=40, custom=True), None) == 40
        assert _stored_priority(_item("unknown_slug", priority=100), None) == 99

    def test_an_unknown_module_key_is_refused(self):
        roles = [_item("captain", permissions={"users": RolePermission(manage=True)})]
        with pytest.raises(HTTPException) as exc:
            _check_submitted_positions(roles, set())
        assert exc.value.status_code == 400
        assert "users" in exc.value.detail

    @pytest.mark.parametrize("slug", ["member", "fire_chief", "it_manager"])
    def test_a_custom_position_cannot_take_a_built_in_identifier(self, slug):
        with pytest.raises(HTTPException) as exc:
            _check_submitted_positions([_item(slug, custom=True)], set())
        assert exc.value.status_code == 400

    def test_a_custom_position_cannot_take_a_seeded_rows_identifier(self):
        with pytest.raises(HTTPException):
            _check_submitted_positions(
                [_item("retired_rank", custom=True)], {"retired_rank"}
            )

    def test_what_the_editor_sends_passes(self):
        roles = [
            _item(
                "captain",
                permissions={
                    m: RolePermission() for m in ONBOARDING_POSITION_EDITOR_MODULE_IDS
                },
            ),
            _item("water_rescue_lead", custom=True),
        ]
        _check_submitted_positions(roles, {"captain"})


async def _org(db_session: AsyncSession):
    unique = str(uuid.uuid4())[:8]
    org = await OnboardingService(db_session).create_organization(
        name=f"Clamp Test Department {unique}",
        slug=f"clamp-test-{unique}",
        organization_type="fire_department",
        timezone="America/New_York",
    )
    await db_session.flush()
    return org


async def _save(db_session: AsyncSession, org_id: str, roles):
    session = SimpleNamespace(data={"department": {"organization_id": str(org_id)}})
    with (
        patch(
            "app.api.v1.onboarding.validate_session",
            new=AsyncMock(return_value=session),
        ),
        patch(
            "app.services.onboarding.OnboardingService.needs_onboarding",
            new=AsyncMock(return_value=True),
        ),
    ):
        return await save_session_roles(
            SimpleNamespace(), RolesSetupRequest(roles=roles), db_session
        )


async def _rows(db_session: AsyncSession, org_id: str) -> dict:
    result = await db_session.execute(
        select(Position).where(Position.organization_id == org_id)
    )
    return {p.slug: p for p in result.scalars().all()}


@pytest.mark.integration
@pytest.mark.onboarding
class TestTheStoredRows:
    async def test_client_priority_and_system_flag_are_not_trusted(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        await _save(
            db_session,
            org.id,
            [
                _item(ROLE_IT_MANAGER, priority=100),
                _item("member", priority=10),
                _item("fire_chief", priority=100),
                _item("water_rescue_lead", priority=100, custom=True),
                _item("shadow_admin", priority=100),
            ],
        )

        rows = await _rows(db_session, org.id)
        assert rows["fire_chief"].priority == 95
        assert rows["fire_chief"].is_system is True
        assert rows["water_rescue_lead"].priority == 99
        assert rows["water_rescue_lead"].is_system is False
        # Not a registry slug, so not minted as an undeletable system row.
        assert rows["shadow_admin"].is_system is False
        assert rows["shadow_admin"].priority == 99

    async def test_a_refused_submission_writes_nothing(self, db_session: AsyncSession):
        org = await _org(db_session)
        await _save(
            db_session,
            org.id,
            [
                _item(ROLE_IT_MANAGER),
                _item("member"),
                _item("fire_chief"),
                _item("water_rescue_lead", custom=True),
            ],
        )
        before = await _rows(db_session, org.id)
        chief_permissions = list(before["fire_chief"].permissions)

        for bad in (
            [_item("fire_chief", permissions={"audit": RolePermission(manage=True)})],
            [_item("fire_chief", custom=True, name="Fire Chief")],
        ):
            with pytest.raises(HTTPException) as exc:
                await _save(db_session, org.id, [_item(ROLE_IT_MANAGER), *bad])
            assert exc.value.status_code == 400

        after = await _rows(db_session, org.id)
        assert set(after) == set(before)
        assert "water_rescue_lead" in after
        assert list(after["fire_chief"].permissions) == chief_permissions
        assert after["fire_chief"].is_system is True
