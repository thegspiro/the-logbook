/**
 * Member class and the legacy `membership_type` it is derived from.
 *
 * Mirrors `backend/app/utils/membership.py`. The backend is the authority — it
 * enforces the rules these helpers only surface — but the same questions get
 * asked on four different screens here, and asking them by hand is how one of
 * them ends up spelling "administrative" differently from the rest.
 */

import {
  MEMBER_CLASS_LABELS,
  MEMBER_STATUS_LABELS,
  MEMBERSHIP_TYPE_LABELS,
  MemberClass,
  MemberStatus,
  MembershipType,
} from '../constants/enums';
import type { MembershipTier } from '../types/user';

/** The legacy words that name a *status* rather than a class, in the status spelling. */
const STATUS_BY_LEGACY_WORD: Record<string, MemberStatus> = {
  prospective: MemberStatus.PROSPECTIVE,
  probationary: MemberStatus.PROBATIONARY,
  active: MemberStatus.REGULAR,
  life: MemberStatus.LIFE,
  retired: MemberStatus.RETIRED,
  honorary: MemberStatus.HONORARY,
  administrative: MemberStatus.REGULAR,
};

const BUILTIN_STATUSES = Object.values(MemberStatus) as string[];

/** Whether `value` is one of the seven built-in ladder statuses. */
export function isBuiltinStatus(value?: string | null): value is MemberStatus {
  return BUILTIN_STATUSES.includes((value ?? '').trim().toLowerCase());
}

/**
 * A status or tier id spelled the way `member_status` stores it.
 *
 * Mirrors `canonical_member_status` in the Python module: the shipped ladder
 * names its second rung `active` and the column stores that standing as
 * `regular`, so a tier id that is also a legacy word becomes the status it
 * means and any other tier id (`senior`) is itself. Blank is `undefined`.
 */
export function canonicalMemberStatus(value?: string | null): string | undefined {
  const key = (value ?? '').trim().toLowerCase();
  if (!key) return undefined;
  if (BUILTIN_STATUSES.includes(key)) return key;
  return STATUS_BY_LEGACY_WORD[key] ?? key;
}

export function memberClassLabel(memberClass?: string | null): string {
  const key = (memberClass ?? '').trim().toLowerCase() as MemberClass;
  return MEMBER_CLASS_LABELS[key] ?? '';
}

/**
 * Human label for a stored `member_status`. A built-in status has a fixed
 * label; a department tier id takes the tier's own name when the ladder is at
 * hand, and is humanised otherwise.
 */
export function memberStatusLabel(memberStatus?: string | null, tiers?: readonly MembershipTier[]): string {
  const key = canonicalMemberStatus(memberStatus);
  if (!key) return '';
  const tier = tiers?.find((t) => canonicalMemberStatus(t.id) === key);
  if (tier?.name) return tier.name;
  if (isBuiltinStatus(key)) return MEMBER_STATUS_LABELS[key];
  const humanised = key.replace(/_/g, ' ');
  return `${humanised.charAt(0).toUpperCase()}${humanised.slice(1)}`;
}

export interface MemberStatusOption {
  value: string;
  label: string;
}

/**
 * What the Status control offers: the seven built-in statuses plus the
 * department's own tiers, one entry per standing. A tier whose id is also a
 * built-in status (the shipped `probationary`, `active`, `life` rungs) is the
 * same entry under the tier's name, so Regular reads "Active Member" where the
 * department calls it that. `extra` carries values already stored on the roster
 * that neither list names, so a filter can still select them.
 */
export function statusOptionsFor(tiers?: readonly MembershipTier[], extra?: readonly string[]): MemberStatusOption[] {
  const seen = new Map<string, string>();
  for (const status of Object.values(MemberStatus)) {
    seen.set(status, MEMBER_STATUS_LABELS[status]);
  }
  for (const tier of tiers ?? []) {
    const key = canonicalMemberStatus(tier.id);
    if (key) seen.set(key, tier.name || seen.get(key) || key);
  }
  for (const value of extra ?? []) {
    const key = canonicalMemberStatus(value);
    if (key && !seen.has(key)) seen.set(key, memberStatusLabel(key));
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }));
}

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
 * Human label for a stored `membership_type`, e.g. "Active member",
 * "Life member", "Administrative". Built-in types come from
 * `MEMBERSHIP_TYPE_LABELS`; an org-configured tier id (`senior`) is humanized
 * as-is, because the tier's display name lives in org settings a plain member
 * cannot read. Empty string for no type.
 */
export function membershipTypeLabel(membershipType?: string | null): string {
  const raw = membershipType?.trim().toLowerCase();
  if (!raw) return '';
  const label = MEMBERSHIP_TYPE_LABELS[raw] ?? raw.replace(/_/g, ' ');
  // "Administrative member" is redundant and "Prospective member" reads as a
  // status; the ladder positions get the noun, the class does not.
  if (raw === MembershipType.ADMINISTRATIVE) return label;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} member`;
}

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
