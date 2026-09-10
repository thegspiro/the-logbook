"""The tier ladder is who votes, so the config endpoint has to defend it.

``organization.settings["membership_tiers"]`` decides voting eligibility,
office eligibility, the meeting-attendance threshold for voting and training
exemption, and a scheduled task advances members along it unattended. Until now
the endpoint that writes it took a raw dict, checked two fields of nine, and
stored the rest verbatim.

Two failures matter, and neither raises anything at the time:

* A malformed rung is not rejected by its readers — they are defensive
  ``.get()`` calls, so the rung silently answers "no" to whatever it is asked
  and the member is quietly out of the electorate.
* A tier id is what ``User.membership_type`` stores, and nothing cascades a
  rename or backfills a removal. Dropping a rung members stand on does not move
  them down it: ``split_membership_type`` refuses to guess a class for an id it
  does not recognise, so they leave the operational body and the ballot
  electorate at once.
"""

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.member_status import (
    get_membership_tier_config,
    update_membership_tier_config,
)
from app.models.user import Organization, User
from app.schemas.organization import MembershipTierSettings
from app.services.onboarding import OnboardingService

pytestmark = [pytest.mark.integration]


def _tier(tier_id: str, name: str, years: int = 0, order: int = 0, **benefits) -> dict:
    return {
        "id": tier_id,
        "name": name,
        "years_required": years,
        "sort_order": order,
        "benefits": benefits,
    }


def _config(*tiers: dict, auto_advance: bool = True) -> dict:
    return {"auto_advance": auto_advance, "tiers": list(tiers)}


