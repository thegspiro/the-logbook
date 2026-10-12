/**
 * Labels and small helpers shared by the dues page and its dialogs.
 */

import { DuesFrequency } from '../types';
import type { MemberDues } from '../types';

export const DUES_FREQUENCY_LABELS: Record<DuesFrequency, string> = {
  [DuesFrequency.ANNUAL]: 'Annual',
  [DuesFrequency.SEMI_ANNUAL]: 'Semi-Annual',
  [DuesFrequency.QUARTERLY]: 'Quarterly',
  [DuesFrequency.MONTHLY]: 'Monthly',
};

/** How a dues payment was made. Stored as free text; these are the offered values. */
export const DUES_PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'online', label: 'Online payment' },
  { value: 'other', label: 'Other' },
];

/**
 * What is still owed, from the backend's own two totals. Used only to prefill
 * the payment amount; the status is the backend's to decide.
 */
export function outstandingOf(dues: MemberDues): number {
  const remaining = Number(dues.amountDue) - Number(dues.amountPaid);
  return remaining > 0 ? Math.round(remaining * 100) / 100 : 0;
}
