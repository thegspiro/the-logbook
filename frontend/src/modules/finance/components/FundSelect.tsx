/**
 * Charges a payment to a restricted fund — a fundraising campaign whose donors
 * gave for a stated purpose. The requester picks it, since they know what the
 * money is for. Shows what the fund has left and warns, under the department's
 * rule, when this form charges it more than that; the server makes the
 * decision on approval (app/services/restricted_funds.py).
 *
 * Hidden while the department has no restricted funds and none is chosen.
 */

import React from 'react';
import { FormField } from '@/components/ux/FormField';
import { formatCurrency } from '@/utils/currencyFormatting';
import type { FundOption, FundOverspendMode } from '../types';
import { fundOverspendWarning } from '../utils/funds';

interface FundSelectProps {
  id: string;
  value: string;
  onChange: (fundId: string) => void;
  /** What this form charges the chosen fund, in total. */
  amount: number;
  funds: FundOption[];
  mode: FundOverspendMode;
  /** A refusal of the fund, from the form's validation or a server 422. */
  error?: string | undefined;
}

export const FundSelect: React.FC<FundSelectProps> = ({ id, value, onChange, amount, funds, mode, error }) => {
  if (funds.length === 0 && !value) return null;
  const chosen = funds.find((f) => f.campaignId === value);
  const warning = chosen ? fundOverspendWarning(mode, amount - Number(chosen.available)) : null;
  const hintId = `${id}-hint`;

  return (
    <div>
      <FormField id={id} label="Restricted fund" error={error}>
        {(field) => (
          <select
            {...field}
            className="form-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-describedby={
              [field['aria-describedby'], chosen ? hintId : null].filter(Boolean).join(' ') || undefined
            }
          >
            <option value="">Not paid from a restricted fund</option>
            {funds.map((f) => (
              <option key={f.campaignId} value={f.campaignId}>
                {f.name} — {formatCurrency(f.available)} left
              </option>
            ))}
            {value && !chosen && <option value={value}>A fund that is no longer open</option>}
          </select>
        )}
      </FormField>
      {chosen && (
        <div id={hintId}>
          {chosen.purpose && (
            <p className="text-theme-text-secondary mt-1 text-xs">Donors gave this for: {chosen.purpose}</p>
          )}
          {warning && (
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300" role="status">
              {warning}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default FundSelect;
