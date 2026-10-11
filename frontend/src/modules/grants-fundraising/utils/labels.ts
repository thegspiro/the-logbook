/**
 * Display labels shared across the Grants & Fundraising pages.
 */

import { GrantCategory } from '../types';
import type { Donor } from '../types';

export const GRANT_CATEGORY_LABELS: Record<GrantCategory, string> = {
  [GrantCategory.EQUIPMENT]: 'Equipment',
  [GrantCategory.STAFFING]: 'Staffing',
  [GrantCategory.TRAINING]: 'Training',
  [GrantCategory.PREVENTION]: 'Prevention',
  [GrantCategory.FACILITIES]: 'Facilities',
  [GrantCategory.VEHICLES]: 'Vehicles',
  [GrantCategory.WELLNESS]: 'Wellness',
  [GrantCategory.COMMUNITY]: 'Community',
  [GrantCategory.OTHER]: 'Other',
};

/** A donor as the pickers and lists name them: person, then organization. */
export const donorDisplayName = (donor: Donor): string => {
  const name = `${donor.firstName} ${donor.lastName}`.trim();
  if (donor.companyName) return name ? `${name} (${donor.companyName})` : donor.companyName;
  return name || 'Unnamed donor';
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  check: 'Check',
  credit_card: 'Credit Card',
  bank_transfer: 'Bank Transfer',
  paypal: 'PayPal',
  venmo: 'Venmo',
  other: 'Other',
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  pending: 'Pending',
  failed: 'Failed',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};
