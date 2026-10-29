/**
 * Applicant-record fields a follow-up form can pre-fill from and write back
 * to, in the order the field editor offers them. The values are the backend's
 * APPLICANT_FIELDS (app/models/forms.py), which refuses anything else.
 */
export const APPLICANT_FIELD_OPTIONS = [
  { value: 'first_name', label: 'First name' },
  { value: 'last_name', label: 'Last name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'date_of_birth', label: 'Date of birth' },
  { value: 'address_street', label: 'Street address' },
  { value: 'address_city', label: 'City' },
  { value: 'address_state', label: 'State' },
  { value: 'address_zip', label: 'ZIP code' },
  { value: 'interest_reason', label: 'Why they are interested' },
  { value: 'referral_source', label: 'Referral source' },
] as const;

export function applicantFieldLabel(value: string | null | undefined): string | undefined {
  return APPLICANT_FIELD_OPTIONS.find((o) => o.value === value)?.label;
}
