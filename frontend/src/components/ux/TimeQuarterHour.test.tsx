import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TimeQuarterHour from './TimeQuarterHour';

const minuteOptions = () => Array.from(screen.getByLabelText<HTMLSelectElement>('Time minute').options, (o) => o.value);

describe('TimeQuarterHour', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockReset();
  });

  describe('default (quarter-hour) mode', () => {
    it('offers exactly the four quarter-hour minutes', () => {
      render(<TimeQuarterHour value="09:30" onChange={onChange} />);
      expect(minuteOptions()).toEqual(['00', '15', '30', '45']);
    });

    it('floors an off-quarter minute, as every existing caller expects', () => {
      render(<TimeQuarterHour value="09:07" onChange={onChange} />);
      expect(screen.getByLabelText('Time minute')).toHaveValue('00');
    });
  });

  describe('preserveOffQuarterMinute', () => {
    it('shows the minute the value really carries', () => {
      render(<TimeQuarterHour value="09:07" onChange={onChange} preserveOffQuarterMinute />);
      expect(screen.getByLabelText('Time minute')).toHaveValue('07');
      expect(minuteOptions()).toEqual(['00', '07', '15', '30', '45']);
    });

    it('keeps the off-quarter minute when the hour changes', async () => {
      const user = userEvent.setup();
      render(<TimeQuarterHour value="09:07" onChange={onChange} preserveOffQuarterMinute />);
      await user.selectOptions(screen.getByLabelText('Time hour'), '10');
      expect(onChange).toHaveBeenCalledWith({ target: { value: '10:07' } });
    });

    it('keeps the off-quarter minute when AM/PM changes', async () => {
      const user = userEvent.setup();
      render(<TimeQuarterHour value="09:07" onChange={onChange} preserveOffQuarterMinute />);
      await user.selectOptions(screen.getByLabelText('Time AM/PM'), 'PM');
      expect(onChange).toHaveBeenCalledWith({ target: { value: '21:07' } });
    });

    it('adds no extra option for a quarter-hour value', () => {
      render(<TimeQuarterHour value="09:45" onChange={onChange} preserveOffQuarterMinute />);
      expect(minuteOptions()).toEqual(['00', '15', '30', '45']);
    });
  });
});
