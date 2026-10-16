import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lastCheckLabel } from './lastCheckLabel';

describe('lastCheckLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T18:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives only the time for a check made today in the viewer’s zone', () => {
    expect(lastCheckLabel('2026-10-16T11:10:00Z', 'America/New_York')).toBe('7:10 AM');
  });

  it('adds the date for an earlier day', () => {
    expect(lastCheckLabel('2026-10-14T11:10:00Z', 'America/New_York')).toMatch(/Oct 14/);
  });
});
