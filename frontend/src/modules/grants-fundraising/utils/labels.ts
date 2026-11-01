/**
 * Display labels shared across the Grants & Fundraising pages.
 */

import {
  BUDGET_ITEM_CATEGORY_LABELS,
  FundraisingEventStatus,
  FundraisingEventType,
  GrantCategory,
  PledgeStatus,
  ZeffyLinkTarget,
  ZeffyPaymentState,
} from '../types';
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

/**
 * A stored budget-line category's label (W68: the reports page printed the raw
 * code). An unknown code reads as itself.
 */
export const budgetItemCategoryLabel = (category: string): string =>
  (BUDGET_ITEM_CATEGORY_LABELS as Record<string, string>)[category] ?? category;

/** A donor as the pickers and lists name them: person, then organization. */
export const donorDisplayName = (donor: Donor): string => {
  const name = `${donor.firstName ?? ''} ${donor.lastName ?? ''}`.trim();
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

export const PLEDGE_STATUS_LABELS: Record<PledgeStatus, string> = {
  [PledgeStatus.PENDING]: 'Pending',
  [PledgeStatus.PARTIAL]: 'Partly received',
  [PledgeStatus.OVERDUE]: 'Overdue',
  [PledgeStatus.FULFILLED]: 'Fulfilled',
  [PledgeStatus.CANCELLED]: 'Cancelled',
};

export const PLEDGE_STATUS_COLORS: Record<string, string> = {
  [PledgeStatus.PENDING]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300',
  [PledgeStatus.PARTIAL]: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  [PledgeStatus.OVERDUE]: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  [PledgeStatus.FULFILLED]: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  [PledgeStatus.CANCELLED]: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-300',
};

export const FUNDRAISING_EVENT_TYPE_LABELS: Record<FundraisingEventType, string> = {
  [FundraisingEventType.DINNER]: 'Dinner',
  [FundraisingEventType.GALA]: 'Gala',
  [FundraisingEventType.AUCTION]: 'Auction',
  [FundraisingEventType.RAFFLE]: 'Raffle',
  [FundraisingEventType.GOLF_OUTING]: 'Golf outing',
  [FundraisingEventType.WALKATHON]: 'Walkathon',
  [FundraisingEventType.OTHER]: 'Other',
};

export const FUNDRAISING_EVENT_STATUS_LABELS: Record<FundraisingEventStatus, string> = {
  [FundraisingEventStatus.PLANNING]: 'Planning',
  [FundraisingEventStatus.OPEN]: 'Open',
  [FundraisingEventStatus.SOLD_OUT]: 'Sold out',
  [FundraisingEventStatus.COMPLETED]: 'Completed',
  [FundraisingEventStatus.CANCELLED]: 'Cancelled',
};

export const FUNDRAISING_EVENT_STATUS_COLORS: Record<string, string> = {
  [FundraisingEventStatus.PLANNING]: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-300',
  [FundraisingEventStatus.OPEN]: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  [FundraisingEventStatus.SOLD_OUT]: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  [FundraisingEventStatus.COMPLETED]: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300',
  [FundraisingEventStatus.CANCELLED]: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
};

export const ZEFFY_TARGET_LABELS: Record<string, string> = {
  [ZeffyLinkTarget.FUNDRAISING_CAMPAIGN]: 'Fundraising campaign',
  [ZeffyLinkTarget.FUNDRAISING_EVENT]: 'Fundraising event',
  [ZeffyLinkTarget.DUES_SCHEDULE]: 'Member dues',
};

export const ZEFFY_STATE_LABELS: Record<string, string> = {
  [ZeffyPaymentState.PENDING]: 'Processing',
  [ZeffyPaymentState.IGNORED]: 'Not counted',
  [ZeffyPaymentState.UNLINKED]: 'Campaign not linked',
  [ZeffyPaymentState.BEFORE_START]: 'Before link start',
  [ZeffyPaymentState.UNMATCHED]: 'No member match',
  [ZeffyPaymentState.APPLIED]: 'Applied',
  [ZeffyPaymentState.REVERSED]: 'Reversed',
  [ZeffyPaymentState.NEEDS_REVIEW]: 'Needs review',
};

export const ZEFFY_STATE_COLORS: Record<string, string> = {
  [ZeffyPaymentState.PENDING]: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-300',
  [ZeffyPaymentState.IGNORED]: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-300',
  [ZeffyPaymentState.UNLINKED]: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  [ZeffyPaymentState.BEFORE_START]: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-300',
  [ZeffyPaymentState.UNMATCHED]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300',
  [ZeffyPaymentState.APPLIED]: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  [ZeffyPaymentState.REVERSED]: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300',
  [ZeffyPaymentState.NEEDS_REVIEW]: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
};
