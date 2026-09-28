"""The profile update schema accepts nothing its columns cannot store.

``PATCH /organization/profile`` once allowed a 30-character phone, a
500-character website and a 100-character state against columns of 20, 255
and 50. A value in that gap passed validation and then failed at flush time
under MySQL strict mode, so the admin saw "An unexpected error occurred"
rather than which field was too long. The Email Templates footer screen now
edits these same fields, which made the gap easier to reach.
"""

import pytest
from pydantic import ValidationError

from app.models.user import Organization
from app.schemas.organization import (
    MailingAddressUpdate,
    OrganizationProfileUpdate,
    PhysicalAddressUpdate,
)

pytestmark = pytest.mark.unit

# {(schema, field): Organization column}
_FIELD_COLUMNS = {
    (OrganizationProfileUpdate, "name"): "name",
    (OrganizationProfileUpdate, "timezone"): "timezone",
    (OrganizationProfileUpdate, "phone"): "phone",
    (OrganizationProfileUpdate, "email"): "email",
    (OrganizationProfileUpdate, "website"): "website",
    (OrganizationProfileUpdate, "county"): "county",
    (MailingAddressUpdate, "line1"): "mailing_address_line1",
    (MailingAddressUpdate, "line2"): "mailing_address_line2",
    (MailingAddressUpdate, "city"): "mailing_city",
    (MailingAddressUpdate, "state"): "mailing_state",
    (MailingAddressUpdate, "zip"): "mailing_zip",
    (PhysicalAddressUpdate, "line1"): "physical_address_line1",
    (PhysicalAddressUpdate, "line2"): "physical_address_line2",
    (PhysicalAddressUpdate, "city"): "physical_city",
    (PhysicalAddressUpdate, "state"): "physical_state",
    (PhysicalAddressUpdate, "zip"): "physical_zip",
}


def _max_length(schema, field):
    for item in schema.model_fields[field].metadata:
        limit = getattr(item, "max_length", None)
        if limit is not None:
            return limit
    return None


@pytest.mark.parametrize(
    ("schema", "field", "column"),
    [(schema, field, column) for (schema, field), column in _FIELD_COLUMNS.items()],
    ids=[f"{schema.__name__}.{field}" for (schema, field) in _FIELD_COLUMNS],
)
def test_the_limit_matches_the_column(schema, field, column):
    assert _max_length(schema, field) == Organization.__table__.c[column].type.length


def test_a_phone_the_column_cannot_hold_is_refused_with_a_message():
    with pytest.raises(ValidationError) as excinfo:
        OrganizationProfileUpdate(phone="1" * 21)
    assert excinfo.value.errors()[0]["loc"] == ("phone",)


def test_a_phone_that_fits_is_accepted():
    assert OrganizationProfileUpdate(phone="(555) 111-2222 x1234").phone


def test_an_explicit_null_is_still_a_clear():
    """The footer screen clears a field by sending null."""
    update = OrganizationProfileUpdate(website=None, mailing_address={"line2": None})
    dumped = update.model_dump(exclude_unset=True)
    assert dumped["website"] is None
    assert dumped["mailing_address"] == {"line2": None}
