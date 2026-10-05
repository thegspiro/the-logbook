"""A new PII column on ``User`` must not slip past anonymization unnoticed.

Pass 2 of the member-lifecycle review (2026-08-08) diffed the ``User`` columns
against the ones the anonymization service clears, by hand, and found nothing
missed. It then recorded the obvious problem with having done that by hand: a
PII column added later is not picked up by the service and nothing notices.
This is that check, mechanised — the ratchet shape `test_org_scoping_ratchet`
uses.

A new column fails this test until somebody classifies it: either the service
clears it, or it is named below with a reason. That is the whole point —
the failure is a prompt to decide, not a defect in itself.

**The namespace trap, recorded because it produced a false finding first.**
``sa_inspect(User).columns`` is keyed by *column* name, and for an encrypted
field that is not the attribute the service assigns: the MFA secret appears
there as ``mfa_secret`` while the service correctly writes
``_mfa_secret_encrypted`` (the real mapped attribute). Diffing the two
namespaces makes a scrubbed field look untouched — it suggested the service
ignored MFA secrets when it clears them on three lines. Compare against
``mapper.column_attrs`` keys, which are what an assignment actually targets.
"""

import ast
import pathlib

import pytest
from sqlalchemy import inspect as sa_inspect

from app.models.user import User

pytestmark = [pytest.mark.unit]

_SERVICE = (
    pathlib.Path(__file__).resolve().parents[1]
    / "app"
    / "services"
    / "member_anonymization_service.py"
)

# Attributes anonymization deliberately leaves alone, grouped by why. Reviewed
# 2026-10-04 (pass 3); the set was equivalent at pass 2. Adding to this list is
# a decision about a member's privacy — say why, in the group it belongs to.
_DELIBERATELY_KEPT: dict[str, frozenset[str]] = {
    "row identity and tenancy": frozenset(
        {"id", "organization_id", "created_at", "updated_at"}
    ),
    # The anonymized shell stays the operational key that history points at.
    "department-assigned keys": frozenset(
        {"membership_number", "previous_membership_number"}
    ),
    # What the member *was* to the department, which the retained operational
    # rows (training, attendance, hours, custody) are only meaningful against.
    "operational role and standing": frozenset(
        {
            "membership_type",
            "membership_type_changed_at",
            "member_class",
            "member_status",
            "status",
            "status_changed_at",
            "archived_at",
            "rank",
            "platoon",
            "station",
            "hire_date",
            "compliance_exempt",
        }
    ),
    # Inert once `password_hash`, the MFA secrets and the OAuth linkage are
    # cleared: there is no credential left for any of this to gate.
    "sign-in metadata with no credential behind it": frozenset(
        {
            "email_verified",
            "must_change_password",
            "password_changed_at",
            "failed_login_attempts",
            "locked_until",
            "last_login_at",
            "mfa_last_timestep",
        }
    ),
    # Carry nothing about the person.
    "interface preferences": frozenset({"profile_visibility", "bottom_nav_slots"}),
    # Identifies the member who made the referral, not this one.
    "a pointer to somebody else": frozenset({"referred_by_user_id"}),
}


def _kept() -> frozenset[str]:
    out: frozenset[str] = frozenset()
    for group in _DELIBERATELY_KEPT.values():
        out |= group
    return out


def _assigned_on_user() -> set[str]:
    """Attributes the service assigns on the ``user`` object."""
    tree = ast.parse(_SERVICE.read_text())
    return {
        target.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Assign)
        for target in node.targets
        if isinstance(target, ast.Attribute)
        and isinstance(target.value, ast.Name)
        and target.value.id == "user"
    }


def _mapped_attrs() -> set[str]:
    return {a.key for a in sa_inspect(User).mapper.column_attrs}


class TestEveryUserColumnIsClassified:
    def test_no_column_is_unclassified(self):
        """Every mapped attribute is either scrubbed or listed with a reason."""
        unclassified = _mapped_attrs() - _assigned_on_user() - _kept()
        assert not unclassified, (
            "these User attributes are neither cleared by "
            "member_anonymization_service nor listed in _DELIBERATELY_KEPT: "
            f"{sorted(unclassified)}. If one holds anything about the person, "
            "clear it in the service; if not, add it to the matching group "
            "above with the reason. A member exercising the right to erasure "
            "is what this list is answerable to."
        )

    def test_the_kept_list_has_not_gone_stale(self):
        """A name that no longer exists on the model, or that the service now
        clears, should leave the list rather than sit in it looking considered."""
        mapped = _mapped_attrs()
        gone = sorted(_kept() - mapped)
        assert not gone, f"_DELIBERATELY_KEPT names non-existent attributes: {gone}"

        now_cleared = sorted(_kept() & _assigned_on_user())
        assert not now_cleared, (
            "these are listed as deliberately kept but the service clears "
            f"them: {now_cleared}. Remove them from the list."
        )

    def test_the_credentials_the_docstring_claims_are_actually_cleared(self):
        """The module docstring promises credentials, MFA secrets and OAuth
        linkage are scrubbed. Assert the code matches the claim — this is the
        check that caught ELEC-5 and CI-5 elsewhere, and the encrypted-column
        naming makes it easy to get wrong by eye."""
        assigned = _assigned_on_user()
        for attr in (
            "password_hash",
            "_mfa_secret_encrypted",
            "_mfa_backup_codes_encrypted",
            "mfa_enabled",
            "oauth_provider",
            "oauth_subject",
            "password_reset_token",
            "calendar_feed_token",
        ):
            assert attr in assigned, (
                f"the docstring claims credentials/MFA/OAuth are scrubbed, but "
                f"{attr} is never assigned"
            )
