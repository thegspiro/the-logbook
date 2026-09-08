"""Guard: the read/write tier of every catalogued permission (PERM-6).

``permission_matches_any_write`` authorizes a *mutation* by keeping only the
write-tier entries of a resource's required-permission list, and
``is_read_only_permission`` is what decides which those are. A read filed as a
write is therefore offered to a caller as proof of write authority — the
direction that costs something. The reverse only withholds a write, which
fails closed.

Nothing but the permission's own name reaches that classifier, so this file
checks it against an independent signal the same file already carries: the
hand-written ``description`` on each ``Permission``. A grant described as
"View ..." reads; anything else writes. The two entries where the prose and
the classification legitimately disagree are named below, with the reason —
adding a third should be a deliberate act, not a silent one.
"""

import pytest

from app.core.permissions import (
    ALL_PERMISSIONS,
    is_read_only_permission,
    permission_matches_any,
    permission_matches_any_write,
)

# Permissions whose description does not predict their tier, and why.
#
# Both are prose problems, not classification ones: renaming the permissions
# would be a breaking config change for any department that granted them, and
# rewording the descriptions would change what every position editor displays.
_DESCRIPTION_MISMATCH: dict[str, str] = {
    # Leads with "View" but the grant that matters is the write half.
    "legal.propose": "View legal documents and propose revisions",
    # A plain read whose description says "Browse" rather than "View".
    "storefront.view": "Browse the department store and track your own orders",
}


def _reads_by_description(description: str) -> bool:
    return description.lower().startswith("view")


class TestClassifierAgreesWithDescription:
    def test_every_permission_tier_matches_its_own_description(self):
        violations = []
        for permission in ALL_PERMISSIONS:
            if permission.name in _DESCRIPTION_MISMATCH:
                continue
            expected = _reads_by_description(permission.description)
            if is_read_only_permission(permission.name) is not expected:
                violations.append(
                    f"{permission.name}: description {permission.description!r} says "
                    f"{'read' if expected else 'write'}, "
                    f"is_read_only_permission says "
                    f"{'read' if not expected else 'write'}"
                )
        assert not violations, (
            "Permission tier disagrees with its description. Either the name "
            "follows the <module>.view[_detail] convention, or add it to "
            "_READ_ONLY_PERMISSION_EXCEPTIONS in app/core/permissions.py (a "
            "read the convention cannot express) or to _DESCRIPTION_MISMATCH "
            "here (a description that does not predict the tier):\n"
            + "\n".join(violations)
        )

    @pytest.mark.parametrize("name,description", sorted(_DESCRIPTION_MISMATCH.items()))
    def test_documented_mismatches_still_describe_a_real_permission(
        self, name: str, description: str
    ):
        """A stale exception is a hole, so pin the prose it was written for."""
        catalogued = {p.name: p.description for p in ALL_PERMISSIONS}
        assert catalogued.get(name) == description


class TestNestedViewActionsAreReads:
    """The two-word read actions a suffix test used to file as writes."""

    def test_nested_view_action_is_read_only(self):
        assert is_read_only_permission("inventory.check_view") is True

    def test_report_style_read_is_read_only(self):
        assert is_read_only_permission("scheduling.report") is True

    def test_sibling_write_actions_are_not_read_only(self):
        assert is_read_only_permission("inventory.check_manage") is False
        assert is_read_only_permission("inventory.check_submit") is False
        assert is_read_only_permission("scheduling.assign") is False

    def test_detail_view_actions_are_read_only(self):
        assert is_read_only_permission("users.view_contact") is True
        assert is_read_only_permission("facilities.view_sensitive") is True
        assert is_read_only_permission("training.view_all") is True


class TestWriteTierMatching:
    """The behaviour the classification exists to produce."""

    def test_read_only_holder_is_admitted_to_read_but_not_to_write(self):
        required = ["inventory.check_view", "inventory.check_manage"]
        granted = {"inventory.check_view"}
        assert permission_matches_any(required, granted) is True
        assert permission_matches_any_write(required, granted) is False

    def test_write_holder_is_admitted_to_both(self):
        required = ["inventory.check_view", "inventory.check_manage"]
        granted = {"inventory.check_manage"}
        assert permission_matches_any(required, granted) is True
        assert permission_matches_any_write(required, granted) is True

    def test_module_wildcard_still_carries_the_write(self):
        required = ["facilities.view_sensitive", "facilities.manage"]
        assert permission_matches_any_write(required, {"facilities.*"}) is True

    def test_all_read_only_requirement_admits_nobody_to_a_write(self):
        """No write-tier entry means no write authority, wildcard or not."""
        assert permission_matches_any_write(["users.view"], {"users.*"}) is False
