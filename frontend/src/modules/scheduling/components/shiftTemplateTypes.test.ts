import { describe, expect, it } from 'vitest';

import { emptyTemplateForm, newTemplateForm } from './shiftTemplateTypes';

describe('newTemplateForm', () => {
  it('ends the shift the default length after the 08:00 start', () => {
    const form = newTemplateForm({ defaultDurationHours: 10.5, defaultMinStaffing: 3 });
    expect(form.start_time_of_day).toBe('08:00');
    expect(form.end_time_of_day).toBe('18:30');
    expect(form.duration_hours).toBe('10.5');
    expect(form.min_staffing).toBe('3');
  });

  it('wraps a day or more and states the length outright', () => {
    expect(newTemplateForm({ defaultDurationHours: 24, defaultMinStaffing: 4 })).toMatchObject({
      end_time_of_day: '08:00',
      duration_hours: '24',
    });
    expect(newTemplateForm({ defaultDurationHours: 36, defaultMinStaffing: 4 })).toMatchObject({
      end_time_of_day: '20:00',
      duration_hours: '36',
    });
  });

  it('falls back to the blank form for unusable values', () => {
    const form = newTemplateForm({ defaultDurationHours: 0, defaultMinStaffing: Number.NaN });
    expect(form.end_time_of_day).toBe('20:00');
    expect(form.min_staffing).toBe(emptyTemplateForm.min_staffing);
  });
});