async def _org(db_session: AsyncSession, tiers: list[dict] | None = None):
    unique = str(uuid.uuid4())[:8]
    org = Organization(
        name=f"Tier Test VFD {unique}",
        slug=f"tier-test-{unique}",
        settings=(
            {"membership_tiers": {"auto_advance": True, "tiers": tiers}}
            if tiers is not None
            else {}
        ),
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(db_session: AsyncSession, org, membership_type: str):
    unique = str(uuid.uuid4())[:8]
    user = User(
        organization_id=org.id,
        username=f"m-{unique}",
        email=f"m-{unique}@example.com",
        password_hash="x",
        first_name="Test",
        last_name="Member",
        membership_type=membership_type,
    )
    db_session.add(user)
    await db_session.flush()
    return user


def _caller(org):
    return User(organization_id=org.id, username="officer", email="o@example.com")


class TestTheConfigIsValidatedByItsOwnModel:
    async def test_a_negative_years_requirement_is_refused(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        with pytest.raises(HTTPException) as exc:
            await update_membership_tier_config(
                _config(_tier("active", "Active", years=-1)),
                db_session,
                _caller(org),
            )
        assert exc.value.status_code == 400

    async def test_an_out_of_range_attendance_threshold_is_refused(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        with pytest.raises(HTTPException) as exc:
            await update_membership_tier_config(
                _config(_tier("active", "Active", voting_min_attendance_pct=140.0)),
                db_session,
                _caller(org),
            )
        assert exc.value.status_code == 400

    async def test_a_tier_with_no_name_is_refused(self, db_session: AsyncSession):
        org = await _org(db_session)
        with pytest.raises(HTTPException) as exc:
            await update_membership_tier_config(
                _config({"id": "active", "benefits": {}}),
                db_session,
                _caller(org),
            )
        assert exc.value.status_code == 400

    async def test_duplicate_tier_ids_are_refused(self, db_session: AsyncSession):
        """Two rungs with one id is a ladder whose readers disagree.

        ``get_tier_by_id`` returns the first match and ``resolve_tier`` the
        highest sort_order, so the same member is on different rungs depending
        on which asked.
        """
        org = await _org(db_session)
        with pytest.raises(HTTPException) as exc:
            await update_membership_tier_config(
                _config(
                    _tier("active", "Active", order=0),
                    _tier("active", "Active Member", order=1),
                ),
                db_session,
                _caller(org),
            )
        assert exc.value.status_code == 400
        assert "Duplicate tier ids" in exc.value.detail

    async def test_a_valid_ladder_is_stored_in_full(self, db_session: AsyncSession):
        org = await _org(db_session)
        await update_membership_tier_config(
            _config(
                _tier(
                    "probationary",
                    "Probationary",
                    years=0,
                    order=0,
                    voting_eligible=False,
                ),
                _tier("active", "Active Member", years=2, order=1),
                auto_advance=False,
            ),
            db_session,
            _caller(org),
        )
        stored = org.settings["membership_tiers"]
        assert stored["auto_advance"] is False
        assert [t["id"] for t in stored["tiers"]] == ["probationary", "active"]
        assert stored["tiers"][0]["benefits"]["voting_eligible"] is False
        # Defaults are materialized rather than left absent, so a reader's
        # fallback and the stored answer cannot disagree.
        assert stored["tiers"][1]["benefits"]["can_hold_office"] is True


class TestAnOccupiedTierCannotBeRemoved:
    async def test_removing_a_tier_members_hold_is_refused(
        self, db_session: AsyncSession
    ):
        org = await _org(
            db_session, [_tier("active", "Active"), _tier("senior", "Senior", order=1)]
        )
        await _member(db_session, org, "senior")
        await _member(db_session, org, "senior")

        with pytest.raises(HTTPException) as exc:
            await update_membership_tier_config(
                _config(_tier("active", "Active")),
                db_session,
                _caller(org),
            )

        assert exc.value.status_code == 400
        assert "'senior' is held by 2 members" in exc.value.detail

    async def test_renaming_a_tier_id_reads_as_removing_it(
        self, db_session: AsyncSession
    ):
        """There is no cascade, so a changed id is a removal plus an addition.

        The display name is what a department wants to change anyway, and that
        is free — only the id is load-bearing.
        """
        org = await _org(db_session, [_tier("senior", "Senior")])
        await _member(db_session, org, "senior")

        with pytest.raises(HTTPException) as exc:
            await update_membership_tier_config(
                _config(_tier("senior_member", "Senior Member")),
                db_session,
                _caller(org),
            )

        assert exc.value.status_code == 400
        assert "'senior' is held by 1 member" in exc.value.detail

    async def test_renaming_only_the_display_name_is_allowed(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session, [_tier("senior", "Senior")])
        await _member(db_session, org, "senior")

        await update_membership_tier_config(
            _config(_tier("senior", "Life Member")),
            db_session,
            _caller(org),
        )

        assert org.settings["membership_tiers"]["tiers"][0]["name"] == "Life Member"

    async def test_removing_an_empty_tier_is_allowed(self, db_session: AsyncSession):
        """A department that does not have a rung must be able to say so."""
        org = await _org(
            db_session, [_tier("active", "Active"), _tier("senior", "Senior", order=1)]
        )
        await _member(db_session, org, "active")

        await update_membership_tier_config(
            _config(_tier("active", "Active")),
            db_session,
            _caller(org),
        )

        assert [t["id"] for t in org.settings["membership_tiers"]["tiers"]] == [
            "active"
        ]


class TestTheEditorIsToldWhoIsOnEachRung:
    async def test_the_config_reports_member_counts(self, db_session: AsyncSession):
        org = await _org(db_session, [_tier("active", "Active")])
        await _member(db_session, org, "active")
        await _member(db_session, org, "active")
        await _member(db_session, org, "administrative")

        result = await get_membership_tier_config(db_session, _caller(org))

        assert result["member_counts"]["active"] == 2
        # The legacy non-tier values are counted too, deliberately: they are
        # what a member holds, and an editor that hid them would offer to
        # delete a rung it could not see was occupied.
        assert result["member_counts"]["administrative"] == 1

    async def test_a_reported_count_is_not_stored_back(self, db_session: AsyncSession):
        """member_counts is a report, not configuration.

        Persisting it would store a snapshot that is wrong the moment anybody
        joins, and readers would have a second, staler answer to a question the
        roster already answers.
        """
        org = await _org(db_session, [_tier("active", "Active")])
        config = await get_membership_tier_config(db_session, _caller(org))

        await update_membership_tier_config(config, db_session, _caller(org))

        assert "member_counts" not in org.settings["membership_tiers"]


class TestTheLadderAFreshDepartmentGets:
    """A department must not finish setup with no ladder at all.

    `advance_all` returns "No membership tiers configured" while
    `settings["membership_tiers"]` is absent, and every benefit reader is a
    defensive `.get()` that answers "no" — so an organization created with
    `settings = {}` had no advancement, no electorate rule, and a setup screen
    reading "No tiers configured" directly beneath its own copy about the
    arrangement we ship.
    """

    async def test_a_new_organization_is_created_with_the_shipped_ladder(
        self, db_session: AsyncSession
    ):
        service = OnboardingService(db_session)
        unique = str(uuid.uuid4())[:8]
        org = await service.create_organization(
            name=f"Ladder Test VFD {unique}",
            slug=f"ladder-test-{unique}",
            organization_type="fire_department",
            timezone="America/New_York",
        )

        stored = org.settings["membership_tiers"]
        assert [t["id"] for t in stored["tiers"]] == [
            t.id for t in MembershipTierSettings().tiers
        ]
        assert stored["auto_advance"] is True

    async def test_a_caller_supplying_its_own_ladder_keeps_it(
        self, db_session: AsyncSession
    ):
        service = OnboardingService(db_session)
        unique = str(uuid.uuid4())[:8]
        org = await service.create_organization(
            name=f"Own Ladder VFD {unique}",
            slug=f"own-ladder-{unique}",
            organization_type="fire_department",
            timezone="America/New_York",
            settings_dict={
                "membership_tiers": {"auto_advance": False, "tiers": []},
            },
        )

        assert org.settings["membership_tiers"] == {
            "auto_advance": False,
            "tiers": [],
        }


class TestAnOrderThatWouldDemote:
    """`sort_order` and `years_required` have to climb together.

    `resolve_tier` returns the qualifying rung with the greatest `sort_order`,
    while qualification is by `years_required`. Reorder Life above Senior and a
    25-year Life member qualifies for both, resolves to Senior because its
    sort_order is now the greater, and the nightly `advance_all` rewrites them
    overnight. Nothing raises; the member finds out at the next election.
    """

    async def test_a_lower_threshold_above_a_higher_one_is_refused(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)

        with pytest.raises(HTTPException) as exc:
            await update_membership_tier_config(
                _config(
                    _tier("life", "Life", years=20, order=0),
                    _tier("senior", "Senior", years=10, order=1),
                ),
                db_session,
                _caller(org),
            )

        assert exc.value.status_code == 400
        assert "move a long-serving member down" in exc.value.detail

    async def test_the_message_names_both_rungs_and_their_years(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)

        with pytest.raises(HTTPException) as exc:
            await update_membership_tier_config(
                _config(
                    _tier("life", "Life", years=20, order=0),
                    _tier("senior", "Senior", years=10, order=1),
                ),
                db_session,
                _caller(org),
            )

        assert "'Senior'" in exc.value.detail
        assert "'Life'" in exc.value.detail
        assert "10 vs 20" in exc.value.detail

    async def test_equal_thresholds_are_allowed(self, db_session: AsyncSession):
        # Two rungs a department separates by something other than tenure —
        # Active and Administrative, both at one year — is a real ladder, and
        # neither can demote the other.
        org = await _org(db_session)

        result = await update_membership_tier_config(
            _config(
                _tier("active", "Active", years=1, order=0),
                _tier("admin_member", "Administrative", years=1, order=1),
            ),
            db_session,
            _caller(org),
        )

        assert [t["id"] for t in result["tiers"]] == ["active", "admin_member"]

    async def test_the_shipped_ladder_passes(self, db_session: AsyncSession):
        # It has to, or every department is blocked from saving the defaults
        # the screen shows them.
        org = await _org(db_session)

        result = await update_membership_tier_config(
            MembershipTierSettings().model_dump(),
            db_session,
            _caller(org),
        )

        assert len(result["tiers"]) == len(MembershipTierSettings().tiers)


class TestBenefitKeysThisModelNeverNamed:
    """Validation must not become a data-loss path.

    Before the endpoint validated, it stored the submitted dict verbatim, so a
    department could hold benefit keys the model never named — the frontend type
    declares `discount_percentage`, `voting_rights` and an open index signature.
    Validating with Pydantic's default `extra="ignore"` and dumping the result
    back would drop them on the first save of an unrelated field, irreversibly,
    and report success.
    """

    async def test_an_unknown_benefit_key_survives_a_save(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)

        result = await update_membership_tier_config(
            _config(
                _tier(
                    "active",
                    "Active",
                    voting_eligible=True,
                    discount_percentage=15,
                )
            ),
            db_session,
            _caller(org),
        )

        assert result["tiers"][0]["benefits"]["discount_percentage"] == 15

    async def test_the_named_fields_are_still_validated(self, db_session: AsyncSession):
        # Allowing extras must not turn off the checks that made this endpoint
        # worth hardening.
        org = await _org(db_session)

        with pytest.raises(HTTPException) as exc:
            await update_membership_tier_config(
                _config(_tier("active", "Active", voting_attendance_period_months=0)),
                db_session,
                _caller(org),
            )

        assert exc.value.status_code == 400


class TestDuplicateDetectionIsBounded:
    async def test_a_ladder_beyond_the_bound_is_refused(self, db_session: AsyncSession):
        # Reachable directly from the API, and the per-tier checks below it are
        # linear in the list, so the list itself has to be bounded.
        org = await _org(db_session)

        with pytest.raises(HTTPException) as exc:
            await update_membership_tier_config(
                _config(
                    *[_tier(f"t{i}", f"Tier {i}", years=i, order=i) for i in range(60)]
                ),
                db_session,
                _caller(org),
            )

        assert exc.value.status_code == 400

    async def test_duplicates_are_still_named(self, db_session: AsyncSession):
        org = await _org(db_session)

        with pytest.raises(HTTPException) as exc:
            await update_membership_tier_config(
                _config(
                    _tier("active", "Active", years=1, order=0),
                    _tier("active", "Active Again", years=1, order=1),
                ),
                db_session,
                _caller(org),
            )

        assert "active" in exc.value.detail


class TestWhatTheScreenIsShownWhenNothingWasConfigured:
    async def test_an_organization_with_no_section_is_shown_the_shipped_ladder(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)  # settings == {}

        result = await get_membership_tier_config(db_session, _caller(org))

        assert [t["id"] for t in result["tiers"]] == [
            t.id for t in MembershipTierSettings().tiers
        ]

    async def test_a_synthesized_ladder_is_reported_as_unsaved(
        self, db_session: AsyncSession
    ):
        """Proposed, not in effect.

        ``MembershipTierService._load_tiers`` reads the stored section, so a
        ladder this endpoint synthesized advances nobody and confers nothing
        until it is saved. An editor told the response was clean would show a
        department settings no reader honours — the same false report the
        fallback exists to fix, moved one step along.
        """
        org = await _org(db_session)  # settings == {}

        result = await get_membership_tier_config(db_session, _caller(org))

        assert result["is_saved"] is False

    async def test_a_stored_ladder_is_reported_as_saved(self, db_session: AsyncSession):
        org = await _org(db_session, tiers=[_tier("active", "Active")])

        result = await get_membership_tier_config(db_session, _caller(org))

        assert result["is_saved"] is True

    async def test_the_saved_flag_is_not_stored_back(self, db_session: AsyncSession):
        # It is a statement about whether the section exists; persisting it
        # would be storing an answer about the storage.
        org = await _org(db_session)

        await update_membership_tier_config(
            {**_config(_tier("active", "Active")), "is_saved": False},
            db_session,
            _caller(org),
        )

        await db_session.refresh(org)
        assert "is_saved" not in org.settings["membership_tiers"]

    async def test_a_deliberately_empty_ladder_is_left_empty(
        self, db_session: AsyncSession
    ):
        # Saving a ladder with no rungs is a decision. Resurrecting the defaults
        # over it is the same overreach as showing nothing to a department that
        # never configured one.
        org = await _org(db_session, tiers=[])

        result = await get_membership_tier_config(db_session, _caller(org))

        assert result["tiers"] == []
