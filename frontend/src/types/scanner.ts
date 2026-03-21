export interface MemberIdPayload {
  type: 'member_id';
  id: string;
  membership_number?: string;
  org?: string;
}

export function isMemberIdPayload(value: unknown): value is MemberIdPayload {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return obj['type'] === 'member_id' && typeof obj['id'] === 'string';
}
