/**
 * Does a scanned plain-text code name this member?
 *
 * A printed member badge encodes the membership number when there is one,
 * and otherwise a short form of the member's id: the id without dashes, first
 * twelve characters, upper-cased. That fallback is `_short_id` in
 * `backend/app/services/label_service.py`; keep the two in step.
 *
 * Both scanners compared only the membership number, so a badge printed for a
 * member without one scanned as "No member found" (workflow review W14).
 */
const SHORT_ID_LENGTH = 12;

export const memberShortId = (id: string): string => id.replace(/-/g, '').slice(0, SHORT_ID_LENGTH).toUpperCase();

export const matchesMemberBadgeCode = (
  scanned: string,
  member: { id: string; membership_number?: string | null | undefined }
): boolean => {
  const code = scanned.trim();
  if (!code) return false;
  if (member.membership_number && member.membership_number.toLowerCase() === code.toLowerCase()) return true;
  return code.length === SHORT_ID_LENGTH && memberShortId(member.id) === code.toUpperCase();
};
