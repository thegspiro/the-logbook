"""The department's voter eligibility defaults, per kind of vote.

Election Settings stores one set of defaults per kind of vote in
``organizations.settings``; every reader -- the elections endpoints that copy
them onto a new election, and the minutes attendance dashboard that reports
who may vote under them -- reads them here, so the two cannot disagree about
what the defaults are (pitfall #29).
"""

from typing import Optional

from loguru import logger
from pydantic import ValidationError

from app.schemas.election import ElectionEligibilityRules, EligibilityDefaults
from app.services.voter_rules import as_type_rules
from app.utils.membership import configured_tiers

_REGULAR_ELIGIBILITY_KEY = "election_eligibility"
# Where each other meeting kind keeps its own defaults; absent means it uses
# the regular ones.
_KIND_ELIGIBILITY_KEYS = {
    "annual": "election_eligibility_annual",
    "bylaws": "election_eligibility_bylaws",
    "special": "election_eligibility_special",
}
_OWN_DEFAULT_KINDS = tuple(_KIND_ELIGIBILITY_KEYS)


def _as_type_rule_defaults(
    defaults: EligibilityDefaults, org_settings: dict
) -> EligibilityDefaults:
    """``defaults`` with its rules as a version 2 (per-type) rule set.

    A department that has not saved version 2 rules yet still has version
    1 rules and tier voting benefits; ``as_type_rules`` turns the two into
    the rows that judge every member the same way, so what the settings
    screen shows and what a new election copies is what applies. Nothing is
    written back until the secretary saves.
    """
    if defaults.rules.version == 2:
        return defaults
    converted = as_type_rules(
        defaults.rules.model_dump(), configured_tiers(org_settings)
    )
    return defaults.model_copy(
        update={"rules": ElectionEligibilityRules.model_validate(converted)}
    )


def _stored_eligibility(org_settings: dict, key: str) -> Optional[EligibilityDefaults]:
    """One set of the department's stored eligibility defaults, as version 2
    rules, or None.

    The value is validated on every write, but ``organizations.settings`` is
    free-form JSON, so a stored value that no longer validates reads as
    absent rather than failing every create and settings read.
    """
    raw = org_settings.get(key)
    if not isinstance(raw, dict):
        return None
    try:
        stored = EligibilityDefaults.model_validate(raw)
    except ValidationError:
        logger.warning("Stored {} is invalid; ignoring it", key)
        return None
    return _as_type_rule_defaults(stored, org_settings)


def _eligibility_defaults(org_settings: dict) -> EligibilityDefaults:
    """The regular-meeting defaults, else the built-in ones (check-in
    required on new items, and the rules the tier ladder implies)."""
    return _stored_eligibility(
        org_settings, _REGULAR_ELIGIBILITY_KEY
    ) or _as_type_rule_defaults(EligibilityDefaults(), org_settings)


def _defaults_for_kind(org_settings: dict, meeting_kind: str) -> EligibilityDefaults:
    """The defaults an election held at ``meeting_kind`` copies: that
    kind's own when the department set them, else the regular ones."""
    key = _KIND_ELIGIBILITY_KEYS.get(meeting_kind)
    if key is not None:
        own = _stored_eligibility(org_settings, key)
        if own is not None:
            return own
    return _eligibility_defaults(org_settings)
