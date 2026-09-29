/**
 * DateTimeQuarterHour shows the time it will send.
 *
 * It used to floor the minute for display only: a stored 09:07 rendered as
 * 9:00 while the parent kept — and submitted — 09:07. On Edit Times that turned
 * a "9:00 to 1:00" correction into 233 credited minutes with nothing on screen
 * to say so, and the modal's own duration preview disagreed with the pickers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DateTimeQuarterHour from './DateTimeQuarterHour';

describe('DateTimeQuarterHour', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockReset();
  });

  it('displays an off-quarter minute rather than flooring it', () => {
    render(<DateTimeQuarterHour value="2026-09-20T09:07" onChange={onChange} />);
    expect(screen.getByLabelText('Time minute')).toHaveValue('07');
    expect(screen.getByLabelText('Time hour')).toHaveValue('9');
  });

  it('keeps the exact minute when the hour changes', async () => {
    const user = userEvent.setup();
    render(<DateTimeQuarterHour value="2026-09-20T09:07" onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText('Time hour'), '10');
    expect(onChange).toHaveBeenCalledWith('2026-09-20T10:07');
  });

  it('keeps the exact time when the date changes', () => {
    render(<DateTimeQuarterHour value="2026-09-20T09:07" onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('2026-09-20'), { target: { value: '2026-09-21' } });
    expect(onChange).toHaveBeenCalledWith('2026-09-21T09:07');
  });

  it('offers only quarter hours for a quarter-hour value', () => {
    render(<DateTimeQuarterHour value="2026-09-20T13:00" onChange={onChange} />);
    const options = Array.from(screen.getByLabelText<HTMLSelectElement>('Time minute').options, (o) => o.value);
    expect(options).toEqual(['00', '15', '30', '45']);
  });
});
