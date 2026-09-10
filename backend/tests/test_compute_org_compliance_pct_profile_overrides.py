"""
`compute_org_compliance_pct` matches a member to a compliance profile and
then reads two things off it: `required_requirement_ids` (which
requirements count) and the threshold overrides. Both were gated behind a
single `if profile and profile.required_requirement_ids:` — truthy, not
`is not None`.

Two distinct profile configurations tripped that guard, and both are real:

- A profile that explicitly selects zero required requirements (`[]`,
  "nothing is required for this group") is indistinguishable from a
  profile that never set the field at all (`None`, "use every org-wide
  requirement"). `[]` fell through to grading the member against every
  active org requirement instead of none. CMP2-2 (the frontend change that
  makes clearing a profile's last required requirement actually send `[]`
  instead of silently omitting the key) is what made this reachable in
  practice — see CMP2-3 in docs/security-review/CMP-20-compliance.md.
- A profile that overrides only the compliance thresholds, and deliberately
  leaves `required_requirement_ids` unset (`None`, "still grade against all
  org requirements, just with a different pass bar for this group") never
  got its threshold override applied either, for the same reason.

Both are fixed by decoupling the two: the requirement-list substitution
checks `is not None`, and the threshold overrides apply whenever a profile
matched, independent of whether it also overrides the requirement list.
"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.compliance_config import ComplianceConfig, ComplianceProfile
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingRequirement,
)
from app.models.user import Organization, User, UserStatus
from app.services.training_compliance import compute_org_compliance_pct

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Profile Override Department",
        slug=f"profoverride-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _active_member(db_session, org) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{handle}",
        email=f"{handle}@profoverride.test",
        first_name="Test",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        membership_type="active",
    )
    db_session.add(user)
    await db_session.flush()
    # `_find_matching_profile` reads `member.positions` unconditionally (even
    # when no profile uses role_ids), and `compute_org_compliance_pct`'s own
    # member query has no eager load for it. A plain `select(User)` later in
    # the same session returns this identity-mapped instance as-is, so
    # warming the relationship here (matching how production requests already
    # have positions loaded via the auth dependency's eager load) avoids an
    # untouched lazy relationship raising MissingGreenlet on an AsyncSession
    # (see test_admin_hours_compliance_lookup.py for the same story).
    await db_session.execute(
        select(User).options(selectinload(User.positions)).where(User.id == user.id)
    )
    return user


async def _annual_hours_requirement(
    db_session, org, **overrides
) -> TrainingRequirement:
    """An HOURS requirement with no records filed against it anywhere —
    a member graded against it is 0% complete."""
    overrides.setdefault("applies_to_all", True)
    req = TrainingRequirement(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Annual Training Hours",
        requirement_type=RequirementType.HOURS,
        required_hours=24.0,
        frequency=RequirementFrequency.ANNUAL,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        active=True,
        **overrides,
    )
    db_session.add(req)
    await db_session.flush()
    return req


async def _config(db_session, org, **overrides) -> ComplianceConfig:
    config = ComplianceConfig(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        threshold_type="percentage",
        compliant_threshold=100.0,
        at_risk_threshold=75.0,
        **overrides,
    )
    db_session.add(config)
    await db_session.flush()
    return config


class TestEmptyRequiredRequirementIds:
    async def test_explicit_empty_list_means_nothing_required(self, db_session):
        """A profile that explicitly cleared its required list must grade the
        member against nothing, not against every org requirement — the
        pre-fix behaviour, since `[]` is falsy."""
        org = await _org(db_session)
        # A strong local reference matters here, not just style: the ORM
        # identity map holds objects weakly, and `_active_member` warms
        # `positions` onto this exact instance. Discard the reference and it
        # can be GC'd before `compute_org_compliance_pct` runs, which then
        # reloads a fresh, positions-unloaded `User` and reintroduces the
        # MissingGreenlet this fixture exists to avoid.
        member = await _active_member(db_session, org)
        assert member.organization_id == org.id
        await _annual_hours_requirement(db_session, org)  # unmet by `member`
        config = await _config(db_session, org)
        profile = ComplianceProfile(
            id=str(uuid.uuid4()),
            config_id=config.id,
            name="No requirements group",
            required_requirement_ids=[],
            is_active=True,
            priority=10,
        )
        db_session.add(profile)
        await db_session.flush()

        pct = await compute_org_compliance_pct(db_session, org.id)

        # The only member is graded against zero requirements (the profile's
        # explicit []), so they are trivially fully compliant.
        assert pct == 100.0

    async def test_unset_required_requirement_ids_still_grades_all(self, db_session):
        """The other direction, so the test above cannot pass by always
        returning 100 regardless of what the profile says: a profile that
        never touched required_requirement_ids (None) still falls back to
        every org requirement, and the (unmet) requirement fails the member."""
        org = await _org(db_session)
        # A strong local reference matters here, not just style: the ORM
        # identity map holds objects weakly, and `_active_member` warms
        # `positions` onto this exact instance. Discard the reference and it
        # can be GC'd before `compute_org_compliance_pct` runs, which then
        # reloads a fresh, positions-unloaded `User` and reintroduces the
        # MissingGreenlet this fixture exists to avoid.
        member = await _active_member(db_session, org)
        assert member.organization_id == org.id
        await _annual_hours_requirement(db_session, org)  # unmet by `member`
        config = await _config(db_session, org)
        profile = ComplianceProfile(
            id=str(uuid.uuid4()),
            config_id=config.id,
            name="Default group",
            required_requirement_ids=None,
            is_active=True,
            priority=10,
        )
        db_session.add(profile)
        await db_session.flush()

        pct = await compute_org_compliance_pct(db_session, org.id)

        assert pct == 0.0


class TestThresholdOverrideAppliesRegardlessOfRequiredList:
    async def test_threshold_override_applies_with_unset_required_list(
        self, db_session
    ):
        """A profile that overrides only the pass bar (and leaves
        required_requirement_ids unset, meaning "still grade against every
        org requirement") must have that override actually used. Nesting the
        override inside the same guard as required_requirement_ids meant a
        profile with no override list never got its threshold applied."""
        org = await _org(db_session)
        # A strong local reference matters here, not just style: the ORM
        # identity map holds objects weakly, and `_active_member` warms
        # `positions` onto this exact instance. Discard the reference and it
        # can be GC'd before `compute_org_compliance_pct` runs, which then
        # reloads a fresh, positions-unloaded `User` and reintroduces the
        # MissingGreenlet this fixture exists to avoid.
        member = await _active_member(db_session, org)
        assert member.organization_id == org.id
        await _annual_hours_requirement(db_session, org)  # unmet by `member` -> 0%
        config = await _config(db_session, org)
        profile = ComplianceProfile(
            id=str(uuid.uuid4()),
            config_id=config.id,
            name="Lenient group",
            required_requirement_ids=None,
            compliant_threshold_override=0.0,
            at_risk_threshold_override=0.0,
            is_active=True,
            priority=10,
        )
        db_session.add(profile)
        await db_session.flush()

        pct = await compute_org_compliance_pct(db_session, org.id)

        # 0% complete against the org's one requirement, but the profile's
        # 0% compliant-threshold override means even 0% passes.
        assert pct == 100.0


class TestMembershipTypeExclusion:
    """get_compliance_matrix (training.py) drops a requirement from a
    member's denominator whenever `required_membership_types` is set and the
    member's own type isn't in it. `compute_org_compliance_pct` — which feeds
    the dashboard percentage the matrix links from — evaluated every
    profile-selected requirement regardless, so a membership-scoped
    requirement the matrix correctly excludes could still fail the member
    here: the two screens describing the same member disagreeing, the exact
    shape CLAUDE.md Pitfall #29 exists to prevent. Caught by a Codex review
    of TR-17 pass 4 (PR #2455) after that pass's own findings file first
    (wrongly) reported this as a shared definition with no remaining drift.
    """

    async def test_requirement_restricted_to_another_membership_type_is_excluded(
        self, db_session
    ):
        """An `active` member is not graded against a requirement scoped to
        `reserve` only — without the fix this unmet requirement drags the
        member to 0%, even though the matrix would never show it to them."""
        org = await _org(db_session)
        member = await _active_member(db_session, org)
        assert member.organization_id == org.id
        # applies_to_all=False is required here, not incidental:
        # RequirementModal.tsx only allows setting required_membership_types
        # with "Applies to All" unchecked, and applies_to_all takes
        # precedence wherever this list is read (TR4-1's own fix included).
        # A row claiming both would apply to everyone regardless of the
        # list, which is the opposite of what this test needs to exercise.
        await _annual_hours_requirement(
            db_session,
            org,
            required_membership_types=["reserve"],
            applies_to_all=False,
        )  # scoped away from `member`; unmet if it counted

        pct = await compute_org_compliance_pct(db_session, org.id)

        # The requirement never applies to this member, so their denominator
        # is empty and they are trivially fully compliant — matching
        # get_compliance_matrix's own `continue` for the same case.
        assert pct == 100.0

    async def test_requirement_restricted_to_the_members_own_type_still_counts(
        self, db_session
    ):
        """The other direction, so the test above cannot pass by excluding
        every requirement regardless of type: a requirement scoped to the
        member's own membership type is still graded (and, being unmet,
        still fails them)."""
        org = await _org(db_session)
        member = await _active_member(db_session, org)
        assert member.organization_id == org.id
        await _annual_hours_requirement(
            db_session,
            org,
            required_membership_types=["active"],
            applies_to_all=False,
        )  # scoped to `member`'s own type; unmet

        pct = await compute_org_compliance_pct(db_session, org.id)

        assert pct == 0.0

    async def test_applies_to_all_overrides_a_stale_membership_type_list(
        self, db_session
    ):
        """`applies_to_all` and `required_membership_types` are independent,
        unvalidated fields on the same row — a requirement created as
        "applies to all" and later scoped down without also clearing
        applies_to_all is a reachable state, not a hypothetical one
        (Codex review of PR #2455). TrainingService.get_applicable_
        requirements (the member-facing /my-training path) gives
        applies_to_all precedence; this must too, or the dashboard
        percentage disagrees with what the member's own view says applies
        to them."""
        org = await _org(db_session)
        member = await _active_member(db_session, org)
        assert member.organization_id == org.id
        await _annual_hours_requirement(
            db_session,
            org,
            required_membership_types=["reserve"],  # stale; member is "active"
            applies_to_all=True,
        )  # unmet — must still count, since applies_to_all wins

        pct = await compute_org_compliance_pct(db_session, org.id)

        assert pct == 0.0
