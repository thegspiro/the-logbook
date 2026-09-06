"""The generated-email strategy must only produce addresses Pydantic accepts.

``tests/test_api_contract.py`` registers a strategy for OpenAPI's ``email``
format because JSON Schema's notion of an address is far wider than the one
``EmailStr`` enforces, and schemathesis reports a correct 422 on a
schema-valid address as "API rejected schema-compliant request".

That strategy is only useful while every address it emits is one
email-validator accepts, and the first version did not hold that: it allowed
a hyphen anywhere inside a domain label, so it could emit ``fa--jm.bfd``.
email-validator refuses two letters followed by two dashes at a label's third
and fourth characters — IDNA reserves that shape for punycode's ``xn--`` — so
CI went red months later, on an unrelated PR, when a fresh corpus happened to
draw one.

These tests live outside that module on purpose: they need no server, no
database and no ``RUN_API_CONTRACT_TESTS``, so the property is checked on
every run rather than only in the contract job.
"""

import itertools
import re

import pytest
from email_validator import EmailNotValidError, validate_email

from tests.test_api_contract import _DELIVERABLE_EMAIL

pytestmark = pytest.mark.unit


def _matches(address: str) -> bool:
    return re.fullmatch(_DELIVERABLE_EMAIL, address) is not None


# The address CI actually generated, plus the general shape of the rule.
@pytest.mark.parametrize(
    "address",
    ["6z2.1@fa--jm.bfd", "a@ab--cd.com", "a@xy--z.io"],
)
def test_rejected_shapes_are_not_generated(address: str) -> None:
    """A shape email-validator refuses must be outside the strategy."""
    with pytest.raises(EmailNotValidError):
        validate_email(address, check_deliverability=False)
    assert not _matches(address), (
        f"the strategy can generate {address!r}, which email-validator "
        "refuses — schemathesis would report the resulting 422 as a "
        "contract breach"
    )


@pytest.mark.parametrize("address", ["a@ab-cd.com", "a@a-b-c.com", "ab.cd@e-f.io"])
def test_single_hyphen_domains_are_still_generated(address: str) -> None:
    """The repair must not narrow the strategy to hyphen-free domains.

    Excluding hyphens outright would also pass the test above while quietly
    shrinking what the contract is exercised against.
    """
    validate_email(address, check_deliverability=False)
    assert _matches(address)


def test_no_generated_domain_can_carry_two_adjacent_hyphens() -> None:
    """The property, by exhaustion rather than by sampling.

    ``--`` is rare enough in random draws that 3000 of them from the *old*
    pattern produced none, so a sampling test would have passed against the
    bug it exists to catch. Every hyphen/alphanumeric domain of this length is
    enumerated instead.
    """
    offenders = [
        domain
        for domain in ("".join(t) for t in itertools.product("ab-", repeat=8))
        if "--" in domain and _matches(f"a@{domain}.com")
    ]
    assert offenders == []
