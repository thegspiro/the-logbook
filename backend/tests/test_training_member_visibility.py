"""The member visibility panel: who may set it, and what it actually withholds.

Every assertion here corresponds to a defect found on 2026-08-25, when the
panel was reviewed end to end:

* the settings were gated on ``training.manage`` — the grant that also creates
  and edits anybody's training records — so the Membership Coordinator, whose
  job the disclosure policy is, could not set it;
* four toggles did not do what their labels said, two of them doing nothing at
  all;
* the member export answered to none of them.
"""

import ast
from pathlib import Path

import pytest
from sqlalchemy import select

from app.api.v1.endpoints.training_module_config import (
    export_my_training,
    get_my_training_summary,
)
from app.core.permissions import (
    ALL_PERMISSIONS,
    DEFAULT_POSITIONS,
    OPERATIONAL_RANKS,
)
from app.models.training import TrainingModuleConfig
from app.models.user import User
from app.services.training_module_config_service import TrainingModuleConfigService

_ENDPOINT_SOURCE = (
    Path(__file__).parents[1] / "app/api/v1/endpoints/training_module_config.py"
)

# Kept in step with the migration by
# ``test_every_seeded_training_configure_grant_is_covered_by_the_migration``.
_MIGRATION_SOURCE = (
    Path(__file__).parents[1]
    / "alembic/versions/20260825_1400_e3b7c25f9a41_grant_training_configure.py"
)


def _handler(name: str) -> ast.AsyncFunctionDef:
    tree = ast.parse(_ENDPOINT_SOURCE.read_text())
    return next(
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == name
    )


def _permission_names(handler_name: str) -> set[str]:
    call = next(
        node
        for node in ast.walk(_handler(handler_name).args)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "require_permission"
    )
    return {ast.literal_eval(argument) for argument in call.args}


# ---------------------------------------------------------------------------
# Who may configure the panel
# ---------------------------------------------------------------------------


def test_training_configure_is_a_registered_permission():
    assert "training.configure" in {p.name for p in ALL_PERMISSIONS}


def test_config_write_accepts_training_configure_and_training_manage():
    """Both, deliberately.

    ``training.configure`` is what the panel is about; ``training.manage`` is
    accepted alongside it so a department's own customized position keeps the
    access it already had rather than losing it to a rename.
    """
    assert _permission_names("update_training_module_config") == {
        "training.configure",
        "training.manage",
    }
    assert _permission_names("get_skill_evaluation_names") == {
        "training.configure",
        "training.manage",
    }


def test_membership_coordinator_configures_without_managing_records():
    """The coordinator sets disclosure policy; they do not edit training files.

    That separation is the whole reason ``training.configure`` exists — the
    alternative on the table was handing them ``training.manage``, which is
    create/edit/delete on any member's training records.
    """
    grants = DEFAULT_POSITIONS["membership_coordinator"]["permissions"]
    assert "training.configure" in grants
    assert "training.manage" not in grants


def test_every_training_manage_holder_also_configures():
    """Nobody loses the panel to the new grant."""
    for slug, position in DEFAULT_POSITIONS.items():
        if "training.manage" in position["permissions"]:
            assert "training.configure" in position["permissions"], slug
    for slug, rank in OPERATIONAL_RANKS.items():
        if "training.manage" in rank["default_permissions"]:
            assert "training.configure" in rank["default_permissions"], slug


def test_every_seeded_training_configure_grant_is_covered_by_the_migration():
    """Pitfall #23: a registry change alone leaves existing departments behind.

    Onboarding copies these lists into ``positions`` rows, so a department that
    has already run it keeps its stored permissions until a migration rewrites
    them. The rank-mirroring positions are the ones easily missed —
    ``DEFAULT_POSITIONS["fire_chief"]["permissions"]`` *is*
    ``OPERATIONAL_RANKS["fire_chief"]["default_permissions"]``.
    """
    migration = ast.parse(_MIGRATION_SOURCE.read_text())
    slugs = next(
        ast.literal_eval(node.value)
        for node in migration.body
        if isinstance(node, ast.Assign)
        and isinstance(node.targets[0], ast.Name)
        and node.targets[0].id == "_SLUGS"
    )

    seeded = {
        slug
        for slug, position in DEFAULT_POSITIONS.items()
        if "training.configure" in position["permissions"]
    }
    assert seeded, "registry carries no training.configure grant to migrate"
    assert seeded == set(slugs)


# ---------------------------------------------------------------------------
# What the flags withhold
# ---------------------------------------------------------------------------


