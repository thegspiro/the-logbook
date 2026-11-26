/**
 * The member roster's Time in seat filter, for officers holding
 * scheduling.report (owner decisions, 2026-11-26): choose a seat and a period
 * and the roster narrows to the members with credited time in it. The
 * figures come from /scheduling/seat-hours, the same numbers Reports, Hours by
 * Position shows. Everyone else never sees this, and nothing about another
 * member's hours reaches them.
 */

import React, { useId, useMemo } from 'react';
import { getPositionOptions } from '../../modules/scheduling/components/shiftTemplateTypes';
import { SEAT_PERIOD_LABELS, SeatPeriod } from './rosterSeatPeriod';

interface Props {
  position: string;
  period: SeatPeriod;
  onChange: (next: { position: string; period: SeatPeriod }) => void;
}

export const RosterSeatFilter: React.FC<Props> = ({ position, period, onChange }) => {
  const id = useId();
  const seats = useMemo(() => getPositionOptions(), []);
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={`${id}-seat`} className="sr-only">
        Time in seat
      </label>
      <select
        id={`${id}-seat`}
        className="form-input"
        value={position}
        onChange={(e) => onChange({ position: e.target.value, period })}
      >
        <option value="">Any time in seat</option>
        {seats.map((seat) => (
          <option key={seat.value} value={seat.value}>
            Time as {seat.label}
          </option>
        ))}
      </select>
      {position && (
        <>
          <label htmlFor={`${id}-period`} className="sr-only">
            Period
          </label>
          <select
            id={`${id}-period`}
            className="form-input"
            value={period}
            onChange={(e) =>
              onChange({
                position,
                period: (Object.values(SeatPeriod) as SeatPeriod[]).find((v) => v === e.target.value) ?? period,
              })
            }
          >
            {(Object.values(SeatPeriod) as SeatPeriod[]).map((value) => (
              <option key={value} value={value}>
                {SEAT_PERIOD_LABELS[value]}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
};

export default RosterSeatFilter;
