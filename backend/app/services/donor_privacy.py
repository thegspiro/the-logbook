"""
Who may see the identity behind an anonymous gift (GF-8), and a donor's contact
details (GF-9).

Owner decision: an anonymous donation -- or a donor who asked to be anonymous
-- is shown without its identity to a caller who holds only
``fundraising.view``. ``fundraising.manage`` still sees it, because the people
who record gifts are the people who send receipts and thank-you letters, and
the flag must not stop a department from doing either.

The amount, date, campaign and payment details stay visible: totals and
campaign progress are built from them, and they say nothing about who gave.

GF-9 extends the same line to every donor, anonymous or not. A caller who holds
only ``fundraising.view`` reads names, the donor type, the company, lifetime
totals and dates: enough to see who supports the department and how much.
Email, phone, postal address, notes, the communication preferences and the
linked member account are contact details, and they need
``fundraising.manage``, the permission of the people who send receipts and
thank-you letters. A donation's ``donor_email`` follows the same rule.
"""

from typing import Any

from app.schemas.grant import DonationResponse, DonorResponse

# The permission that sees through the flag; the endpoint layer checks it.
MANAGE_PERMISSION = "fundraising.manage"

# Cleared on an anonymous donation for a view-only caller.
DONATION_IDENTITY_FIELDS = ("donor_name", "donor_email", "donor_id")

# Cleared on an anonymous donor's record for a view-only caller. first_name/
# last_name are Optional on the response (W69-6: an organization donor may
# carry neither), so masking overwrites them with a placeholder string rather
# than leaving them blank; ``is_anonymous`` stays true beside them so a
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

# Withheld from a view-only caller for every donor, not just an anonymous one.
DONOR_CONTACT_FIELDS = (
    "email",
    "phone",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "postal_code",
    "country",
    "notes",
    "user_id",
    "communication_preferences",
)
ANONYMOUS_FIRST_NAME = "Anonymous"
ANONYMOUS_LAST_NAME = "donor"


def present_donation(donation: Any, can_see_identity: bool) -> DonationResponse:
    response: DonationResponse = DonationResponse.model_validate(donation)
    if can_see_identity:
        return response
    # A named donor's address is contact detail even when the gift is not
    # anonymous; the name stays, as the donor list shows it.
    update: dict[str, Any] = {"donor_email": None}
    if response.is_anonymous:
        update = {field: None for field in DONATION_IDENTITY_FIELDS}
    masked: DonationResponse = response.model_copy(update=update)
    return masked


def present_donor(donor: Any, can_see_identity: bool) -> DonorResponse:
    response: DonorResponse = DonorResponse.model_validate(donor)
    if can_see_identity:
        return response
    update: dict[str, Any] = {field: None for field in DONOR_CONTACT_FIELDS}
    update["contact_hidden"] = True
    if response.is_anonymous:
        update.update({field: None for field in DONOR_IDENTITY_FIELDS})
        update["first_name"] = ANONYMOUS_FIRST_NAME
        update["last_name"] = ANONYMOUS_LAST_NAME
    masked: DonorResponse = response.model_copy(update=update)
    return masked
