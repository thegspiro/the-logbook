/**
 * "Who can charge these lines" — the setting a budget category carries, as
 * both the Treasurer's category dialog and the owner's own settings show it.
 *
 * Restricted lines are always open to the category's owner (and the owner of
 * any category above it); the positions ticked here are added to them. What
 * the backend actually enforces is `finance_budget_access`; this only edits it.
 */

import React from 'react';
import { ChargeAccess, isChargeAccess, type FinanceNamedOption } from '../types';
import type { ChargeAccessValue } from '../utils/chargeAccess';

interface ChargeAccessFieldsProps {
  idPrefix: string;
  value: ChargeAccessValue;
  onChange: (value: ChargeAccessValue) => void;
  positions: FinanceNamedOption[];
  /** True when the category has no parent, so "inherit" means open. */
  isTopLevel: boolean;
  /** The parent's name and rule, to say what "inherit" resolves to. */
  inheritedHint?: string | undefined;
}

export const ChargeAccessFields: React.FC<ChargeAccessFieldsProps> = ({
  idPrefix,
  value,
  onChange,
  positions,
  isTopLevel,
  inheritedHint,
}) => {
  const togglePosition = (id: string, checked: boolean) => {
    const positionIds = checked
      ? [...value.positionIds.filter((p) => p !== id), id]
      : value.positionIds.filter((p) => p !== id);
    onChange({ ...value, positionIds });
  };

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-access`} className="form-label">
          Who can charge these lines
        </label>
        <select
          id={`${idPrefix}-access`}
          className="form-input"
          value={value.access}
          onChange={(e) => {
            const next = e.target.value;
            onChange({ ...value, access: isChargeAccess(next) ? next : '' });
          }}
          aria-describedby={`${idPrefix}-access-hint`}
        >
          <option value="">
            {isTopLevel ? 'Anyone who submits requests (default)' : 'Same as the parent category'}
          </option>
          <option value={ChargeAccess.OPEN}>Anyone who submits requests</option>
          <option value={ChargeAccess.RESTRICTED}>Only the owner and the positions chosen below</option>
        </select>
        <p id={`${idPrefix}-access-hint`} className="text-theme-text-secondary mt-1 text-xs">
          {value.access === '' && inheritedHint
            ? inheritedHint
            : 'Restricted lines are hidden from everyone else on purchase, check and expense requests. The owner of this category, or of one above it, can always charge them.'}
        </p>
      </div>
      {value.access === ChargeAccess.RESTRICTED && (
        <fieldset>
          <legend className="form-label">Also allow these positions</legend>
          {positions.length === 0 ? (
            <p className="text-theme-text-secondary text-xs">No positions to choose from.</p>
          ) : (
            <div className="border-theme-surface-border max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
              {positions.map((position) => {
                const id = `${idPrefix}-position-${position.id}`;
                return (
                  <label key={position.id} htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      id={id}
                      type="checkbox"
                      className="form-checkbox"
                      checked={value.positionIds.includes(position.id)}
                      onChange={(e) => togglePosition(position.id, e.target.checked)}
                    />
                    <span className="text-theme-text-primary">{position.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
};