def test_officer_narrative_fallback_is_closed():
    """The one flag whose column default is False needs a matching fallback.

    Every other officer-content field defaults open, which is right for them
    and wrong here: the narrative is candid prose written for the training
    file, and a missing key must not publish it.
    """
    call = next(
        node
        for node in ast.walk(_handler("get_my_training_summary"))
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "get"
        and node.args
        and isinstance(node.args[0], ast.Constant)
        and node.args[0].value == "show_officer_narrative"
    )
    assert len(call.args) == 2, "fallback default is missing entirely"
    assert ast.literal_eval(call.args[1]) is False


def test_visibility_dict_coerces_a_null_narrative_closed():
    """Columns added after a row exists come back NULL; that is not consent."""
    config = TrainingModuleConfig()
    config.show_officer_narrative = None
    assert config.to_visibility_dict()["show_officer_narrative"] is False


async def _member(db_session, setup_org_and_admin) -> User:
    _org_id, admin_id = setup_org_and_admin
    result = await db_session.execute(select(User).where(User.id == admin_id))
    user = result.scalar_one()
    # No roles assigned, so the endpoint's officer check resolves to False and
    # the visibility flags actually apply.
    return user


async def _configure(db_session, org_id: str, **flags) -> None:
    service = TrainingModuleConfigService(db_session)
    await service.update_config(organization_id=org_id, updated_by=None, **flags)


async def test_hours_are_withheld_but_the_counts_survive(
    db_session, setup_org_and_admin
):
    """``show_training_hours`` had no reader anywhere before this.

    The counts stay: "how many courses have I completed" is history, and the
    page's core stat row needs it.
    """
    org_id, _ = setup_org_and_admin
    user = await _member(db_session, setup_org_and_admin)
    await _configure(db_session, org_id, show_training_hours=False)

    result = await get_my_training_summary(db=db_session, current_user=user)

    summary = result["hours_summary"]
    assert "total_hours" not in summary
    assert "hours_this_month" not in summary
    assert summary["completed_courses"] == 0


async def test_requirement_details_are_withheld_when_switched_off(
    db_session, setup_org_and_admin
):
    """The main breakdown ignored this flag; only the pipeline copy honoured it."""
    org_id, _ = setup_org_and_admin
    user = await _member(db_session, setup_org_and_admin)
    await _configure(db_session, org_id, show_requirement_details=False)

    result = await get_my_training_summary(db=db_session, current_user=user)

    assert "requirements_detail" not in result
    # The compliance percentage is a core stat and stays.
    assert "requirements_summary" in result


async def test_hiding_certification_status_hides_the_cert_derived_flags(
    db_session, setup_org_and_admin
):
    """Otherwise the requirements list still reads "Certification expired"."""
    org_id, _ = setup_org_and_admin
    user = await _member(db_session, setup_org_and_admin)
    await _configure(db_session, org_id, show_certification_status=False)

    result = await get_my_training_summary(db=db_session, current_user=user)

    assert "certifications" not in result
    for detail in result.get("requirements_detail", []):
        assert "cert_expired" not in detail
        assert "blocks_activity" not in detail


async def test_defaults_disclose_everything_the_page_already_showed(
    db_session, setup_org_and_admin
):
    """A department that changes nothing must see no change."""
    user = await _member(db_session, setup_org_and_admin)

    result = await get_my_training_summary(db=db_session, current_user=user)

    assert "total_hours" in result["hours_summary"]
    assert "requirements_detail" in result
    assert "certifications" in result


# ---------------------------------------------------------------------------
# The export is not a way around the flags
# ---------------------------------------------------------------------------


async def test_export_refused_when_history_is_hidden(db_session, setup_org_and_admin):
    """Enabling export must not hand back what the page withholds."""
    from fastapi import HTTPException

    org_id, _ = setup_org_and_admin
    user = await _member(db_session, setup_org_and_admin)
    await _configure(
        db_session,
        org_id,
        allow_member_report_export=True,
        show_training_history=False,
    )

    with pytest.raises(HTTPException) as excinfo:
        await export_my_training(db=db_session, current_user=user)

    assert excinfo.value.status_code == 403


async def test_export_omits_certification_columns_when_hidden(db_session):
    """The CSV carried certification numbers and expiry unconditionally."""
    from app.services.training_enhancement_service import ReportExportService

    service = ReportExportService(db_session)

    withheld = await service.generate_individual_csv(
        "no-such-user", "no-such-org", include_certifications=False
    )
    full = await service.generate_individual_csv("no-such-user", "no-such-org")

    header = withheld.splitlines()[0]
    assert "Certification #" not in header
    assert "Expiration Date" not in header
    assert "Certification #" in full.splitlines()[0]
