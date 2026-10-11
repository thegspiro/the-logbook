import { describe, it, expect } from 'vitest';
import { AdminHoursEntryMethod } from '../../../constants/enums';
import { entryMethodLabel } from './entryMethod';

describe('entryMethodLabel', () => {
  it('labels every method the backend can record', () => {
    expect(entryMethodLabel(AdminHoursEntryMethod.QR_SCAN)).toBe('QR Scan');
    expect(entryMethodLabel(AdminHoursEntryMethod.NFC_STATION)).toBe('ID Card Station');
    expect(entryMethodLabel(AdminHoursEntryMethod.MANUAL)).toBe('Manual');
    expect(entryMethodLabel(AdminHoursEntryMethod.EVENT_ATTENDANCE)).toBe('Event Attendance');
  });

  it('keeps an unknown method readable instead of rendering nothing', () => {
    expect(entryMethodLabel('kiosk_badge_tap')).toBe('kiosk badge tap');
  });
});
