/**
 * On a payment's detail page, until it is approved: how far it would take its
 * restricted fund past what the fund has left (the backend's `fundShortfall`).
 */

import React from 'react';
import { formatCurrency } from '@/utils/currencyFormatting';
import type { MonetaryAmount } from '../types';

interface FundShortfallNoticeProps {
  shortfall?: MonetaryAmount | null | undefined;
}

export const FundShortfallNotice: React.FC<FundShortfallNoticeProps> = ({ shortfall }) => {
  if (!shortfall || Number(shortfall) <= 0) return null;
  return (
    <div className="alert-warning mt-4">
      <p className="text-theme-alert-warning-title text-sm font-medium">
        This is {formatCurrency(shortfall)} more than its restricted fund has left.
      </p>
      <p className="text-theme-alert-warning-text mt-0.5 text-sm">
        Donors gave that money for a stated purpose and no more than they gave can be spent on it. Depending on the
        department&apos;s rule, approving this either overspends the fund or is refused.
      </p>
    </div>
  );
};

/** The fund a payment is charged to, as one item of a detail grid. */
export const FundNameItem: React.FC<{ name?: string | null | undefined }> = ({ name }) =>
  name ? (
    <div>
      <p className="text-theme-text-secondary text-xs">Restricted fund</p>
      <p className="text-theme-text-primary text-sm">{name}</p>
    </div>
  ) : null;
