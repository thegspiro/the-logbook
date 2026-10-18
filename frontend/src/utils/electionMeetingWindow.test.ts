import { describe, it, expect } from 'vitest';
import { eventWindow, meetingWindow } from './electionMeetingWindow';

describe('meetingWindow', () => {
  it('joins the wall-clock date and times without reading them in any zone', () => {
    expect(meetingWindow({ meeting_date: '2026-11-05', start_time: '19:30:00', end_time: '21:00:00' })).toEqual({
      start: '2026-11-05T19:30',
      end: '2026-11-05T21:00',
    });
  });

  it('has no window without a start time', () => {
    expect(meetingWindow({ meeting_date: '2026-11-05' })).toEqual({ start: null, end: null });
  });

  it('drops an end that is missing or not after the start', () => {
    expect(meetingWindow({ meeting_date: '2026-11-05', start_time: '19:30:00' }).end).toBeNull();
    expect(meetingWindow({ meeting_date: '2026-11-05', start_time: '19:30:00', end_time: '19:30:00' }).end).toBeNull();
  });
});

describe('eventWindow', () => {
  it('converts UTC instants into the department zone', () => {
    expect(
      eventWindow({ start_datetime: '2026-11-06T00:30:00Z', end_datetime: '2026-11-06T02:00:00Z' }, 'America/New_York')
    ).toEqual({ start: '2026-11-05T19:30', end: '2026-11-05T21:00' });
  });
});
