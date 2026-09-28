/**
 * Input rules for the organization profile, shared by every screen that edits
 * it: Organization settings (Profile, Contact, Addresses) and the department
 * contact card on the email Footers screen.
 *
 * The lengths are the database columns' (`Organization` in
 * backend/app/models/user.py). `OrganizationProfileUpdate` rejects anything
 * longer with a 422, and backend/tests/test_organization_profile_limits.py
 * holds the schema to the columns. Stopping the typing here is what turns that
 * refusal into something a person never meets: the settings screens save as
 * you type, so a value one character too long otherwise surfaces as a failed
 * autosave with nothing on the field to say which one.
 */

export const ORGANIZATION_PROFILE_MAX_LENGTH = {
  name: 255,
  phone: 20,
  email: 255,
  website: 255,
  county: 100,
  addressLine: 255,
  city: 100,
  state: 50,
  zip: 20,
} as const;

// Deliberately loose: the point is to catch a typo like a missing "@", not to
// out-guess what a mail server will accept.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Why an organization email address cannot be saved, or `null` if it can.
 * A blank address is allowed: it clears the field.
 */
export function organizationEmailError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || EMAIL_PATTERN.test(trimmed)) return null;
  return 'Enter an email address like office@example.org.';
}
