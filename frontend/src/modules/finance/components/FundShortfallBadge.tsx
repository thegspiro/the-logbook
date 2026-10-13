/**
 * Marks a request that would take its restricted fund past what the fund has
 * left (the backend's `fundShortfall`), wherever an approver decides it.
 */

import React from 'react';
import { PiggyBank } from 'lucide-react';
import { formatCurrency } from '@/utils/currencyFormatting';
import type { MonetaryAmount } from '../types';

interface FundShortfallBadgeProps {
  /** Renders nothing when null, absent or zero. */
  shortfall?: MonetaryAmount | null | undefined;
}

export const FundShortfallBadge: React.FC<FundShortfallBadgeProps> = ({ shortfall }) => {
  if (!shortfall || Number(shortfall) <= 0) return null;
  return (
    <span className="badge inline-flex items-center gap-1 bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
      <PiggyBank className="h-3 w-3" aria-hidden="true" />
      Over fund by {formatCurrency(shortfall)}
    </span>
  );
};

export default FundShortfallBadge;
