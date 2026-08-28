/**
 * Member class and the legacy `membership_type` it is derived from.
 *
 * Mirrors `backend/app/utils/membership.py`. The backend is the authority — it
 * enforces the rules these helpers only surface — but the same questions get
 * asked on four different screens here, and asking them by hand is how one of
 * them ends up spelling "administrative" differently from the rest.
 */

import { MemberClass, MemberStatus, MembershipType } from '../constants/enums';

/**
 * Legacy `membership_type` -> the member class it implies.
 *
 * Mirrors `_SPLIT` in the Python module, class half only. `honorary` maps to
 * social rather than operational because that is what the system already did
 * with it — honorary members have never been able to self-sign up for a shift.
 *
 * Anything absent is deliberately *not* defaulted: `membership_type` doubles as
 * an org-configurable membership tier id (the shipped defaults already include
 * `senior`), and calling an unknown tier "operational" would enrol those
 * members in rules they were never part of.
 */
const CLASS_BY_MEMBERSHIP_TYPE: Record<string, MemberClass> = {
  [MembershipType.PROSPECTIVE]: MemberClass.OPERATIONAL,
  [MembershipType.PROBATIONARY]: MemberClass.OPERATIONAL,
  [MembershipType.ACTIVE]: MemberClass.OPERATIONAL,
  [MembershipType.LIFE]: MemberClass.OPERATIONAL,
  [MembershipType.RETIRED]: MemberClass.OPERATIONAL,
  [MembershipType.ADMINISTRATIVE]: MemberClass.ADMINISTRATIVE,
  [MembershipType.HONORARY]: MemberClass.SOCIAL,
};

/** The class to judge a member by, whichever field the record carries. */
export function effectiveMemberClass(
  memberClass?: string | null,
  membershipType?: string | null
): MemberClass | undefined {
  const explicit = memberClass?.trim().toLowerCase();
  if (explicit) {
    return (Object.values(MemberClass) as string[]).includes(explicit) ? (explicit as MemberClass) : undefined;
  }
  const legacy = membershipType?.trim().toLowerCase();
  if (!legacy) return undefined;
  return CLASS_BY_MEMBERSHIP_TYPE[legacy];
}

/**
 * Whether this member is administrative, and so holds no operational rank.
 *
 * Asks about the administrative class specifically, never about the absence of
 * the operational one: an unrecognised membership tier resolves to no class at
 * all, so "not operational" is true for every department running a custom tier
 * and would grey out their rank field.
 */
export function isAdministrativeMember(memberClass?: string | null, membershipType?: string | null): boolean {
  return effectiveMemberClass(memberClass, membershipType) === MemberClass.ADMINISTRATIVE;
}

/** Shown under a rank field the administrative class has disabled. */
export const ADMINISTRATIVE_RANK_HINT = 'Administrative members do not hold an operational rank.';

/**
 * A single "membership type" picked in a form -> the class/status pair to send.
 *
 * The add-member form has always offered one dropdown holding both facts, and
 * `MemberFormData.membershipType` spells the regular case `'regular'` — which is
 * a *status*, not a legal `membership_type`, so sending that string straight
 * through would land in the column as an unrecognised tier. Sending the pair
 * instead makes every option in that dropdown expressible, including the
 * administrative one the API previously had no way to hear.
 */
export function memberClassAndStatusFor(selection: string): {
  member_class: MemberClass;
  member_status: MemberStatus;
} {
  if (selection === MembershipType.ADMINISTRATIVE) {
    return { member_class: MemberClass.ADMINISTRATIVE, member_status: MemberStatus.REGULAR };
  }
  const status: Record<string, MemberStatus> = {
    prospective: MemberStatus.PROSPECTIVE,
    probationary: MemberStatus.PROBATIONARY,
    regular: MemberStatus.REGULAR,
    active: MemberStatus.REGULAR,
    life: MemberStatus.LIFE,
    retired: MemberStatus.RETIRED,
  };
  return {
    member_class: MemberClass.OPERATIONAL,
    member_status: status[selection] ?? MemberStatus.REGULAR,
  };
}
