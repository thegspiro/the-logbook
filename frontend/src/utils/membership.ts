/**
 * Member classification, mirroring `backend/app/utils/membership.py`.
 *
 * Who may hold an operational rank.
 *
 * A rank is a place in the emergency-response chain of command, not a title:
 * the backend unions each rank's default permissions into the member's
 * effective ones, and shift eligibility reads the rank to decide which seats a
 * member may sign up for. An administrative member does not respond, so the
 * API refuses to store a rank against one and clears any rank a member still
 * carries when they move into the administrative class.
 *
 * The forms disable the field rather than letting it be filled and rejected on
 * save. Mirrors `may_hold_rank` in `backend/app/utils/membership.py`; the
 * server is the enforcement point and this is only what stops the operator
 * typing a value it will refuse.
 */

/**
 * Membership values that put a member off the line.
 *
 * The member forms edit the legacy `membership_type`, which fuses class and
 * status into one field. `administrative` is the one value in that vocabulary
 * that names the class — every other value is a rung on the ladder, and an
 * operational member on any rung may hold a rank.
 */
const CLASSES_WITHOUT_RANK = ['administrative'];

export function mayHoldOperationalRank(membershipType: string | null | undefined): boolean {
  if (!membershipType) return true;
  return !CLASSES_WITHOUT_RANK.includes(membershipType.trim().toLowerCase());
}

export const RANK_DISABLED_REASON = 'Administrative members do not hold an operational rank.';

/**
 * The Membership Type choice on the member forms, as the two fields the API stores.
 *
 * Those options have always mixed the two independent facts the backend keeps
 * apart: "probationary", "regular" and "life" are rungs on the membership
 * ladder (`member_status`), while "administrative" names what kind of member
 * somebody is (`member_class`). Sending the raw choice as the legacy
 * `membership_type` would write "regular", which is not one of that field's
 * seven values and resolves on the server to no class and no status at all.
 *
 * Administrative deliberately names no status: the choice says nothing about
 * how far through the progression the member is, and inventing "regular" for
 * them would record a fact nobody stated.
 */
export function membershipClassification(membershipType: string | null | undefined): {
  member_class?: string;
  member_status?: string;
} {
  const value = (membershipType || '').trim().toLowerCase();
  if (!value) return {};
  if (!mayHoldOperationalRank(value)) return { member_class: value };
  return { member_class: 'operational', member_status: value };
}
