"""
Who may see the identity behind an anonymous gift (GF-8).

Owner decision: an anonymous donation -- or a donor who asked to be anonymous
-- is shown without its identity to a caller who holds only
``fundraising.view``. ``fundraising.manage`` still sees it, because the people
who record gifts are the people who send receipts and thank-you letters, and
the flag must not stop a department from doing either.

The amount, date, campaign and payment details stay visible: totals and
campaign progress are built from them, and they say nothing about who gave.
"""

from typing import Any

from app.schemas.grant import DonationResponse, DonorResponse

# The permission that sees through the flag; the endpoint layer checks it.
MANAGE_PERMISSION = "fundraising.manage"

# Cleared on an anonymous donation for a view-only caller.
DONATION_IDENTITY_FIELDS = ("donor_name", "donor_email", "donor_id")

# Cleared on an anonymous donor's record for a view-only caller. The name
# fields are required strings on the response, so they read as a placeholder
# rather than going missing; ``is_anonymous`` stays true beside them so a
# client can tell the placeholder from a real name.
DONOR_IDENTITY_FIELDS = (
    "email",
    "phone",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "postal_code",
    "company_name",
    "notes",
    "user_id",
)
ANONYMOUS_FIRST_NAME = "Anonymous"
ANONYMOUS_LAST_NAME = "donor"


def present_donation(donation: Any, can_see_identity: bool) -> DonationResponse:
    response: DonationResponse = DonationResponse.model_validate(donation)
    if can_see_identity or not response.is_anonymous:
        return response
    masked: DonationResponse = response.model_copy(
        update={field: None for field in DONATION_IDENTITY_FIELDS}
    )
    return masked


def present_donor(donor: Any, can_see_identity: bool) -> DonorResponse:
    response: DonorResponse = DonorResponse.model_validate(donor)
    if can_see_identity or not response.is_anonymous:
        return response
    update: dict[str, Any] = {field: None for field in DONOR_IDENTITY_FIELDS}
    update["first_name"] = ANONYMOUS_FIRST_NAME
    update["last_name"] = ANONYMOUS_LAST_NAME
    masked: DonorResponse = response.model_copy(update=update)
    return masked
