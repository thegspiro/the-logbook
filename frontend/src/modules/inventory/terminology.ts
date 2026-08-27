/** Canonical quartermaster language. API payload values remain stable for compatibility. */
export const INVENTORY_TERMS = [
  ['Assignment', 'Serialized gear held on an ongoing basis.'],
  ['Temporary loan', 'Serialized gear expected back by a date.'],
  ['Issuance', 'Quantity-tracked stock given to a member.'],
  ['Return', 'Physically receiving assigned or issued gear.'],
  ['Check-in', 'Closing a temporary loan when the gear is received.'],
  ['Transfer', 'Moving serialized gear between holders.'],
  ['Distribution', 'One mixed batch that may create assignments, temporary loans, and issuances.'],
] as const;

export function equipmentRequestTypeLabel(type: string): string {
  if (type === 'checkout') return 'Temporary loan';
  if (type === 'assignment') return 'Assignment';
  if (type === 'issuance') return 'Issuance';
  return type;
}
