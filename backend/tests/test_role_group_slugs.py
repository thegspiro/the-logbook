"""A role group must name positions a department can actually hold.

Six constants in ``core.constants`` name **position slugs** and are matched
against ``Position.slug`` to decide who gets notified or who counts as an
officer. Four of them named slugs that no installation is ever given:

* ``"chief"`` — the seeded chief is ``fire_chief``. So the chief was absent
  from election rollback and deletion alerts, member-drop and auto-archive
  notices, the overdue-property report, and the store's admin heads-up. The
  election path even reported a recipient count to the operator that silently
  excluded them.
* ``"admin"`` — no position has ever been slugged this. The System Owner
  position is ``it_manager``.

Both failure modes are silent in the worst way: the notification sends, to
fewer people, and nothing anywhere says so. And they were *sometimes* right —
a department that names a custom position "Chief" gets the slug ``chief`` from
``slugify``, so the bug worked on some installs and not others, which is why it
was never reported.

The groups now expand office keys through ``OFFICE_CATALOG``, whose chief entry
already knew ``fire_chief`` and ``chief`` were one office. This file asserts the
result: every slug a group produces is one a department can hold.
"""

import pytest

from app.core.constants import (
    ADMIN_NOTIFY_ROLE_SLUGS,
    CHIEF_POSITION_SLUGS,
    DEFAULT_COMPLIANCE_OFFICER_ROLES,
    DEFAULT_TRAINING_OFFICER_ROLES,
    LEADERSHIP_ROLE_SLUGS,
    OFFICE_CATALOG,
    TRAINING_OFFICER_ROLE_SLUGS,
    position_slugs_for_offices,
)
from app.core.permissions import DEFAULT_POSITIONS

pytestmark = pytest.mark.unit

#: Slugs no department is seeded with, and why each is allowed to stay.
#:
#: ``chief`` is the deliberate one: it is not seeded, but an admin who names a
#: custom position "Chief" gets exactly that slug, so a group that dropped it
#: would break the departments the old code accidentally worked for.
_ALLOWED_UNSEEDED = {
    "chief": "reachable via a custom position named 'Chief' (role_service.slugify)",
}

#: The two cert-alert lists are fallbacks behind ``cert_alert_config``, which a
#: department fills in with its own slugs. Naming a position a department may
#: reasonably have invented is the point, so they are exempt from the rule —
#: but named here, so the exemption is a decision rather than an oversight.
_CONFIG_FALLBACK_LISTS = {
    "DEFAULT_TRAINING_OFFICER_ROLES": DEFAULT_TRAINING_OFFICER_ROLES,
    "DEFAULT_COMPLIANCE_OFFICER_ROLES": DEFAULT_COMPLIANCE_OFFICER_ROLES,
}

ROLE_GROUPS = {
    "LEADERSHIP_ROLE_SLUGS": LEADERSHIP_ROLE_SLUGS,
    "ADMIN_NOTIFY_ROLE_SLUGS": ADMIN_NOTIFY_ROLE_SLUGS,
    "TRAINING_OFFICER_ROLE_SLUGS": TRAINING_OFFICER_ROLE_SLUGS,
    "CHIEF_POSITION_SLUGS": CHIEF_POSITION_SLUGS,
}


class TestEveryGroupNamesReachablePositions:
    @pytest.mark.parametrize("name", sorted(ROLE_GROUPS))
    def test_every_slug_is_seeded_or_explicitly_allowed(self, name):
        unreachable = sorted(
            slug
            for slug in ROLE_GROUPS[name]
            if slug not in DEFAULT_POSITIONS and slug not in _ALLOWED_UNSEEDED
        )
        assert not unreachable, (
            f"{name} names {unreachable}, which no department is ever seeded "
            "with — the lookup will match nobody and the notification will "
            "quietly go to fewer people. Use the office key so "
            "position_slugs_for_offices expands it, or add it to "
            "_ALLOWED_UNSEEDED with the reason it is reachable anyway."
        )

    @pytest.mark.parametrize("name", sorted(ROLE_GROUPS))
    def test_no_group_is_empty(self, name):
        assert ROLE_GROUPS[name], f"{name} resolves to nothing at all"

    @pytest.mark.parametrize("name", sorted(ROLE_GROUPS))
    def test_no_group_repeats_a_slug(self, name):
        """A repeat would query the same position twice.

        Harmless for a set-based call site and a duplicate email for a
        list-based one, so it is cheaper to make the expansion not produce them.
        """
        slugs = ROLE_GROUPS[name]
        assert len(slugs) == len(set(slugs)), f"{name} repeats a slug: {slugs}"


