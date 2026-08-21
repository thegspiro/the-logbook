import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatRelativeTime } from './useRelativeTime';

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return an empty string for a missing date', () => {
    expect(formatRelativeTime(null)).toBe('');
    expect(formatRelativeTime(undefined)).toBe('');
    expect(formatRelativeTime('')).toBe('');
  });

  it('should read backwards for past timestamps', () => {
    expect(formatRelativeTime('2026-03-15T09:00:00Z')).toBe('3 hours ago');
    expect(formatRelativeTime('2026-03-14T12:00:00Z')).toBe('1 day ago');
    expect(formatRelativeTime('2025-12-15T12:00:00Z')).toBe('3 months ago');
  });

  // An events list is mostly ahead of the viewer: collapsing the future to
  // "just now" labelled every upcoming event as happening right now.
  it('should read forwards for future timestamps', () => {
    expect(formatRelativeTime('2026-03-15T15:00:00Z')).toBe('in 3 hours');
    expect(formatRelativeTime('2026-03-16T12:00:00Z')).toBe('in 1 day');
    expect(formatRelativeTime('2026-03-25T12:00:00Z')).toBe('in 1 week');
  });

  it('should call the surrounding minute "just now" in either direction', () => {
    expect(formatRelativeTime('2026-03-15T11:59:30Z')).toBe('just now');
    expect(formatRelativeTime('2026-03-15T12:00:30Z')).toBe('just now');
  });
});
