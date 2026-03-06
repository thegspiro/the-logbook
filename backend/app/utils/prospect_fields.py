"""
Shared Prospect Field Mappings

Single source of truth for mapping form-field labels and field-types
to ProspectiveMember column names.  Used by both the pipeline service
(auto-generating FormIntegration field_mappings) and the forms service
(label-based mapping at submission time).
"""

from typing import Dict

# Maps normalised (lower-cased, stripped) form-field labels to the
# corresponding ProspectiveMember column name.
LABEL_MAP: Dict[str, str] = {
    "first name": "first_name",
    "firstname": "first_name",
    "first": "first_name",
    "last name": "last_name",
    "lastname": "last_name",
    "last": "last_name",
    "email": "email",
    "email address": "email",
    "e-mail": "email",
    "phone": "phone",
    "phone number": "phone",
    "telephone": "phone",
    "mobile": "mobile",
    "cell": "mobile",
    "cell phone": "mobile",
    "mobile phone": "mobile",
    "date of birth": "date_of_birth",
    "birthday": "date_of_birth",
    "dob": "date_of_birth",
    "birth date": "date_of_birth",
    "address": "address_street",
    "street": "address_street",
    "street address": "address_street",
    "address line 1": "address_street",
    "city": "address_city",
    "town": "address_city",
    "state": "address_state",
    "province": "address_state",
    "zip": "address_zip",
    "zip code": "address_zip",
    "postal code": "address_zip",
    "zipcode": "address_zip",
    "why are you interested": "interest_reason",
    "interest reason": "interest_reason",
    "reason for interest": "interest_reason",
    "why do you want to join": "interest_reason",
    "interest": "interest_reason",
    "referral source": "referral_source",
    "referral": "referral_source",
    "how did you hear about us": "referral_source",
    "how did you hear": "referral_source",
    "membership type": "desired_membership_type",
    "desired membership type": "desired_membership_type",
    "type of membership": "desired_membership_type",
    "member type": "desired_membership_type",
}

# Fallback: map by field_type when the label is ambiguous.
FIELD_TYPE_MAP: Dict[str, str] = {
    "email": "email",
    "phone": "phone",
    "date": "date_of_birth",
}

# Required prospect fields that a pipeline form must provide.
REQUIRED_PROSPECT_FIELDS: set[str] = {"first_name", "last_name", "email"}

# Human-readable labels keyed by ProspectiveMember column name.
# Used on both backend (API responses) and frontend (display).
FIELD_DISPLAY_LABELS: Dict[str, str] = {
    "first_name": "First Name",
    "last_name": "Last Name",
    "email": "Email Address",
    "phone": "Phone Number",
    "mobile": "Mobile Number",
    "date_of_birth": "Date of Birth",
    "address_street": "Address",
    "address_city": "City",
    "address_state": "State",
    "address_zip": "Zip Code",
    "interest_reason": "Interest Reason",
    "referral_source": "Referral Source",
    "referred_by": "Referred By",
    "desired_membership_type": "Desired Membership Type",
}
