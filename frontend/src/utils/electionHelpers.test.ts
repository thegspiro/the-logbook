import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getTimeRemaining,
  getStatusBadgeClass,
  getVictoryDescription,
} from './electionHelpers';
import { ElectionStatus, VictoryCondition } from '../constants/enums';
import type { Election } from '../types/election';

const makeElection = (overrides: Partial<Election>): Election =>
  ({
    victory_condition: VictoryCondition.MOST_VOTES,
    victory_threshold: null,
    victory_percentage: null,
    ...overrides,
  }) as Election;

describe('getTimeRemaining', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats days and hours when more than a day remains', () => {
    expect(getTimeRemaining('2026-06-12T17:00:00Z')).toBe('2d 5h remaining');
  });

  it('formats hours and minutes when less than a day remains', () => {
    expect(getTimeRemaining('2026-06-10T15:45:00Z')).toBe('3h 45m remaining');
  });

  it('formats minutes when less than an hour remains', () => {
    expect(getTimeRemaining('2026-06-10T12:45:00Z')).toBe('45m remaining');
  });

  it('returns null when the end date is in the past', () => {
    expect(getTimeRemaining('2026-06-10T11:59:00Z')).toBeNull();
  });

  it('returns null when the end date is exactly now', () => {
    expect(getTimeRemaining('2026-06-10T12:00:00Z')).toBeNull();
  });

  it('returns null for an unparseable date instead of "NaNm remaining"', () => {
    expect(getTimeRemaining('not-a-date')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(getTimeRemaining('')).toBeNull();
  });
});

describe('getStatusBadgeClass', () => {
  it('returns green classes for open elections', () => {
    expect(getStatusBadgeClass(ElectionStatus.OPEN)).toContain('green');
  });

  it('returns yellow classes for drafts', () => {
    expect(getStatusBadgeClass(ElectionStatus.DRAFT)).toContain('yellow');
  });

  it('returns red classes for cancelled elections', () => {
    expect(getStatusBadgeClass(ElectionStatus.CANCELLED)).toContain('red');
  });

  it('returns muted classes for closed elections', () => {
    expect(getStatusBadgeClass(ElectionStatus.CLOSED)).toContain(
      'text-theme-text-muted',
    );
  });

  it('falls back to muted classes for unknown statuses', () => {
    expect(getStatusBadgeClass('bogus')).toContain('text-theme-text-muted');
  });
});

describe('getVictoryDescription', () => {
  it('describes plurality', () => {
    const e = makeElection({ victory_condition: VictoryCondition.MOST_VOTES });
    expect(getVictoryDescription(e)).toBe('Most Votes (Plurality)');
  });

  it('describes majority', () => {
    const e = makeElection({ victory_condition: VictoryCondition.MAJORITY });
    expect(getVictoryDescription(e)).toBe('Majority (>50% of votes)');
  });

  it('describes supermajority with a configured percentage', () => {
    const e = makeElection({
      victory_condition: VictoryCondition.SUPERMAJORITY,
      victory_percentage: 75,
    });
    expect(getVictoryDescription(e)).toBe('Supermajority (75% of votes)');
  });

  it('defaults supermajority to 67% when unconfigured', () => {
    const e = makeElection({
      victory_condition: VictoryCondition.SUPERMAJORITY,
    });
    expect(getVictoryDescription(e)).toBe('Supermajority (67% of votes)');
  });

  it('describes a vote-count threshold', () => {
    const e = makeElection({
      victory_condition: VictoryCondition.THRESHOLD,
      victory_threshold: 25,
    });
    expect(getVictoryDescription(e)).toBe('Threshold (25 votes required)');
  });

  it('describes a percentage threshold when no count is set', () => {
    const e = makeElection({
      victory_condition: VictoryCondition.THRESHOLD,
      victory_percentage: 60,
    });
    expect(getVictoryDescription(e)).toBe('Threshold (60% of votes required)');
  });

  it('describes a bare threshold when nothing is configured', () => {
    const e = makeElection({ victory_condition: VictoryCondition.THRESHOLD });
    expect(getVictoryDescription(e)).toBe('Threshold');
  });

  it('falls back to simple majority for unknown conditions', () => {
    const e = makeElection({
      victory_condition: 'mystery' as Election['victory_condition'],
    });
    expect(getVictoryDescription(e)).toBe('Simple Majority');
  });
});
