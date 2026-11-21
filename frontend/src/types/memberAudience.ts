/**
 * Choosing which members an "email the members" send reaches.
 *
 * Mirrors `backend/app/schemas/member_audience.py` (snake_case on the wire).
 * Within one list any match counts; across lists every one must match; an
 * empty list does not narrow.
 */

export interface MemberAudienceChoice {
  member_classes: string[];
  member_statuses: string[];
  position_ids: string[];
}

export interface MemberStatusOption {
  value: string;
  /** Set for a department's own tier; built-in statuses are named client-side. */
  label: string | null;
}

export interface MemberAudienceOptions {
  member_classes: string[];
  member_statuses: MemberStatusOption[];
  positions: { id: string; name: string }[];
}

export interface MemberAudiencePreview {
  recipients: number;
  skipped_opted_out: number;
}

export const EMPTY_AUDIENCE: MemberAudienceChoice = {
  member_classes: [],
  member_statuses: [],
  position_ids: [],
};
