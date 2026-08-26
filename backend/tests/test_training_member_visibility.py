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
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select, text

from app.api.v1.endpoints.training_module_config import (
    export_my_training,
    get_my_training_summary,
)
from app.core.constants import TRAINING_OFFICER_ROLE_SLUGS
from app.core.permissions import (
    ALL_PERMISSIONS,
    DEFAULT_POSITIONS,
    OPERATIONAL_RANKS,
)
from app.models.training import TrainingModuleConfig
from app.models.user import User
from app.schemas.training_module_config import (
    MEMBER_DISCLOSURE_FIELDS,
    TrainingModuleConfigUpdate,
)
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


def _migration_slugs() -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Read ``_MIRROR_SLUGS`` and ``_NEW_GRANT_SLUGS`` out of the migration."""
    migration = ast.parse(_MIGRATION_SOURCE.read_text())
    found = {
        node.targets[0].id: ast.literal_eval(node.value)
        for node in migration.body
        if isinstance(node, ast.Assign)
        and isinstance(node.targets[0], ast.Name)
        and node.targets[0].id in {"_MIRROR_SLUGS", "_NEW_GRANT_SLUGS"}
    }
    return found["_MIRROR_SLUGS"], found["_NEW_GRANT_SLUGS"]


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
    mirror, new_grant = _migration_slugs()

    seeded = {
        slug
        for slug, position in DEFAULT_POSITIONS.items()
        if "training.configure" in position["permissions"]
    }
    assert seeded, "registry carries no training.configure grant to migrate"
    assert seeded == set(mirror) | set(new_grant)


def test_migration_splits_mirror_grants_from_the_new_one():
    """The two tiers are not interchangeable.

    A department may edit a system position's permissions, so a slug that
    carries ``training.configure`` only because it carried ``training.manage``
    must be checked against the row's *current* grants — otherwise the
    backfill re-grants configuration access to a captain an administrator
    deliberately restricted. The Membership Coordinator is the exception: the
    permission is new, so no prior removal can have expressed an intent about
    it.
    """
    mirror, new_grant = _migration_slugs()

    assert set(new_grant) == {"membership_coordinator"}
    for slug in mirror:
        assert "training.manage" in DEFAULT_POSITIONS[slug]["permissions"], slug
    assert (
        "training.manage"
        not in DEFAULT_POSITIONS["membership_coordinator"]["permissions"]
    )


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


async def _grant_officer_position(
    db_session, org_id: str, user_id: str, slug: str = "training_officer"
) -> None:
    """Attach a position the endpoint's officer check recognizes.

    Name and slug are the *seeded* pair — "Training Officer" / ``training_officer``
    — because that is the data a real department has. The fixture used to set
    the name equal to the slug so the check would pass against ``Position.name``;
    it now matches on ``Position.slug``, so this exercises the real shape.
    """
    position_id = str(uuid.uuid4())
    name = DEFAULT_POSITIONS[slug]["name"]
    await db_session.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, is_system) "
            "VALUES (:i, :o, :n, :s, :y)"
        ),
        {"i": position_id, "o": org_id, "n": name, "s": slug, "y": True},
    )
    await db_session.execute(
        text("INSERT INTO user_positions (user_id, position_id) " "VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    await db_session.flush()


# The rest of this module drives the endpoint against a real database, so it
# belongs to the integration job. The unit job runs `-m "not integration"`
# with no database at all — an unmarked db_session test errors there rather
# than failing informatively.
@pytest.mark.integration
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


@pytest.mark.integration
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


@pytest.mark.integration
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


@pytest.mark.integration
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


@pytest.mark.integration
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


@pytest.mark.integration
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


# ---------------------------------------------------------------------------
# Review findings, 2026-08-25
# ---------------------------------------------------------------------------


def test_disclosure_allowlist_covers_only_visibility_fields():
    """``training.configure`` must not reach the shift-report system.

    The update schema carries far more than disclosure policy — whether shift
    reports exist at all, manual entry, the officer's form sections, apparatus
    mappings, the review workflow and the rating scale. A Membership
    Coordinator holding this permission alone would otherwise be able to
    switch off a system they deliberately do not administer.
    """
    all_fields = set(TrainingModuleConfigUpdate.model_fields)

    assert MEMBER_DISCLOSURE_FIELDS <= all_fields
    operational = all_fields - MEMBER_DISCLOSURE_FIELDS
    for field in (
        "shift_reports_enabled",
        "manual_entry_enabled",
        "report_review_required",
        "rating_scale_type",
        "apparatus_type_skills",
        "form_show_officer_narrative",
    ):
        assert field in operational, field
    for field in ("show_officer_narrative", "skills_result_disclosure"):
        assert field in MEMBER_DISCLOSURE_FIELDS, field


def test_update_handler_checks_training_manage_for_operational_fields():
    """The allowlist is enforced in the handler, not merely documented."""
    source = ast.unparse(_handler("update_training_module_config"))
    assert "MEMBER_DISCLOSURE_FIELDS" in source
    assert "user_has_permission(current_user, 'training.manage')" in source


@pytest.mark.integration
async def test_officer_visibility_is_reported_as_effective(
    db_session, setup_org_and_admin
):
    """Officers are exempt on the server; the payload has to say so.

    The page re-applies these flags client-side, so returning the raw org
    policy hid sections from the very people the endpoint had already decided
    to exempt.
    """
    org_id, _ = setup_org_and_admin
    user = await _member(db_session, setup_org_and_admin)
    await _configure(
        db_session,
        org_id,
        show_training_hours=False,
        show_shift_stats=False,
        allow_member_report_export=False,
    )

    as_member = await get_my_training_summary(db=db_session, current_user=user)
    assert as_member["visibility"]["show_training_hours"] is False

    # Same caller, now holding the seeded training-officer position — name
    # "Training Officer", slug ``training_officer``. Until 2026-08-26 the
    # endpoint compared TRAINING_OFFICER_ROLE_SLUGS against ``Position.name``,
    # so this exemption could not fire on any real installation and the fixture
    # had to set the name equal to the slug to exercise it at all.
    await _grant_officer_position(db_session, org_id, str(user.id))

    # Drop the identity map before re-reading. The endpoint re-queries the
    # user with selectinload(User.roles), but SQLAlchemy will not overwrite an
    # already-populated collection on an instance it still holds, so without
    # this the officer still looks position-less.
    db_session.expunge_all()
    user = await _member(db_session, setup_org_and_admin)

    as_officer = await get_my_training_summary(db=db_session, current_user=user)

    visibility = as_officer["visibility"]
    assert all(v is True for k, v in visibility.items() if k.startswith("show_"))
    # Not folded in: the export endpoint has no officer exemption either, so
    # flipping this would offer a button that 403s.
    assert visibility["allow_member_report_export"] is False


async def test_the_seeded_fire_chief_also_counts_as_an_officer(
    db_session, setup_org_and_admin
):
    """The chief is in TRAINING_OFFICER_ROLE_SLUGS and never matched it.

    The group named ``"chief"``, and no department is seeded a position with
    that slug — the chief's slug is ``fire_chief``. Combined with the
    name-versus-slug comparison this endpoint used to do, a chief opening
    /my-training got the plain member's visibility policy. Both halves are
    fixed; this asserts the outcome rather than either mechanism.
    """
    org_id, _ = setup_org_and_admin
    user = await _member(db_session, setup_org_and_admin)
    await _configure(db_session, org_id, show_training_hours=False)

    assert "fire_chief" in TRAINING_OFFICER_ROLE_SLUGS
    await _grant_officer_position(db_session, org_id, str(user.id), slug="fire_chief")

    # See the note in the sibling test: the identity map holds a populated
    # positions collection that a re-query will not overwrite.
    db_session.expunge_all()
    user = await _member(db_session, setup_org_and_admin)

    summary = await get_my_training_summary(db=db_session, current_user=user)
    assert summary["visibility"]["show_training_hours"] is True


def test_member_shift_queries_filter_on_release():
    """Draft, pending and flagged reports must not reach the trainee.

    ``/shift-completion/my-*`` passes ``released_only=True`` for exactly this
    reason. These two queries did not, so the shift statistics — the average
    rating above all — exposed an officer's assessment before approval.
    """
    source = ast.unparse(_handler("get_my_training_summary"))
    assert "ShiftCompletionReport.review_status == 'approved'" in source
    # Applied to both the report list and the aggregate, and only for members.
    assert source.count("*released_only") == 2
    assert "if is_officer else" in source
