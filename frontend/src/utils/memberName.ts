/**
 * How a member is named on screen.
 *
 * A member may go by a name other than their legal first name — John Terry
 * Heather is "Terry Heather" to everyone on the shift. Everyday references
 * (shift boards, rosters, pickers, greetings) use `formatMemberName`; reports,
 * exports, training records, certificates, ballots and signed forms use
 * `formatLegalName`, because those may be handed to a government body and must
 * match the member's ID. Mirrors `app/utils/member_names.py` on the backend.
 */

export interface MemberNameParts {
  first_name?: string | null | undefined;
  last_name?: string | null | undefined;
  preferred_name?: string | null | undefined;
}

const joinParts = (...parts: Array<string | null | undefined>): string =>
  parts
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ');

/** The name the member goes by: preferred name (else first name) + last name. */
export const givenName = (member: MemberNameParts): string =>
  member.preferred_name?.trim() || member.first_name?.trim() || '';

/** Preferred (else first) + last name, for everyday references to a member. */
export const formatMemberName = (member: MemberNameParts): string => joinParts(givenName(member), member.last_name);

/** First + last name, ignoring any preferred name, for records of note. */
export const formatLegalName = (member: MemberNameParts): string => joinParts(member.first_name, member.last_name);

export interface MemberNameFields extends MemberNameParts {
  display_name?: string | null | undefined;
  full_name?: string | null | undefined;
}

/**
 * The everyday name for a member record from any endpoint: the server's
 * `display_name` when it sent one, else composed from the parts, else the
 * server's `full_name` for payloads that carry no parts. Empty when the record
 * holds no name at all, so callers can fall back to a username or email.
 */
export const displayNameOf = (member: MemberNameFields): string =>
  member.display_name?.trim() || formatMemberName(member) || member.full_name?.trim() || '';
