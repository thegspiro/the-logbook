/**
 * The calendar file carries the DTSTAMP every event must have (RFC 5545);
 * some calendars refuse an event without one.
 */
import { describe, it, expect } from 'vitest';
import { generateICSContent } from './eventHelpers';

describe('generateICSContent', () => {
  it('stamps the event', () => {
    const ics = generateICSContent({
      id: 'ev-1',
      title: 'Hose testing',
      location: 'Station 3 Bay',
      start_datetime: '2026-12-05T14:00:00Z',
      end_datetime: '2026-12-05T16:00:00Z',
    });

    expect(ics).toMatch(/\r?\nDTSTAMP:\d{8}T\d{6}Z\r?\n/);
    expect(ics).toContain('LOCATION:Station 3 Bay');
  });
});
