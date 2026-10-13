import { formatCurrency } from '@/utils/currencyFormatting';
import { FundOverspendMode } from '../types';

/** The request form's warning for a charge `over` past what its restricted fund has left, or null. */
export const fundOverspendWarning = (mode: FundOverspendMode, over: number): string | null => {
  if (over <= 0 || mode === FundOverspendMode.OFF) return null;
  const amount = formatCurrency(over);
  return mode === FundOverspendMode.BLOCK
    ? `This is ${amount} more than the fund has left. The department does not allow a fund to be overspent, so it cannot be approved until the fund has enough.`
    : `This is ${amount} more than the fund has left. It can still be approved, and the approvers will see the shortfall.`;
};
