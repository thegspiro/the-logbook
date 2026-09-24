/**
 * How a returning member's earlier service counts.
 *
 * Shown wherever a former member is brought back — Reactivate, and a status
 * change out of dropped/retired — because both open a new service stint and
 * both have to decide what the earlier ones are worth. The department's
 * setting is the default; the officer can choose otherwise for this member.
 */

import React from 'react';
import { RejoinServiceCredit } from '../constants/enums';
import type { RejoinServiceState } from '../hooks/useRejoinServiceOptions';
import { formatServiceSpan, spanFromDays } from '../utils/serviceLength';

/** Earlier service in days, as it will stand once the member is back. */
function earlierServiceDays(state: RejoinServiceState): number {
  const { history } = state;
  if (!history) return 0;
  if (state.needsPreviousServiceEnd && history.hire_date && state.previousServiceEnd) {
    const start = Date.parse(`${history.hire_date}T00:00:00Z`);
    const end = Date.parse(`${state.previousServiceEnd}T00:00:00Z`);
    return Number.isNaN(start) || Number.isNaN(end) ? 0 : Math.max(0, Math.round((end - start) / 86_400_000));
  }
  return history.credited_days + history.prior_days;
}

interface RejoinServiceFieldsProps {
  state: RejoinServiceState;
  disabled?: boolean | undefined;
}

export const RejoinServiceFields: React.FC<RejoinServiceFieldsProps> = ({ state, disabled = false }) => {
  if (state.loading) {
    return (
      <p className="text-theme-text-muted text-sm" role="status">
        Loading service history…
      </p>
    );
  }
  if (state.loadFailed || !state.history) {
    return (
      <p className="text-theme-text-muted text-sm">
        Their service history could not be loaded, so the department&apos;s default applies to earlier service.
      </p>
    );
  }

  const earlier = formatServiceSpan(spanFromDays(earlierServiceDays(state), state.previousServiceEnd || state.today));
  const isDefault = (value: RejoinServiceCredit) =>
    state.history?.default_rejoin_credit === value ? ' (department default)' : '';

  return (
    <fieldset disabled={disabled} className="m-0 min-w-0 space-y-3 border-0 p-0">
      <legend className="form-label">Earlier service ({earlier})</legend>
      <label className="flex items-start gap-2">
        <input
          type="radio"
          name="rejoin-service-credit"
          className="mt-1"
          checked={state.credit === RejoinServiceCredit.CONTINUE}
          onChange={() => state.setCredit(RejoinServiceCredit.CONTINUE)}
        />
        <span className="text-sm">
          <span className="text-theme-text-primary font-medium">
            Continue prior service{isDefault(RejoinServiceCredit.CONTINUE)}
          </span>
          <span className="text-theme-text-muted block">
            Earlier service keeps counting. Only the time away is left out.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2">
        <input
          type="radio"
          name="rejoin-service-credit"
          className="mt-1"
          checked={state.credit === RejoinServiceCredit.RESTART}
          onChange={() => state.setCredit(RejoinServiceCredit.RESTART)}
        />
        <span className="text-sm">
          <span className="text-theme-text-primary font-medium">
            Restart at zero{isDefault(RejoinServiceCredit.RESTART)}
          </span>
          <span className="text-theme-text-muted block">
            Service counts from the return date. Earlier service stays on record as prior service.
          </span>
        </span>
      </label>

      <div>
        <label htmlFor="rejoin-date" className="form-label">
          Return date
        </label>
        <input
          id="rejoin-date"
          type="date"
          className="form-input"
          value={state.rejoinDate}
          max={state.today}
          onChange={(e) => state.setRejoinDate(e.target.value)}
        />
      </div>

      {state.needsPreviousServiceEnd && (
        <div>
          <label htmlFor="previous-service-end" className="form-label">
            Last day of previous service
          </label>
          <input
            id="previous-service-end"
            type="date"
            className="form-input"
            value={state.previousServiceEnd}
            min={state.history.hire_date ?? undefined}
            max={state.today}
            onChange={(e) => state.setPreviousServiceEnd(e.target.value)}
          />
          <p className="text-theme-text-muted mt-1 text-xs">
            Estimated from their last status change. Correct it if you know the actual date.
          </p>
        </div>
      )}
    </fieldset>
  );
};

export default RejoinServiceFields;