class TestTheChiefIsActuallyReachable:
    """The assertion that describes the bug.

    Every one of these groups is meant to include the chief, and none of them
    did — on any department using the seeded position rather than a hand-made
    one.
    """

    @pytest.mark.parametrize(
        "name",
        ["LEADERSHIP_ROLE_SLUGS", "ADMIN_NOTIFY_ROLE_SLUGS", "CHIEF_POSITION_SLUGS"],
    )
    def test_the_seeded_chief_position_is_in_the_group(self, name):
        assert "fire_chief" in ROLE_GROUPS[name], (
            f"{name} does not reach the chief. 'fire_chief' is the slug "
            "onboarding seeds; 'chief' alone matches only a department that "
            "hand-made a position by that name."
        )

    def test_both_spellings_are_carried(self):
        # Dropping 'chief' would break the departments the old code happened to
        # work for, which is the opposite of a fix.
        assert set(CHIEF_POSITION_SLUGS) == {"fire_chief", "chief"}

    def test_the_admin_group_names_the_system_owner(self):
        # "admin" was never a position. it_manager is the one that holds "*".
        assert "it_manager" in ADMIN_NOTIFY_ROLE_SLUGS
        assert "admin" not in ADMIN_NOTIFY_ROLE_SLUGS


class TestTheResolver:
    def test_an_office_key_expands_to_every_spelling(self):
        assert position_slugs_for_offices("chief") == ["fire_chief", "chief"]

    def test_a_non_office_passes_through(self):
        # Not every position is an office — it_manager and training_officer are
        # positions a group may name directly.
        assert position_slugs_for_offices("it_manager") == ["it_manager"]

    def test_overlapping_keys_do_not_repeat_a_slug(self):
        assert position_slugs_for_offices("chief", "chief") == ["fire_chief", "chief"]

    def test_order_follows_the_keys_given(self):
        assert position_slugs_for_offices("president", "chief") == [
            "president",
            "fire_chief",
            "chief",
        ]

    def test_every_catalog_slug_is_seeded_or_allowed(self):
        """The catalog is the authority the groups now trust; check it too."""
        for office in OFFICE_CATALOG:
            for slug in office["position_slugs"]:  # type: ignore[union-attr]
                assert slug in DEFAULT_POSITIONS or slug in _ALLOWED_UNSEEDED, (
                    f"OFFICE_CATALOG office {office['key']!r} names position "
                    f"{slug!r}, which is never seeded"
                )


class TestTheConfigFallbackExemptions:
    """Recorded, not silently tolerated.

    These two name unseeded slugs on purpose. The test exists so that the
    exemption is visible and so that adding a third list does not inherit it by
    accident.
    """

    @pytest.mark.parametrize("name", sorted(_CONFIG_FALLBACK_LISTS))
    def test_the_exempt_lists_are_the_ones_named(self, name):
        assert name in _CONFIG_FALLBACK_LISTS

    def test_compliance_officer_resolves_to_nothing_on_a_stock_install(self):
        """Documented so the next reader does not mistake it for working.

        ``compliance_officer`` is not a seeded position and has no office, so
        on a department that has not written its own ``cert_alert_config`` the
        compliance CC on the urgent 7-day certification tier is empty.
        """
        assert DEFAULT_COMPLIANCE_OFFICER_ROLES == ["compliance_officer"]
        assert "compliance_officer" not in DEFAULT_POSITIONS
